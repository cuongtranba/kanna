import { describe, expect, spyOn, test } from "bun:test"
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { isRecord } from "../shared/errors"
import { log } from "../shared/log"
import { safeJsonParse } from "../shared/safe-json"
import {
  hasCodexSourceShrunk,
  parseCodexRolloutFile,
  parseCodexSourceHash,
  READ_CHUNK_BYTES,
  type CodexLineClassification,
  type CodexParserDeps,
  type CodexParseResult,
} from "./codex-session-parser.adapter"
import type { CodexRolloutRecord } from "./codex-session-types"

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-parser-"))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * A stand-in for the real classifier. It understands exactly two line shapes,
 * which is all the adapter's contract needs: the adapter never inspects a line
 * itself.
 */
function fakeClassify(rawLine: string, lineIndex: number, fallbackTimestamp: number): CodexRolloutRecord | null {
  const parsed = safeJsonParse(rawLine)
  if (!isRecord(parsed)) return null
  const type = parsed.type
  if (typeof type !== "string") return null
  const timestamp = typeof parsed.ts === "number" ? parsed.ts : fallbackTimestamp

  if (type === "session_meta") {
    return {
      kind: "session_meta",
      lineIndex,
      timestamp,
      meta: {
        sessionId: typeof parsed.id === "string" ? parsed.id : "",
        cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
        cliVersion: null,
        parentThreadId: typeof parsed.parent === "string" ? parsed.parent : null,
        forkedFromId: typeof parsed.forkedFrom === "string" ? parsed.forkedFrom : null,
        agentPath: typeof parsed.agentPath === "string" ? parsed.agentPath : null,
      },
    }
  }
  if (type === "user") {
    return {
      kind: "user_message",
      lineIndex,
      timestamp,
      text: typeof parsed.text === "string" ? parsed.text : "",
    }
  }
  return null
}

/**
 * The companion classifier: the same decision as `fakeClassify`, plus WHY a
 * line was dropped. Stands in for whatever `codex-rollout-line.ts` exports —
 * the adapter only needs the three reasons told apart.
 */
function fakeClassifyWithReason(
  rawLine: string,
  lineIndex: number,
  fallbackTimestamp: number,
): CodexLineClassification {
  if (rawLine.trim().length === 0) return { kind: "skipped", reason: "blank" }
  const parsed = safeJsonParse(rawLine)
  if (!isRecord(parsed)) return { kind: "skipped", reason: "unparseable" }
  const record = fakeClassify(rawLine, lineIndex, fallbackTimestamp)
  return record ? { kind: "record", record } : { kind: "skipped", reason: "dropped" }
}

/** Echoes the physical line index into `text`, so the index is directly assertable. */
function echoIndexClassify(rawLine: string, lineIndex: number, fallbackTimestamp: number): CodexRolloutRecord | null {
  const record = fakeClassify(rawLine, lineIndex, fallbackTimestamp)
  if (!record || record.kind !== "user_message") return record
  return { ...record, text: String(lineIndex) }
}

function makeDeps(overrides: Partial<CodexParserDeps> = {}): CodexParserDeps {
  return {
    maxBytes: 256 * 1024 * 1024,
    classifyLine: fakeClassify,
    isSubagentMeta: (meta) =>
      meta.parentThreadId !== null || meta.forkedFromId !== null || meta.agentPath !== null,
    ...overrides,
  }
}

const SESSION_ID = "019fe1f6-b759-7f10-8e11-171db6cdc3fa"

function metaLine(overrides: Record<string, string | number> = {}): string {
  return JSON.stringify({ type: "session_meta", id: SESSION_ID, cwd: "/repo", ts: 1000, ...overrides })
}

function userLine(text: string, ts?: number): string {
  return JSON.stringify(ts === undefined ? { type: "user", text } : { type: "user", text, ts })
}

function writeRollout(dir: string, name: string, body: string): string {
  const filePath = path.join(dir, name)
  writeFileSync(filePath, body)
  return filePath
}

/** Narrows to the happy case so tests read the result without a cast. */
function expectParsedResult(result: CodexParseResult) {
  if (result.kind !== "parsed") {
    throw new Error(`expected parsed, got ${result.kind}${result.kind === "rejected" ? `:${result.reason}` : ""}`)
  }
  return result
}

