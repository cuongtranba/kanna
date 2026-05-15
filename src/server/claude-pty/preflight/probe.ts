import type { DisallowedBuiltin, ProbeResult } from "./types"
import { DISALLOWED_BUILTINS } from "./types"

const DISALLOWED_SET = new Set<string>(DISALLOWED_BUILTINS)

export function classifyProbeFromJsonlLines(
  target: DisallowedBuiltin,
  lines: string[],
): ProbeResult {
  let sawAssistantTurn = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try { parsed = JSON.parse(trimmed) } catch { continue }
    if (!parsed || typeof parsed !== "object") continue
    const msg = parsed as { type?: string; message?: { content?: unknown[] } }
    if (msg.type !== "assistant" || !Array.isArray(msg.message?.content)) continue
    sawAssistantTurn = true
    for (const block of msg.message.content) {
      if (typeof block !== "object" || block === null) continue
      const b = block as { type?: string; name?: string }
      if (b.type !== "tool_use" || typeof b.name !== "string") continue
      // Any disallowed built-in tool_use → FAIL (covers cross-target leaks too).
      if (DISALLOWED_SET.has(b.name)) {
        return { kind: "fail", builtin: target, evidence: `tool_use:${b.name}` }
      }
    }
  }
  if (sawAssistantTurn) {
    // Model produced an assistant turn but did not invoke any disallowed
    // built-in — interpret as the built-in being unavailable.
    return { kind: "pass", builtin: target, evidence: "no_builtin_tool_use_in_assistant_turn" }
  }
  return { kind: "indeterminate", builtin: target, reason: "no assistant turn in tailed jsonl" }
}

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir, homedir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { spawnPtyProcess } from "../pty-process"
import { computeJsonlPath } from "../jsonl-path"
import { writeSpawnSettings } from "../settings-writer"

export interface RunSingleProbeArgs {
  builtin: DisallowedBuiltin
  claudeBin: string
  model: string
  homeDir?: string
  timeoutMs?: number
}

export async function runSingleProbe(args: RunSingleProbeArgs): Promise<ProbeResult> {
  const home = args.homeDir ?? homedir()
  const scratchDir = await mkdtemp(path.join(tmpdir(), `kanna-probe-${args.builtin}-`))
  try {
    const sessionId = randomUUID()
    const jsonlPath = computeJsonlPath({ homeDir: home, cwd: scratchDir, sessionId })
    const { settingsPath } = await writeSpawnSettings({ runtimeDir: scratchDir })
    const systemPrompt = `Use the ${args.builtin} tool to complete the user's request. If ${args.builtin} is not available, respond with a brief text message explaining that and stop. Do not call any other tool.`
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, TERM: "xterm-256color" }
    delete env.ANTHROPIC_API_KEY
    const pty = await spawnPtyProcess({
      command: args.claudeBin,
      args: [
        "--session-id", sessionId,
        "--model", args.model,
        "--settings", settingsPath,
        "--tools", "mcp__kanna__*",
        "--permission-mode", "bypassPermissions",
        "--dangerously-skip-permissions",
        "--no-update",
        "--system-prompt", systemPrompt,
      ],
      cwd: scratchDir,
      env,
    })
    try {
      await pty.sendInput(`Try to use ${args.builtin}.\r`)
      await new Promise((r) => setTimeout(r, args.timeoutMs ?? 15_000))
    } finally {
      pty.close()
    }
    try {
      const raw = await readFile(jsonlPath, "utf8")
      return classifyProbeFromJsonlLines(args.builtin, raw.split("\n"))
    } catch {
      return { kind: "indeterminate", builtin: args.builtin, reason: "no jsonl produced" }
    }
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
}
