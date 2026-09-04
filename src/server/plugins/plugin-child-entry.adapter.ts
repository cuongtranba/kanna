/**
 * Subprocess entry point for one running Kanna plugin instance. Spawned by
 * `plugin-service-io.adapter.ts` as
 * `<bun> plugin-child-entry.adapter.ts <bundlePath> <socketPath>` and runs as
 * its OWN OS process by design — plugin code is unsandboxed, and a crash
 * here must never take the Kanna daemon down (PLUGIN-SYSTEM-PLAN.md "Server
 * runtime").
 *
 * Wires the runtime half of the plugin ABI (`@kanna/plugin/server`, `zod`)
 * that the compiled server bundle's rewritten `require(...)` calls resolve
 * against — see `../../shared/plugins/host-modules.ts` and
 * `plugin-build.adapter.ts`'s `hostModulePlugin`, which turns every bare
 * import into `globalThis.__KANNA_PLUGIN_HOST__.require(name)`. That require
 * MUST be synchronous: Bun bundles the whole plugin into one file, so the
 * shimmed `require()` call runs during the bundle's own top-level module
 * evaluation, not lazily — `zod` is therefore imported up front, before the
 * bundle is ever loaded.
 *
 * Connects to the host's ALREADY-LISTENING Unix socket (the host binds
 * before spawning this process — see `plugin-service.ts`'s `start` — so this
 * side never has to retry a connection race) and answers RPC calls: zod
 * validates input, runs the registered handler, zod validates output, then
 * replies. A rejected schema resolves `{ok:false}` rather than throwing —
 * the security contract this file exists to hold (acceptance test "a
 * rejected output schema fails the call rather than returning bad data").
 */
import { createConnection } from "node:net"
import { createInterface } from "node:readline"
import * as zod from "zod"
import { type LoadedModule } from "../../shared/dynamic-module"
import { errorMessage, isRecord } from "../../shared/errors"
import { type JsonValue } from "../../shared/json"
import {
  defineRpc,
  encodePluginLine,
  parsePluginHostCallMessage,
  type PluginChildMessage,
  type PluginHostCallMessage,
  type PluginRpcContract,
} from "./plugin-rpc-protocol"

type PluginRpcHandler = (input: JsonValue) => JsonValue | Promise<JsonValue>

interface RegisteredRpc {
  readonly contract: PluginRpcContract
  readonly handler: PluginRpcHandler
}

interface PluginContext {
  handle(contract: PluginRpcContract, handler: PluginRpcHandler): void
  // No-ops on the server target — UI contribution is a client-only concept.
  // See PLUGIN-SYSTEM-PLAN.md "Registration stripping without Babel": both
  // bundles compile from the same entry, and the OTHER side's calls are
  // meant to be harmless here, not reachable.
  //
  // EVERY client-side `add*` must appear here. The entry runs whole in the
  // child, so a method missing from this mirror is not an inert call — it is a
  // TypeError inside `contribute`, and the child then never reports ready. A
  // plugin that contributes UI *and* an RPC handler dies at startup with a
  // timeout that names nothing.
  addSurface(): void
  addSidebarItem(): void
  addCommandCenterItem(): void
}

function createPluginContext(handlers: Map<string, RegisteredRpc>): PluginContext {
  return {
    handle(contract, handler) {
      handlers.set(contract.name, { contract, handler })
    },
    addSurface() {},
    addSidebarItem() {},
    addCommandCenterItem() {},
  }
}

function installHostModuleRequire(): void {
  Object.assign(globalThis, {
    __KANNA_PLUGIN_HOST__: {
      require(name: string): LoadedModule {
        if (name === "zod") return zod
        if (name === "@kanna/plugin/server") return { defineRpc }
        throw new Error(`plugin-child-entry: host module "${name}" is not available in server code`)
      },
    },
  })
}

function isContributeExport(value: LoadedModule): value is { default: (context: PluginContext) => void } {
  return isRecord(value) && typeof value.default === "function"
}

async function loadContribute(bundlePath: string): Promise<(context: PluginContext) => void> {
  const loaded: LoadedModule = await import(bundlePath)
  if (!isContributeExport(loaded)) {
    throw new Error(`plugin-child-entry: ${bundlePath} has no default export`)
  }
  return loaded.default
}

async function handleCall(
  send: (message: PluginChildMessage) => void,
  handlers: Map<string, RegisteredRpc>,
  call: PluginHostCallMessage,
): Promise<void> {
  const registered = handlers.get(call.method)
  if (!registered) {
    send({ type: "result", id: call.id, ok: false, error: `no handler registered for "${call.method}"` })
    return
  }
  const parsedInput = registered.contract.input.safeParse(call.params)
  if (!parsedInput.success) {
    send({ type: "result", id: call.id, ok: false, error: `input schema rejected: ${parsedInput.error.message}` })
    return
  }
  let output: JsonValue
  try {
    output = await registered.handler(parsedInput.data)
  } catch (error) {
    send({ type: "result", id: call.id, ok: false, error: errorMessage(error) })
    return
  }
  const parsedOutput = registered.contract.output.safeParse(output)
  if (!parsedOutput.success) {
    send({ type: "result", id: call.id, ok: false, error: `output schema rejected: ${parsedOutput.error.message}` })
    return
  }
  send({ type: "result", id: call.id, ok: true, output: parsedOutput.data })
}

async function main(): Promise<void> {
  const [bundlePath, socketPath] = process.argv.slice(2)
  if (!bundlePath || !socketPath) {
    throw new Error("plugin-child-entry: expected <bundlePath> <socketPath> arguments")
  }

  installHostModuleRequire()
  const contribute = await loadContribute(bundlePath)

  const handlers = new Map<string, RegisteredRpc>()
  contribute(createPluginContext(handlers))

  const socket = createConnection({ path: socketPath })
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })

  const send = (message: PluginChildMessage): void => {
    socket.write(encodePluginLine(message))
  }

  const lines = createInterface({ input: socket })
  send({ type: "ready" })

  for await (const line of lines) {
    const call = parsePluginHostCallMessage(line)
    if (!call) continue
    void handleCall(send, handlers, call)
  }
}

main().catch((error) => {
  process.stderr.write(`plugin-child-entry: fatal: ${errorMessage(error)}\n`)
  process.exit(1)
})
