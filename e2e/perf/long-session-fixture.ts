import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const LONG_SESSION_ID = "8a6d1c2e-4b7f-4e0a-9c3d-1f2e3a4b5c6d"
export const PROJECT_DIR_NAME = "mobile-bench"

const LOREM = [
  "The transcript renders each committed entry as its own row, so a long session exercises virtualization.",
  "Rows vary a lot in height: a one-line reply sits next to a forty-line code block or a long tool log.",
  "Scrolling must stay native, so momentum and rubber-banding come from the browser rather than from script.",
  "When the reader scrolls up, new output must not move what they are reading.",
  "Older history loads above the viewport, and the visible content has to stay put while it does.",
]

function paragraph(i: number, sentences: number): string {
  return Array.from({ length: sentences }, (_, k) => LOREM[(i + k) % LOREM.length]).join(" ")
}

function codeBlock(i: number, lines: number): string {
  const body = Array.from({ length: lines }, (_, k) => `  const value${String(k)} = compute(${String(i)}, ${String(k)}) // step ${String(k)}`)
  return ["```ts", `export function block${String(i)}() {`, ...body, "}", "```"].join("\n")
}

function assistantMarkdown(i: number): string {
  const variant = i % 4
  if (variant === 0) return `${paragraph(i, 2)}\n\n${codeBlock(i, 6 + (i % 30))}\n\n${paragraph(i + 1, 1)}`
  if (variant === 1) return `## Step ${String(i)}\n\n- ${LOREM[i % LOREM.length]}\n- ${LOREM[(i + 1) % LOREM.length]}\n- \`inline_${String(i)}\` keeps working\n\n${paragraph(i, 3)}`
  if (variant === 2) return paragraph(i, 1)
  return `${paragraph(i, 4)}\n\n${paragraph(i + 2, 3)}`
}

function toolOutput(i: number): string {
  return Array.from({ length: 4 + (i % 60) }, (_, k) => `line ${String(k)}: ok ${String(i * 31 + k)}`).join("\n")
}

interface Record {
  [key: string]: string | number | boolean | null | Record | Record[] | string[]
}

function at(i: number): string {
  return new Date(Date.UTC(2026, 9, 1, 8, 0, 0) + i * 7_000).toISOString()
}

export function buildLongSessionRecords(cwd: string, turns: number, startIndex = 0): Record[] {
  const base = { sessionId: LONG_SESSION_ID, cwd, version: "2.1.0" }
  const records: Record[] = []
  let n = startIndex * 10
  for (let t = startIndex; t < startIndex + turns; t++) {
    records.push({ ...base, type: "user", uuid: `u-${String(t)}`, timestamp: at(n++), message: { role: "user", content: `Turn ${String(t)}: ${LOREM[t % LOREM.length]}` } })
    records.push({
      ...base,
      type: "assistant",
      uuid: `a-${String(t)}-text`,
      timestamp: at(n++),
      message: { id: `msg-${String(t)}-a`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: assistantMarkdown(t) }] },
    })
    const toolId = `toolu_${String(t).padStart(6, "0")}`
    const useEdit = t % 3 === 0
    records.push({
      ...base,
      type: "assistant",
      uuid: `a-${String(t)}-tool`,
      timestamp: at(n++),
      message: {
        id: `msg-${String(t)}-b`,
        role: "assistant",
        model: "claude-opus-5-5",
        content: [
          useEdit
            ? { type: "tool_use", id: toolId, name: "Edit", input: { file_path: `${cwd}/src/file${String(t)}.ts`, old_string: `const a = ${String(t)}\nconst b = a + 1`, new_string: `const a = ${String(t + 1)}\nconst b = a * 2\nconst c = b - 1` } }
            : { type: "tool_use", id: toolId, name: "Bash", input: { command: `bun run test src/file${String(t)}.test.ts`, description: "Run the suite" } },
        ],
      },
    })
    records.push({
      ...base,
      type: "user",
      uuid: `u-${String(t)}-result`,
      timestamp: at(n++),
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: useEdit ? "The file has been updated." : toolOutput(t) }] },
    })
    records.push({
      ...base,
      type: "assistant",
      uuid: `a-${String(t)}-done`,
      timestamp: at(n++),
      message: { id: `msg-${String(t)}-c`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: paragraph(t + 3, 1 + (t % 3)) }] },
    })
  }
  return records
}

function toJsonl(records: Record[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
}

export interface LongSessionPaths {
  projectDir: string
  sessionFile: string
}

export function longSessionPaths(kannaHome: string): LongSessionPaths {
  return {
    projectDir: join(kannaHome, PROJECT_DIR_NAME),
    sessionFile: join(kannaHome, ".claude", "projects", PROJECT_DIR_NAME, `${LONG_SESSION_ID}.jsonl`),
  }
}

export async function seedLongSession(kannaHome: string, turns: number): Promise<void> {
  const { projectDir, sessionFile } = longSessionPaths(kannaHome)
  await mkdir(join(projectDir, "src"), { recursive: true })
  await mkdir(join(kannaHome, ".claude", "projects", PROJECT_DIR_NAME), { recursive: true })
  await writeFile(sessionFile, toJsonl(buildLongSessionRecords(projectDir, turns)))
}

export async function appendLongSessionTurns(kannaHome: string, startIndex: number, turns: number): Promise<void> {
  const { projectDir, sessionFile } = longSessionPaths(kannaHome)
  await appendFile(sessionFile, toJsonl(buildLongSessionRecords(projectDir, turns, startIndex)))
}
