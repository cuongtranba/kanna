# Kanna-MCP Built-in Tool Shims Implementation Plan (P3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mcp__kanna__bash`, `read`, `glob`, `grep`, `edit`, `write`, `webfetch`, `websearch` MCP tools that route through the durable approval protocol from P1. These are the replacements that let P3b's allowlist preflight + `--tools "mcp__kanna__*"` work without crippling the model.

**Architecture:** Each tool is a thin wrapper that calls `gatedToolCall` (P1, `kanna-mcp-tools/tool-callback-shim.ts`) with structured args + verb-appropriate `policy.evaluate` rules. `policy.evaluate` is extended to handle path-deny on read/edit/write tools (P1 only covered `mcp__kanna__bash`). Tools are registered in `kanna-mcp.ts` behind the existing `KANNA_MCP_TOOL_CALLBACKS=1` flag (no new flag — they're inert until the model calls them, which only happens when P3b applies `--tools "mcp__kanna__*"`).

**Tech Stack:** Bun + TypeScript strict, `zod` schemas (already used by existing kanna-mcp tools), `node:fs/promises`, `Bun.spawn` for bash, `minimatch` (existing dep) for glob, Node-side grep (no `rg` binary requirement). `bun:test`.

---

## Scope check

This plan ships **only** the MCP tool shims + `policy.evaluate` path-deny extensions for them. The allowlist preflight (probe suite + sentinel + cache) and the `--tools "mcp__kanna__*"` flag wiring at PTY spawn time are P3b — separate plan, follow-up PR.

The shims are dormant when the model still has built-ins enabled (which is the case for P3a's merge). They become live the moment P3b lands.

---

## File Structure

**Created:**

```
src/server/kanna-mcp-tools/
  ├── read.ts                # mcp__kanna__read
  ├── read.test.ts
  ├── glob.ts                # mcp__kanna__glob
  ├── glob.test.ts
  ├── grep.ts                # mcp__kanna__grep
  ├── grep.test.ts
  ├── bash.ts                # mcp__kanna__bash
  ├── bash.test.ts
  ├── edit.ts                # mcp__kanna__edit
  ├── edit.test.ts
  ├── write.ts               # mcp__kanna__write
  ├── write.test.ts
  ├── webfetch.ts            # mcp__kanna__webfetch
  ├── webfetch.test.ts
  ├── websearch.ts           # mcp__kanna__websearch (stub)
  └── websearch.test.ts
```

**Modified:**

```
src/server/permission-gate.ts          # path-deny for read/edit/write tools
src/server/permission-gate.test.ts     # cover the new branches
src/server/kanna-mcp.ts                # register the 8 new tools (flag-gated)
src/server/kanna-mcp.test.ts           # assert flag-on registers all 8
```

---

## Conventions

- TypeScript strict, no `any`. SDK-boundary casts to `unknown` then narrow.
- Tests use `bun:test`. Co-located.
- Each task = one Conventional Commit.
- Each tool returns the standard MCP `ToolHandlerResult` (`content: [{type: "text", text}]`, optional `isError: true`).
- All gating goes through `gatedToolCall(...)` (P1) so the durable approval protocol applies uniformly.

---

## Task 1: `policy.evaluate` path-deny for new tools

**Files:**
- Modify: `src/server/permission-gate.ts`
- Modify: `src/server/permission-gate.test.ts`

Today `policy.evaluate` only enforces `readPathDeny` for `mcp__kanna__bash`. Extend it so:
- `mcp__kanna__read` / `mcp__kanna__glob` / `mcp__kanna__grep` → check `args.path` against `readPathDeny` → auto-deny on match.
- `mcp__kanna__edit` / `mcp__kanna__write` → check `args.path` against `writePathDeny` → auto-deny on match.
- All other branches unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/permission-gate.test.ts`:

```ts
describe("path-deny for read/edit/write tools", () => {
  test("mcp__kanna__read path in readPathDeny → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__read",
      args: { path: "~/.ssh/id_rsa" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toContain("readPathDeny")
  })

  test("mcp__kanna__read non-sensitive path → falls through to default", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__read",
      args: { path: "/tmp/project/src/foo.ts" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("mcp__kanna__write path in writePathDeny → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__write",
      args: { path: "/etc/passwd", content: "x" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toContain("writePathDeny")
  })

  test("mcp__kanna__edit path in writePathDeny → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__edit",
      args: { path: "~/.aws/credentials", oldString: "a", newString: "b" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toContain("writePathDeny")
  })

  test("mcp__kanna__glob with deny-matching pattern → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__glob",
      args: { path: "~/.ssh/*" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test src/server/permission-gate.test.ts`
Expected: 5 new tests FAIL.

- [ ] **Step 3: Implement in `src/server/permission-gate.ts`**

Add a generic per-tool path-deny block above the existing bash block:

```ts
const READ_PATH_TOOLS = new Set([
  "mcp__kanna__read",
  "mcp__kanna__glob",
  "mcp__kanna__grep",
])
const WRITE_PATH_TOOLS = new Set([
  "mcp__kanna__write",
  "mcp__kanna__edit",
])

function getPathArg(args: Record<string, unknown>): string | null {
  if (typeof args.path === "string") return args.path
  return null
}

// Inside `policy.evaluate(args)`, BEFORE the existing bash block:
if (READ_PATH_TOOLS.has(args.toolName)) {
  const p = getPathArg(args.args)
  if (p !== null) {
    const expanded = p.startsWith("~")
      ? path.join(homedir(), p.slice(1).replace(/^\//, ""))
      : p
    const resolved = path.resolve(args.cwd, expanded)
    const denied = pathMatchesDeny(resolved, args.chatPolicy.readPathDeny)
    if (denied) {
      return { verdict: "auto-deny", reason: `readPathDeny: ${denied}` }
    }
  }
}
if (WRITE_PATH_TOOLS.has(args.toolName)) {
  const p = getPathArg(args.args)
  if (p !== null) {
    const expanded = p.startsWith("~")
      ? path.join(homedir(), p.slice(1).replace(/^\//, ""))
      : p
    const resolved = path.resolve(args.cwd, expanded)
    const deniedW = pathMatchesDeny(resolved, args.chatPolicy.writePathDeny)
    const deniedR = pathMatchesDeny(resolved, args.chatPolicy.readPathDeny)
    if (deniedW) return { verdict: "auto-deny", reason: `writePathDeny: ${deniedW}` }
    if (deniedR) return { verdict: "auto-deny", reason: `readPathDeny: ${deniedR}` }
  }
}
```

(Note: `writePathDeny` was documented as P2-deferred in P1's JSDoc. P3a activates it. Update the JSDoc on `ChatPermissionPolicy.writePathDeny` in `src/shared/permission-policy.ts` to remove the "deferred" note.)

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test src/server/permission-gate.test.ts`
Expected: all PASS (13 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/server/permission-gate.ts src/server/permission-gate.test.ts src/shared/permission-policy.ts
git commit -m "feat(permission-gate): path-deny for mcp__kanna__read/edit/write/glob/grep"
```

---

## Task 2: `mcp__kanna__read`

**Files:**
- Create: `src/server/kanna-mcp-tools/read.ts`
- Create: `src/server/kanna-mcp-tools/read.test.ts`

Reads a file's contents, returns the text.

- [ ] **Step 1: Write the failing tests**

`src/server/kanna-mcp-tools/read.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createReadTool } from "./read"

async function newStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-read-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const ctx = (cwd: string) => ({
  chatId: "c", sessionId: "s", toolUseId: "tu", cwd,
  chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" as const },
})

describe("mcp__kanna__read", () => {
  test("reads file content when policy allows", async () => {
    const { store, dir, cleanup } = await newStore()
    try {
      const filePath = path.join(dir, "hello.txt")
      await writeFile(filePath, "hello world", "utf8")
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createReadTool({ toolCallback: svc })
      const result = await tool.handler({ path: filePath }, ctx(dir))
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain("hello world")
    } finally { await cleanup() }
  })

  test("denied when path in readPathDeny", async () => {
    const { store, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createReadTool({ toolCallback: svc })
      const result = await tool.handler({ path: "~/.ssh/id_rsa" }, ctx("/tmp"))
      expect(result.isError).toBe(true)
      expect(result.content[0].text.toLowerCase()).toContain("denied")
    } finally { await cleanup() }
  })

  test("returns isError when file does not exist", async () => {
    const { store, dir, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createReadTool({ toolCallback: svc })
      const result = await tool.handler({ path: path.join(dir, "missing.txt") }, ctx(dir))
      expect(result.isError).toBe(true)
    } finally { await cleanup() }
  })
})
```

- [ ] **Step 2: Run to verify failure**

`bun test src/server/kanna-mcp-tools/read.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/server/kanna-mcp-tools/read.ts`**

```ts
import { z } from "zod"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string().describe("Absolute path or workspace-relative path to the file"),
})

export type ReadInput = z.infer<typeof InputSchema>

export interface ReadTool {
  name: "read"
  schema: typeof InputSchema
  handler: (input: ReadInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(homedir(), p.slice(1).replace(/^\//, ""))
  return path.resolve(cwd, p)
}

export function createReadTool(deps: { toolCallback: ToolCallbackService }): ReadTool {
  return {
    name: "read",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__read",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          const resolved = resolvePath(input.path, ctx.cwd)
          try {
            const content = await readFile(resolved, "utf8")
            return { content: [{ type: "text" as const, text: content }] }
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Read failed: ${(err as Error).message}` }],
              isError: true,
            }
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

**Note:** `formatAnswer` is currently typed as a sync function in `tool-callback-shim.ts` (per P1). For this task, the shim must accept an async `formatAnswer` returning `Promise<ToolHandlerResult>`. Adjust the shim signature OR call `readFile` synchronously via `readFileSync` from `node:fs`.

Pragmatic choice: update the shim. Edit `src/server/kanna-mcp-tools/tool-callback-shim.ts` to accept `formatAnswer: (payload: unknown) => ToolHandlerResult | Promise<ToolHandlerResult>` and `await` the result. This is backward-compatible — existing sync handlers still work.

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test src/server/kanna-mcp-tools/read.test.ts`
Expected: 3/3 PASS.

Also run `bun test src/server/kanna-mcp-tools/` to confirm no regression in existing `ask_user_question`/`exit_plan_mode` tests caused by the shim signature change.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/read.ts src/server/kanna-mcp-tools/read.test.ts src/server/kanna-mcp-tools/tool-callback-shim.ts
git commit -m "feat(kanna-mcp): mcp__kanna__read with readPathDeny enforcement"
```

---

## Task 3: `mcp__kanna__glob`

**Files:**
- Create: `src/server/kanna-mcp-tools/glob.ts`
- Create: `src/server/kanna-mcp-tools/glob.test.ts`

Globs file paths matching a pattern, returns the list as text.

- [ ] **Step 1: Failing tests**

`src/server/kanna-mcp-tools/glob.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createGlobTool } from "./glob"

async function newStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-glob-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const ctx = (cwd: string) => ({
  chatId: "c", sessionId: "s", toolUseId: "tu", cwd,
  chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" as const },
})

describe("mcp__kanna__glob", () => {
  test("returns matching files for a simple pattern", async () => {
    const { store, dir, cleanup } = await newStore()
    try {
      await writeFile(path.join(dir, "a.ts"), "x", "utf8")
      await writeFile(path.join(dir, "b.ts"), "x", "utf8")
      await writeFile(path.join(dir, "c.js"), "x", "utf8")
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createGlobTool({ toolCallback: svc })
      const result = await tool.handler({ path: dir, pattern: "*.ts" }, ctx(dir))
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain("a.ts")
      expect(result.content[0].text).toContain("b.ts")
      expect(result.content[0].text).not.toContain("c.js")
    } finally { await cleanup() }
  })

  test("denied when path in readPathDeny", async () => {
    const { store, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createGlobTool({ toolCallback: svc })
      const result = await tool.handler({ path: "~/.ssh", pattern: "*" }, ctx("/tmp"))
      expect(result.isError).toBe(true)
    } finally { await cleanup() }
  })
})
```

- [ ] **Step 2: Run to verify failure**

`bun test src/server/kanna-mcp-tools/glob.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/server/kanna-mcp-tools/glob.ts`**

```ts
import { z } from "zod"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import { minimatch } from "minimatch"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string().describe("Root directory to glob within (absolute or workspace-relative)"),
  pattern: z.string().describe("Glob pattern e.g. **/*.ts"),
})

export type GlobInput = z.infer<typeof InputSchema>

export interface GlobTool {
  name: "glob"
  schema: typeof InputSchema
  handler: (input: GlobInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(homedir(), p.slice(1).replace(/^\//, ""))
  return path.resolve(cwd, p)
}

async function walk(root: string, pattern: string, results: string[], maxResults = 1000): Promise<void> {
  if (results.length >= maxResults) return
  let entries: { name: string; isDirectory(): boolean }[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (results.length >= maxResults) return
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue
      await walk(full, pattern, results, maxResults)
    } else {
      const rel = path.relative(root, full)
      if (minimatch(rel, pattern, { dot: true })) {
        results.push(full)
      }
    }
  }
}

export function createGlobTool(deps: { toolCallback: ToolCallbackService }): GlobTool {
  return {
    name: "glob",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__glob",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          const resolved = resolvePath(input.path, ctx.cwd)
          try {
            const st = await stat(resolved)
            if (!st.isDirectory()) {
              return { content: [{ type: "text" as const, text: `Not a directory: ${resolved}` }], isError: true }
            }
            const results: string[] = []
            await walk(resolved, input.pattern, results)
            return { content: [{ type: "text" as const, text: results.join("\n") }] }
          } catch (err) {
            return { content: [{ type: "text" as const, text: `Glob failed: ${(err as Error).message}` }], isError: true }
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

- [ ] **Step 4: Run tests**

`bun test src/server/kanna-mcp-tools/glob.test.ts` → 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/glob.ts src/server/kanna-mcp-tools/glob.test.ts
git commit -m "feat(kanna-mcp): mcp__kanna__glob with readPathDeny enforcement"
```

---

## Task 4: `mcp__kanna__grep`

**Files:**
- Create: `src/server/kanna-mcp-tools/grep.ts`
- Create: `src/server/kanna-mcp-tools/grep.test.ts`

Greps file contents within a directory tree. Node-side implementation — no `rg` binary requirement.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createGrepTool } from "./grep"

async function newStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-grep-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const ctx = (cwd: string) => ({
  chatId: "c", sessionId: "s", toolUseId: "tu", cwd,
  chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" as const },
})

describe("mcp__kanna__grep", () => {
  test("finds matching lines across files", async () => {
    const { store, dir, cleanup } = await newStore()
    try {
      await writeFile(path.join(dir, "a.txt"), "alpha\nbeta\n", "utf8")
      await writeFile(path.join(dir, "b.txt"), "beta\ngamma\n", "utf8")
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createGrepTool({ toolCallback: svc })
      const result = await tool.handler({ path: dir, pattern: "beta" }, ctx(dir))
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain("a.txt")
      expect(result.content[0].text).toContain("b.txt")
    } finally { await cleanup() }
  })

  test("denied when path in readPathDeny", async () => {
    const { store, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createGrepTool({ toolCallback: svc })
      const result = await tool.handler({ path: "~/.ssh", pattern: "x" }, ctx("/tmp"))
      expect(result.isError).toBe(true)
    } finally { await cleanup() }
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `src/server/kanna-mcp-tools/grep.ts`**

```ts
import { z } from "zod"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string().describe("Root directory or file"),
  pattern: z.string().describe("Regex pattern (ECMAScript)"),
})

export type GrepInput = z.infer<typeof InputSchema>

export interface GrepTool {
  name: "grep"
  schema: typeof InputSchema
  handler: (input: GrepInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(homedir(), p.slice(1).replace(/^\//, ""))
  return path.resolve(cwd, p)
}

async function grepFile(filePath: string, re: RegExp, results: string[], maxLines: number): Promise<void> {
  if (results.length >= maxLines) return
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch {
    return
  }
  const lines = raw.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (results.length >= maxLines) return
    if (re.test(lines[i])) {
      results.push(`${filePath}:${i + 1}: ${lines[i]}`)
    }
  }
}

async function walk(root: string, re: RegExp, results: string[], maxResults: number): Promise<void> {
  if (results.length >= maxResults) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (results.length >= maxResults) return
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue
      await walk(full, re, results, maxResults)
    } else if (entry.isFile()) {
      await grepFile(full, re, results, maxResults)
    }
  }
}

export function createGrepTool(deps: { toolCallback: ToolCallbackService }): GrepTool {
  return {
    name: "grep",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__grep",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          const resolved = resolvePath(input.path, ctx.cwd)
          let re: RegExp
          try {
            re = new RegExp(input.pattern)
          } catch (err) {
            return { content: [{ type: "text" as const, text: `Invalid regex: ${(err as Error).message}` }], isError: true }
          }
          try {
            const results: string[] = []
            const st = await stat(resolved)
            if (st.isDirectory()) {
              await walk(resolved, re, results, 500)
            } else if (st.isFile()) {
              await grepFile(resolved, re, results, 500)
            }
            return { content: [{ type: "text" as const, text: results.join("\n") || "(no matches)" }] }
          } catch (err) {
            return { content: [{ type: "text" as const, text: `Grep failed: ${(err as Error).message}` }], isError: true }
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

- [ ] **Step 4: Run tests** → 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/grep.ts src/server/kanna-mcp-tools/grep.test.ts
git commit -m "feat(kanna-mcp): mcp__kanna__grep with readPathDeny enforcement"
```

---

## Task 5: `mcp__kanna__bash`

**Files:**
- Create: `src/server/kanna-mcp-tools/bash.ts`
- Create: `src/server/kanna-mcp-tools/bash.test.ts`

Executes a shell command via `Bun.spawn` and returns stdout+stderr. `policy.evaluate`'s bash arg parser (built in P1) already handles auto-allow/deny logic — the shim doesn't re-parse.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "bun:test"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createBashTool } from "./bash"

async function newStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-bash-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const ctx = (cwd: string) => ({
  chatId: "c", sessionId: "s", toolUseId: "tu", cwd,
  chatPolicy: POLICY_DEFAULT,
})

describe("mcp__kanna__bash", () => {
  test("auto-allowed verb returns stdout", async () => {
    const { store, dir, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createBashTool({ toolCallback: svc })
      const result = await tool.handler({ command: "pwd" }, ctx(dir))
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain(dir)
    } finally { await cleanup() }
  })

  test("denied command in toolDenyList returns isError", async () => {
    const { store, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createBashTool({ toolCallback: svc })
      const result = await tool.handler({ command: "rm -rf /" }, ctx("/tmp"))
      expect(result.isError).toBe(true)
    } finally { await cleanup() }
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `src/server/kanna-mcp-tools/bash.ts`**

```ts
import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  command: z.string().describe("Shell command to run (single line, no shell features)"),
})

export type BashInput = z.infer<typeof InputSchema>

export interface BashTool {
  name: "bash"
  schema: typeof InputSchema
  handler: (input: BashInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

async function runBash(command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["/bin/sh", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

export function createBashTool(deps: { toolCallback: ToolCallbackService }): BashTool {
  return {
    name: "bash",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__bash",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          try {
            const { stdout, stderr, exitCode } = await runBash(input.command, ctx.cwd)
            const out = [
              stdout && `stdout:\n${stdout}`,
              stderr && `stderr:\n${stderr}`,
              `exit: ${exitCode}`,
            ].filter(Boolean).join("\n\n")
            return {
              content: [{ type: "text" as const, text: out }],
              isError: exitCode !== 0,
            }
          } catch (err) {
            return { content: [{ type: "text" as const, text: `Bash spawn failed: ${(err as Error).message}` }], isError: true }
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

- [ ] **Step 4: Run tests** → 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/bash.ts src/server/kanna-mcp-tools/bash.test.ts
git commit -m "feat(kanna-mcp): mcp__kanna__bash via Bun.spawn with permission-gate parser"
```

---

## Task 6: `mcp__kanna__edit`

**Files:**
- Create: `src/server/kanna-mcp-tools/edit.ts`
- Create: `src/server/kanna-mcp-tools/edit.test.ts`

String-replaces an exact substring in a file. Mirrors Claude built-in `Edit`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createEditTool } from "./edit"

async function newStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-edit-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const ctx = (cwd: string) => ({
  chatId: "c", sessionId: "s", toolUseId: "tu", cwd,
  chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" as const },
})

describe("mcp__kanna__edit", () => {
  test("replaces exact substring", async () => {
    const { store, dir, cleanup } = await newStore()
    try {
      const filePath = path.join(dir, "a.txt")
      await writeFile(filePath, "hello world", "utf8")
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createEditTool({ toolCallback: svc })
      const result = await tool.handler(
        { path: filePath, oldString: "world", newString: "moon" },
        ctx(dir),
      )
      expect(result.isError).toBeFalsy()
      const newContent = await readFile(filePath, "utf8")
      expect(newContent).toBe("hello moon")
    } finally { await cleanup() }
  })

  test("returns isError when oldString not found", async () => {
    const { store, dir, cleanup } = await newStore()
    try {
      const filePath = path.join(dir, "a.txt")
      await writeFile(filePath, "hello", "utf8")
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createEditTool({ toolCallback: svc })
      const result = await tool.handler(
        { path: filePath, oldString: "missing", newString: "x" },
        ctx(dir),
      )
      expect(result.isError).toBe(true)
    } finally { await cleanup() }
  })

  test("denied when path in writePathDeny", async () => {
    const { store, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createEditTool({ toolCallback: svc })
      const result = await tool.handler(
        { path: "/etc/passwd", oldString: "x", newString: "y" },
        ctx("/tmp"),
      )
      expect(result.isError).toBe(true)
    } finally { await cleanup() }
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `src/server/kanna-mcp-tools/edit.ts`**

```ts
import { z } from "zod"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string(),
  oldString: z.string(),
  newString: z.string(),
})

export type EditInput = z.infer<typeof InputSchema>

export interface EditTool {
  name: "edit"
  schema: typeof InputSchema
  handler: (input: EditInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(homedir(), p.slice(1).replace(/^\//, ""))
  return path.resolve(cwd, p)
}

export function createEditTool(deps: { toolCallback: ToolCallbackService }): EditTool {
  return {
    name: "edit",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__edit",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          const resolved = resolvePath(input.path, ctx.cwd)
          try {
            const original = await readFile(resolved, "utf8")
            if (!original.includes(input.oldString)) {
              return {
                content: [{ type: "text" as const, text: `Edit failed: oldString not found in ${resolved}` }],
                isError: true,
              }
            }
            const occurrences = original.split(input.oldString).length - 1
            if (occurrences > 1) {
              return {
                content: [{ type: "text" as const, text: `Edit ambiguous: oldString matched ${occurrences} times in ${resolved}` }],
                isError: true,
              }
            }
            const next = original.replace(input.oldString, input.newString)
            await writeFile(resolved, next, "utf8")
            return { content: [{ type: "text" as const, text: `Edited ${resolved}` }] }
          } catch (err) {
            return { content: [{ type: "text" as const, text: `Edit failed: ${(err as Error).message}` }], isError: true }
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

- [ ] **Step 4: Run tests** → 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/edit.ts src/server/kanna-mcp-tools/edit.test.ts
git commit -m "feat(kanna-mcp): mcp__kanna__edit with writePathDeny + ambiguity guard"
```

---

## Task 7: `mcp__kanna__write`

**Files:**
- Create: `src/server/kanna-mcp-tools/write.ts`
- Create: `src/server/kanna-mcp-tools/write.test.ts`

Overwrites a file with new content (or creates it).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createWriteTool } from "./write"

async function newStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-write-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const ctx = (cwd: string) => ({
  chatId: "c", sessionId: "s", toolUseId: "tu", cwd,
  chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" as const },
})

describe("mcp__kanna__write", () => {
  test("writes file content", async () => {
    const { store, dir, cleanup } = await newStore()
    try {
      const filePath = path.join(dir, "out.txt")
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createWriteTool({ toolCallback: svc })
      const result = await tool.handler({ path: filePath, content: "hello" }, ctx(dir))
      expect(result.isError).toBeFalsy()
      expect(await readFile(filePath, "utf8")).toBe("hello")
    } finally { await cleanup() }
  })

  test("denied when path in writePathDeny", async () => {
    const { store, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createWriteTool({ toolCallback: svc })
      const result = await tool.handler({ path: "/etc/foo", content: "x" }, ctx("/tmp"))
      expect(result.isError).toBe(true)
    } finally { await cleanup() }
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `src/server/kanna-mcp-tools/write.ts`**

```ts
import { z } from "zod"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string(),
  content: z.string(),
})

export type WriteInput = z.infer<typeof InputSchema>

export interface WriteTool {
  name: "write"
  schema: typeof InputSchema
  handler: (input: WriteInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(homedir(), p.slice(1).replace(/^\//, ""))
  return path.resolve(cwd, p)
}

export function createWriteTool(deps: { toolCallback: ToolCallbackService }): WriteTool {
  return {
    name: "write",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__write",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          const resolved = resolvePath(input.path, ctx.cwd)
          try {
            await mkdir(path.dirname(resolved), { recursive: true })
            await writeFile(resolved, input.content, "utf8")
            return { content: [{ type: "text" as const, text: `Wrote ${resolved}` }] }
          } catch (err) {
            return { content: [{ type: "text" as const, text: `Write failed: ${(err as Error).message}` }], isError: true }
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

- [ ] **Step 4: Run tests** → 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/write.ts src/server/kanna-mcp-tools/write.test.ts
git commit -m "feat(kanna-mcp): mcp__kanna__write with writePathDeny enforcement"
```

---

## Task 8: `mcp__kanna__webfetch`

**Files:**
- Create: `src/server/kanna-mcp-tools/webfetch.ts`
- Create: `src/server/kanna-mcp-tools/webfetch.test.ts`

HTTP GET via global `fetch`. Returns response text.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "bun:test"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createWebfetchTool } from "./webfetch"

async function newStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-web-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const ctx = () => ({
  chatId: "c", sessionId: "s", toolUseId: "tu", cwd: "/tmp",
  chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" as const },
})

describe("mcp__kanna__webfetch", () => {
  test("returns body from local HTTP server", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() { return new Response("hello from server") },
    })
    try {
      const { store, cleanup } = await newStore()
      try {
        const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
        const tool = createWebfetchTool({ toolCallback: svc })
        const result = await tool.handler({ url: `http://localhost:${server.port}/` }, ctx())
        expect(result.isError).toBeFalsy()
        expect(result.content[0].text).toContain("hello from server")
      } finally { await cleanup() }
    } finally { server.stop(true) }
  })

  test("returns isError on bad URL", async () => {
    const { store, cleanup } = await newStore()
    try {
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createWebfetchTool({ toolCallback: svc })
      const result = await tool.handler({ url: "not-a-url" }, ctx())
      expect(result.isError).toBe(true)
    } finally { await cleanup() }
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `src/server/kanna-mcp-tools/webfetch.ts`**

```ts
import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  url: z.string().url(),
})

export type WebfetchInput = z.infer<typeof InputSchema>

export interface WebfetchTool {
  name: "webfetch"
  schema: typeof InputSchema
  handler: (input: WebfetchInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

export function createWebfetchTool(deps: { toolCallback: ToolCallbackService }): WebfetchTool {
  return {
    name: "webfetch",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__webfetch",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          try {
            const res = await fetch(input.url)
            const text = await res.text()
            return { content: [{ type: "text" as const, text: `Status: ${res.status}\n\n${text}` }] }
          } catch (err) {
            return { content: [{ type: "text" as const, text: `Fetch failed: ${(err as Error).message}` }], isError: true }
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

The second test (`returns isError on bad URL`) will fail at Zod parsing — the schema rejects malformed URLs before reaching the handler. Either: (a) drop the `.url()` constraint and rely on `fetch` to throw, or (b) wrap the test to call the schema first and assert on Zod's parse error.

Pragmatic: drop `.url()` so handler runs and `fetch` throws.

- [ ] **Step 4: Run tests** → 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/webfetch.ts src/server/kanna-mcp-tools/webfetch.test.ts
git commit -m "feat(kanna-mcp): mcp__kanna__webfetch via global fetch"
```

---

## Task 9: `mcp__kanna__websearch` stub

**Files:**
- Create: `src/server/kanna-mcp-tools/websearch.ts`
- Create: `src/server/kanna-mcp-tools/websearch.test.ts`

Stub. Real search needs an external API (Anthropic doesn't expose theirs to MCP). For P3a we ship a returns-isError stub so model can detect "search unavailable" and pivot.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from "bun:test"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "../event-store"
import { createToolCallbackService } from "../tool-callback"
import { createWebsearchTool } from "./websearch"

describe("mcp__kanna__websearch (stub)", () => {
  test("always returns isError with a clear message", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-mcp-ws-"))
    try {
      const store = new EventStore(dir)
      await store.initialize()
      const svc = createToolCallbackService({ store, serverSecret: "k", now: () => 1, timeoutMs: 600_000 })
      const tool = createWebsearchTool({ toolCallback: svc })
      const result = await tool.handler(
        { query: "test" },
        { chatId: "c", sessionId: "s", toolUseId: "tu", cwd: "/tmp", chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" } },
      )
      expect(result.isError).toBe(true)
      expect(result.content[0].text.toLowerCase()).toContain("unavailable")
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `src/server/kanna-mcp-tools/websearch.ts`**

```ts
import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  query: z.string(),
})

export type WebsearchInput = z.infer<typeof InputSchema>

export interface WebsearchTool {
  name: "websearch"
  schema: typeof InputSchema
  handler: (input: WebsearchInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

export function createWebsearchTool(deps: { toolCallback: ToolCallbackService }): WebsearchTool {
  return {
    name: "websearch",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__websearch",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: () => ({
          content: [{
            type: "text" as const,
            text: "WebSearch unavailable in this environment. Use mcp__kanna__webfetch with a specific URL if you already know the target.",
          }],
          isError: true,
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

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/websearch.ts src/server/kanna-mcp-tools/websearch.test.ts
git commit -m "feat(kanna-mcp): mcp__kanna__websearch stub returning isError"
```

---

## Task 10: Register the 8 tools in `kanna-mcp.ts` (flag-gated)

**Files:**
- Modify: `src/server/kanna-mcp.ts`
- Modify: `src/server/kanna-mcp.test.ts`

- [ ] **Step 1: Extend test for new tool registration**

Append to `src/server/kanna-mcp.test.ts`:

```ts
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
      projectId: "p", localPath: "/tmp",
      chatId: "c", sessionId: "s",
      toolCallback: stub as any,
      chatPolicy: POLICY_DEFAULT,
      tunnelGateway: null,
    })
    const names = tools.map((t) => t.name)
    for (const n of ["read", "glob", "grep", "bash", "edit", "write", "webfetch", "websearch"]) {
      expect(names).toContain(n)
    }
  } finally {
    delete process.env.KANNA_MCP_TOOL_CALLBACKS
  }
})
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Modify `src/server/kanna-mcp.ts`**

Add imports near the existing kanna-mcp-tools imports:

```ts
import { createReadTool } from "./kanna-mcp-tools/read"
import { createGlobTool } from "./kanna-mcp-tools/glob"
import { createGrepTool } from "./kanna-mcp-tools/grep"
import { createBashTool } from "./kanna-mcp-tools/bash"
import { createEditTool } from "./kanna-mcp-tools/edit"
import { createWriteTool } from "./kanna-mcp-tools/write"
import { createWebfetchTool } from "./kanna-mcp-tools/webfetch"
import { createWebsearchTool } from "./kanna-mcp-tools/websearch"
```

Inside `buildKannaMcpTools`, after the existing `ask_user_question` + `exit_plan_mode` registration block, add (same pattern):

```ts
if (featureFlag && args.toolCallback) {
  const readTool = createReadTool({ toolCallback: args.toolCallback })
  const globTool = createGlobTool({ toolCallback: args.toolCallback })
  const grepTool = createGrepTool({ toolCallback: args.toolCallback })
  const bashTool = createBashTool({ toolCallback: args.toolCallback })
  const editTool = createEditTool({ toolCallback: args.toolCallback })
  const writeTool = createWriteTool({ toolCallback: args.toolCallback })
  const webfetchTool = createWebfetchTool({ toolCallback: args.toolCallback })
  const websearchTool = createWebsearchTool({ toolCallback: args.toolCallback })

  for (const t of [readTool, globTool, grepTool, bashTool, editTool, writeTool, webfetchTool, websearchTool]) {
    tools.push(
      tool(
        t.name,
        `Kanna built-in replacement for ${t.name}.`,
        t.schema.shape,
        async (input, extra) => {
          const requestId = (extra as { requestId?: string | number } | undefined)?.requestId
          const toolUseId = requestId != null ? String(requestId) : crypto.randomUUID()
          return await t.handler(input as any, {
            chatId: chatId ?? "",
            sessionId,
            toolUseId,
            cwd,
            chatPolicy,
          })
        },
      ),
    )
  }
}
```

The `input as any` cast inside the closure is necessary because each tool's schema differs and the closure-bound `t.handler` is structurally typed across them. This is acceptable per project rules (SDK boundary).

- [ ] **Step 4: Run tests**

`bun test src/server/kanna-mcp.test.ts` → all pass (existing 10 + 1 new).
`bun x tsc --noEmit` clean.
`bun run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp.ts src/server/kanna-mcp.test.ts
git commit -m "feat(kanna-mcp): register read/glob/grep/bash/edit/write/webfetch/websearch shims"
```

---

## Task 11: Doc update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append to `CLAUDE.md`**

```md
# Kanna-MCP Built-in Shims

When `KANNA_MCP_TOOL_CALLBACKS=1`, kanna-mcp registers 8 additional tools
that mirror Claude's built-ins: `mcp__kanna__{read, glob, grep, bash, edit,
write, webfetch, websearch}`. They route through the durable approval
protocol with the same path-deny rules as the bash tool from P1.

These tools are inert until the PTY driver applies `--tools "mcp__kanna__*"`
(P3b — landing in a follow-up PR). With the SDK driver (the default), the
model still uses its native built-ins and these shims sit unused.

`websearch` is a stub that always returns `isError: true` — real web search
needs an external API integration which is out of scope for P3a.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: P3a mcp__kanna__* built-in shims"
```

---

## Self-Review

**1. Spec coverage** (`docs/superpowers/specs/2026-05-14-claude-pty-driver-design.md` §"Permission enforcement"):
- `mcp__kanna__bash/edit/write/read/glob/grep/webfetch/websearch` shims — Tasks 2-9.
- `policy.evaluate` path-deny extension for new tools — Task 1.
- Registration behind feature flag — Task 10.
- Docs — Task 11.

**Deferred to P3b (NOT in P3a):**
- `--tools "mcp__kanna__*"` flag at PTY spawn time.
- Allowlist preflight (directed probes + sentinel + cache).
- Spawn-time refusal if preflight fails.

**2. Placeholder scan:** No TBD/TODO. All tasks contain executable code.

**3. Type consistency:** Each tool follows the same factory signature `create<X>Tool({ toolCallback })` returning `{ name, schema, handler }`. Handler signature is identical: `(input, ctx) => Promise<ToolHandlerResult>`. `gatedToolCall` parameters are stable across all 8 callers.

**4. Edge cases noted:**
- Task 2 (read): `tool-callback-shim.ts` `formatAnswer` must support async return. Shim signature update is part of Task 2's commit.
- Task 8 (webfetch): drop Zod `.url()` constraint so handler runs and `fetch` throws.

---
