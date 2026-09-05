import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"

export interface TribeSessionFixture {
  mainJsonlPath: string
  subagentsDir: string
  appendLine: (line: object) => void
}

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
