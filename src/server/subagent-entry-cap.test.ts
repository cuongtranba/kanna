import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { capTranscriptEntry, SUBAGENT_RESULT_THRESHOLD, PREVIEW_SIZE } from "./subagent-entry-cap"
import type { TranscriptEntry } from "../shared/types"

describe("capTranscriptEntry", () => {
  let kannaRoot: string

  beforeEach(async () => {
    kannaRoot = await mkdtemp(path.join(tmpdir(), "kanna-cap-test-"))
  })

  afterEach(async () => {
    await rm(kannaRoot, { recursive: true, force: true })
  })

  function makeEntry(content: unknown): TranscriptEntry {
    return {
      kind: "tool_result",
      _id: "test-entry",
      createdAt: 0,
      toolId: "tool-xyz",
      content,
    } as TranscriptEntry
  }

  test("passthrough non-tool_result entry", async () => {
    const entry: TranscriptEntry = {
      kind: "assistant_text",
      _id: "a",
      createdAt: 0,
      text: "hello",
    } as TranscriptEntry
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    expect(out).toBe(entry)
  })

  test("passthrough tool_result under threshold", async () => {
    const entry = makeEntry("hello world")
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    expect(out).toBe(entry)
    expect("persisted" in out).toBe(false)
  })

  test("persist tool_result over threshold (string content)", async () => {
    const big = "a".repeat(SUBAGENT_RESULT_THRESHOLD + 100)
    const entry = makeEntry(big)
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    expect(out).not.toBe(entry)
    const persisted = (out as { persisted?: { filePath: string; originalSize: number; isJson: boolean; truncated: true } }).persisted
    expect(persisted).toBeDefined()
    expect(persisted!.originalSize).toBe(big.length)
    expect(persisted!.isJson).toBe(false)
    expect(persisted!.truncated).toBe(true)
    expect(persisted!.filePath.endsWith("tool-xyz.txt")).toBe(true)
    const onDisk = await readFile(persisted!.filePath, "utf-8")
    expect(onDisk).toBe(big)
    const preview = (out as { content: string }).content
    expect(preview).toContain("<persisted-output>")
    expect(preview).toContain("Output too large")
    expect(preview.length).toBeLessThan(PREVIEW_SIZE + 1000)
  })

  test("persist tool_result over threshold (json array content)", async () => {
    const blocks = Array.from({ length: 1000 }, (_, i) => ({ type: "text", text: `line ${i}\n${"x".repeat(100)}` }))
    const entry = makeEntry(blocks)
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const persisted = (out as { persisted?: { filePath: string; isJson: boolean } }).persisted
    expect(persisted).toBeDefined()
    expect(persisted!.isJson).toBe(true)
    expect(persisted!.filePath.endsWith("tool-xyz.json")).toBe(true)
  })

  test("idempotent: re-call with same toolUseId swallows EEXIST", async () => {
    const big = "z".repeat(SUBAGENT_RESULT_THRESHOLD + 1)
    const entry = makeEntry(big)
    const out1 = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const out2 = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    expect((out1 as { persisted?: { filePath: string } }).persisted!.filePath)
      .toBe((out2 as { persisted?: { filePath: string } }).persisted!.filePath)
    const s = await stat((out1 as { persisted?: { filePath: string } }).persisted!.filePath)
    expect(s.size).toBe(big.length)
  })

  test("measures bytes not chars: multibyte content under threshold by chars but over by bytes is persisted", async () => {
    const emoji = "\u{1F4A9}"
    const content = emoji.repeat(20_000)
    const entry = makeEntry(content)
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const persisted = (out as { persisted?: { originalSize: number } }).persisted
    expect(persisted).toBeDefined()
    expect(persisted!.originalSize).toBe(Buffer.byteLength(content, "utf8"))
  })

  test("sanitizes toolId with path separators", async () => {
    const big = "a".repeat(SUBAGENT_RESULT_THRESHOLD + 1)
    const entry: TranscriptEntry = {
      kind: "tool_result",
      _id: "e1",
      createdAt: 0,
      toolId: "../../../etc/passwd",
      content: big,
    } as TranscriptEntry
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const filePath = (out as { persisted?: { filePath: string } }).persisted!.filePath
    expect(filePath).toContain(path.join("subagent-results", "r1"))
    expect(filePath).not.toContain("..")
    expect(filePath).not.toContain("/etc/passwd")
    expect(path.basename(filePath)).toMatch(/^[A-Za-z0-9_-]+\.txt$/)
  })

  test("preview cuts at newline boundary within last 50% of limit", async () => {
    const head = "line\n".repeat(300)
    const tail = "z".repeat(SUBAGENT_RESULT_THRESHOLD)
    const entry = makeEntry(head + tail)
    const out = await capTranscriptEntry({
      entry, chatId: "c1", runId: "r1", projectId: "p1", kannaRoot,
    })
    const content = (out as { content: string }).content
    const previewSection = content.slice(content.indexOf("Preview"))
    const previewBody = previewSection.split("\n").slice(1, -2).join("\n")
    expect(previewBody.endsWith("\n") || previewBody.endsWith("line")).toBe(true)
  })
})
