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
