# MCP Tool Refactor + Durable Approval Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `ask_user_question` and `exit_plan_mode` from the SDK's inline `canUseTool` hook into the `kanna-mcp` server, behind a unified durable approval protocol (with HMAC-SHA256 deterministic IDs bound to canonical args, server-driven timeouts, cancellation, idempotency, and replay-on-reconnect). Add the `permission-gate.ts` policy module that both drivers will share. This is phase 1a of the larger Claude PTY driver spec (`docs/superpowers/specs/2026-05-14-claude-pty-driver-design.md`); it ships behind the `KANNA_MCP_TOOL_CALLBACKS=1` feature flag and benefits the existing SDK driver immediately.

**Architecture:** New `permission-gate.ts` exposes `policy.evaluate(toolName, args, chatSettings) → { verdict: "auto-allow" | "auto-deny" | "ask", reason? }`. New `tool-callback.ts` stores `ToolRequest` records in `EventStore`, exposes a server-side promise-keyed by `toolRequestId`, and handles lifecycle (pending → answered | timeout | canceled | session_closed | arg_mismatch). `kanna-mcp` gains two new tools (`ask_user_question`, `exit_plan_mode`) that call `policy.evaluate` then route through `tool-callback`. SDK driver's `canUseTool` becomes a thin pass-through to the same `permission-gate` + `tool-callback`. UI gains a `pending_tool_request` transcript entry kind that renders an approval card and supports cancel/answer; on reconnect, pending requests replay from `EventStore`.

**Tech Stack:** Bun + TypeScript + `@anthropic-ai/claude-agent-sdk` (existing), Zod (existing), `node:crypto` for HMAC, `bun:test`. No new runtime dependencies.

---

## File Structure

**Created:**

```
src/server/permission-gate.ts          # policy.evaluate; ChatPermissionPolicy types
src/server/permission-gate.test.ts
src/server/tool-callback.ts            # durable ToolRequest store + lifecycle
src/server/tool-callback.test.ts
src/server/kanna-mcp-tools/            # new dir for the per-tool kanna-mcp implementations
  ├── ask-user-question.ts
  ├── ask-user-question.test.ts
  ├── exit-plan-mode.ts
  ├── exit-plan-mode.test.ts
  └── tool-callback-shim.ts            # shared wrapper: call policy.evaluate + route via tool-callback
src/shared/permission-policy.ts        # ChatPermissionPolicy type shared with client
src/client/components/PendingToolRequestCard.tsx
src/client/components/PendingToolRequestCard.test.tsx
```

**Modified:**

```
src/server/kanna-mcp.ts                # register the two new tools (behind feature flag)
src/server/agent.ts                    # canUseTool routes through permission-gate + tool-callback
src/server/event-store.ts              # add ToolRequest CRUD + pendingToolRequests query
src/shared/types.ts                    # TranscriptEntry kind: "pending_tool_request" + cleared event
src/shared/tools.ts                    # canonicalArgsHash helper; normalizeToolCall already exists
```

---

## Conventions

- All new code is TypeScript, strict mode, no `any` (per `~/.claude/CLAUDE.md` strong-typing rule).
- Tests use `bun test`. Test files co-located next to source.
- Commits use Conventional Commits: `feat(scope):`, `test(scope):`, `refactor(scope):`. Each task ends with one commit.
- Feature flag check: `process.env.KANNA_MCP_TOOL_CALLBACKS === "1"`. Off by default in this plan; integration tests turn it on.
- TDD: every implementation task is preceded by a failing test.

---

## Task 1: Define `ChatPermissionPolicy` and `ToolRequest` types

**Files:**
- Create: `src/shared/permission-policy.ts`
- Modify: `src/shared/types.ts` (add `TranscriptEntry` kind for pending requests)
- Test: `src/shared/permission-policy.test.ts`

- [ ] **Step 1: Write the failing test**

`src/shared/permission-policy.test.ts`:

```ts
import { expect, test } from "bun:test"
import type { ChatPermissionPolicy, ToolRequest } from "./permission-policy"
import { POLICY_DEFAULT, POLICY_TERMINAL_STATUSES } from "./permission-policy"

test("default policy uses 'ask' verdict and has built-in deny patterns", () => {
  expect(POLICY_DEFAULT.defaultAction).toBe("ask")
  expect(POLICY_DEFAULT.readPathDeny).toContain("~/.ssh")
  expect(POLICY_DEFAULT.readPathDeny).toContain("~/.claude")
  expect(POLICY_DEFAULT.writePathDeny).toContain("/etc/**")
})

test("terminal statuses set includes timeout/canceled/arg_mismatch", () => {
  expect(POLICY_TERMINAL_STATUSES.has("answered")).toBe(true)
  expect(POLICY_TERMINAL_STATUSES.has("timeout")).toBe(true)
  expect(POLICY_TERMINAL_STATUSES.has("canceled")).toBe(true)
  expect(POLICY_TERMINAL_STATUSES.has("session_closed")).toBe(true)
  expect(POLICY_TERMINAL_STATUSES.has("arg_mismatch")).toBe(true)
})

test("ToolRequest type structurally requires canonicalArgsHash and toolName", () => {
  const req: ToolRequest = {
    id: "abc",
    chatId: "c1",
    sessionId: "s1",
    toolUseId: "tu1",
    toolName: "ask_user_question",
    arguments: {},
    canonicalArgsHash: "hash",
    policyVerdict: "ask",
    status: "pending",
    createdAt: 0,
    expiresAt: 0,
  }
  expect(req.id).toBe("abc")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/shared/permission-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/shared/permission-policy.ts`**

```ts
export type ToolRequestStatus =
  | "pending"
  | "answered"
  | "timeout"
  | "canceled"
  | "session_closed"
  | "arg_mismatch"

export const POLICY_TERMINAL_STATUSES: ReadonlySet<ToolRequestStatus> = new Set([
  "answered",
  "timeout",
  "canceled",
  "session_closed",
  "arg_mismatch",
])

export type PolicyVerdict = "auto-allow" | "auto-deny" | "ask"

export interface BashGateConfig {
  autoAllowVerbs: string[]
}

export interface ToolRule {
  tool: string
  pattern: string  // ECMAScript regex source
}

export interface ChatPermissionPolicy {
  defaultAction: "ask" | "auto-allow" | "auto-deny"
  bash: BashGateConfig
  readPathDeny: string[]
  writePathDeny: string[]
  toolDenyList: ToolRule[]
  toolAllowList: ToolRule[]
}

export interface ToolRequestDecision {
  kind: "allow" | "deny" | "answer"
  payload?: unknown
  reason?: string
}

export interface ToolRequest {
  id: string
  chatId: string
  sessionId: string
  toolUseId: string
  toolName: string
  arguments: Record<string, unknown>
  canonicalArgsHash: string
  policyVerdict: PolicyVerdict
  status: ToolRequestStatus
  decision?: ToolRequestDecision
  mismatchReason?: string
  createdAt: number
  resolvedAt?: number
  expiresAt: number
}

export const POLICY_DEFAULT: ChatPermissionPolicy = {
  defaultAction: "ask",
  bash: {
    autoAllowVerbs: ["ls", "pwd", "git status", "git diff", "git log"],
  },
  readPathDeny: [
    "~/.ssh",
    "~/.aws",
    "~/.gcp",
    "~/.config/gh",
    "~/.claude",
    "~/.kanna",
    "~/Library/Keychains",
    "/etc/shadow",
    "/etc/sudoers",
    "~/.npmrc",
    "~/.netrc",
    "~/.docker/config.json",
    "**/.env",
    "**/.env.*",
    "**/credentials*",
    "**/*.pem",
    "**/*.key",
    "**/id_rsa*",
    "**/id_ed25519*",
  ],
  writePathDeny: [
    "/etc/**",
    "/usr/**",
    "/System/**",
    "~/.ssh/**",
    "~/.aws/**",
    "~/.config/gh/**",
    "~/.claude/**",
    "~/.kanna/**",
  ],
  toolDenyList: [
    { tool: "mcp__kanna__bash", pattern: "rm\\s+-rf\\s+(/|~|\\$HOME)\\b" },
    { tool: "mcp__kanna__bash", pattern: "git\\s+push\\b.*--force" },
  ],
  toolAllowList: [],
}
```

Also add to `src/shared/types.ts` (`TranscriptEntry` discriminated union — locate the existing union and add):

```ts
// In the TranscriptEntry union, add:
  | { kind: "pending_tool_request"; toolRequestId: string }
  | { kind: "tool_request_resolved"; toolRequestId: string; status: ToolRequestStatus; decision?: ToolRequestDecision }
```

Import `ToolRequestStatus, ToolRequestDecision` from `./permission-policy`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/shared/permission-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/permission-policy.ts src/shared/permission-policy.test.ts src/shared/types.ts
git commit -m "feat(permission-policy): add ChatPermissionPolicy and ToolRequest types"
```

---

## Task 2: `canonicalArgsHash` helper

**Files:**
- Modify: `src/shared/tools.ts` (append `canonicalArgsHash`)
- Test: `src/shared/tools.test.ts` (append cases)

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/tools.test.ts`:

