import type { HookInput } from "@anthropic-ai/claude-agent-sdk"
import { expect, test } from "vite-plus/test"
import { inboxHandlerTurnKind, inboxInstructScheduleId, inboxReplyScheduleId } from "../shared/inbound/handler-turn"
import { buildInboxGuardMatcher, inboxToolPolicyOf, type InboxToolPolicy } from "./claude-inbox-guard"

const REPLY = { tool: "zalo_send_message", args: {}, resultIdPath: "" }
const SOURCES = [
  { serverId: "srv-zalo", reply: REPLY },
  { serverId: "srv-feed", reply: null },
]
const SERVERS = [
  { id: "srv-zalo", name: "zalo-mcp" },
  { id: "srv-feed", name: "feed" },
]

function preToolUse(toolName: string): HookInput {
  return {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: {},
    tool_use_id: "tu-1",
    session_id: "s1",
    transcript_path: "/tmp/t",
    cwd: "/tmp",
  }
}

async function decisionFor(policy: InboxToolPolicy | null, toolName: string): Promise<string | undefined> {
  const matcher = buildInboxGuardMatcher(() => policy)
  const [hook] = matcher.hooks
  const output = await hook(preToolUse(toolName), "tu-1", { signal: new AbortController().signal })
  return "hookSpecificOutput" in output && output.hookSpecificOutput?.hookEventName === "PreToolUse"
    ? output.hookSpecificOutput.permissionDecision
    : undefined
}

function policyForTurn(scheduleId: string | undefined): InboxToolPolicy | null {
  return inboxToolPolicyOf(scheduleId, SOURCES, SERVERS)
}

test("a triage turn cannot run Bash or call the reply source's tools, raw or normalised", async () => {
  const policy = policyForTurn("mcp-src-1-delivery-9")
  expect(await decisionFor(policy, "Bash")).toBe("deny")
  expect(await decisionFor(policy, "mcp__zalo-mcp__zalo_send_message")).toBe("deny")
  expect(await decisionFor(policy, "mcp__zalo_mcp__zalo_send_message")).toBe("deny")
})

test("a triage turn keeps the tools it needs to investigate and report", async () => {
  const policy = policyForTurn("webhook-hook-1-delivery-9")
  expect(await decisionFor(policy, "Read")).toBeUndefined()
  expect(await decisionFor(policy, "mcp__kanna__inbox_report")).toBeUndefined()
  expect(await decisionFor(policy, "mcp__feed__search")).toBeUndefined()
})

test("an ask turn is restricted like a triage turn", async () => {
  const policy = policyForTurn(inboxInstructScheduleId("thread-1", 5))
  expect(await decisionFor(policy, "Bash")).toBe("deny")
  expect(await decisionFor(policy, "mcp__zalo-mcp__zalo_send_message")).toBe("deny")
})

test("the legacy agent-reply turn and an ordinary turn are not restricted", async () => {
  expect(policyForTurn(inboxReplyScheduleId("thread-1", 1))).toBeNull()
  expect(policyForTurn(undefined)).toBeNull()
  expect(inboxHandlerTurnKind(inboxReplyScheduleId("thread-1", 1))).toBe("agent-reply")
  expect(await decisionFor(null, "Bash")).toBeUndefined()
  expect(await decisionFor(null, "mcp__zalo-mcp__zalo_send_message")).toBeUndefined()
})
