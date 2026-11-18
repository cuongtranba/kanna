import { spawn } from "node:child_process"
import { readFile, realpath } from "node:fs/promises"
import { isBuiltin } from "node:module"
import { createInterface } from "node:readline"
import { join, relative, resolve, sep } from "node:path"
import { toError } from "../../shared/errors"
import { isPathInside } from "../path-containment"
import { errorMessage } from "../../shared/errors"
import { isJsonArray, isJsonObject, safeJsonParse } from "../../shared/json"
import { CLIENT_HOST_MODULES, PLUGIN_HOST_GLOBAL, type PluginHostTarget } from "../../shared/plugins/host-modules"
import { spawnCapture } from "../process-utils.adapter"
import { SERVER_HOST_MODULES } from "./server-host-modules"
import * as pluginRpcProtocolModule from "./plugin-rpc-protocol"

export interface BuildPluginBundlesArgs {
  readonly sourceDir: string
  readonly entry: string
  readonly childPath?: string
  readonly deadlineMs?: number
}

export type BuildPluginBundlesResult =
  | { readonly ok: true; readonly client: string; readonly server: string }
  | { readonly ok: false; readonly errors: string[] }

export const PLUGIN_BUILD_RESULT_MARKER = "__KANNA_PLUGIN_BUILD_RESULT__"

const BUILD_CHILD_PATH = join(import.meta.dirname, "plugin-build-child.adapter.ts")

const BUILD_CHILD_DEADLINE_MS = 20_000

const STDERR_TAIL_LINES = 20

const BARE_SPECIFIER_PATTERN = /^[^./]/

const SERVER_FILE_PATTERN = /\.server\.[jt]sx?$/

