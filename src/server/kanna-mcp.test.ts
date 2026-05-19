import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import type { TranscriptEntry } from "../shared/types"
import { buildDelegateProgressEmitter, buildKannaMcpTools, resolveOfferDownload } from "./kanna-mcp"
import { POLICY_DEFAULT } from "../shared/permission-policy"

let tempRoot: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "kanna-mcp-"))
  await mkdir(path.join(tempRoot, "dist"), { recursive: true })
  await writeFile(path.join(tempRoot, "dist", "build.zip"), "binary contents")
  await writeFile(path.join(tempRoot, "report.pdf"), "%PDF-1.4")
})

afterAll(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
})

describe("resolveOfferDownload", () => {
  test("returns content URL + metadata for a valid project file", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "dist/build.zip", label: "Latest build" },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.contentUrl).toBe("/api/projects/p1/files/dist/build.zip/content")
    expect(result.payload.fileName).toBe("build.zip")
    expect(result.payload.displayName).toBe("Latest build")
    expect(result.payload.relativePath).toBe("dist/build.zip")
    expect(result.payload.size).toBeGreaterThan(0)
    expect(result.payload.mimeType).toBeTruthy()
  })

  test("falls back to file name when label missing", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "report.pdf" },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.displayName).toBe("report.pdf")
    expect(result.payload.mimeType).toBeTruthy()
  })

  test("rejects absolute paths", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "/etc/passwd" },
    )
    expect(result.ok).toBe(false)
  })

  test("rejects parent-relative escape paths", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "../../etc/hosts" },
    )
    expect(result.ok).toBe(false)
  })

  test("rejects directories", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "dist" },
    )
    expect(result.ok).toBe(false)
  })

  test("rejects missing files", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "missing.txt" },
    )
    expect(result.ok).toBe(false)
  })

  test("URL-encodes project ID with special characters", async () => {
    const result = await resolveOfferDownload(
      { projectId: "proj 1/extra", localPath: tempRoot },
      { path: "report.pdf" },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.contentUrl.startsWith("/api/projects/proj%201%2Fextra/files/")).toBe(true)
  })
})

const makeArgs = (toolCallback?: Parameters<typeof buildKannaMcpTools>[0]["toolCallback"]) => ({
  projectId: "p",
  localPath: "/tmp",
  chatId: "c",
  sessionId: "s",
  toolCallback,
  chatPolicy: POLICY_DEFAULT,
  tunnelGateway: null,
})

test("feature flag off → ask_user_question / exit_plan_mode NOT registered", () => {
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
  const tools = buildKannaMcpTools(makeArgs(undefined))
  const names = tools.map((t) => t.name)
  expect(names).not.toContain("ask_user_question")
  expect(names).not.toContain("exit_plan_mode")
})

test("feature flag on → tools registered when toolCallback present", () => {
  process.env.KANNA_MCP_TOOL_CALLBACKS = "1"
  const stub: Parameters<typeof buildKannaMcpTools>[0]["toolCallback"] = {
    submit: async () => ({ status: "answered", decision: { kind: "deny" as const, reason: "test" } }),
    answer: async () => {},
    cancel: async () => {},
    cancelAllForChat: async () => {},
    cancelAllForSession: async () => {},
    recoverOnStartup: async () => {},
    tickTimeouts: async () => {},
  }
  const tools = buildKannaMcpTools(makeArgs(stub))
  const names = tools.map((t) => t.name)
  expect(names).toContain("ask_user_question")
  expect(names).toContain("exit_plan_mode")
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
})

test("feature flag on but toolCallback absent → tools NOT registered", () => {
  process.env.KANNA_MCP_TOOL_CALLBACKS = "1"
  const tools = buildKannaMcpTools(makeArgs(undefined))
  const names = tools.map((t) => t.name)
  expect(names).not.toContain("ask_user_question")
  expect(names).not.toContain("exit_plan_mode")
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
})

test("feature flag on → all 8 new mcp__kanna__* tools registered", () => {
  process.env.KANNA_MCP_TOOL_CALLBACKS = "1"
  try {
    const stub = {
      submit: async () => ({ status: "answered", decision: { kind: "deny" } }),
      answer: async () => {},
      cancel: async () => {},
      cancelAllForChat: async () => {},
      cancelAllForSession: async () => {},
      recoverOnStartup: async () => {},
      tickTimeouts: async () => {},
    }
    const tools = buildKannaMcpTools({
      projectId: "p",
      localPath: "/tmp",
      chatId: "c",
      sessionId: "s",
      toolCallback: stub as unknown as Parameters<typeof buildKannaMcpTools>[0]["toolCallback"],
      chatPolicy: POLICY_DEFAULT,
      tunnelGateway: null,
    })
    const names = tools.map((t) => t.name)
    for (const n of ["read", "glob", "grep", "bash", "edit", "write", "webfetch", "websearch"]) {
      expect(names).toContain(n)
    }
    expect(names).not.toContain("probe_unavailable")
  } finally {
    delete process.env.KANNA_MCP_TOOL_CALLBACKS
  }
})