function expectParsed(result: CodexParseResult) {
  return expectParsedResult(result).session
}

/** Captures what the adapter logged, and always restores the real logger. */
function withLogSpy<T>(level: "warn" | "error", run: (messages: string[]) => T): T {
  const messages: string[] = []
  const spy = spyOn(log, level).mockImplementation((...args) => {
    messages.push(args.map((arg) => String(arg)).join(" "))
  })
  try {
    return run(messages)
  } finally {
    spy.mockRestore()
  }
}

describe("parseCodexRolloutFile", () => {
  test("parses a rollout into a ParsedSession carrying provider codex", () => {
    withTempDir((dir) => {
      const file = writeRollout(
        dir,
        "rollout-a.jsonl",
        [metaLine(), userLine("hello", 2000), userLine("world", 3000), ""].join("\n"),
      )

      const session = expectParsed(parseCodexRolloutFile(file, makeDeps()))
      expect(session.provider).toBe("codex")
      expect(session.sessionId).toBe(SESSION_ID)
      expect(session.cwd).toBe("/repo")
      expect(session.filePath).toBe(file)
      expect(session.firstTimestamp).toBe(1000)
      expect(session.lastTimestamp).toBe(3000)
      expect(session.records.map((r) => r.kind)).toEqual(["session_meta", "user_message", "user_message"])
      expect(session.records.map((r) => r.lineIndex)).toEqual([0, 1, 2])
    })
  })

  test("retains only classified records, dropping unparseable lines", () => {
    withTempDir((dir) => {
      const file = writeRollout(
        dir,
        "rollout-b.jsonl",
        [metaLine(), "not json at all", JSON.stringify({ type: "ignored" }), userLine("kept", 9000), ""].join("\n"),
      )

      const session = expectParsed(parseCodexRolloutFile(file, makeDeps()))
      expect(session.records).toHaveLength(2)
      // Index 3, not 1: the index is a function of byte position, not of what
      // the classifier chose to keep.
      expect(session.records[1]?.lineIndex).toBe(3)
    })
  })

  test("lineIndex counts blank lines", () => {
    withTempDir((dir) => {
      const file = writeRollout(
        dir,
        "rollout-blanks.jsonl",
        [metaLine(), "", "   ", userLine("x"), "", userLine("y"), ""].join("\n"),
      )

      const session = expectParsed(
        parseCodexRolloutFile(file, makeDeps({ classifyLine: echoIndexClassify })),
      )
      const texts = session.records.filter((r) => r.kind === "user_message").map((r) => r.text)
      expect(texts).toEqual(["3", "5"])
    })
  })

  test("keeps a final line that has no trailing newline", () => {
    withTempDir((dir) => {
      const file = writeRollout(dir, "rollout-notrail.jsonl", [metaLine(), userLine("last", 4000)].join("\n"))

      const session = expectParsed(parseCodexRolloutFile(file, makeDeps()))
      expect(session.records).toHaveLength(2)
      const last = session.records[1]
      expect(last?.kind === "user_message" ? last.text : null).toBe("last")
      expect(last?.lineIndex).toBe(1)
    })
  })

  test("handles CRLF line endings", () => {
    withTempDir((dir) => {
      const file = writeRollout(dir, "rollout-crlf.jsonl", `${metaLine()}\r\n${userLine("crlf", 5000)}\r\n`)

      const session = expectParsed(parseCodexRolloutFile(file, makeDeps()))
      expect(session.records).toHaveLength(2)
      const last = session.records[1]
      expect(last?.kind === "user_message" ? last.text : null).toBe("crlf")
    })
  })

  test(
    "parses a multi-megabyte rollout whose lines straddle read-chunk boundaries",
    () => {
      withTempDir((dir) => {
        const lines: string[] = [metaLine()]
        let bytes = Buffer.byteLength(lines[0] ?? "") + 1
        let filler = 0
        const pushFiller = () => {
          const line = userLine(`filler-${filler}-${"x".repeat(900)}`, 2000 + filler)
          lines.push(line)
          bytes += Buffer.byteLength(line) + 1
          filler += 1
        }

        while (bytes < READ_CHUNK_BYTES - 8192) pushFiller()

        // Build one line that starts before the 1 MiB boundary and ends after
        // it, with a 4-byte emoji placed so the boundary falls INSIDE it. That
        // is the only construction that proves both the remainder carry and the
        // incremental UTF-8 decode.
        const jsonHead = '{"type":"user","ts":1,"text":"'
        const padLength = READ_CHUNK_BYTES - 2 - (bytes + Buffer.byteLength(jsonHead))
        expect(padLength).toBeGreaterThan(0)
        const straddleText = `${"P".repeat(padLength)}🌱${"T".repeat(4096)}`
        const straddleLine = `${jsonHead}${straddleText}"}`
        expect(bytes).toBeLessThan(READ_CHUNK_BYTES)
        expect(bytes + Buffer.byteLength(straddleLine)).toBeGreaterThan(READ_CHUNK_BYTES)
        const straddleIndex = lines.length
        lines.push(straddleLine)
        bytes += Buffer.byteLength(straddleLine) + 1

        while (bytes < 3 * 1024 * 1024) pushFiller()
        const tailText = "the-very-last-record"
        lines.push(userLine(tailText, 9_000_000))
        lines.push("")

        const file = writeRollout(dir, "rollout-big.jsonl", lines.join("\n"))
        const session = expectParsed(parseCodexRolloutFile(file, makeDeps()))

        // Every line but the trailing empty one produced a record.
        expect(session.records).toHaveLength(lines.length - 1)
        const straddled = session.records[straddleIndex]
        expect(straddled?.lineIndex).toBe(straddleIndex)
        expect(straddled?.kind === "user_message" ? straddled.text : null).toBe(straddleText)
        const last = session.records[session.records.length - 1]
        expect(last?.kind === "user_message" ? last.text : null).toBe(tailText)
        expect(session.lastTimestamp).toBe(9_000_000)
      })
    },
    30_000,
  )

  test("sourceHash is stable across re-reads and changes after an append", () => {
    withTempDir((dir) => {
      const file = writeRollout(dir, "rollout-hash.jsonl", `${metaLine()}\n${userLine("a", 1)}\n`)

      const first = expectParsed(parseCodexRolloutFile(file, makeDeps())).sourceHash
      const second = expectParsed(parseCodexRolloutFile(file, makeDeps())).sourceHash
      expect(second).toBe(first)
      expect(first.startsWith("codex:v1:")).toBe(true)

      appendFileSync(file, `${userLine("b", 2)}\n`)
      const afterAppend = expectParsed(parseCodexRolloutFile(file, makeDeps())).sourceHash
      expect(afterAppend).not.toBe(first)
    })
  })

  test("returns tooLarge — not null — for a file over the cap", () => {
    withTempDir((dir) => {
      const file = writeRollout(dir, "rollout-big-cap.jsonl", `${metaLine()}\n${userLine("a", 1)}\n`)

      const result = parseCodexRolloutFile(file, makeDeps({ maxBytes: 8 }))
      expect(result.kind).toBe("tooLarge")
      if (result.kind !== "tooLarge") throw new Error("expected tooLarge")
      expect(result.maxBytes).toBe(8)
      expect(result.size).toBeGreaterThan(8)
    })
  })

  test("rejects a subagent rollout", () => {
    withTempDir((dir) => {
      const file = writeRollout(
        dir,
        "rollout-sub.jsonl",
        `${metaLine({ parent: "parent-thread" })}\n${userLine("a", 1)}\n`,
      )

      const result = parseCodexRolloutFile(file, makeDeps())
      expect(result).toEqual({ kind: "rejected", reason: "subagent" })
    })
  })

  test("rejects a rollout with no session_meta, no cwd, or no records", () => {
    withTempDir((dir) => {
      const noMeta = writeRollout(dir, "rollout-nometa.jsonl", `${userLine("a", 1)}\n`)
      expect(parseCodexRolloutFile(noMeta, makeDeps())).toEqual({ kind: "rejected", reason: "no_session_meta" })

      const noCwd = writeRollout(dir, "rollout-nocwd.jsonl", `${metaLine({ cwd: "" })}\n${userLine("a", 1)}\n`)
      expect(parseCodexRolloutFile(noCwd, makeDeps())).toEqual({ kind: "rejected", reason: "no_cwd" })

      const empty = writeRollout(dir, "rollout-empty.jsonl", "")
      expect(parseCodexRolloutFile(empty, makeDeps())).toEqual({ kind: "rejected", reason: "no_records" })

      const noneKept = writeRollout(dir, "rollout-nokeep.jsonl", "garbage\nmore garbage\n")
      expect(parseCodexRolloutFile(noneKept, makeDeps())).toEqual({ kind: "rejected", reason: "no_records" })
    })
  })

  test("rejects an unreadable path and a directory", () => {
    withTempDir((dir) => {
      expect(parseCodexRolloutFile(path.join(dir, "missing.jsonl"), makeDeps())).toEqual({
        kind: "rejected",
        reason: "unreadable",
      })

      const asDir = path.join(dir, "rollout-dir.jsonl")
      mkdirSync(asDir)
      expect(parseCodexRolloutFile(asDir, makeDeps())).toEqual({ kind: "rejected", reason: "unreadable" })
    })
  })

  test("says so when the CLASSIFIER threw, instead of blaming the file", () => {
    withTempDir((dir) => {
      const file = writeRollout(dir, "rollout-throws.jsonl", `${metaLine()}\n${userLine("a", 1)}\n`)
      const boom = () => {
        throw new TypeError("classifier regression")
      }

      const messages = withLogSpy("error", (captured) => {
        // Still `unreadable`: `SessionSource.parse` promises never to throw and
        // the rejection vocabulary is not this adapter's to widen. What changes
        // is that the operator is told a whole-corpus classifier regression is
        // not "all my rollouts are unreadable".
        expect(parseCodexRolloutFile(file, makeDeps({ classifyLine: boom }))).toEqual({
          kind: "rejected",
          reason: "unreadable",
        })
        return captured
      })

      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain("classifier")
      expect(messages[0]).toContain(file)
      expect(messages[0]).toContain("classifier regression")
    })
  })

  test("falls back to file mtime when no record carries a timestamp", () => {
    withTempDir((dir) => {
      const file = writeRollout(dir, "rollout-nots.jsonl", `${metaLine({ ts: Number.NaN })}\n`)
      // `JSON.stringify(NaN)` writes `null`, so the meta line has no numeric ts
      // and the classifier falls back to the value the adapter supplies.
      const session = expectParsed(parseCodexRolloutFile(file, makeDeps()))
      expect(session.firstTimestamp).toBeGreaterThan(0)
      expect(session.lastTimestamp).toBe(session.firstTimestamp)
    })
  })
})