const LITERAL_EXPORT_PATTERN = /export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(["'`])((?:(?!\1).)*)\1/g

const HOST_REQUIRE_NAMESPACE = "kanna-host-require"
const HOST_STUB_NAMESPACE = "kanna-host-stub"
const SERVER_ONLY_STUB_NAMESPACE = "kanna-server-only-stub"

const DEPENDENCY_INSTALL_DEADLINE_MS = 300_000

const LOCKFILE_NAMES = ["bun.lock", "bun.lockb"] as const

const STUB_EXPORT_NAMES: Readonly<Record<string, readonly string[]>> = {
  "@kanna/plugin/server": Object.keys(pluginRpcProtocolModule),
}

const SERVER_ONLY_STUB_SOURCE = [
  "const inert = new Proxy(function () {}, {",
  "  get: (_target, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => '' : inert),",
  "  apply: () => inert,",
  "  construct: () => inert,",
  "  getPrototypeOf: () => inert,",
  "})",
  "module.exports = inert",
].join("\n")

function isRuntimeBuiltin(specifier: string): boolean {
  return isBuiltin(specifier) || specifier === "bun" || specifier.startsWith("bun:")
}

function isPluginOwnFile(pluginRoot: string, importer: string): boolean {
  return importer.length > 0 && isPathInside(pluginRoot, importer) && !importer.split(sep).includes("node_modules")
}

function serverOnlyBuiltinMessage(specifier: string): string {
  return `Module "${specifier}" is server-only: import it from a *.server.ts file so the client build can stub it`
}

interface HostModulePluginArgs {
  readonly host: PluginHostTarget
  readonly sourceDir: string
  readonly ownModules: readonly string[]
  readonly otherModules: readonly string[]
}

function hostModulePlugin({ host, sourceDir, ownModules, otherModules }: HostModulePluginArgs): Bun.BunPlugin {
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
        if (host === "server" || !isPluginOwnFile(sourceDir, args.importer)) return undefined
        if (SERVER_FILE_PATTERN.test(args.importer)) {
          return { path: args.path, namespace: SERVER_ONLY_STUB_NAMESPACE }
        }
        if (isRuntimeBuiltin(args.path)) throw new Error(serverOnlyBuiltinMessage(args.path))
        return undefined
      })
      build.onLoad({ filter: /.*/, namespace: SERVER_ONLY_STUB_NAMESPACE }, () => ({
        contents: SERVER_ONLY_STUB_SOURCE,
        loader: "js",
      }))
      build.onLoad({ filter: /.*/, namespace: HOST_REQUIRE_NAMESPACE }, (args) => ({
        contents: `module.exports = globalThis.${PLUGIN_HOST_GLOBAL}.require(${JSON.stringify(args.path)})`,
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
      plugins: [
        hostModulePlugin({
          host: args.target === "browser" ? "client" : "server",
          sourceDir: args.sourceDir,
          ownModules: args.ownModules,
          otherModules: args.otherModules,
        }),
      ],
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
    return error.errors.map((sub) =>
      sub instanceof BuildMessage || sub instanceof ResolveMessage ? sub.message : errorMessage(sub),
    )
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
    if (!isPathInside(sourceDir, absolutePath)) continue
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

export async function buildPluginBundlesInProcess({
  sourceDir: givenSourceDir,
  entry,
}: BuildPluginBundlesArgs): Promise<BuildPluginBundlesResult> {
  const sourceDir = await realpath(givenSourceDir).catch(() => resolve(givenSourceDir))
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

function decodeChildResult(payload: string): BuildPluginBundlesResult | null {
  const parsed = safeJsonParse(payload)
  if (parsed === null || !isJsonObject(parsed)) return null
  if (parsed.ok === true && typeof parsed.client === "string" && typeof parsed.server === "string") {
    return { ok: true, client: parsed.client, server: parsed.server }
  }
  const errors = parsed.errors
  if (parsed.ok === false && errors !== undefined && isJsonArray(errors)) {
    return { ok: false, errors: errors.filter((entry): entry is string => typeof entry === "string") }
  }
  return null
}

interface BuildChildOutcome {
  readonly result: BuildPluginBundlesResult | null
  readonly harnessError: string
}

function runBuildChild(args: {
  readonly sourceDir: string
  readonly entry: string
  readonly childPath: string
  readonly deadlineMs: number
}): Promise<BuildChildOutcome> {
  return new Promise((resolveOutcome) => {
    const child = spawn(process.execPath, [args.childPath, args.sourceDir, args.entry], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })

    let markerPayload: string | null = null
    const stderrTail: string[] = []
    let deadlineHit = false

    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (line.startsWith(PLUGIN_BUILD_RESULT_MARKER)) {
          markerPayload = line.slice(PLUGIN_BUILD_RESULT_MARKER.length)
        }
      })
    }
    if (child.stderr) {
      createInterface({ input: child.stderr }).on("line", (line) => {
        stderrTail.push(line)
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift()
      })
    }

    const deadline = setTimeout(() => {
      deadlineHit = true
      child.kill("SIGKILL")
    }, args.deadlineMs)

    const settle = (exitCode: number) => {
      clearTimeout(deadline)
      const result = markerPayload === null ? null : decodeChildResult(markerPayload)
      if (result) {
        resolveOutcome({ result, harnessError: "" })
        return
      }
      const detail = stderrTail.length > 0 ? ` — stderr: ${stderrTail.join(" | ")}` : ""
      const cause = deadlineHit
        ? `bundler process produced no verdict within ${args.deadlineMs}ms and was killed`
        : `bundler process exited with code ${exitCode} before reporting a verdict`
      resolveOutcome({ result: null, harnessError: `${cause}${detail}` })
    }

    child.once("close", (code) => settle(code ?? 1))
    child.once("error", (error) => {
      clearTimeout(deadline)
      resolveOutcome({ result: null, harnessError: `bundler process failed to spawn: ${errorMessage(error)}` })
    })
  })
}

async function installPluginDependencies(sourceDir: string): Promise<string[]> {
  if (!(await Bun.file(join(sourceDir, "package.json")).exists())) return []
  const lockfiles = await Promise.all(LOCKFILE_NAMES.map((name) => Bun.file(join(sourceDir, name)).exists()))
  const deadline = AbortSignal.timeout(DEPENDENCY_INSTALL_DEADLINE_MS)
  const run = await spawnCapture(
    [process.execPath, "install", lockfiles.some(Boolean) ? "--frozen-lockfile" : "--no-save"],
    { cwd: sourceDir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, signal: deadline },
  )
  if (run.exitCode === 0) return []
  const tail = run.stderr.trim().split("\n").slice(-STDERR_TAIL_LINES).join(" | ")
  const cause = deadline.aborted
    ? `bun install did not finish within ${DEPENDENCY_INSTALL_DEADLINE_MS}ms and was killed`
    : `bun install exited with code ${run.exitCode}`
  return [`Installing plugin dependencies failed (${cause}): ${tail}`]
}

export async function buildPluginBundles(args: BuildPluginBundlesArgs): Promise<BuildPluginBundlesResult> {
  const installErrors = await installPluginDependencies(args.sourceDir)
  if (installErrors.length > 0) return { ok: false, errors: installErrors }
  const childArgs = {
    sourceDir: args.sourceDir,
    entry: args.entry,
    childPath: args.childPath ?? BUILD_CHILD_PATH,
    deadlineMs: args.deadlineMs ?? BUILD_CHILD_DEADLINE_MS,
  }
  const first = await runBuildChild(childArgs)
  if (first.result) return first.result
  const second = await runBuildChild(childArgs)
  if (second.result) return second.result
  return {
    ok: false,
    errors: [
      `Plugin compile did not finish: ${first.harnessError}; retry in a fresh process also failed: ${second.harnessError}. ` +
        "The compile runs in its own process so a wedged bundler cannot hang the server or the test runner.",
    ],
  }
}
