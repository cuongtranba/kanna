import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"

export interface TribeSessionFixture {
  mainJsonlPath: string
  subagentsDir: string
  appendLine: (line: object) => void
}

/**
 * Builds a Tribe-shaped Claude session fixture on disk: a main transcript
 * JSONL (a `system`/`init` record, one `user` turn, one `assistant` turn
 * carrying a native `Agent`/`Task` `tool_use` call) plus a sibling
 * `<sessionId>/subagents/agent-<agentId>.jsonl` sidecar — exactly what a
 * real Tribe campaign session leaves on disk.
 *
 * Fixes vs. plan-06-join.md's illustrative Task 1 Step 1 snippet, verified
 * against the real production sources:
 *
 * 1. `opts.cwd` is used as-is, never hardcoded — callers pass a real,
 *    existing directory (e.g. one made with `mkdtempSync`) so
 *    `importOneSession`'s `cwdExists()` check (`claude-session-importer.adapter.ts`)
 *    succeeds and a brand-new import can reach `status: "created"`.
 * 2. Every record carries `sessionId` + `cwd` directly on the record,
 *    camelCase (never `session_id`) — `parseClaudeSessionFile`
 *    (`claude-session-parser.adapter.ts`) reads `record.sessionId` /
 *    `record.cwd`, matching `ClaudeSessionRecordBase`
 *    (`claude-session-types.ts`). A record missing these would silently
 *    fail to carry session identity.
 * 3. Every user/assistant record carries a unique `uuid`. `applyDelta`
 *    (`claude-session-importer.adapter.ts`) treats a uuid-less record as
 *    ALWAYS new (`!record.uuid || !seen.has(record.uuid)`) — a fixture with
 *    no uuids would let a broken/no-op live-tail dedupe pass silently.
 */
export function writeTribeSessionFixture(
  dir: string,
  opts: { sessionId: string; cwd: string },
): TribeSessionFixture {
  const { sessionId, cwd } = opts
  mkdirSync(dir, { recursive: true })
  const mainJsonlPath = join(dir, `${sessionId}.jsonl`)
  const agentId = "hunter-1"

  const initLine = {
    type: "system",
    subtype: "init",
    sessionId,
    cwd,
    timestamp: "2026-04-20T10:00:00.000Z",
  }
  const userLine = {
    type: "user",
    uuid: "u1",
    sessionId,
    cwd,
    timestamp: "2026-04-20T10:00:01.000Z",
    message: { role: "user", content: "ship card foundation" },
  }
  const assistantLine = {
    type: "assistant",
    uuid: "a1",
    sessionId,
    cwd,
    timestamp: "2026-04-20T10:00:02.000Z",
    message: {
      role: "assistant",
      id: "m1",
      content: [
        { type: "tool_use", id: "toolu_1", name: "Agent", input: { agentId, description: "hunter task 1" } },
      ],
    },
  }

  writeFileSync(
    mainJsonlPath,
    `${[initLine, userLine, assistantLine].map((l) => JSON.stringify(l)).join("\n")}\n`,
  )

  const subagentsDir = join(dir, sessionId, "subagents")
  mkdirSync(subagentsDir, { recursive: true })
  const agentFile = join(subagentsDir, `agent-${agentId}.jsonl`)
  writeFileSync(
    agentFile,
    `${[
      JSON.stringify({
        type: "user",
        uuid: "su1",
        isSidechain: true,
        message: { role: "user", content: "task 1 brief" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "sa1",
        isSidechain: true,
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      }),
    ].join("\n")}\n`,
  )

  let appendCounter = 0
  return {
    mainJsonlPath,
    subagentsDir,
    appendLine: (line: object) => {
      appendCounter += 1
      const record = {
        uuid: `delta-${appendCounter}`,
        sessionId,
        cwd,
        timestamp: new Date().toISOString(),
        ...line,
      }
      appendFileSync(mainJsonlPath, `${JSON.stringify(record)}\n`)
    },
  }
}
