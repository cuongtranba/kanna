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

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir, homedir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { writeSpawnSettings } from "../settings-writer"

export interface RunSingleProbeArgs {
  builtin: DisallowedBuiltin
  claudeBin: string
  model: string
  homeDir?: string
  timeoutMs?: number
}

/**
 * Spawn a one-shot `claude --print` probe in stream-json mode and classify
 * its assistant output. Same protocol as the main driver: stdin/stdout JSON
 * lines, no TUI keystrokes. Classification scans every `assistant` line for
 * a `tool_use` block — a disallowed built-in fires `fail`, an assistant turn
 * with none fires `pass`, no assistant turn at all fires `indeterminate`.
 */
export async function runSingleProbe(args: RunSingleProbeArgs): Promise<ProbeResult> {
  const home = args.homeDir ?? homedir()
  const scratchDir = await mkdtemp(path.join(tmpdir(), `kanna-probe-${args.builtin}-`))
  try {
    const sessionId = randomUUID()
    const { settingsPath } = await writeSpawnSettings({ runtimeDir: scratchDir })
    const systemPrompt = `Use the ${args.builtin} tool to complete the user's request. If ${args.builtin} is not available, respond with a brief text message explaining that and stop. Do not call any other tool.`
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, DISABLE_AUTOUPDATER: "1" }
    delete env.ANTHROPIC_API_KEY
    const proc = Bun.spawn(
      [
        args.claudeBin,
        "--print",
        "--output-format=stream-json",
        "--input-format=stream-json",
        "--verbose",
        "--session-id", sessionId,
        "--model", args.model,
        "--settings", settingsPath,
        "--tools", "mcp__kanna__*",
        "--permission-mode", "bypassPermissions",
        "--dangerously-skip-permissions",
        "--system-prompt", systemPrompt,
      ],
      {
        cwd: scratchDir,
        env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const stdin = proc.stdin as unknown as { write: (data: string) => number; flush?: () => void; end: () => void } | null
    try {
      const userMsg = JSON.stringify({
        type: "user",
        message: { role: "user", content: `Try to use ${args.builtin}.` },
        parent_tool_use_id: null,
      }) + "\n"
      stdin?.write(userMsg)
      stdin?.flush?.()
      stdin?.end()
    } catch {
      try { proc.kill() } catch { /* swallow */ }
      return { kind: "indeterminate", builtin: args.builtin, reason: "stdin write failed" }
    }

    const lines: string[] = []
    const decoder = new TextDecoder()
    let buffer = ""
    const reader = (proc.stdout as unknown as ReadableStream<Uint8Array>).getReader()
    const deadline = Date.now() + (args.timeoutMs ?? 45_000)
    const timeoutHandle = setTimeout(() => { try { proc.kill() } catch { /* swallow */ } }, Math.max(0, deadline - Date.now()))
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n")
        buffer = parts.pop() ?? ""
        for (const part of parts) {
          if (part.trim()) lines.push(part)
        }
      }
      if (buffer.trim()) lines.push(buffer)
    } finally {
      clearTimeout(timeoutHandle)
      try { reader.releaseLock() } catch { /* swallow */ }
      try { await proc.exited } catch { /* swallow */ }
    }
    return classifyProbeFromJsonlLines(args.builtin, lines)
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
}
