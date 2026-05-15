import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { mkdtemp } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { verifyPtyAuth } from "./auth"
import { computeJsonlPath } from "./jsonl-path"
import { createJsonlReader } from "./jsonl-reader"
import { spawnPtyProcess } from "./pty-process"
import { writeSlashCommand } from "./slash-commands"
import { writeSpawnSettings } from "./settings-writer"
import { detectModelSwitch, detectRateLimit } from "./frame-parser"
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
}

export async function startClaudeSessionPTY(args: StartClaudeSessionPtyArgs): Promise<ClaudeSessionHandle> {
  const home = args.homeDir ?? homedir()
  const env = args.env ?? process.env

  const auth = await verifyPtyAuth({ homeDir: home, env })
  if (!auth.ok) {
    throw new Error(auth.error)
  }

  const spawnEnv: NodeJS.ProcessEnv = { ...env }
  delete spawnEnv.ANTHROPIC_API_KEY
  spawnEnv.TERM = "xterm-256color"
  spawnEnv.NO_COLOR = "0"
  spawnEnv.HOME = home

  const sessionId = args.sessionToken ?? randomUUID()
  const jsonlPath = computeJsonlPath({ homeDir: home, cwd: args.localPath, sessionId })

  const runtimeDir = await mkdtemp(path.join(tmpdir(), `kanna-pty-${sessionId.slice(0, 8)}-`))
  const { settingsPath } = await writeSpawnSettings({ runtimeDir })

  const claudeBin = env.CLAUDE_EXECUTABLE?.replace(/^~(?=\/|$)/, home) ?? "claude"
  const cliArgs: string[] = [
    "--session-id", sessionId,
    "--model", args.model,
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

  let pendingModelAck: { resolve: () => void } | null = null
  let cachedAccountInfo: AccountInfo | null = null
  const mergedQueue: HarnessEvent[] = []
  const mergedWaiters: Array<(r: IteratorResult<HarnessEvent>) => void> = []

  function pushMerged(ev: HarnessEvent) {
    if (
      ev.type === "transcript" &&
      ev.entry &&
      (ev.entry as { kind?: string }).kind === "account_info"
    ) {
      const entry = ev.entry as unknown as { accountInfo?: AccountInfo }
      if (entry.accountInfo) cachedAccountInfo = entry.accountInfo
    }
    const w = mergedWaiters.shift()
    if (w) w({ value: ev, done: false })
    else mergedQueue.push(ev)
  }

  const pty = await spawnPtyProcess({
    command: claudeBin,
    args: cliArgs,
    cwd: args.localPath,
    env: spawnEnv,
    cols: 120,
    rows: 40,
    onOutput: () => {
      const frame = pty.serializer.serialize()
      if (pendingModelAck && detectModelSwitch(frame)) {
        pendingModelAck.resolve()
        pendingModelAck = null
      }
      const rl = detectRateLimit(frame)
      if (rl) {
        const resetAtMs = new Date(`${new Date().toDateString()} ${rl.resetAt} ${rl.tz}`).getTime()
        if (!Number.isNaN(resetAtMs)) {
          pushMerged({ type: "rate_limit", rateLimit: { resetAt: resetAtMs, tz: rl.tz } })
        }
      }
    },
  })

  const reader = createJsonlReader({ filePath: jsonlPath })

  void (async () => {
    for await (const ev of reader) pushMerged(ev)
  })()

  if (args.initialPrompt) {
    await pty.sendInput(`${args.initialPrompt}\r`)
  }

  const stream: AsyncIterable<HarnessEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<HarnessEvent>> {
          if (mergedQueue.length > 0) {
            const ev = mergedQueue.shift()
            if (ev) return Promise.resolve({ value: ev, done: false })
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
    interrupt: async () => {
      await pty.sendInput("\x1b")
      setTimeout(() => {
        void pty.sendInput("\x03")
      }, 1000)
    },
    sendPrompt: async (content) => {
      await pty.sendInput(`${content}\r`)
    },
    setModel: async (model) => {
      await writeSlashCommand(pty, "model", model)
      await new Promise<void>((resolve) => {
        pendingModelAck = { resolve }
        setTimeout(() => {
          if (pendingModelAck) {
            pendingModelAck.resolve()
            pendingModelAck = null
          }
        }, 3000)
      })
    },
    setPermissionMode: async (_planMode) => {
      await writeSlashCommand(pty, "permissions")
    },
    getSupportedCommands: async () => STATIC_SUPPORTED_COMMANDS,
    getAccountInfo: async () => cachedAccountInfo,
    close: () => {
      void writeSlashCommand(pty, "exit")
      setTimeout(() => {
        pty.close()
      }, 2000)
      reader.close()
    },
  }
}