describe("unparseable-line accounting", () => {
  test("counts corrupt lines and warns ONCE for the file", () => {
    withTempDir((dir) => {
      const file = writeRollout(
        dir,
        "rollout-corrupt.jsonl",
        [
          metaLine(),
          "not json at all",
          userLine("kept", 2000),
          '{"type":"user","text":"half-writ',
          // A recognised line the classifier deliberately drops — never corruption.
          JSON.stringify({ type: "world_state" }),
          "",
        ].join("\n"),
      )

      const messages = withLogSpy("warn", (captured) => {
        const result = expectParsedResult(
          parseCodexRolloutFile(file, makeDeps({ classifyLineWithReason: fakeClassifyWithReason })),
        )
        expect(result.diagnostics.unparseableLines).toBe(2)
        expect(result.diagnostics.truncatedFinalLine).toBe(false)
        expect(result.session.records).toHaveLength(2)
        return captured
      })

      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain("2 unparseable lines")
      expect(messages[0]).toContain(file)
    })
  })

  test("a truncated FINAL line is codex mid-write — not counted, not warned", () => {
    withTempDir((dir) => {
      // No trailing newline: this is exactly what a rollout looks like between
      // the write of a record and the write of its `\n`.
      const file = writeRollout(
        dir,
        "rollout-midwrite.jsonl",
        `${metaLine()}\n${userLine("kept", 2000)}\n{"type":"user","text":"half-writ`,
      )

      const messages = withLogSpy("warn", (captured) => {
        const result = expectParsedResult(
          parseCodexRolloutFile(file, makeDeps({ classifyLineWithReason: fakeClassifyWithReason })),
        )
        expect(result.diagnostics.unparseableLines).toBe(0)
        expect(result.diagnostics.truncatedFinalLine).toBe(true)
        // The next tick re-reads the same byte offset, so the record arrives
        // later at the SAME lineIndex. Nothing is lost and nothing is alarming.
        expect(result.session.records.map((r) => r.lineIndex)).toEqual([0, 1])
        return captured
      })

      expect(messages).toEqual([])
    })
  })

  test("reports null — not zero — when no reason classifier is injected", () => {
    withTempDir((dir) => {
      const file = writeRollout(
        dir,
        "rollout-noreason.jsonl",
        [metaLine(), "not json at all", userLine("kept", 2000), ""].join("\n"),
      )

      const messages = withLogSpy("warn", (captured) => {
        const result = expectParsedResult(parseCodexRolloutFile(file, makeDeps()))
        // `classifyLine` answers null for a blank line, a corrupt line and a
        // dropped type alike, so zero would be a claim the adapter cannot make.
        expect(result.diagnostics.unparseableLines).toBeNull()
        expect(result.diagnostics.truncatedFinalLine).toBe(false)
        return captured
      })

      expect(messages).toEqual([])
    })
  })

  test("the reason classifier decides which records are retained", () => {
    withTempDir((dir) => {
      const file = writeRollout(
        dir,
        "rollout-reason-records.jsonl",
        [metaLine(), "", userLine("a", 1), "garbage", userLine("b", 2), ""].join("\n"),
      )

      const session = withLogSpy("warn", () =>
        expectParsed(parseCodexRolloutFile(file, makeDeps({ classifyLineWithReason: fakeClassifyWithReason }))),
      )
      expect(session.records.map((r) => r.lineIndex)).toEqual([0, 2, 4])
    })
  })
})