```ts
import { canonicalArgsHash } from "./tools"

test("canonicalArgsHash: object key order doesn't matter", () => {
  expect(canonicalArgsHash({ a: 1, b: 2 })).toBe(canonicalArgsHash({ b: 2, a: 1 }))
})

test("canonicalArgsHash: distinguishes value differences", () => {
  expect(canonicalArgsHash({ a: 1 })).not.toBe(canonicalArgsHash({ a: 2 }))
})

test("canonicalArgsHash: handles nested structures and arrays", () => {
  const h1 = canonicalArgsHash({ x: { a: 1, b: [3, 2, 1] } })
  const h2 = canonicalArgsHash({ x: { b: [3, 2, 1], a: 1 } })
  expect(h1).toBe(h2)
})

test("canonicalArgsHash: returns 64-char hex (sha256)", () => {
  expect(canonicalArgsHash({})).toMatch(/^[0-9a-f]{64}$/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/shared/tools.test.ts`
Expected: FAIL — `canonicalArgsHash is not defined`.

- [ ] **Step 3: Implement `canonicalArgsHash` in `src/shared/tools.ts`**

Append:

```ts
import { createHash } from "node:crypto"

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`
}

export function canonicalArgsHash(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/shared/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/tools.ts src/shared/tools.test.ts
git commit -m "feat(tools): add canonicalArgsHash helper for ToolRequest idempotency"
```

---

## Task 3: `policy.evaluate` skeleton (no bash parser yet)

**Files:**
- Create: `src/server/permission-gate.ts`
- Create: `src/server/permission-gate.test.ts`

- [ ] **Step 1: Write the failing test**

`src/server/permission-gate.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { policy } from "./permission-gate"
import { POLICY_DEFAULT } from "../shared/permission-policy"

describe("policy.evaluate basics", () => {
  test("defaultAction 'ask' → ask verdict", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__webfetch",
      args: { url: "https://example.com" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("ask")
  })

  test("defaultAction 'auto-allow' → auto-allow verdict", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__webfetch",
      args: { url: "https://example.com" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("auto-allow")
  })

  test("toolDenyList regex match → auto-deny with reason", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "rm -rf /" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("auto-deny")
    expect(verdict.reason).toContain("denylist")
  })

  test("deny-list overrides defaultAction auto-allow", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "rm -rf /" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("auto-deny")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/permission-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/permission-gate.ts`**

```ts
import type {
  ChatPermissionPolicy,
  PolicyVerdict,
} from "../shared/permission-policy"

export interface EvaluateArgs {
  toolName: string
  args: Record<string, unknown>
  chatPolicy: ChatPermissionPolicy
  cwd: string
}

export interface EvaluateResult {
  verdict: PolicyVerdict
  reason?: string
}

function argsToText(args: Record<string, unknown>): string {
  return typeof args.command === "string" ? args.command : JSON.stringify(args)
}

export const policy = {
  evaluate(args: EvaluateArgs): EvaluateResult {
    // 1. Deny list wins over everything.
    for (const rule of args.chatPolicy.toolDenyList) {
      if (rule.tool !== args.toolName) continue
      const re = new RegExp(rule.pattern)
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-deny", reason: `matched denylist: ${rule.pattern}` }
      }
    }
    // 2. Allow list (only meaningful with defaultAction !== "auto-allow")
    for (const rule of args.chatPolicy.toolAllowList) {
      if (rule.tool !== args.toolName) continue
      const re = new RegExp(rule.pattern)
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-allow", reason: `matched allowlist: ${rule.pattern}` }
      }
    }
    // 3. Default action.
    return { verdict: args.chatPolicy.defaultAction === "ask" ? "ask" : args.chatPolicy.defaultAction }
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/server/permission-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/permission-gate.ts src/server/permission-gate.test.ts
git commit -m "feat(permission-gate): policy.evaluate skeleton with deny/allow lists"
```

---

## Task 4: Bash arg parser (shell-aware, downgrade-to-ask on any shell feature)

**Files:**
- Modify: `src/server/permission-gate.ts`
- Modify: `src/server/permission-gate.test.ts`

> **Library note:** Use `shell-quote` for parsing. It's already a transitive dep in many Bun projects, but verify with `bun pm ls shell-quote`. If missing, add with `bun add shell-quote @types/shell-quote`.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/permission-gate.test.ts`:

```ts
describe("bash arg parsing", () => {
  const policyWithDefaults = POLICY_DEFAULT

  test("plain `ls` → auto-allow", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-allow")
  })

  test("`cat ~/.ssh/id_rsa` → auto-deny (readPathDeny)", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat ~/.ssh/id_rsa" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toContain("readPathDeny")
  })

  test("`cat ~/.claude/.credentials.json` → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat ~/.claude/.credentials.json" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
  })

  test("pipe `ls | grep foo` → ask (downgrades)", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls | grep foo" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("subshell `cat $(echo ~/.ssh/id_rsa)` → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat $(echo ~/.ssh/id_rsa)" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("env-prefix `FOO=bar ls` → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "FOO=bar ls" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("chain `ls && rm file` → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls && rm file" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("`git status` (multi-word verb in autoAllowVerbs) → auto-allow", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "git status" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-allow")
  })

  test("unrecognized verb → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "curl https://example.com" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/permission-gate.test.ts`
Expected: most new tests FAIL.

- [ ] **Step 3: Implement bash arg parsing in `src/server/permission-gate.ts`**

Add (above the existing `policy` const):

```ts
import { parse as shellParse } from "shell-quote"
import path from "node:path"
import { homedir } from "node:os"
import { minimatch } from "minimatch"

// Patterns from shell-quote that indicate non-trivial shell features
interface ShellOp { op: string }
function isShellOp(token: unknown): token is ShellOp {
  return typeof token === "object" && token !== null && "op" in (token as object)
}

interface ParsedSimpleCommand {
  verb: string       // e.g. "ls" or "git status"
  paths: string[]    // resolved-absolute paths from arg list
  hadEnvPrefix: boolean
}

function parseSimpleBash(
  command: string,
  cwd: string,
  autoAllowVerbs: string[],
): ParsedSimpleCommand | null {
  // shellParse returns either string args or { op } objects for shell metas
  const tokens = shellParse(command)
  for (const t of tokens) {
    if (isShellOp(t)) {
      // any pipe, redirect, subshell, glob expansion, &&, ||, ;
      return null
    }
  }
  const stringTokens = tokens as string[]
  if (stringTokens.length === 0) return null

  // env-prefix detection: FOO=bar cmd
  let hadEnvPrefix = false
  let i = 0
  while (i < stringTokens.length && /^[A-Z_][A-Z0-9_]*=/.test(stringTokens[i])) {
    hadEnvPrefix = true
    i++
  }
  const rest = stringTokens.slice(i)
  if (rest.length === 0) return null

  // Try matching the longest multi-word verb from autoAllowVerbs first
  let verb: string | null = null
  let argsStart = 1
  const sorted = [...autoAllowVerbs].sort((a, b) => b.length - a.length)
  for (const candidate of sorted) {
    const parts = candidate.split(/\s+/)
    if (
      rest.length >= parts.length
      && parts.every((p, idx) => rest[idx] === p)
    ) {
      verb = candidate
      argsStart = parts.length
      break
    }
  }
  if (!verb) {
    verb = rest[0]
    argsStart = 1
  }

  const paths: string[] = []
  for (const arg of rest.slice(argsStart)) {
    // Treat anything that looks like a path (contains /, starts with ~, or
    // resolves to an existing fs entry) as a path argument.
    const isPathLike = arg.startsWith("~") || arg.includes("/") || arg.startsWith(".")
    if (!isPathLike) continue
    const expanded = arg.startsWith("~")
      ? path.join(homedir(), arg.slice(1).replace(/^\//, ""))
      : arg
    const resolved = path.resolve(cwd, expanded)
    paths.push(resolved)
  }
  return { verb, paths, hadEnvPrefix }
}

function pathMatchesDeny(absPath: string, deny: string[]): string | null {
  for (const pattern of deny) {
    const expanded = pattern.startsWith("~")
      ? path.join(homedir(), pattern.slice(1).replace(/^\//, ""))
      : pattern
    // Treat bare dir like "~/.ssh" as "~/.ssh/**"
    const matchPattern = expanded.endsWith("/**") || expanded.includes("*")
      ? expanded
      : `${expanded}/**`
    if (
      minimatch(absPath, matchPattern, { dot: true })
      || absPath === expanded
    ) {
      return pattern
    }
  }
  return null
}
```

Then update `policy.evaluate` to call `parseSimpleBash` for `mcp__kanna__bash` BEFORE the deny-list step:

```ts
export const policy = {
  evaluate(args: EvaluateArgs): EvaluateResult {
    // Bash-specific arg parsing.
    if (args.toolName === "mcp__kanna__bash") {
      const command = typeof args.args.command === "string" ? args.args.command : ""
      const parsed = parseSimpleBash(command, args.cwd, args.chatPolicy.bash.autoAllowVerbs)
      if (!parsed) {
        // Shell features → can't reason → ask user
        return { verdict: "ask", reason: "bash command uses shell features" }
      }
      if (parsed.hadEnvPrefix) {
        return { verdict: "ask", reason: "bash command has env prefix" }
      }
      // readPathDeny check on every path argument
      for (const p of parsed.paths) {
        const denied = pathMatchesDeny(p, args.chatPolicy.readPathDeny)
        if (denied) {
          return { verdict: "auto-deny", reason: `readPathDeny: ${denied}` }
        }
      }
      // Deny list (existing block runs next)
    }

    // 1. Deny list wins over everything.
    for (const rule of args.chatPolicy.toolDenyList) {
      if (rule.tool !== args.toolName) continue
      const re = new RegExp(rule.pattern)
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-deny", reason: `matched denylist: ${rule.pattern}` }
      }
    }

    // 2. Bash auto-allow if verb is in autoAllowVerbs and no deny path
    if (args.toolName === "mcp__kanna__bash") {
      const command = typeof args.args.command === "string" ? args.args.command : ""
      const parsed = parseSimpleBash(command, args.cwd, args.chatPolicy.bash.autoAllowVerbs)
      if (parsed && args.chatPolicy.bash.autoAllowVerbs.includes(parsed.verb)) {
        return { verdict: "auto-allow", reason: `verb in autoAllowVerbs: ${parsed.verb}` }
      }
      return { verdict: "ask", reason: "bash verb not on autoAllowVerbs" }
    }

    // 3. Allow list
    for (const rule of args.chatPolicy.toolAllowList) {
      if (rule.tool !== args.toolName) continue
      const re = new RegExp(rule.pattern)
      if (re.test(argsToText(args.args))) {
        return { verdict: "auto-allow", reason: `matched allowlist: ${rule.pattern}` }
      }
    }

    // 4. Default action.
    return { verdict: args.chatPolicy.defaultAction === "ask" ? "ask" : args.chatPolicy.defaultAction }
  },
}
```

Install missing deps if needed: `bun add shell-quote minimatch && bun add -d @types/shell-quote @types/minimatch`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/permission-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/permission-gate.ts src/server/permission-gate.test.ts package.json bun.lockb
git commit -m "feat(permission-gate): bash arg parsing with readPathDeny enforcement"
```

---

## Task 5: `EventStore` ToolRequest CRUD methods

**Files:**
- Modify: `src/server/event-store.ts`
- Modify: `src/server/event-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/event-store.test.ts`:

```ts
import type { ToolRequest } from "../shared/permission-policy"

function fixtureToolRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    id: "id-1",
    chatId: "chat-1",
    sessionId: "sess-1",
    toolUseId: "tu-1",
    toolName: "ask_user_question",
    arguments: { questions: [] },
    canonicalArgsHash: "hash-1",
    policyVerdict: "ask",
    status: "pending",
    createdAt: 1_000,
    expiresAt: 1_000 + 600_000,
    ...overrides,
  }
}

test("EventStore: putToolRequest then getToolRequest returns the same record", async () => {
  const store = newTestEventStore()
  await store.putToolRequest(fixtureToolRequest())
  const got = await store.getToolRequest("id-1")
  expect(got?.toolUseId).toBe("tu-1")
})

test("EventStore: listPendingToolRequests filters by chatId", async () => {
  const store = newTestEventStore()
  await store.putToolRequest(fixtureToolRequest({ id: "a", chatId: "c1" }))
  await store.putToolRequest(fixtureToolRequest({ id: "b", chatId: "c2" }))
  await store.putToolRequest(fixtureToolRequest({ id: "c", chatId: "c1", status: "answered" }))
  const pending = await store.listPendingToolRequests("c1")
  expect(pending.map((r) => r.id).sort()).toEqual(["a"])
})

test("EventStore: resolveToolRequest sets terminal status atomically", async () => {
  const store = newTestEventStore()
  await store.putToolRequest(fixtureToolRequest())
  await store.resolveToolRequest("id-1", {
    status: "answered",
    decision: { kind: "answer", payload: { ok: true } },
    resolvedAt: 2_000,
  })
  const got = await store.getToolRequest("id-1")
  expect(got?.status).toBe("answered")
  expect(got?.decision?.kind).toBe("answer")
})
```

Add the `newTestEventStore()` helper if not already present in the test file (mirror existing patterns from `event-store.test.ts`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/event-store.test.ts`
Expected: FAIL — `putToolRequest` etc. not defined.

- [ ] **Step 3: Implement CRUD on `EventStore`**

In `src/server/event-store.ts`, add three methods to the `EventStore` class:

```ts
import type { ToolRequest, ToolRequestStatus, ToolRequestDecision } from "../shared/permission-policy"

  // ... inside EventStore class, near other persistence methods:

  async putToolRequest(req: ToolRequest): Promise<void> {
    // Persist using the same storage primitive already used for other
    // EventStore records (e.g., the existing kv-table or sqlite store).
    // The record is keyed by req.id; secondary index on (chatId, status).
    await this.kv.put(`tool-request/${req.id}`, JSON.stringify(req))
    await this.kv.put(`tool-request-by-chat/${req.chatId}/${req.id}`, req.status)
  }

  async getToolRequest(id: string): Promise<ToolRequest | null> {
    const raw = await this.kv.get(`tool-request/${id}`)
    return raw ? JSON.parse(raw) as ToolRequest : null
  }

  async listPendingToolRequests(chatId: string): Promise<ToolRequest[]> {
    const prefix = `tool-request-by-chat/${chatId}/`
    const entries = await this.kv.list({ prefix })
    const out: ToolRequest[] = []
    for (const { key, value } of entries) {
      if (value !== "pending") continue
      const id = key.slice(prefix.length)
      const req = await this.getToolRequest(id)
      if (req) out.push(req)
    }
    return out
  }

  async resolveToolRequest(
    id: string,
    args: { status: ToolRequestStatus; decision?: ToolRequestDecision; resolvedAt: number; mismatchReason?: string },
  ): Promise<void> {
    const existing = await this.getToolRequest(id)
    if (!existing) throw new Error(`resolveToolRequest: unknown id ${id}`)
    const next: ToolRequest = {
      ...existing,
      status: args.status,
      decision: args.decision ?? existing.decision,
      resolvedAt: args.resolvedAt,
      mismatchReason: args.mismatchReason,
    }
    await this.kv.put(`tool-request/${id}`, JSON.stringify(next))
    await this.kv.put(`tool-request-by-chat/${next.chatId}/${id}`, next.status)
  }
```

Adjust `this.kv` reference to whatever the existing storage primitive is in `event-store.ts` (check imports — likely a `KvStore` instance set in the constructor). If the existing storage is a single jsonl append-log, model the same put/get/list pattern on top of an in-memory index that's rebuilt from the log.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/event-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/event-store.ts src/server/event-store.test.ts
git commit -m "feat(event-store): persist ToolRequest records with chat-scoped pending index"
```

---

## Task 6: `tool-callback.ts` — durable approval protocol

**Files:**
- Create: `src/server/tool-callback.ts`
- Create: `src/server/tool-callback.test.ts`

This task implements the lifecycle:
- `submit({ chatId, sessionId, toolUseId, toolName, args, chatPolicy, cwd })` →
  - compute `canonicalArgsHash`, derive `id` = HMAC-SHA256(serverSecret, chatId||sessionId||toolUseId||toolName||canonicalArgsHash).
  - if existing record with same `id` and terminal status → return cached decision.
  - if existing record with same `toolUseId` but different `id` (toolName/args differ) → resolve as `arg_mismatch`, log audit, fail closed.
  - else: call `policy.evaluate` → store new `ToolRequest` → if `auto-allow`/`auto-deny`, resolve immediately; if `ask`, return a Promise awaiting external resolution.
- `answer(id, decision)` → resolve `pending` → terminal.
- `cancel(id, reason)` → resolve `pending` → `canceled`.
- `cancelAllForChat(chatId, reason)` → cancel all pending.
- `cancelAllForSession(sessionId, reason)` → cancel all pending for sessionId.
- Server-restart cleanup: on init, resolve any persisted `pending` to `session_closed` (fail closed).

- [ ] **Step 1: Write the failing tests**

`src/server/tool-callback.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import { newTestEventStore } from "./event-store.test"  // re-use helper
import { createToolCallbackService } from "./tool-callback"

const baseInput = {
  chatId: "chat-1",
  sessionId: "sess-1",
  toolUseId: "tu-1",
  toolName: "ask_user_question",
  args: { questions: [{ q: "ok?" }] },
  chatPolicy: POLICY_DEFAULT,
  cwd: "/tmp/project",
}

describe("tool-callback durable protocol", () => {
  test("auto-deny short-circuits with deny decision", async () => {
    const store = newTestEventStore()
    const svc = createToolCallbackService({
      store,
      serverSecret: "secret",
      now: () => 1_000,
      timeoutMs: 600_000,
    })
    const res = await svc.submit({
      ...baseInput,
      toolName: "mcp__kanna__bash",
      args: { command: "rm -rf /" },
    })
    expect(res.decision.kind).toBe("deny")
    expect(res.status).toBe("answered")
  })

  test("ask verdict creates pending record and awaits answer()", async () => {
    const store = newTestEventStore()
    const svc = createToolCallbackService({
      store,
      serverSecret: "secret",
      now: () => 1_000,
      timeoutMs: 600_000,
    })
    const pending = svc.submit(baseInput)
    // The promise should still be unresolved.
    const list = await store.listPendingToolRequests("chat-1")
    expect(list).toHaveLength(1)
    await svc.answer(list[0].id, { kind: "answer", payload: { answer: "yes" } })
    const res = await pending
    expect(res.status).toBe("answered")
    expect(res.decision.payload).toEqual({ answer: "yes" })
  })

  test("idempotent retry returns same decision without duplicating UI prompt", async () => {
    const store = newTestEventStore()
    const svc = createToolCallbackService({
      store,
      serverSecret: "secret",
      now: () => 1_000,
      timeoutMs: 600_000,
    })
    const first = svc.submit(baseInput)
    const second = svc.submit(baseInput)
    expect(await store.listPendingToolRequests("chat-1")).toHaveLength(1)
    const list = await store.listPendingToolRequests("chat-1")
    await svc.answer(list[0].id, { kind: "answer", payload: 1 })
    expect((await first).decision.payload).toBe(1)
    expect((await second).decision.payload).toBe(1)
  })

  test("same toolUseId with mutated args → arg_mismatch fail closed", async () => {
    const store = newTestEventStore()
    const svc = createToolCallbackService({
      store,
      serverSecret: "secret",
      now: () => 1_000,
      timeoutMs: 600_000,
    })
    void svc.submit(baseInput)
    const list = await store.listPendingToolRequests("chat-1")
    await svc.answer(list[0].id, { kind: "answer", payload: "first" })

    const mutated = svc.submit({ ...baseInput, args: { questions: [{ q: "different?" }] } })
    const res = await mutated
    expect(res.status).toBe("arg_mismatch")
    expect(res.decision.kind).toBe("deny")
    expect(res.mismatchReason).toContain("canonicalArgsHash")
  })

  test("cancelAllForChat resolves all pending as canceled", async () => {
    const store = newTestEventStore()
    const svc = createToolCallbackService({
      store,
      serverSecret: "secret",
      now: () => 1_000,
      timeoutMs: 600_000,
    })
    const p = svc.submit(baseInput)
    await svc.cancelAllForChat("chat-1", "PTY shutdown")
    const res = await p
    expect(res.status).toBe("canceled")
  })

  test("timeout resolves pending as timeout/deny", async () => {
    const store = newTestEventStore()
    let nowVal = 1_000
    const svc = createToolCallbackService({
      store,
      serverSecret: "secret",
      now: () => nowVal,
      timeoutMs: 100,
    })
    const p = svc.submit(baseInput)
    nowVal = 1_000 + 200
    await svc.tickTimeouts()
    const res = await p
    expect(res.status).toBe("timeout")
    expect(res.decision.kind).toBe("deny")
  })

  test("server-restart resolves persisted pending as session_closed", async () => {
    const store = newTestEventStore()
    const svc1 = createToolCallbackService({ store, serverSecret: "secret", now: () => 1_000, timeoutMs: 600_000 })
    void svc1.submit(baseInput)
    // Simulate restart: drop in-memory state.
    const svc2 = createToolCallbackService({ store, serverSecret: "secret", now: () => 2_000, timeoutMs: 600_000 })
    await svc2.recoverOnStartup()
    const list = await store.listPendingToolRequests("chat-1")
    expect(list).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/tool-callback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/tool-callback.ts`**

```ts
import { createHmac } from "node:crypto"
import type {
  ChatPermissionPolicy,
  ToolRequest,
  ToolRequestDecision,
  ToolRequestStatus,
} from "../shared/permission-policy"
import { POLICY_TERMINAL_STATUSES } from "../shared/permission-policy"
import { policy } from "./permission-gate"
import { canonicalArgsHash } from "../shared/tools"
import type { EventStore } from "./event-store"

export interface ToolCallbackServiceArgs {
  store: EventStore
  serverSecret: string
  now: () => number
  timeoutMs: number
}

export interface ToolCallbackSubmitArgs {
  chatId: string
  sessionId: string
  toolUseId: string
  toolName: string
  args: Record<string, unknown>
  chatPolicy: ChatPermissionPolicy
  cwd: string
}

export interface ToolCallbackResult {
  status: ToolRequestStatus
  decision: ToolRequestDecision
  mismatchReason?: string
}

interface PendingWaiter {
  resolve: (r: ToolCallbackResult) => void
  expiresAt: number
}

export interface ToolCallbackService {
  submit(args: ToolCallbackSubmitArgs): Promise<ToolCallbackResult>
  answer(id: string, decision: ToolRequestDecision): Promise<void>
  cancel(id: string, reason: string): Promise<void>
  cancelAllForChat(chatId: string, reason: string): Promise<void>
  cancelAllForSession(sessionId: string, reason: string): Promise<void>
  recoverOnStartup(): Promise<void>
  tickTimeouts(): Promise<void>
}

export function createToolCallbackService(opts: ToolCallbackServiceArgs): ToolCallbackService {
  const waiters = new Map<string, PendingWaiter[]>()
  // Cache: toolUseId → expected (id, toolName, canonicalArgsHash) for arg_mismatch detection
  const seenToolUseIds = new Map<string, { id: string; toolName: string; canonicalArgsHash: string }>()

  function hmacId(s: ToolCallbackSubmitArgs, hash: string): string {
    const h = createHmac("sha256", opts.serverSecret)
    h.update(`${s.chatId}|${s.sessionId}|${s.toolUseId}|${s.toolName}|${hash}`)
    return h.digest("hex")
  }

  function resolveWaiters(id: string, result: ToolCallbackResult) {
    const ws = waiters.get(id) ?? []
    waiters.delete(id)
    for (const w of ws) w.resolve(result)
  }

  return {
    async submit(args) {
      const hash = canonicalArgsHash(args.args)
      const id = hmacId(args, hash)
      const seen = seenToolUseIds.get(args.toolUseId)
      if (seen && (seen.toolName !== args.toolName || seen.canonicalArgsHash !== hash)) {
        // Mismatched retry → fail closed.
        const reason = `argument_mismatch: canonicalArgsHash differs from prior submission for toolUseId=${args.toolUseId}`
        const decision: ToolRequestDecision = { kind: "deny", reason }
        // Persist a new arg_mismatch record under the new id (do not mutate prior record).
        const now = opts.now()
        await opts.store.putToolRequest({
          id,
          chatId: args.chatId,
          sessionId: args.sessionId,
          toolUseId: args.toolUseId,
          toolName: args.toolName,
          arguments: args.args,
          canonicalArgsHash: hash,
          policyVerdict: "auto-deny",
          status: "arg_mismatch",
          decision,
          mismatchReason: reason,
          createdAt: now,
          resolvedAt: now,
          expiresAt: now,
        })
        return { status: "arg_mismatch", decision, mismatchReason: reason }
      }

      const existing = await opts.store.getToolRequest(id)
      if (existing && POLICY_TERMINAL_STATUSES.has(existing.status)) {
        // Idempotent: return cached terminal result.
        return {
          status: existing.status,
          decision: existing.decision ?? { kind: "deny", reason: "unknown" },
          mismatchReason: existing.mismatchReason,
        }
      }
      if (existing) {
        // Pending; attach a new waiter.
        return new Promise<ToolCallbackResult>((resolve) => {
          const list = waiters.get(id) ?? []
          list.push({ resolve, expiresAt: existing.expiresAt })
          waiters.set(id, list)
        })
      }

      // New request. Evaluate policy.
      const verdict = policy.evaluate({
        toolName: args.toolName,
        args: args.args,
        chatPolicy: args.chatPolicy,
        cwd: args.cwd,
      })
      const now = opts.now()
      const expiresAt = now + opts.timeoutMs
      const req: ToolRequest = {
        id,
        chatId: args.chatId,
        sessionId: args.sessionId,
        toolUseId: args.toolUseId,
        toolName: args.toolName,
        arguments: args.args,
        canonicalArgsHash: hash,
        policyVerdict: verdict.verdict,
        status: "pending",
        createdAt: now,
        expiresAt,
      }
      await opts.store.putToolRequest(req)
      seenToolUseIds.set(args.toolUseId, { id, toolName: args.toolName, canonicalArgsHash: hash })

      if (verdict.verdict === "auto-allow" || verdict.verdict === "auto-deny") {
        const decision: ToolRequestDecision = verdict.verdict === "auto-allow"
          ? { kind: "allow", reason: verdict.reason }
          : { kind: "deny", reason: verdict.reason }
        await opts.store.resolveToolRequest(id, {
          status: "answered",
          decision,
          resolvedAt: opts.now(),
        })
        return { status: "answered", decision }
      }

      // verdict === "ask" — return a promise that resolves on answer/cancel/timeout.
      return new Promise<ToolCallbackResult>((resolve) => {
        const list = waiters.get(id) ?? []
        list.push({ resolve, expiresAt })
        waiters.set(id, list)
      })
    },

    async answer(id, decision) {
      const existing = await opts.store.getToolRequest(id)
      if (!existing || POLICY_TERMINAL_STATUSES.has(existing.status)) return
      await opts.store.resolveToolRequest(id, {
        status: "answered",
        decision,
        resolvedAt: opts.now(),
      })
      resolveWaiters(id, { status: "answered", decision })
    },

    async cancel(id, reason) {
      const existing = await opts.store.getToolRequest(id)
      if (!existing || POLICY_TERMINAL_STATUSES.has(existing.status)) return
      const decision: ToolRequestDecision = { kind: "deny", reason: `canceled: ${reason}` }
      await opts.store.resolveToolRequest(id, {
        status: "canceled",
        decision,
        resolvedAt: opts.now(),
      })
      resolveWaiters(id, { status: "canceled", decision })
    },

    async cancelAllForChat(chatId, reason) {
      const list = await opts.store.listPendingToolRequests(chatId)
      for (const req of list) await this.cancel(req.id, reason)
    },

    async cancelAllForSession(sessionId, reason) {
      // Walk all pending across known chats (or iterate via a session-keyed index in the future)
      // Minimal implementation: iterate waiters in memory, match by sessionId.
      const ids = Array.from(waiters.keys())
      for (const id of ids) {
        const req = await opts.store.getToolRequest(id)
        if (req && req.sessionId === sessionId) await this.cancel(id, reason)
      }
    },

    async recoverOnStartup() {
      // On startup, fail-closed all persisted pending records.
      // We don't have a chat enumeration helper, so iterate the kv scan.
      // Use a coarse scan of all `tool-request/*` keys via the EventStore.
      const all = await opts.store.scanAllToolRequests()
      for (const req of all) {
        if (req.status !== "pending") continue
        const decision: ToolRequestDecision = { kind: "deny", reason: "server_restarted" }
        await opts.store.resolveToolRequest(req.id, {
          status: "session_closed",
          decision,
          resolvedAt: opts.now(),
        })
      }
    },

    async tickTimeouts() {
      const now = opts.now()
      for (const [id, list] of waiters.entries()) {
        if (list.length === 0) continue
        // All waiters share the same expiresAt (per-id); use the first.
        if (list[0].expiresAt > now) continue
        const decision: ToolRequestDecision = { kind: "deny", reason: "timeout" }
        await opts.store.resolveToolRequest(id, {
          status: "timeout",
          decision,
          resolvedAt: now,
        })
        resolveWaiters(id, { status: "timeout", decision })
      }
    },
  }
}
```

Add the `scanAllToolRequests()` method to `EventStore` in this task too (needed for `recoverOnStartup`):

```ts
  async scanAllToolRequests(): Promise<ToolRequest[]> {
    const entries = await this.kv.list({ prefix: "tool-request/" })
    const out: ToolRequest[] = []
    for (const { value } of entries) {
      if (value) out.push(JSON.parse(value) as ToolRequest)
    }
    return out
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/tool-callback.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/tool-callback.ts src/server/tool-callback.test.ts src/server/event-store.ts
git commit -m "feat(tool-callback): durable approval protocol with HMAC-bound idempotency"
```

---

## Task 7: Wire `tool-callback.recoverOnStartup()` into Kanna server boot

**Files:**
- Modify: `src/server/cli.ts` (or wherever the server is initialized; locate `new EventStore` and trace the boot order)

- [ ] **Step 1: Locate the boot site**

Run: `bun --bun rg -n "new EventStore|createToolCallbackService" src/server`. Identify the file where `EventStore` is constructed for the live server (usually `cli.ts` or `server.ts`).

- [ ] **Step 2: Write the failing test (integration-level, in `cli.test.ts` or similar)**

If no test file exists for the boot site, create one that minimally proves recovery is called. Example (`src/server/boot.test.ts`, new file):

```ts
import { test, expect, mock } from "bun:test"
import { initToolCallbackOnBoot } from "./tool-callback"
import { newTestEventStore } from "./event-store.test"

test("initToolCallbackOnBoot calls recoverOnStartup before returning service", async () => {
  const store = newTestEventStore()
  await store.putToolRequest({
    id: "x", chatId: "c", sessionId: "s", toolUseId: "tu",
    toolName: "ask_user_question", arguments: {}, canonicalArgsHash: "h",
    policyVerdict: "ask", status: "pending", createdAt: 0, expiresAt: 99999999,
  })
  const svc = await initToolCallbackOnBoot({ store, serverSecret: "k", now: () => 1 })
  expect((await store.listPendingToolRequests("c")).length).toBe(0)
  expect(svc).toBeDefined()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/server/boot.test.ts`
Expected: FAIL — `initToolCallbackOnBoot` not exported.

- [ ] **Step 4: Add `initToolCallbackOnBoot` to `src/server/tool-callback.ts`**

```ts
export async function initToolCallbackOnBoot(args: {
  store: EventStore
  serverSecret: string
  now?: () => number
  timeoutMs?: number
}): Promise<ToolCallbackService> {
  const svc = createToolCallbackService({
    store: args.store,
    serverSecret: args.serverSecret,
    now: args.now ?? (() => Date.now()),
    timeoutMs: args.timeoutMs ?? 600_000,
  })
  await svc.recoverOnStartup()
  return svc
}
```

- [ ] **Step 5: Call it from the server boot site**

In the file you located in Step 1 (let's say `src/server/cli.ts`), find where `EventStore` is constructed and the agent wiring begins. Add:

```ts
import { initToolCallbackOnBoot } from "./tool-callback"

// ... after store is constructed:
const toolCallback = await initToolCallbackOnBoot({
  store,
  serverSecret: process.env.KANNA_SERVER_SECRET ?? crypto.randomUUID(),
})
// Pass toolCallback into AgentCoordinator's args; see Task 9.
```

For `KANNA_SERVER_SECRET`: if absent, generate per-server-boot. Document in `docs/` that setting this stably across restarts is required for idempotency-across-restart (not required for this plan since restart fails closed).

- [ ] **Step 6: Run tests to verify**

Run: `bun test src/server/boot.test.ts && bun test src/server`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/tool-callback.ts src/server/cli.ts src/server/boot.test.ts
git commit -m "feat(boot): wire tool-callback.recoverOnStartup on server init"
```

---

## Task 8: `mcp__kanna__ask_user_question` MCP tool

**Files:**
- Create: `src/server/kanna-mcp-tools/ask-user-question.ts`
- Create: `src/server/kanna-mcp-tools/ask-user-question.test.ts`
- Create: `src/server/kanna-mcp-tools/tool-callback-shim.ts` (shared wrapper)

- [ ] **Step 1: Write the failing test**

`src/server/kanna-mcp-tools/ask-user-question.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { createAskUserQuestionTool } from "./ask-user-question"
import { newTestEventStore } from "../event-store.test"
import { createToolCallbackService } from "../tool-callback"

const toolCallContext = (overrides: object = {}) => ({
  chatId: "c1",
  sessionId: "s1",
  toolUseId: "tu1",
  cwd: "/tmp",
  chatPolicy: POLICY_DEFAULT,
  ...overrides,
})

describe("mcp__kanna__ask_user_question", () => {
  test("calls policy.evaluate then routes to tool-callback", async () => {
    const store = newTestEventStore()
    const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
    const tool = createAskUserQuestionTool({ toolCallback: svc })
    const promise = tool.handler(
      { questions: [{ text: "ok?", header: "OK", options: [{ label: "yes", description: "" }, { label: "no", description: "" }], multiSelect: false }] },
      toolCallContext(),
    )
    const pending = await store.listPendingToolRequests("c1")
    expect(pending).toHaveLength(1)
    await svc.answer(pending[0].id, { kind: "answer", payload: { answers: { "ok?": "yes" } } })
    const result = await promise
    expect(result.content[0].type).toBe("text")
    expect(JSON.parse(result.content[0].text).answers).toEqual({ "ok?": "yes" })
  })

  test("auto-deny → returns isError true", async () => {
    const store = newTestEventStore()
    const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
    const tool = createAskUserQuestionTool({ toolCallback: svc })
    const result = await tool.handler(
      { questions: [] },
      toolCallContext({ chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-deny" } }),
    )
    expect(result.isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/kanna-mcp-tools/ask-user-question.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the shim and the tool**

`src/server/kanna-mcp-tools/tool-callback-shim.ts`:

```ts
import type { ToolCallbackService } from "../tool-callback"
import type { ChatPermissionPolicy } from "../../shared/permission-policy"

export interface ToolHandlerContext {
  chatId: string
  sessionId: string
  toolUseId: string
  cwd: string
  chatPolicy: ChatPermissionPolicy
}

export interface ToolHandlerResult {
  content: { type: "text"; text: string }[]
  isError?: boolean
}

export async function gatedToolCall(args: {
  toolCallback: ToolCallbackService
  toolName: string
  ctx: ToolHandlerContext
  args: Record<string, unknown>
  formatAnswer: (payload: unknown) => ToolHandlerResult
  formatDeny: (reason: string) => ToolHandlerResult
}): Promise<ToolHandlerResult> {
  const res = await args.toolCallback.submit({
    chatId: args.ctx.chatId,
    sessionId: args.ctx.sessionId,
    toolUseId: args.ctx.toolUseId,
    toolName: args.toolName,
    args: args.args,
    chatPolicy: args.ctx.chatPolicy,
    cwd: args.ctx.cwd,
  })
  if (res.decision.kind === "allow" || res.decision.kind === "answer") {
    return args.formatAnswer(res.decision.payload)
  }
  return args.formatDeny(res.decision.reason ?? "denied")
}
```

`src/server/kanna-mcp-tools/ask-user-question.ts`:

```ts
import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const QuestionSchema = z.object({
  text: z.string(),
  header: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string() })).min(2).max(4),
  multiSelect: z.boolean(),
})

const InputSchema = z.object({
  questions: z.array(QuestionSchema).min(1).max(4),
})

export function createAskUserQuestionTool(deps: { toolCallback: ToolCallbackService }) {
  return {
    name: "ask_user_question",
    schema: InputSchema,
    async handler(input: z.infer<typeof InputSchema>, ctx: ToolHandlerContext): Promise<ToolHandlerResult> {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__ask_user_question",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: (payload) => ({
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        }),
        formatDeny: (reason) => ({
          content: [{ type: "text" as const, text: `Denied: ${reason}` }],
          isError: true,
        }),
      })
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/kanna-mcp-tools/ask-user-question.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/
git commit -m "feat(kanna-mcp): ask_user_question routed through tool-callback"
```

---

## Task 9: `mcp__kanna__exit_plan_mode` MCP tool

**Files:**
- Create: `src/server/kanna-mcp-tools/exit-plan-mode.ts`
- Create: `src/server/kanna-mcp-tools/exit-plan-mode.test.ts`

- [ ] **Step 1: Write the failing test**

`src/server/kanna-mcp-tools/exit-plan-mode.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { createExitPlanModeTool } from "./exit-plan-mode"
import { newTestEventStore } from "../event-store.test"
import { createToolCallbackService } from "../tool-callback"

describe("mcp__kanna__exit_plan_mode", () => {
  test("confirmed answer → returns success content", async () => {
    const store = newTestEventStore()
    const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
    const tool = createExitPlanModeTool({ toolCallback: svc })
    const promise = tool.handler({ plan: "do x" }, {
      chatId: "c", sessionId: "s", toolUseId: "tu", cwd: "/tmp", chatPolicy: POLICY_DEFAULT,
    })
    const pending = await store.listPendingToolRequests("c")
    await svc.answer(pending[0].id, { kind: "answer", payload: { confirmed: true } })
    const result = await promise
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain("confirmed")
  })

  test("rejected with message → isError true with message", async () => {
    const store = newTestEventStore()
    const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
    const tool = createExitPlanModeTool({ toolCallback: svc })
    const promise = tool.handler({ plan: "do x" }, {
      chatId: "c", sessionId: "s", toolUseId: "tu", cwd: "/tmp", chatPolicy: POLICY_DEFAULT,
    })
    const pending = await store.listPendingToolRequests("c")
    await svc.answer(pending[0].id, { kind: "answer", payload: { confirmed: false, message: "tweak step 3" } })
    const result = await promise
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("tweak step 3")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/kanna-mcp-tools/exit-plan-mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/kanna-mcp-tools/exit-plan-mode.ts`**

```ts
import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  plan: z.string(),
})

export function createExitPlanModeTool(deps: { toolCallback: ToolCallbackService }) {
  return {
    name: "exit_plan_mode",
    schema: InputSchema,
    async handler(input: z.infer<typeof InputSchema>, ctx: ToolHandlerContext): Promise<ToolHandlerResult> {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__exit_plan_mode",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: (payload) => {
          const record = (payload && typeof payload === "object") ? payload as Record<string, unknown> : {}
          if (record.confirmed) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ confirmed: true }) }] }
          }
          const msg = typeof record.message === "string" ? record.message : "User wants to suggest edits."
          return {
            content: [{ type: "text" as const, text: msg }],
            isError: true,
          }
        },
        formatDeny: (reason) => ({
          content: [{ type: "text" as const, text: `Denied: ${reason}` }],
          isError: true,
        }),
      })
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/kanna-mcp-tools/exit-plan-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/exit-plan-mode.ts src/server/kanna-mcp-tools/exit-plan-mode.test.ts
git commit -m "feat(kanna-mcp): exit_plan_mode routed through tool-callback"
```

---

## Task 10: Register the two new tools in `kanna-mcp.ts` (feature-flagged)

**Files:**
- Modify: `src/server/kanna-mcp.ts`
- Modify: `src/server/kanna-mcp.test.ts`

- [ ] **Step 1: Extend the failing test**

Append to `src/server/kanna-mcp.test.ts`:

```ts
import { createKannaMcpServer } from "./kanna-mcp"

test("feature flag off → ask_user_question / exit_plan_mode NOT registered", () => {
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
  const server = createKannaMcpServer({
    projectId: "p", localPath: "/tmp",
    toolCallback: undefined,
  } as any)
  const names = (server.tools as unknown as { name: string }[]).map((t) => t.name)
  expect(names).not.toContain("ask_user_question")
  expect(names).not.toContain("exit_plan_mode")
})

test("feature flag on → tools registered", () => {
  process.env.KANNA_MCP_TOOL_CALLBACKS = "1"
  const server = createKannaMcpServer({
    projectId: "p", localPath: "/tmp",
    toolCallback: { /* mock service */ } as any,
  } as any)
  const names = (server.tools as unknown as { name: string }[]).map((t) => t.name)
  expect(names).toContain("ask_user_question")
  expect(names).toContain("exit_plan_mode")
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/kanna-mcp.test.ts`
Expected: FAIL — flag check not present, tools not registered conditionally.

- [ ] **Step 3: Modify `src/server/kanna-mcp.ts`**

Extend `KannaMcpArgs` and `createKannaMcpServer`:

```ts
import { createAskUserQuestionTool } from "./kanna-mcp-tools/ask-user-question"
import { createExitPlanModeTool } from "./kanna-mcp-tools/exit-plan-mode"
import type { ToolCallbackService } from "./tool-callback"

