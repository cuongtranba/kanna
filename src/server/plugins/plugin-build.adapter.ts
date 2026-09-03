import { readFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import type { AnyValue } from "../../shared/errors"
import { errorMessage } from "../../shared/errors"
import {
  CLIENT_HOST_MODULES,
  hostModuleUnavailableMessage,
  SERVER_HOST_MODULES,
} from "../../shared/plugins/host-modules"
import * as pluginRpcProtocolModule from "./plugin-rpc-protocol"

/**
 * The only file allowed to call `Bun.build` (side-effect seal: `.adapter.ts`).
 * Compiles one plugin entry into a browser bundle and a Bun bundle from the
 * SAME source, giving each target its own host-module ABI so a plugin ships
 * no dependencies of its own — see `host-modules.ts` for the allowlists.
 */
export interface BuildPluginBundlesArgs {
  readonly sourceDir: string
  readonly entry: string
}

export type BuildPluginBundlesResult =
  | { readonly ok: true; readonly client: string; readonly server: string }
  | { readonly ok: false; readonly errors: string[] }

/** Bare-specifier matcher: relative (`./x`, `../x`) and absolute paths resolve normally. */
const BARE_SPECIFIER_PATTERN = /^[^./]/

/** Matches `greeting.server.ts` / `secret.server.tsx`, never `greeting.shared.ts`. */
const SERVER_FILE_PATTERN = /\.server\.[jt]sx?$/

/** `export const NAME = "literal"` — the only shape a `.server.` file's exported secret takes. */
const LITERAL_EXPORT_PATTERN = /export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(["'`])((?:(?!\1).)*)\1/g

const HOST_REQUIRE_NAMESPACE = "kanna-host-require"
const HOST_STUB_NAMESPACE = "kanna-host-stub"

/**
 * A `Bun.build` plugin resolving each ABI module exactly (never by prefix —
 * `Bun.build`'s own `external` array treats `@scope/pkg` as a prefix, which
 * would silently also externalize `@scope/pkg/server`; MEASURED). A module
 * that belongs to the OTHER target's ABI (e.g. `@kanna/plugin/server` seen
 * while compiling the client) resolves to a stub rather than refusing —
 * `Bun.build` never executes the code, so a stubbed capability that is
 * unreachable on this target costs nothing at compile time and lets a
 * `.shared.ts` contract file (which legitimately references both sides'
 * names) compile for both. Anything off BOTH lists is refused — thrown, not
 * returned as `{errors:[...]}`, because `Bun.build` silently ignores that
 * esbuild-style shape and reports `success:true` with the bad import intact
 * (MEASURED regression, see PLUGIN-SYSTEM-PLAN.md).
 *
 * The stub is a `Proxy` answering any property access with an identity
 * function, not a bare `{}` — `.shared.ts` contract files legitimately call
 * the OTHER side's declarative builders (`defineRpc(contract)` from
 * `@kanna/plugin/server`) at MODULE TOP LEVEL, which is the whole point of a
 * "shared" contract file. A bare-object stub answers that call with
 * `undefined(...)`, throwing `TypeError: ... is not a function` before the
 * plugin's `default` export ever runs (MEASURED: `greeting.shared.ts` calling
 * `defineRpc(...)` on the client build). The identity function is the
 * correct no-op for a declarative builder — it returns its argument
 * unchanged and does nothing at runtime, so no server capability leaks
 * (the literal-leak case is guarded separately by `findServerLiteralLeaks`).
 *
 * A `get`-only trap is not enough. `import { defineRpc } from "..."` compiles
 * to a direct `H.defineRpc` property access on the CJS-interop namespace
 * object (`__toESM`'s helper), and that helper populates named bindings by
 * calling `Object.getOwnPropertyNames` on our exports value ONCE at module
 * load — BEFORE `defineRpc` is ever accessed. A Proxy whose only trap is
 * `get` forwards that enumeration to its (empty) target, so `H.defineRpc`
 * resolves to `undefined` and throws `TypeError: H.defineRpc is not a
 * function` (MEASURED: this is exactly the bug the `get`-only version of
 * this stub shipped with). The fix adds `ownKeys`/`getOwnPropertyDescriptor`
 * traps reporting the OTHER side's REAL export names — sourced from the real
 * module (`STUB_EXPORT_NAMES`) so the list can never drift from what that
 * module actually exports. A name outside this known list is still reachable
 * via `H.default.<name>`, which goes through the `get` trap directly.
 */
const STUB_EXPORT_NAMES: Readonly<Record<string, readonly string[]>> = {
  "@kanna/plugin/server": Object.keys(pluginRpcProtocolModule),
}

function hostModulePlugin(ownModules: readonly string[], otherModules: readonly string[]): Bun.BunPlugin {
  return {
    name: "kanna-host-modules",
    setup(build) {
      build.onResolve({ filter: BARE_SPECIFIER_PATTERN }, (args) => {
        if (ownModules.includes(args.path)) {
          return { path: args.path, namespace: HOST_REQUIRE_NAMESPACE }
        }
        if (otherModules.includes(args.path)) {
          return { path: args.path, namespace: HOST_STUB_NAMESPACE }
        }
        throw new Error(hostModuleUnavailableMessage(args.path))
      })
      build.onLoad({ filter: /.*/, namespace: HOST_REQUIRE_NAMESPACE }, (args) => ({
        contents: `module.exports = globalThis.__KANNA_PLUGIN_HOST__.require(${JSON.stringify(args.path)})`,
        loader: "js",
      }))
      build.onLoad({ filter: /.*/, namespace: HOST_STUB_NAMESPACE }, (args) => ({
        contents: [
          `const KNOWN_NAMES = ${JSON.stringify(STUB_EXPORT_NAMES[args.path] ?? [])}`,
          "const identity = (value) => value",
          "module.exports = new Proxy({}, {",
          "  get: () => identity,",
          "  has: () => true,",
          "  ownKeys: () => KNOWN_NAMES,",
          "  getOwnPropertyDescriptor: (_target, prop) =>",
          "    KNOWN_NAMES.includes(prop)",
          "      ? { value: identity, enumerable: true, configurable: true, writable: true }",
          "      : undefined,",
          "})",
        ].join("\n"),
        loader: "js",
      }))
    },
  }
}

interface TargetBuildArgs {
  readonly sourceDir: string
  readonly entry: string
  readonly target: "browser" | "bun"
  readonly minify: boolean
  readonly ownModules: readonly string[]
  readonly otherModules: readonly string[]
}

type TargetBuildResult =
  | { readonly ok: true; readonly code: string; readonly inputPaths: readonly string[] }
  | { readonly ok: false; readonly errors: string[] }

async function buildTarget(args: TargetBuildArgs): Promise<TargetBuildResult> {
  try {
    const result = await Bun.build({
      entrypoints: [join(args.sourceDir, args.entry)],
      target: args.target,
      format: "esm",
      minify: args.minify,
      metafile: true,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      plugins: [hostModulePlugin(args.ownModules, args.otherModules)],
    })
    if (!result.success) {
      return { ok: false, errors: result.logs.map((log) => log.message) }
    }
    const [output] = result.outputs
    if (!output) return { ok: false, errors: ["Bun.build produced no output artifact."] }
    const inputPaths = result.metafile ? Object.keys(result.metafile.inputs) : []
    return { ok: true, code: await output.text(), inputPaths }
  } catch (error) {
    return { ok: false, errors: describeThrownBuildError(error) }
  }
}

/**
 * `Bun.build` rejects a throwing plugin with an `AggregateError` whose OWN
 * `.message` is the generic "Bundle failed" — the plugin's actual thrown
 * message (e.g. `hostModuleUnavailableMessage`) lives in `.errors`. MEASURED:
 * without unwrapping this, every plugin-thrown refusal surfaced as the
 * useless literal string "Bundle failed" instead of the documented message.
 */
function describeThrownBuildError(error: AnyValue): string[] {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map((sub) => errorMessage(sub))
  }
  return [errorMessage(error)]
}

/**
 * SECURITY: a `.server.` file may compile into the client bundle (its code is
 * no more sensitive than any other plugin code — only its RUNTIME capability
 * is server-only), but a raw literal it exports must never survive tree-shaking
 * into the output. MEASURED regression: `greeting.server.ts`'s used
 * `createGreeting` function legitimately reaches the client bundle via
 * `plugin.handle(contract, createGreeting)` — a no-op registration on the
 * client — while `secret.server.ts`'s literal `LEAKED_SECRET_MARKER`, used the
 * same way, would ship its actual string value to the browser. Scoped to
 * `metafile.inputs` (files the CLIENT build actually reached), not every
 * `.server.` file under `sourceDir` — an unreached file can never leak.
 */
async function findServerLiteralLeaks(
  sourceDir: string,
  clientInputPaths: readonly string[],
  clientCode: string,
): Promise<string[]> {
  const errors: string[] = []
  for (const inputPath of clientInputPaths) {
    if (!SERVER_FILE_PATTERN.test(inputPath)) continue
    const absolutePath = resolve(process.cwd(), inputPath)
    if (relative(sourceDir, absolutePath).startsWith("..")) continue
    const source = await readFile(absolutePath, "utf8")
    for (const match of source.matchAll(LITERAL_EXPORT_PATTERN)) {
      const literal = match[2]
      if (literal.length === 0 || !clientCode.includes(literal)) continue
      errors.push(
        `Server-only content leaked into the client bundle: a literal exported from ` +
          `${relative(sourceDir, absolutePath)} (a *.server file) is reachable from client code.`,
      )
    }
  }
  return errors
}

export async function buildPluginBundles({ sourceDir, entry }: BuildPluginBundlesArgs): Promise<BuildPluginBundlesResult> {
  const client = await buildTarget({
    sourceDir,
    entry,
    target: "browser",
    minify: true,
    ownModules: CLIENT_HOST_MODULES,
    otherModules: SERVER_HOST_MODULES,
  })
  if (!client.ok) return { ok: false, errors: client.errors }

  const leaks = await findServerLiteralLeaks(sourceDir, client.inputPaths, client.code)
  if (leaks.length > 0) return { ok: false, errors: leaks }

  const server = await buildTarget({
    sourceDir,
    entry,
    target: "bun",
    minify: false,
    ownModules: SERVER_HOST_MODULES,
    otherModules: CLIENT_HOST_MODULES,
  })
  if (!server.ok) return { ok: false, errors: server.errors }

  return { ok: true, client: client.code, server: server.code }
}