describe("the shrink guard", () => {
  test("parseCodexSourceHash reads the size back off a hash the parser minted", () => {
    withTempDir((dir) => {
      const body = `${metaLine()}\n${userLine("a", 1)}\n`
      const file = writeRollout(dir, "rollout-parts.jsonl", body)

      const parts = parseCodexSourceHash(expectParsed(parseCodexRolloutFile(file, makeDeps())).sourceHash)
      expect(parts?.size).toBe(Buffer.byteLength(body))
      expect(parts?.mtimeMs).toBeGreaterThan(0)
      expect(parts?.digest).toMatch(/^[0-9a-f]{32}$/)
    })
  })

  test("parseCodexSourceHash returns null for anything it did not mint", () => {
    expect(parseCodexSourceHash("")).toBeNull()
    expect(parseCodexSourceHash("codex:v1:12:34")).toBeNull()
    expect(parseCodexSourceHash("codex:v2:12:34:abc")).toBeNull()
    expect(parseCodexSourceHash("codex:v1::34:abc")).toBeNull()
    expect(parseCodexSourceHash("codex:v1:12:34:")).toBeNull()
    // A claude sourceHash, which is what a mis-keyed lookup would hand over.
    expect(parseCodexSourceHash("9f2b1c4d")).toBeNull()
  })

  test("detects a rewritten rollout that SHRANK, and stays quiet on an append", () => {
    withTempDir((dir) => {
      const file = writeRollout(
        dir,
        "rollout-shrink.jsonl",
        [metaLine(), userLine("one", 1), userLine("two", 2), ""].join("\n"),
      )
      const before = expectParsed(parseCodexRolloutFile(file, makeDeps())).sourceHash

      appendFileSync(file, `${userLine("three", 3)}\n`)
      const grown = expectParsed(parseCodexRolloutFile(file, makeDeps())).sourceHash
      expect(hasCodexSourceShrunk(before, grown)).toBe(false)
      expect(hasCodexSourceShrunk(before, before)).toBe(false)

      // A rotation / truncation / re-serialisation: every `codex#<lineIndex>`
      // key past the shift now names a different record.
      writeFileSync(file, [metaLine(), userLine("two", 2), ""].join("\n"))
      const shrunk = expectParsed(parseCodexRolloutFile(file, makeDeps())).sourceHash
      expect(hasCodexSourceShrunk(before, shrunk)).toBe(true)
    })
  })

  test("reports no shrink when either hash is unreadable — absence of evidence, not evidence", () => {
    expect(hasCodexSourceShrunk("not-a-codex-hash", "codex:v1:10:1:abc")).toBe(false)
    expect(hasCodexSourceShrunk("codex:v1:99:1:abc", "not-a-codex-hash")).toBe(false)
  })
})