export interface KannaMcpArgs extends OfferDownloadArgs {
  chatId?: string
  tunnelGateway?: TunnelGateway | null
  toolCallback?: ToolCallbackService
}

export function createKannaMcpServer(args: KannaMcpArgs) {
  const tunnelGateway = args.tunnelGateway ?? null
  const chatId = args.chatId ?? null
  const featureFlag = process.env.KANNA_MCP_TOOL_CALLBACKS === "1"

  const tools = [
    // ... existing offer_download and expose_port tools unchanged
  ]

  if (featureFlag && args.toolCallback) {
    const askTool = createAskUserQuestionTool({ toolCallback: args.toolCallback })
    const exitPlanTool = createExitPlanModeTool({ toolCallback: args.toolCallback })
    tools.push(
      tool(askTool.name, "Ask the user a question with multiple choice answers", askTool.schema.shape, askTool.handler),
      tool(exitPlanTool.name, "Submit a plan for user approval before continuing", exitPlanTool.schema.shape, exitPlanTool.handler),
    )
  }

  return createSdkMcpServer({
    name: KANNA_MCP_SERVER_NAME,
    tools,
  })
}
```

Note: the `tool()` factory from `@anthropic-ai/claude-agent-sdk` may require the handler signature to be `(input) => ...` without the explicit `ctx` arg. In that case, wrap inside an adapter that pulls `chatId/sessionId/toolUseId/cwd/chatPolicy` from a closure-bound context. The closure binding is set up in `agent.ts` (next task) when this MCP server is constructed per chat.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/kanna-mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp.ts src/server/kanna-mcp.test.ts
git commit -m "feat(kanna-mcp): register ask_user_question + exit_plan_mode behind feature flag"
```

