import { stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"

const execFileAsync = promisify(execFile)

export interface ResolveClaudeBinaryArgs {
  env: NodeJS.ProcessEnv
  homeDir: string
  cwd?: string
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
}

export interface ResolveClaudeBinaryResult {
  path: string
  source: "env-CLAUDE_EXECUTABLE" | "env-CLAUDE_CODE_EXECPATH" | "PATH" | "node_modules"
  triedPaths: string[]
}

function expandTilde(p: string, home: string): string {
  return p.replace(/^~(?=\/|$)/, home)
}

async function isExecutableFile(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isFile()
  } catch {
    return false
  }
}

async function whichClaude(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | null> {
  const cmd = platform === "win32" ? "where" : "which"
  try {
    const { stdout } = await execFileAsync(cmd, ["claude"], { env, timeout: 2000 })
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0)
    if (!first) return null
    if (!(await isExecutableFile(first))) return null
    return first
  } catch {
    return null
  }
}

function buildNodeModulesCandidates(cwd: string, platform: NodeJS.Platform, arch: NodeJS.Architecture): string[] {
  const tag = `${platform}-${arch}`
  const pkgDir = `@anthropic-ai/claude-agent-sdk-${tag}`
  const candidates: string[] = []
  let dir = path.resolve(cwd)
  while (true) {
    candidates.push(path.join(dir, "node_modules", pkgDir, "claude"))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return candidates
}

export async function resolveClaudeBinary(args: ResolveClaudeBinaryArgs): Promise<ResolveClaudeBinaryResult> {
  const env = args.env
  const home = args.homeDir
  const cwd = args.cwd ?? process.cwd()
  const platform = args.platform ?? process.platform
  const arch = args.arch ?? process.arch
  const tried: string[] = []

  if (env.CLAUDE_EXECUTABLE) {
    const candidate = expandTilde(env.CLAUDE_EXECUTABLE, home)
    tried.push(`CLAUDE_EXECUTABLE=${candidate}`)
    if (await isExecutableFile(candidate)) {
      return { path: candidate, source: "env-CLAUDE_EXECUTABLE", triedPaths: tried }
    }
  }

  if (env.CLAUDE_CODE_EXECPATH) {
    const candidate = expandTilde(env.CLAUDE_CODE_EXECPATH, home)
    tried.push(`CLAUDE_CODE_EXECPATH=${candidate}`)
    if (await isExecutableFile(candidate)) {
      return { path: candidate, source: "env-CLAUDE_CODE_EXECPATH", triedPaths: tried }
    }
  }

  const fromPath = await whichClaude(env, platform)
  tried.push(`PATH lookup: ${fromPath ?? "<not found>"}`)
  if (fromPath) {
    return { path: fromPath, source: "PATH", triedPaths: tried }
  }

  const candidates = buildNodeModulesCandidates(cwd, platform, arch)
  for (const candidate of candidates) {
    tried.push(candidate)
    if (await isExecutableFile(candidate)) {
      return { path: candidate, source: "node_modules", triedPaths: tried }
    }
  }

  throw new Error(
    `Unable to locate the \`claude\` CLI binary. Set CLAUDE_EXECUTABLE to an absolute path, `
    + `install \`@anthropic-ai/claude-code\` globally so \`claude\` is on PATH, or install `
    + `\`@anthropic-ai/claude-agent-sdk\` so the platform-bundled binary exists in node_modules. `
    + `Tried:\n  - ${tried.join("\n  - ")}`,
  )
}
