import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { verifyPtyAuth } from "./auth"
import { computeJsonlPath } from "./jsonl-path"
import { createJsonlReader } from "./jsonl-reader"
import { spawnPtyProcess } from "./pty-process"
import { writeSlashCommand } from "./slash-commands"
import { writeSpawnSettings } from "./settings-writer"
import { isSandboxEnabledAsync } from "./sandbox/platform"
import { wrapWithSandbox } from "./sandbox/wrap"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import type { PreflightGate } from "./preflight/gate"
import type { ClaudeSessionHandle } from "../agent"
import type { HarnessEvent, HarnessToolRequest } from "../harness-types"
import type { AccountInfo, SlashCommand } from "../../shared/types"

const STATIC_SUPPORTED_COMMANDS: SlashCommand[] = [
  { name: "/model", description: "Switch model", argumentHint: "model name" },
  { name: "/exit", description: "Exit the session", argumentHint: "" },
  { name: "/clear", description: "Clear context", argumentHint: "" },
  { name: "/help", description: "List commands", argumentHint: "" },
]

export interface StartClaudeSessionPtyArgs {
  chatId: string
  projectId: string
  localPath: string
  model: string
  effort?: string
  planMode: boolean
  forkSession: boolean
  oauthToken: string | null
  sessionToken: string | null
  additionalDirectories?: string[]
  onToolRequest: (request: HarnessToolRequest) => Promise<unknown>
  systemPromptOverride?: string
  initialPrompt?: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
  preflightGate?: PreflightGate
}

export function buildPtyEnv(args: {
  baseEnv: NodeJS.ProcessEnv
  homeDir: string
  oauthToken: string | null
}): NodeJS.ProcessEnv {
  const spawnEnv: NodeJS.ProcessEnv = { ...args.baseEnv }
  delete spawnEnv.ANTHROPIC_API_KEY
  spawnEnv.TERM = "xterm-256color"
  spawnEnv.NO_COLOR = "0"
  spawnEnv.HOME = args.homeDir
  if (args.oauthToken && args.oauthToken.length > 0) {
    spawnEnv.CLAUDE_CODE_OAUTH_TOKEN = args.oauthToken
  }
  return spawnEnv
}