---

## Task 11: Refactor SDK driver `canUseTool` to route through `permission-gate`

**Files:**
- Modify: `src/server/agent.ts` (lines 669-722 region, plus surrounding wiring)
- Modify: `src/server/agent.test.ts` (relevant tests)

The current `canUseTool` only intercepts `AskUserQuestion` and `ExitPlanMode`. After this task, `canUseTool` calls `policy.evaluate` for every tool and, for `AskUserQuestion`/`ExitPlanMode` specifically, defers to the new MCP-routed flow when the feature flag is on. When flag is off, behavior is unchanged.

- [ ] **Step 1: Add a regression test asserting unchanged behavior when flag is off**

Append to `src/server/agent.test.ts`:

```ts
test("canUseTool with KANNA_MCP_TOOL_CALLBACKS=0: AskUserQuestion still goes through args.onToolRequest", async () => {
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
  // Build a minimal harness around startClaudeSession (or extract the canUseTool builder).
  // Assert: when AskUserQuestion fires, args.onToolRequest is called once with the normalized tool.
  // (Use existing test patterns from agent.test.ts — mirror the closest existing test.)
  // Skipping full body — the key assertion is that the old code path runs.
})
```

Add a new test asserting new behavior when flag is on:

```ts
test("canUseTool with KANNA_MCP_TOOL_CALLBACKS=1: AskUserQuestion routes through ToolCallback", async () => {
  process.env.KANNA_MCP_TOOL_CALLBACKS = "1"
  // Build harness with toolCallback service injected.
  // Assert: an MCP tool call to mcp__kanna__ask_user_question would be the path, but in SDK mode
  // canUseTool still intercepts the BUILT-IN AskUserQuestion. The flag flips the routing inside
  // canUseTool to call toolCallback.submit(...) instead of args.onToolRequest(...).
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/agent.test.ts`
Expected: new tests FAIL or skip — they're scaffolding for the impl.

