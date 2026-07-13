import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import type { TranscriptEntry } from "../shared/types"
import { buildDelegateProgressEmitter, buildKannaMcpTools, resolveOfferDownload, resolveWorkspaceFile } from "./kanna-mcp"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { KannaMcpDelegationContext } from "./kanna-mcp"

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
    recoverOnStartup: async () => {},
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
      recoverOnStartup: async () => {},
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
  recoverOnStartup: async () => {},
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

// ── keep_alive / send_subagent_message / close_subagent ───────────────────

interface FakeOrchestratorState {
  lastDelegate: {
    subagentId: string
    prompt: string
    keepAlive: boolean | undefined
  } | null
  lastSend: { runId: string; prompt: string } | null
  lastClose: { chatId: string; runId: string; reason: string } | null
}

function buildKannaMcpForTest(opts: { withDelegation: boolean }): {
  tools: Map<string, { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }>
  fakeOrch: FakeOrchestratorState
} {
  const state: FakeOrchestratorState = {
    lastDelegate: null,
    lastSend: null,
    lastClose: null,
  }
  const fakeOrchestrator: Pick<SubagentOrchestrator, "delegateRun" | "sendToLiveRun" | "closeLiveRun" | "findSubagent"> = {
    findSubagent: (id: string) => {
      if (id === "s1") return { id: "s1", name: "Agent S1", provider: "claude" as const, model: "claude-3-5-sonnet", systemPrompt: "", description: "", contextScope: "previous-assistant-reply" as const, triggerMode: "auto" as const, createdAt: 0, updatedAt: 0, modelOptions: { reasoningEffort: "low" as const, contextWindow: "200k" as const } }
      if (id === "s2-notclaude") return { id: "s2-notclaude", name: "Agent S2", provider: "codex" as const, model: "gpt-4o", systemPrompt: "", description: "", contextScope: "previous-assistant-reply" as const, triggerMode: "auto" as const, createdAt: 0, updatedAt: 0, modelOptions: { reasoningEffort: "medium" as const, fastMode: false } }
      return undefined
    },
    delegateRun: async (args) => {
      state.lastDelegate = {
        subagentId: args.subagentId,
        prompt: args.prompt,
        keepAlive: args.keepAlive,
      }
      return { status: "completed" as const, runId: "run-42", text: "done" }
    },
    sendToLiveRun: async (runId, prompt) => {
      state.lastSend = { runId, prompt }
      return { status: "completed" as const, runId, text: "follow-up reply" }
    },
    closeLiveRun: async (chatId, runId, reason) => {
      state.lastClose = { chatId, runId, reason }
    },
  }

  const delegationContext: KannaMcpDelegationContext = {
    parentSubagentId: null,
    parentRunId: null,
    ancestorSubagentIds: [],
    depth: 0,
    getParentUserMessageId: () => "msg-1",
    getMentionedSubagentIds: () => [],
  }

  const rawTools = buildKannaMcpTools({
    projectId: "p",
    localPath: "/tmp",
    chatId: "chat-test",
    sessionId: "s",
    chatPolicy: POLICY_DEFAULT,
    tunnelGateway: null,
    ...(opts.withDelegation
      ? {
          subagentOrchestrator: fakeOrchestrator as unknown as SubagentOrchestrator,
          delegationContext,
        }
      : {}),
  })

  const toolMap = new Map<string, { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }>()
  for (const t of rawTools) {
    toolMap.set(t.name, { handler: (input) => (t as { handler: (i: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }).handler(input, undefined) })
  }
  return { tools: toolMap, fakeOrch: state }
}

describe("keep_alive delegate + send_subagent_message + close_subagent", () => {
  test("delegate_subagent accepts keep_alive and returns run_id; send/close registered", async () => {
    const { tools, fakeOrch } = buildKannaMcpForTest({ withDelegation: true })
    expect(tools.has("delegate_subagent")).toBe(true)
    expect(tools.has("send_subagent_message")).toBe(true)
    expect(tools.has("close_subagent")).toBe(true)

    const res = await tools.get("delegate_subagent")!.handler({ subagent_id: "s1", prompt: "go", keep_alive: true })
    expect(fakeOrch.lastDelegate?.keepAlive).toBe(true)
    expect(res.content[0].text).toMatch(/run_id/)
  })

  test("delegate_subagent without keep_alive does not append run_id hint", async () => {
    const { tools } = buildKannaMcpForTest({ withDelegation: true })
    const res = await tools.get("delegate_subagent")!.handler({ subagent_id: "s1", prompt: "go" })
    expect(res.isError).toBeUndefined()
    const parsed = JSON.parse(res.content[0].text) as { status: string; run_id: string }
    expect(parsed.status).toBe("completed")
    // No keep-alive hint appended (text is just the JSON)
    expect(res.content[0].text).not.toContain("session kept alive")
  })

  test("delegate_subagent with keep_alive=true appends session hint", async () => {
    const { tools } = buildKannaMcpForTest({ withDelegation: true })
    const res = await tools.get("delegate_subagent")!.handler({ subagent_id: "s1", prompt: "go", keep_alive: true })
    expect(res.content[0].text).toContain("session kept alive")
    expect(res.content[0].text).toContain("run-42")
  })

  test("delegate_subagent rejects keep_alive for non-claude subagents", async () => {
    const { tools } = buildKannaMcpForTest({ withDelegation: true })
    const res = await tools.get("delegate_subagent")!.handler({ subagent_id: "s2-notclaude", prompt: "go", keep_alive: true })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("Claude subagents")
  })

  test("send_subagent_message forwards to orchestrator and returns text", async () => {
    const { tools, fakeOrch } = buildKannaMcpForTest({ withDelegation: true })
    const res = await tools.get("send_subagent_message")!.handler({ run_id: "run-42", prompt: "next step" })
    expect(fakeOrch.lastSend?.runId).toBe("run-42")
    expect(fakeOrch.lastSend?.prompt).toBe("next step")
    expect(res.content[0].text).toBe("follow-up reply")
  })

  test("close_subagent calls orchestrator.closeLiveRun with explicit reason", async () => {
    const { tools, fakeOrch } = buildKannaMcpForTest({ withDelegation: true })
    const res = await tools.get("close_subagent")!.handler({ run_id: "run-42" })
    expect(fakeOrch.lastClose?.runId).toBe("run-42")
    expect(fakeOrch.lastClose?.reason).toBe("explicit")
    expect(res.content[0].text).toContain("run-42")
  })

  test("send/close NOT registered without delegation context", () => {
    const { tools } = buildKannaMcpForTest({ withDelegation: false })
    expect(tools.has("delegate_subagent")).toBe(false)
    expect(tools.has("send_subagent_message")).toBe(false)
    expect(tools.has("close_subagent")).toBe(false)
  })
})

describe("schedule_wakeup tool removed", () => {
  test("no schedule_wakeup registered under any args (hard-break per adr-20260711-notification-driven-loop-orchestration)", () => {
    const baseArgs = {
      projectId: "p",
      localPath: "/tmp",
      chatId: "c",
      sessionId: "s",
      chatPolicy: POLICY_DEFAULT,
      tunnelGateway: null,
    } as const
    const tools = buildKannaMcpTools({ ...baseArgs })
    expect(tools.map((t) => t.name)).not.toContain("schedule_wakeup")
  })
})

describe("setup_loop tool", () => {
  const baseArgs = {
    projectId: "p",
    localPath: "/tmp",
    chatId: "c",
    sessionId: "s",
    chatPolicy: POLICY_DEFAULT,
    tunnelGateway: null,
  } as const

  function toolMap(tools: ReturnType<typeof buildKannaMcpTools>) {
    const m = new Map<string, { handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }>()
    for (const t of tools) {
      m.set(t.name, {
        handler: (i) => (
          t as { handler: (x: Record<string, unknown>, e: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }
        ).handler(i, undefined),
      })
    }
    return m
  }

  test("hidden when no setupLoop callback supplied", () => {
    const tools = buildKannaMcpTools({ ...baseArgs })
    expect(tools.map((t) => t.name)).not.toContain("setup_loop")
  })

  test("hidden when chatId is absent (subagent spawns lose the tool)", () => {
    const tools = buildKannaMcpTools({
      ...baseArgs,
      chatId: undefined,
      setupLoop: async () => ({
        ok: true,
        trackingFileRel: "PROGRESS.md",
        created: false,
        reconciled: false,
        reconcileActions: [],
        prompt: "x",
      }),
    })
    expect(tools.map((t) => t.name)).not.toContain("setup_loop")
  })

  test("registered when setupLoop + chatId supplied; forwards zod-validated input; surfaces success", async () => {
    const calls: Array<Record<string, unknown>> = []
    const tools = toolMap(buildKannaMcpTools({
      ...baseArgs,
      setupLoop: async (input) => {
        calls.push({ ...input })
        return {
          ok: true,
          trackingFileRel: "PROGRESS.md",
          created: true,
          reconciled: false,
          reconcileActions: [],
          prompt: "the rendered loop prompt",
        }
      },
    }))
    expect(tools.has("setup_loop")).toBe(true)
    const res = await tools.get("setup_loop")!.handler({
      goal: "eslint passes",
      verify_command: "bun run lint",
      chunk_hint: "start with src/client",
    })
    expect(res.isError).toBeUndefined()
    expect(calls[0]).toEqual({
      goal: "eslint passes",
      verifyCommand: "bun run lint",
      trackingFile: undefined,
      chunkHint: "start with src/client",
    })
    expect(res.content[0].text).toContain("PROGRESS.md")
    expect(res.content[0].text).toContain("created skeleton")
    expect(res.content[0].text).toContain("cleared")
  })

  test("existing conformant tracking file: message reports it already conforms", async () => {
    const tools = toolMap(buildKannaMcpTools({
      ...baseArgs,
      setupLoop: async () => ({
        ok: true,
        trackingFileRel: "PROGRESS.md",
        created: false,
        reconciled: false,
        reconcileActions: [],
        prompt: "p",
      }),
    }))
    const res = await tools.get("setup_loop")!.handler({
      goal: "g",
      verify_command: "true",
    })
    expect(res.isError).toBeUndefined()
    expect(res.content[0].text).toContain("existing file already conforms to the loop schema")
  })

  test("existing reconciled tracking file: message lists the deterministic actions taken", async () => {
    const tools = toolMap(buildKannaMcpTools({
      ...baseArgs,
      setupLoop: async () => ({
        ok: true,
        trackingFileRel: "PROGRESS.md",
        created: false,
        reconciled: true,
        reconcileActions: ['rewrote "## Goal"', 'inserted "## Next chunk"'],
        prompt: "p",
      }),
    }))
    const res = await tools.get("setup_loop")!.handler({
      goal: "g",
      verify_command: "true",
    })
    expect(res.isError).toBeUndefined()
    expect(res.content[0].text).toContain("existing file reconciled to the loop schema")
    expect(res.content[0].text).toContain('rewrote "## Goal"')
    expect(res.content[0].text).toContain('inserted "## Next chunk"')
  })

  test("validator rejection → isError with the error list", async () => {
    const tools = toolMap(buildKannaMcpTools({
      ...baseArgs,
      setupLoop: async () => ({
        ok: false,
        errors: ["goal is required and must be a non-empty string", "verifyCommand is required and must be a non-empty string"],
      }),
    }))
    const res = await tools.get("setup_loop")!.handler({
      goal: "g",
      verify_command: "true",
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("setup_loop rejected")
    expect(res.content[0].text).toContain("goal is required")
    expect(res.content[0].text).toContain("verifyCommand is required")
  })
})

describe("resolveWorkspaceFile", () => {
  test("resolves a markdown file and returns local-file contentUrl", async () => {
    const mdPath = path.join(tempRoot, "spec.md")
    await writeFile(mdPath, "# hello")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "spec.md" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.contentUrl).toMatch(/^\/api\/local-file\?path=/)
    expect(result.payload.contentUrl).toContain(encodeURIComponent(mdPath))
    expect(result.payload.fileName).toBe("spec.md")
    expect(result.payload.mimeType).toContain("text/markdown")
    expect(result.payload.size).toBeGreaterThan(0)
  })

  test("resolves a .ts source file", async () => {
    const tsPath = path.join(tempRoot, "index.ts")
    await writeFile(tsPath, "export const x = 1")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "index.ts" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.mimeType).toContain("text/plain")
  })

  test("resolves a .mmd mermaid file", async () => {
    const mmdPath = path.join(tempRoot, "flow.mmd")
    await writeFile(mmdPath, "graph TD\nA-->B")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "flow.mmd" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.mimeType).toBe("text/vnd.mermaid")
  })

  test("resolves a .png image file", async () => {
    const pngPath = path.join(tempRoot, "logo.png")
    await writeFile(pngPath, Buffer.from("PNG"))
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "logo.png" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.mimeType).toBe("image/png")
  })

  test("resolves a .json file despite its charset mime parameter", async () => {
    const jsonPath = path.join(tempRoot, "data.json")
    await writeFile(jsonPath, "{}")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "data.json" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.mimeType).toBe("application/json; charset=utf-8")
  })

  test("rejects absolute paths", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "/etc/passwd" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error).toContain("Invalid project file path")
  })

  test("rejects traversal paths", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "../../../etc/passwd" })
    expect(result.ok).toBe(false)
  })

  test("rejects missing files", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "ghost.md" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error).toContain("ghost.md")
  })

  test("rejects directories", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "dist" })
    expect(result.ok).toBe(false)
  })

  test("rejects non-previewable mime (zip)", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "dist/build.zip" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error).toContain("offer_download")
  })

  test("rejects extensionless files as non-previewable", async () => {
    const noExt = path.join(tempRoot, "Makefile")
    await writeFile(noExt, "all:\n\techo done")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "Makefile" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error).toContain("offer_download")
  })

  test("uses label as displayName when provided", async () => {
    const notesPath = path.join(tempRoot, "notes.md")
    await writeFile(notesPath, "# notes")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "notes.md", label: "My Notes" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.displayName).toBe("My Notes")
  })

  test("resolveOfferDownload still works after shared helper extraction (regression)", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "dist/build.zip" },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.contentUrl).toContain("/api/projects/p1/files/")
  })
})