// ── Issue #215: PTY forces interactive shims without the env flag ──────────

const callbackStub = (): Parameters<typeof buildKannaMcpTools>[0]["toolCallback"] => ({
  submit: async () => ({ status: "answered", decision: { kind: "deny" as const, reason: "test" } }),
  answer: async () => {},
  cancel: async () => {},
  cancelAllForChat: async () => {},
  cancelAllForSession: async () => {},
  recoverOnStartup: async () => {},
  tickTimeouts: async () => {},
})

test("forceInteractiveToolCallbacks → ask_user_question / exit_plan_mode registered with env flag UNSET", () => {
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
  const tools = buildKannaMcpTools({
    ...makeArgs(callbackStub()),
    forceInteractiveToolCallbacks: true,
  })
  const names = tools.map((t) => t.name)
  expect(names).toContain("ask_user_question")
  expect(names).toContain("exit_plan_mode")
})

test("forceInteractiveToolCallbacks does NOT register the 8 built-in shims (env flag UNSET)", () => {
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
  const tools = buildKannaMcpTools({
    ...makeArgs(callbackStub()),
    forceInteractiveToolCallbacks: true,
  })
  const names = tools.map((t) => t.name)
  for (const n of ["read", "glob", "grep", "bash", "edit", "write", "webfetch", "websearch"]) {
    expect(names).not.toContain(n)
  }
})

test("forceInteractiveToolCallbacks but toolCallback absent → nothing registered (fail-safe)", () => {
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
  const tools = buildKannaMcpTools({
    ...makeArgs(undefined),
    forceInteractiveToolCallbacks: true,
  })
  const names = tools.map((t) => t.name)
  expect(names).not.toContain("ask_user_question")
  expect(names).not.toContain("exit_plan_mode")
})

describe("buildDelegateProgressEmitter", () => {
  function makeEntry(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
    return { _id: "e1", createdAt: 1, kind: "assistant_text", text: "x", ...over } as TranscriptEntry
  }

  test("returns undefined when extra is null / not an object", () => {
    expect(buildDelegateProgressEmitter(null)).toBeUndefined()
    expect(buildDelegateProgressEmitter(undefined)).toBeUndefined()
    expect(buildDelegateProgressEmitter("nope")).toBeUndefined()
  })

  test("returns undefined when progressToken is missing", () => {
    const sendNotification = async () => undefined
    expect(buildDelegateProgressEmitter({ sendNotification })).toBeUndefined()
    expect(buildDelegateProgressEmitter({ _meta: {}, sendNotification })).toBeUndefined()
  })

  test("returns undefined when sendNotification is missing", () => {
    expect(buildDelegateProgressEmitter({ _meta: { progressToken: 42 } })).toBeUndefined()
  })

  test("emits notifications/progress with incrementing progress on each entry", async () => {
    const sent: Array<{ method: string; params: Record<string, unknown> }> = []
    const emit = buildDelegateProgressEmitter({
      _meta: { progressToken: "tok-1" },
      sendNotification: async (n: { method: string; params: Record<string, unknown> }) => {
        sent.push(n)
      },
    })
    expect(emit).toBeDefined()
    emit!(makeEntry())
    emit!(makeEntry({
      kind: "tool_call",
      tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "t1", input: { command: "ls" } },
    } as TranscriptEntry))
    await new Promise((r) => setTimeout(r, 5))
    expect(sent).toHaveLength(2)
    expect(sent[0].method).toBe("notifications/progress")
    expect(sent[0].params.progressToken).toBe("tok-1")
    expect(sent[0].params.progress).toBe(1)
    expect(sent[1].params.progress).toBe(2)
    expect(sent[1].params.message).toBe("tool_call:Bash")
  })

  test("swallows sendNotification rejections so they do not break the run", async () => {
    const emit = buildDelegateProgressEmitter({
      _meta: { progressToken: 7 },
      sendNotification: async () => {
        throw new Error("transport gone")
      },
    })
    expect(emit).toBeDefined()
    // Should not throw synchronously and the unhandled rejection is swallowed by .catch().
    expect(() => emit!(makeEntry())).not.toThrow()
    await new Promise((r) => setTimeout(r, 5))
  })
})