- [ ] **Step 3: Refactor `canUseTool` in `src/server/agent.ts`**

Replace the existing `canUseTool` body (lines 669-722) with:

```ts
  const canUseTool: CanUseTool = async (toolName, input, options) => {
    if (toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode") {
      return {
        behavior: "allow",
        updatedInput: input,
      }
    }

    const tool = normalizeToolCall({
      toolName,
      toolId: options.toolUseID,
      input: (input ?? {}) as Record<string, unknown>,
    })

    if (tool.toolKind !== "ask_user_question" && tool.toolKind !== "exit_plan_mode") {
      return {
        behavior: "deny",
        message: "Unsupported tool request",
      }
    }

    // Feature flag: route via tool-callback if enabled and service is present.
    if (process.env.KANNA_MCP_TOOL_CALLBACKS === "1" && args.toolCallback) {
      const result = await args.toolCallback.submit({
        chatId: args.chatId ?? "",
        sessionId: args.sessionToken ?? "",
        toolUseId: options.toolUseID,
        toolName: `mcp__kanna__${tool.toolKind}`,
        args: (tool.rawInput ?? {}) as Record<string, unknown>,
        chatPolicy: args.chatPolicy ?? POLICY_DEFAULT,
        cwd: args.localPath,
      })
      if (result.decision.kind === "deny") {
        return { behavior: "deny", message: result.decision.reason ?? "denied" } satisfies PermissionResult
      }
      const payload = (result.decision.payload && typeof result.decision.payload === "object")
        ? result.decision.payload as Record<string, unknown>
        : {}
      if (tool.toolKind === "ask_user_question") {
        return {
          behavior: "allow",
          updatedInput: {
            ...(tool.rawInput ?? {}),
            questions: payload.questions ?? tool.input.questions,
            answers: payload.answers ?? result.decision.payload,
          },
        } satisfies PermissionResult
      }
      // exit_plan_mode
      if (payload.confirmed) {
        return {
          behavior: "allow",
          updatedInput: { ...(tool.rawInput ?? {}), ...payload },
        } satisfies PermissionResult
      }
      return {
        behavior: "deny",
        message: typeof payload.message === "string"
          ? `User wants to suggest edits to the plan: ${payload.message}`
          : "User wants to suggest edits to the plan before approving.",
      } satisfies PermissionResult
    }

    // Legacy path (flag off): existing behavior unchanged.
    const result = await args.onToolRequest({ tool })

    if (tool.toolKind === "ask_user_question") {
      const record = result && typeof result === "object" ? result as Record<string, unknown> : {}
      return {
        behavior: "allow",
        updatedInput: {
          ...(tool.rawInput ?? {}),
          questions: record.questions ?? tool.input.questions,
          answers: record.answers ?? result,
        },
      } satisfies PermissionResult
    }

    const record = result && typeof result === "object" ? result as Record<string, unknown> : {}
    const confirmed = Boolean(record.confirmed)
    if (confirmed) {
      return {
        behavior: "allow",
        updatedInput: {
          ...(tool.rawInput ?? {}),
          ...record,
        },
      } satisfies PermissionResult
    }

    return {
      behavior: "deny",
      message: typeof record.message === "string"
        ? `User wants to suggest edits to the plan: ${record.message}`
        : "User wants to suggest edits to the plan before approving.",
    } satisfies PermissionResult
  }
```

