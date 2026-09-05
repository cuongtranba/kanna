import { readFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { toError } from "../../shared/errors"
import { errorMessage } from "../../shared/errors"
import {
  CLIENT_HOST_MODULES,
  hostModuleUnavailableMessage,
  SERVER_HOST_MODULES,
} from "../../shared/plugins/host-modules"
import * as pluginRpcProtocolModule from "./plugin-rpc-protocol"

export interface BuildPluginBundlesArgs {
  readonly sourceDir: string
  readonly entry: string
}

export type BuildPluginBundlesResult =
  | { readonly ok: true; readonly client: string; readonly server: string }
  | { readonly ok: false; readonly errors: string[] }

const BARE_SPECIFIER_PATTERN = /^[^./]/

const SERVER_FILE_PATTERN = /\.server\.[jt]sx?$/

const LITERAL_EXPORT_PATTERN = /export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(["'`])((?:(?!\1).)*)\1/g

const HOST_REQUIRE_NAMESPACE = "kanna-host-require"
const HOST_STUB_NAMESPACE = "kanna-host-stub"

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
    return { ok: false, errors: describeThrownBuildError(toError(error)) }
  }
}

function describeThrownBuildError(error: Error): string[] {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map((sub) => errorMessage(sub))
  }
  return [errorMessage(error)]
}

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