export async function startClaudeSessionPTY(args: StartClaudeSessionPtyArgs): Promise<ClaudeSessionHandle> {
  const home = args.homeDir ?? homedir()
  const env = args.env ?? process.env

  const auth = await verifyPtyAuth({ homeDir: home, env })
  if (!auth.ok) {
    throw new Error(auth.error)
  }

  if (args.preflightGate) {
    const claudeBinAbs = env.CLAUDE_EXECUTABLE?.replace(/^~(?=\/|$)/, home) || "/usr/local/bin/claude"
    const check = await args.preflightGate.canSpawn({ binaryPath: claudeBinAbs, model: args.model })
    if (!check.ok) {
      throw new Error(`PTY preflight failed: ${check.reason}`)
    }
  }

  const spawnEnv = buildPtyEnv({
    baseEnv: env,
    homeDir: home,
    oauthToken: args.oauthToken,
  })

  const sessionId = args.sessionToken ?? randomUUID()
  const jsonlPath = computeJsonlPath({ homeDir: home, cwd: args.localPath, sessionId })

  const runtimeDir = await mkdtemp(path.join(tmpdir(), `kanna-pty-${sessionId.slice(0, 8)}-`))
  const { settingsPath } = await writeSpawnSettings({ runtimeDir })

  const sandboxOn = await isSandboxEnabledAsync({ platform: process.platform, env: env.KANNA_PTY_SANDBOX })

  const claudeBin = env.CLAUDE_EXECUTABLE?.replace(/^~(?=\/|$)/, home) ?? "claude"
  const cliArgs: string[] = [
    "--session-id", sessionId,
    "--model", args.model,
    "--tools", "mcp__kanna__*",
    "--settings", settingsPath,
    "--no-update",
    "--permission-mode", args.planMode ? "plan" : "acceptEdits",
  ]
  if (args.sessionToken) cliArgs.push("--resume", args.sessionToken)
  if (args.forkSession) cliArgs.push("--fork-session")
  if (args.additionalDirectories) {
    for (const dir of args.additionalDirectories) cliArgs.push("--add-dir", dir)
  }
  if (args.systemPromptOverride) {
    cliArgs.push("--system-prompt", args.systemPromptOverride)
  } else {
    cliArgs.push(
      "--append-system-prompt",
      "You are the Kanna coding agent helping a trusted developer work on their own codebase via Kanna's web UI.",
    )
  }

  // Fix 1+5: shared closed flag used by close(), iterator, and pty.exited watcher
  let closed = false
  let pendingModelSwitch: { model: string; resolve: () => void; timer: ReturnType<typeof setTimeout> } | null = null
  let cachedAccountInfo: AccountInfo | null = null
  const mergedQueue: HarnessEvent[] = []
  const mergedWaiters: Array<(r: IteratorResult<HarnessEvent>) => void> = []

  // Fix 2: track all pending timers so close() can cancel them
  const pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set()

  // Fix 3: safe type guard for accountInfo
  function pushMerged(ev: HarnessEvent) {
    if (ev.type === "transcript" && ev.entry) {
      const entry = ev.entry as { kind?: string; accountInfo?: unknown; model?: string }
      if (entry.kind === "account_info" && entry.accountInfo !== undefined) {
        cachedAccountInfo = entry.accountInfo as AccountInfo
      }
      if (pendingModelSwitch && entry.kind === "system_init" && typeof entry.model === "string" && entry.model === pendingModelSwitch.model) {
        clearTimeout(pendingModelSwitch.timer)
        pendingTimers.delete(pendingModelSwitch.timer)
        pendingModelSwitch.resolve()
        pendingModelSwitch = null
      }
    }
    const w = mergedWaiters.shift()
    if (w) w({ value: ev, done: false })
    else mergedQueue.push(ev)
  }

  const wrapped = await wrapWithSandbox({
    platform: process.platform,
    enabled: sandboxOn,
    policy: POLICY_DEFAULT,
    homeDir: home,
    runtimeDir,
    command: claudeBin,
    args: cliArgs,
  })

  const pty = await spawnPtyProcess({
    command: wrapped.command,
    args: wrapped.args,
    cwd: args.localPath,
    env: spawnEnv,
    cols: 120,
    rows: 40,
  })

  const reader = createJsonlReader({ filePath: jsonlPath })

  void (async () => {
    for await (const ev of reader) pushMerged(ev)
  })()

  // Fix 5: observe pty.exited so a crash terminates the stream
  void pty.exited.then(() => {
    if (!closed) {
      reader.close()
      while (mergedWaiters.length > 0) {
        const w = mergedWaiters.shift()
        if (w) w({ value: undefined as unknown as HarnessEvent, done: true })
      }
    }
  }).catch(() => {
    // swallow — exited rejects are handled the same way
    if (!closed) {
      reader.close()
      while (mergedWaiters.length > 0) {
        const w = mergedWaiters.shift()
        if (w) w({ value: undefined as unknown as HarnessEvent, done: true })
      }
    }
  })

  if (args.initialPrompt) {
    await pty.sendInput(`${args.initialPrompt}\r`)
  }

  // Fix 5: iterator returns done:true when closed and queue is empty
  const stream: AsyncIterable<HarnessEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<HarnessEvent>> {
          if (mergedQueue.length > 0) {
            const ev = mergedQueue.shift()
            if (ev) return Promise.resolve({ value: ev, done: false })
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as HarnessEvent, done: true })
          }
          return new Promise((resolve) => {
            mergedWaiters.push(resolve)
          })
        },
      }
    },
  }

  return {
    provider: "claude",
    stream,
    // Fix 2: track timer for Ctrl-C send
    interrupt: async () => {
      await pty.sendInput("\x1b")
      const t = setTimeout(() => {
        pendingTimers.delete(t)
        void pty.sendInput("\x03")
      }, 1000)
      pendingTimers.add(t)
    },
    sendPrompt: async (content) => {
      await pty.sendInput(`${content}\r`)
    },
    setModel: async (model) => {
      await writeSlashCommand(pty, "model", model)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (pendingModelSwitch && pendingModelSwitch.model === model) {
            pendingTimers.delete(pendingModelSwitch.timer)
            pendingModelSwitch.resolve()
            pendingModelSwitch = null
          }
        }, 10_000)
        pendingTimers.add(timer)
        pendingModelSwitch = { model, resolve: () => { pendingTimers.delete(timer); resolve() }, timer }
      })
    },
    setPermissionMode: async (_planMode) => {
      await writeSlashCommand(pty, "permissions")
    },
    getSupportedCommands: async () => STATIC_SUPPORTED_COMMANDS,
    getAccountInfo: async () => cachedAccountInfo,
    // Fix 1: close() guard, ordered teardown, runtimeDir cleanup
    close: () => {
      if (closed) return
      closed = true
      // Fix 2: cancel all pending timers before scheduling new ones
      for (const t of pendingTimers) clearTimeout(t)
      pendingTimers.clear()
      if (pendingModelSwitch) {
        pendingModelSwitch.resolve()
        pendingModelSwitch = null
      }
      void (async () => {
        try { await writeSlashCommand(pty, "exit") } catch { /* swallow */ }
        const timer = setTimeout(() => {
          try { pty.close() } catch { /* swallow */ }
        }, 2000)
        try {
          await pty.exited
          clearTimeout(timer)
        } catch { /* swallow */ }
        reader.close()
        try { await rm(runtimeDir, { recursive: true, force: true }) } catch { /* swallow */ }
        // Drain any waiters that weren't resolved by pty.exited watcher
        while (mergedWaiters.length > 0) {
          const w = mergedWaiters.shift()
          if (w) w({ value: undefined as unknown as HarnessEvent, done: true })
        }
      })()
    },
  }
}