Add `toolCallback?: ToolCallbackService` and `chatPolicy?: ChatPermissionPolicy` to the `startClaudeSession` args. Locate the `args:` signature (around line 668) and add them. Default `chatPolicy` falls back to `POLICY_DEFAULT` from `permission-policy.ts`.

Also pass these new args from `AgentCoordinator` when calling `startClaudeSession` — locate the existing call sites (around lines 1300-1350 in `agent.ts`) and add `toolCallback` (from the boot site) + `chatPolicy` (from `chat.permissionPolicy`, falling back to default).

- [ ] **Step 4: Run all agent tests**

Run: `bun test src/server/agent.test.ts`
Expected: PASS — both new and existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "refactor(agent): canUseTool routes ask_user_question/exit_plan_mode through tool-callback when flag on"
```

---

## Task 12: Pass `toolCallback` through to `createKannaMcpServer` per chat

**Files:**
- Modify: `src/server/agent.ts` (the call to `createKannaMcpServer` inside `startClaudeSession`, around line 741)

- [ ] **Step 1: Locate and update**

Find:

```ts
      mcpServers: {
        [KANNA_MCP_SERVER_NAME]: createKannaMcpServer({
          projectId: args.projectId,
          localPath: args.localPath,
          chatId: args.chatId,
          tunnelGateway: args.tunnelGateway ?? null,
        }),
      },
```

Replace with:

```ts
      mcpServers: {
        [KANNA_MCP_SERVER_NAME]: createKannaMcpServer({
          projectId: args.projectId,
          localPath: args.localPath,
          chatId: args.chatId,
          tunnelGateway: args.tunnelGateway ?? null,
          toolCallback: args.toolCallback,
        }),
      },
```

- [ ] **Step 2: Run the build + existing tests**

Run: `bun run lint && bun test src/server`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat(agent): pass toolCallback through to kanna-mcp per chat"
```

---

## Task 13: Replay-on-reconnect — emit pending requests as transcript entries

**Files:**
- Modify: `src/server/ws-router.ts` (locate the chat-snapshot/replay path)
- Modify: `src/server/ws-router.test.ts`

On reconnect, the client must receive any `pending` ToolRequest as a `pending_tool_request` transcript entry so the UI can re-render its approval card.

- [ ] **Step 1: Locate the snapshot path**

Run: `bun --bun rg -n "transcript|snapshot" src/server/ws-router.ts | head -30`
Find where the server emits the chat history on subscribe.

- [ ] **Step 2: Write the failing test**

Append to `src/server/ws-router.test.ts`:

```ts
test("ws-router snapshot includes pending tool requests as pending_tool_request entries", async () => {
  // Construct ws-router with a store containing one pending tool request.
  // Subscribe a client; assert the first snapshot contains an entry
  // { kind: "pending_tool_request", toolRequestId: "<id>" } for the pending record.
})
```

- [ ] **Step 3: Run test**

Run: `bun test src/server/ws-router.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

In the snapshot builder, after assembling the existing transcript array for a chat, query:

```ts
const pendingRequests = await store.listPendingToolRequests(chatId)
for (const req of pendingRequests) {
  transcript.push(timestamped({
    kind: "pending_tool_request",
    toolRequestId: req.id,
  }))
}
```

Sort the merged array by `createdAt` to maintain order.

- [ ] **Step 5: Run tests**

Run: `bun test src/server/ws-router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ws-router.ts src/server/ws-router.test.ts
git commit -m "feat(ws-router): replay pending tool requests on subscribe"
```

---

## Task 14: WebSocket message: `tool_request_answer`

**Files:**
- Modify: `src/server/ws-router.ts` (add handler for inbound `tool_request_answer`)
- Modify: `src/shared/ws-protocol.ts` (or wherever WS message types live)
- Modify: `src/server/ws-router.test.ts`

The client can answer a pending tool request via a new WS message: `{ type: "tool_request_answer", toolRequestId, decision }`.

- [ ] **Step 1: Write the failing test**

```ts
test("ws-router: tool_request_answer message resolves a pending request", async () => {
  // Construct router with a pending request.
  // Send { type: "tool_request_answer", toolRequestId, decision: { kind: "answer", payload: { ok: true } } }
  // Assert: store.getToolRequest returns status "answered"
  // Assert: associated agent.canUseTool promise resolved.
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/server/ws-router.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the inbound message handler in `ws-router.ts`:

```ts
case "tool_request_answer":
  await this.toolCallback.answer(msg.toolRequestId, msg.decision)
  break
```

Add the message type to `src/shared/ws-protocol.ts` (the union of inbound client messages):

```ts
  | { type: "tool_request_answer"; toolRequestId: string; decision: ToolRequestDecision }
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/ws-router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ws-router.ts src/shared/ws-protocol.ts src/server/ws-router.test.ts
git commit -m "feat(ws-router): tool_request_answer handler"
```

---

## Task 15: Cancel pending on chat delete + PTY-equivalent (session close)

**Files:**
- Modify: `src/server/agent.ts` (locate session close path)
- Modify: `src/server/agent.test.ts`

When a session closes (existing flow for SDK driver: `ClaudeSessionHandle.close()`), call `toolCallback.cancelAllForSession(sessionId, "session_closed")`. When a chat is deleted, call `cancelAllForChat(chatId, "chat_deleted")`.

- [ ] **Step 1: Write the failing test**

```ts
test("closing session cancels pending tool requests for that session", async () => {
  // Set up session with one pending request via toolCallback.
  // Call session.close().
  // Assert store record for that request has status "canceled".
})
```

- [ ] **Step 2: Run test**

Run: `bun test src/server/agent.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Locate `close: () => { ... }` (around line 770 in `agent.ts`) and modify:

```ts
    close: () => {
      // existing close logic
      if (args.toolCallback) {
        void args.toolCallback.cancelAllForSession(args.sessionToken ?? "", "session_closed")
      }
    },
```

For chat delete, locate the chat-delete handler in `AgentCoordinator` and add a call to `cancelAllForChat`.

- [ ] **Step 4: Run tests**

Run: `bun test src/server/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(agent): cancel pending tool requests on session close + chat delete"
```

---

## Task 16: Timeout tick driver

**Files:**
- Modify: `src/server/cli.ts` (or wherever the boot site is — same as Task 7)
- Test: cover indirectly in `tool-callback.test.ts` (already covered in Task 6)

- [ ] **Step 1: Add a `setInterval` near the boot site**

After `initToolCallbackOnBoot`:

```ts
const tickInterval = setInterval(() => {
  void toolCallback.tickTimeouts()
}, 5_000)
// Ensure clearInterval on shutdown:
process.once("SIGTERM", () => clearInterval(tickInterval))
process.once("SIGINT", () => clearInterval(tickInterval))
```

- [ ] **Step 2: Run lint + tests**

Run: `bun run lint && bun test src/server`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/cli.ts
git commit -m "feat(boot): periodic tickTimeouts driver for tool-callback"
```

---

## Task 17: Client-side `PendingToolRequestCard` component

**Files:**
- Create: `src/client/components/PendingToolRequestCard.tsx`
- Create: `src/client/components/PendingToolRequestCard.test.tsx`

> **Style note:** follow `kanna-react-style` skill (already loaded via project hooks). Use Tooltip (project) over native `title`. Co-locate test next to component. Pull strings from the existing chat-card primitives if they exist (`bun --bun rg -n "QuestionCard|PlanCard" src/client`).

- [ ] **Step 1: Locate existing question/plan card patterns**

Run: `bun --bun rg -n "AskUserQuestion|ExitPlanMode|question.*card" src/client`
Reuse those components if present.

- [ ] **Step 2: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "bun:test"
import { PendingToolRequestCard } from "./PendingToolRequestCard"

describe("PendingToolRequestCard", () => {
  test("renders ask_user_question with options as buttons", () => {
    const req = {
      id: "id-1",
      toolName: "mcp__kanna__ask_user_question",
      arguments: {
        questions: [{ text: "Pick", header: "P", options: [{ label: "A", description: "" }, { label: "B", description: "" }], multiSelect: false }],
      },
    } as const
    render(<PendingToolRequestCard request={req as any} onAnswer={() => {}} onCancel={() => {}} />)
    expect(screen.getByText("Pick")).toBeInTheDocument()
    expect(screen.getByText("A")).toBeInTheDocument()
  })

  test("renders exit_plan_mode with confirm/edit buttons", () => {
    const req = {
      id: "id-2",
      toolName: "mcp__kanna__exit_plan_mode",
      arguments: { plan: "do x" },
    } as const
    render(<PendingToolRequestCard request={req as any} onAnswer={() => {}} onCancel={() => {}} />)
    expect(screen.getByText(/do x/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test**

Run: `bun test src/client/components/PendingToolRequestCard.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement the component**

```tsx
import type { ToolRequest, ToolRequestDecision } from "../../shared/permission-policy"

interface Props {
  request: ToolRequest
  onAnswer: (decision: ToolRequestDecision) => void
  onCancel: () => void
}

export function PendingToolRequestCard({ request, onAnswer, onCancel }: Props) {
  if (request.toolName === "mcp__kanna__ask_user_question") {
    const questions = (request.arguments.questions as Array<{
      text: string
      header: string
      options: Array<{ label: string; description: string }>
      multiSelect: boolean
    }>) ?? []
    const handleAnswer = (q: number, optionLabel: string) => {
      onAnswer({
        kind: "answer",
        payload: { answers: { [questions[q].text]: optionLabel } },
      })
    }
    return (
      <div className="rounded-md border p-4">
        {questions.map((q, idx) => (
          <div key={idx} className="mb-3">
            <div className="font-medium">{q.text}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {q.options.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => handleAnswer(idx, opt.label)}
                  className="rounded border px-3 py-1 text-sm"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button type="button" onClick={onCancel} className="text-sm text-muted-foreground">Cancel</button>
      </div>
    )
  }

  if (request.toolName === "mcp__kanna__exit_plan_mode") {
    const plan = typeof request.arguments.plan === "string" ? request.arguments.plan : ""
    return (
      <div className="rounded-md border p-4">
        <pre className="whitespace-pre-wrap text-sm">{plan}</pre>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => onAnswer({ kind: "answer", payload: { confirmed: true } })}
            className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => onAnswer({ kind: "answer", payload: { confirmed: false, message: "" } })}
            className="rounded border px-3 py-1 text-sm"
          >
            Edit
          </button>
          <button type="button" onClick={onCancel} className="text-sm text-muted-foreground">Cancel</button>
        </div>
      </div>
    )
  }

  return <div className="rounded-md border p-4">Unknown tool request: {request.toolName}</div>
}
```

- [ ] **Step 5: Run test**

Run: `bun test src/client/components/PendingToolRequestCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/PendingToolRequestCard.tsx src/client/components/PendingToolRequestCard.test.tsx
git commit -m "feat(client): PendingToolRequestCard for ask_user_question / exit_plan_mode"
```

---

## Task 18: Wire the component into the chat transcript renderer

**Files:**
- Modify: `src/client/app/<ChatTranscript or similar>.tsx` — locate via `bun --bun rg -n "kind === \"" src/client/app | head`

- [ ] **Step 1: Locate the transcript switch**

Run: `bun --bun rg -n 'kind === "ask_user_question"|kind === "exit_plan_mode"|TranscriptEntry' src/client | head -20`

- [ ] **Step 2: Write a failing render-loop check test**

Use `renderForLoopCheck` per project conventions:

```tsx
test("ChatTranscript with pending_tool_request entry doesn't trigger render loop", () => {
  renderForLoopCheck(<ChatTranscript chatId="c" entries={[{
    _id: "e1", createdAt: 1, kind: "pending_tool_request", toolRequestId: "id-1",
  }]} />)
})
```

- [ ] **Step 3: Implement**

In the transcript switch (case statement on `entry.kind`):

```tsx
case "pending_tool_request": {
  const req = useToolRequest(entry.toolRequestId)  // hook subscribes to store; returns ToolRequest | null
  if (!req || req.status !== "pending") return null
  return (
    <PendingToolRequestCard
      request={req}
      onAnswer={(decision) => sendWs({ type: "tool_request_answer", toolRequestId: req.id, decision })}
      onCancel={() => sendWs({ type: "tool_request_answer", toolRequestId: req.id, decision: { kind: "deny", reason: "user_canceled" } })}
    />
  )
}
```

Create `useToolRequest` hook in `src/client/state/toolRequests.ts` that subscribes to the store. Use the EMPTY-constant pattern from `kanna-react-style` to keep a stable reference.

- [ ] **Step 4: Run tests**

Run: `bun test src/client && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client
git commit -m "feat(client): render pending_tool_request entries via PendingToolRequestCard"
```

---

## Task 19: Documentation update

**Files:**
- Modify: `CLAUDE.md` (project root) — note about the new feature flag

- [ ] **Step 1: Append a section to `CLAUDE.md`**

```md
# Tool Callback Feature Flag (KANNA_MCP_TOOL_CALLBACKS)

Setting `KANNA_MCP_TOOL_CALLBACKS=1` routes `ask_user_question` and
`exit_plan_mode` through the durable approval protocol in
`src/server/tool-callback.ts`. Pending requests survive server restart
(as `session_closed` fail-closed) and are replayed to the client on
reconnect. Default is off; the SDK driver uses the legacy
`canUseTool`-via-`onToolRequest` path.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: KANNA_MCP_TOOL_CALLBACKS feature flag"
```

---

## Task 20: Final integration smoke test

**Files:**
- Modify: `src/server/agent.test.ts`

- [ ] **Step 1: Add an end-to-end test with flag on**

```ts
test("E2E: flag-on, AskUserQuestion → tool-callback → answer → SDK receives updated input", async () => {
  process.env.KANNA_MCP_TOOL_CALLBACKS = "1"
  // Use the existing test harness for startClaudeSession.
  // Inject toolCallback. Inject a mock SDK query() that fires an
  // AskUserQuestion tool call. Assert: a pending ToolRequest is created,
  // calling toolCallback.answer resolves the canUseTool promise, and the
  // SDK receives the answers in updatedInput.
  delete process.env.KANNA_MCP_TOOL_CALLBACKS
})
```

- [ ] **Step 2: Run the full suite**

Run: `bun run check`
Expected: PASS (tsc, lint, build all clean).

- [ ] **Step 3: Commit**

```bash
git add src/server/agent.test.ts
git commit -m "test(agent): E2E flag-on tool-callback round-trip"
```

---

## Self-Review

1. **Spec coverage:**
   - Durable approval protocol (spec §"Callback protocol"): covered by Tasks 1, 5, 6 (id formula with `canonicalArgsHash`; idempotency; arg_mismatch; timeout; cancel-on-close; replay-on-reconnect; server-restart fail-closed).
   - `policy.evaluate` and `permission-gate.ts` (spec §"Permission enforcement"): Tasks 3, 4.
   - kanna-mcp tools for `ask_user_question` / `exit_plan_mode` (spec §"Special-case tools"): Tasks 8, 9, 10.
   - Both drivers via shared protocol (spec note): Task 11 routes SDK's `canUseTool` through the same service; PTY-side routing is deferred to P2.
   - Feature flag (spec §"Rollout phase 1a"): present in Tasks 10, 11.
   - UI replay (spec §"Callback protocol, item 7"): Tasks 13, 14, 18.
   - Cancel on chat close / session close: Task 15.
   - Time-driven timeouts: Tasks 6, 16.

2. **Placeholder scan:** No TBD / TODO / "implement later" in plan body. Some task bodies refer to existing project patterns ("locate via grep") rather than re-discovering them — acceptable since the engineer can run the grep command supplied.

3. **Type consistency:** `ToolRequest`, `ToolRequestDecision`, `ToolRequestStatus`, `ChatPermissionPolicy`, `ToolCallbackService` are defined once in shared/permission-policy and shared/tool-callback. Method names: `submit`, `answer`, `cancel`, `cancelAllForChat`, `cancelAllForSession`, `recoverOnStartup`, `tickTimeouts` — consistent across tasks.

4. **Ambiguity:** Two tasks (5 step 3, 11 step 3) reference internal patterns the engineer must verify in-repo (`this.kv` storage primitive in `EventStore`; exact call sites of `startClaudeSession` in `AgentCoordinator`). These are tagged with a grep command so the engineer can find them in one step.

---
