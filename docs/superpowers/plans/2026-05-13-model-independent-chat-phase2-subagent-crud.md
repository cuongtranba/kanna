# Phase 2 — Subagent CRUD & Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-configurable subagents to `app-settings.json` with full CRUD, and make `@agent/<name>` mention parsing server-authoritative. Phase 2 does NOT run subagents — it ships the data shape, settings UI, picker integration, and the parse + validate pipeline so phase 3 can plug the orchestrator in cleanly.

**Architecture:** New `Subagent` array in `AppSettingsSnapshot`. CRUD via new `subagent.*` commands flowing through the existing `app-settings` snapshot channel. New server module `mention-parser.ts` is the single source of truth for `@agent/<name>` extraction; the client parses purely for picker UX. `MessageEvent` envelope gains optional `subagentMentions` and `unknownSubagentMentions` — `TranscriptEntry` is unchanged.

**Tech Stack:** TypeScript, Bun, React 19, Zustand, bun:test, JSONL event log, ULID.

**Design reference:** `docs/superpowers/specs/2026-05-13-model-independent-chat-phase2-subagent-crud.md`.

**Baseline:** Phase 1 merged. Branch `plans/model-independent-chat-phase2` off the phase-1 tip. Verify `bun test` passes before starting.

---

## File Structure

**Shared (modify):**
- `src/shared/types.ts` — `Subagent`, `SubagentInput`, `SubagentPatch`, extend `AppSettingsSnapshot`, extend `AppSettingsPatch`
- `src/shared/protocol.ts` — add `subagent.create` / `subagent.update` / `subagent.delete` commands + response types

**Server (modify + new):**
- `src/server/app-settings.ts` — extend file shape, normalization, validation, CRUD methods
- `src/server/events.ts` — extend `MessageEvent` envelope with optional mention fields
- `src/server/mention-parser.ts` (new) — `parseMentions` + reserved-name guard
- `src/server/mention-parser.test.ts` (new)
- `src/server/ws-router.ts` — handle new commands (path inferred — confirm with `grep -n 'app-settings' src/server/ws-router.ts`)

**Client (modify + new):**
- `src/client/hooks/useSubagentSuggestions.ts` (new)
- `src/client/hooks/useSubagentSuggestions.test.ts` (new)
- `src/client/components/chat-ui/MentionPicker.tsx` — render two sections
- `src/client/components/chat-ui/MentionPicker.test.tsx` (extend or create)
- `src/client/lib/mention-suggestions.ts` — extend `applyMentionToInput` with `kind: "agent"` branch
- `src/client/components/chat-ui/ChatInput.tsx` — wire suggestions; render mention chips
- `src/client/app/SettingsPage.tsx` — Subagents section
- `src/client/app/SettingsPage.test.tsx` (extend)

---

## Task 1 — `Subagent` shared types

**Files:**
- Modify: `src/shared/types.ts` (after `ChatProviderPreferences` at line 196)
- Modify: `src/shared/types.ts:542-583` (extend AppSettingsSnapshot + AppSettingsPatch)

- [ ] **Step 1: Add type declarations**

Insert into `src/shared/types.ts` near the other settings types (e.g. after `ChatProviderPreferences`):

```ts
export type SubagentContextScope = "previous-assistant-reply" | "full-transcript"

export interface Subagent {
  id: string
  name: string
  description?: string
  provider: AgentProvider
  model: string
  modelOptions: ClaudeModelOptions | CodexModelOptions
  systemPrompt: string
  contextScope: SubagentContextScope
  createdAt: number
  updatedAt: number
}

export interface SubagentInput {
  name: string
  description?: string
  provider: AgentProvider
  model: string
  modelOptions: ClaudeModelOptions | CodexModelOptions
  systemPrompt: string
  contextScope: SubagentContextScope
}

export interface SubagentPatch {
  name?: string
  description?: string | null
  provider?: AgentProvider
  model?: string
  modelOptions?: Partial<ClaudeModelOptions> | Partial<CodexModelOptions>
  systemPrompt?: string
  contextScope?: SubagentContextScope
}

export type SubagentValidationErrorCode =
  | "EMPTY_NAME"
  | "INVALID_CHAR"
  | "RESERVED_NAME"
  | "DUPLICATE_NAME"
  | "TOO_LONG"
  | "NOT_FOUND"

export interface SubagentValidationError {
  code: SubagentValidationErrorCode
  message: string
}
```

- [ ] **Step 2: Extend `AppSettingsSnapshot` and `AppSettingsPatch`**

`src/shared/types.ts:542-583` — add `subagents` field to both:

```ts
// AppSettingsSnapshot — add at end of interface body:
subagents: Subagent[]

// AppSettingsPatch — add:
subagents?: {
  create?: SubagentInput
  update?: { id: string; patch: SubagentPatch }
  delete?: { id: string }
}
```

The patch shape is intentionally enum-like (one op per write). The dedicated CRUD commands in Task 3 are the primary API; the patch shape exists for symmetry with `settings.writeAppSettingsPatch`.

- [ ] **Step 3: Typecheck**

Run: `bun run check 2>&1 | tail -20`
Expected: PASS for the type file. App-settings runtime errors expected — fixed in Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): Subagent + AppSettings extension types"
```

---

## Task 2 — App-settings normalization, validation, CRUD

**Files:**
- Modify: `src/server/app-settings.ts:49-73, 375-583` (file shape, payload, normalize, patch)

- [ ] **Step 1: Extend file shape**

`src/server/app-settings.ts:49`. Add `subagents` to `AppSettingsFile`:

```ts
interface AppSettingsFile {
  // ... existing
  subagents?: unknown
}
```

- [ ] **Step 2: Add name validation helper**

Add new module-local function below `normalizeUploadSettings`:

```ts
const SUBAGENT_NAME_REGEX = /^[a-z0-9_-]+$/
const SUBAGENT_RESERVED_NAMES = new Set(["agent", "agents"])
const SUBAGENT_NAME_MAX = 64

function validateSubagentName(
  rawName: string,
  existingIds: { id: string; name: string }[],
  ignoreId?: string,
): SubagentValidationError | null {
  const name = rawName.trim()
  if (!name) return { code: "EMPTY_NAME", message: "Name is required" }
  if (name.length > SUBAGENT_NAME_MAX) {
    return { code: "TOO_LONG", message: `Name must be ≤ ${SUBAGENT_NAME_MAX} chars` }
  }
  if (name.startsWith(".") || name.includes("/")) {
    return { code: "INVALID_CHAR", message: "Name cannot contain '/' or start with '.'" }
  }
  if (!SUBAGENT_NAME_REGEX.test(name)) {
    return { code: "INVALID_CHAR", message: "Name must match [a-z0-9_-]+" }
  }
  if (SUBAGENT_RESERVED_NAMES.has(name.toLowerCase())) {
    return { code: "RESERVED_NAME", message: `'${name}' is reserved` }
  }
  const lower = name.toLowerCase()
  for (const existing of existingIds) {
    if (existing.id === ignoreId) continue
    if (existing.name.toLowerCase() === lower) {
      return { code: "DUPLICATE_NAME", message: `Name '${name}' already in use` }
    }
  }
  return null
}
```

Import `SubagentValidationError` from `../shared/types` at top.

- [ ] **Step 3: Add per-entry normalizer**

```ts
function normalizeSubagentEntry(value: unknown, warnings: string[]): Subagent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (typeof source.id !== "string" || !source.id) return null
  if (typeof source.name !== "string") return null
  const provider: AgentProvider | null =
    source.provider === "claude" || source.provider === "codex" ? source.provider : null
  if (!provider) {
    warnings.push(`Subagent '${source.id}' has invalid provider; dropped`)
    return null
  }
  const modelOptions = provider === "claude"
    ? normalizeClaudeModelOptions(typeof source.model === "string" ? source.model : "claude-opus-4-7", (source.modelOptions ?? {}) as Partial<ClaudeModelOptions>)
    : normalizeCodexModelOptions((source.modelOptions ?? {}) as Partial<CodexModelOptions>)
  const contextScope: SubagentContextScope =
    source.contextScope === "full-transcript" ? "full-transcript" : "previous-assistant-reply"
  return {
    id: source.id,
    name: typeof source.name === "string" ? source.name.trim() : "",
    description: typeof source.description === "string" ? source.description : undefined,
    provider,
    model: typeof source.model === "string" ? source.model : (provider === "claude" ? "claude-opus-4-7" : "gpt-5.5"),
    modelOptions,
    systemPrompt: typeof source.systemPrompt === "string" ? source.systemPrompt : "",
    contextScope,
    createdAt: typeof source.createdAt === "number" ? source.createdAt : Date.now(),
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : Date.now(),
  }
}

function normalizeSubagents(value: unknown, warnings: string[]): Subagent[] {
  if (!Array.isArray(value)) return []
  const out: Subagent[] = []
  for (const entry of value) {
    const normalized = normalizeSubagentEntry(entry, warnings)
    if (!normalized) continue
    // Validate name as if appending (skip dupes silently for on-disk corruption recovery)
    const error = validateSubagentName(normalized.name, out.map((s) => ({ id: s.id, name: s.name })))
    if (error) {
      warnings.push(`Subagent '${normalized.id}' rejected: ${error.message}`)
      continue
    }
    out.push(normalized)
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}
```

If `normalizeClaudeModelOptions` / `normalizeCodexModelOptions` are not currently exported from `../shared/types`, add a re-export there or inline minimal normalization (call `normalizeClaudeModelId` etc.).

- [ ] **Step 4: Wire `subagents` into `normalizeAppSettings`, `toFilePayload`, `toSnapshot`, `toComparablePayload`, `applyPatch`**

In `normalizeAppSettings` (line 447):

```ts
subagents: normalizeSubagents(source?.subagents, warnings),
```

In `AppSettingsState` (line 75) the field already inherits via `AppSettingsSnapshot`.

In `toFilePayload` (line 375), `toSnapshot` (line 394), `toComparablePayload` (line 484) — add:

```ts
subagents: state.subagents,
```

(`toComparablePayload` uses `source.subagents`.)

In `applyPatch` (line 503) — handle the optional ops:

```ts
function isSubagentValidationError(error: unknown): error is SubagentValidationError {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && "message" in error
  )
}

function applyPatch(state: AppSettingsState, patch: AppSettingsPatch): AppSettingsState {
  let nextSubagents = state.subagents
  if (patch.subagents?.create) {
    const input = patch.subagents.create
    const error = validateSubagentName(input.name, state.subagents.map((s) => ({ id: s.id, name: s.name })))
    if (error) throw new SubagentValidationException(error)
    const now = Date.now()
    nextSubagents = [
      ...state.subagents,
      {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        description: input.description,
        provider: input.provider,
        model: input.model,
        modelOptions: input.modelOptions,
        systemPrompt: input.systemPrompt,
        contextScope: input.contextScope,
        createdAt: now,
        updatedAt: now,
      },
    ]
  } else if (patch.subagents?.update) {
    const { id, patch: agentPatch } = patch.subagents.update
    const idx = state.subagents.findIndex((s) => s.id === id)
    if (idx < 0) throw new SubagentValidationException({ code: "NOT_FOUND", message: `Subagent ${id} not found` })
    const existing = state.subagents[idx]
    const nextName = agentPatch.name != null ? agentPatch.name.trim() : existing.name
    if (agentPatch.name != null) {
      const error = validateSubagentName(nextName, state.subagents.map((s) => ({ id: s.id, name: s.name })), id)
      if (error) throw new SubagentValidationException(error)
    }
    const merged: Subagent = {
      ...existing,
      ...agentPatch,
      name: nextName,
      modelOptions: { ...existing.modelOptions, ...(agentPatch.modelOptions ?? {}) } as Subagent["modelOptions"],
      updatedAt: Date.now(),
    }
    nextSubagents = [...state.subagents.slice(0, idx), merged, ...state.subagents.slice(idx + 1)]
  } else if (patch.subagents?.delete) {
    nextSubagents = state.subagents.filter((s) => s.id !== patch.subagents!.delete!.id)
  }
  const base = toFilePayload(state)
  return normalizeAppSettings({
    ...base,
    analyticsEnabled: patch.analyticsEnabled ?? base.analyticsEnabled,
    terminal: patch.terminal ? { ...base.terminal, ...patch.terminal } : base.terminal,
    editor: patch.editor ? { ...base.editor, ...patch.editor } : base.editor,
    providerDefaults: patch.providerDefaults
      ? { ...base.providerDefaults, ...patch.providerDefaults }
      : base.providerDefaults,
    cloudflareTunnel: patch.cloudflareTunnel
      ? { ...base.cloudflareTunnel, ...patch.cloudflareTunnel }
      : base.cloudflareTunnel,
    auth: patch.auth ? { ...base.auth, ...patch.auth } : base.auth,
    claudeAuth: patch.claudeAuth
      ? { tokens: patch.claudeAuth.tokens ?? base.claudeAuth.tokens }
      : base.claudeAuth,
    uploads: patch.uploads ? { ...base.uploads, ...patch.uploads } : base.uploads,
    subagents: nextSubagents,
  }, /* filePath = */ undefined).payload
}
```

Add a small exception wrapper near the validation helpers so validation failures are not confused with arbitrary runtime errors that happen to expose a `.code` property:

```ts
class SubagentValidationException extends Error {
  constructor(readonly validationError: SubagentValidationError) {
    super(validationError.message)
    this.name = "SubagentValidationException"
  }
}
```

If `normalizeAppSettings` second arg defaults to `homedir()`-derived path, leave it omitted to reuse the default.

`crypto.randomUUID` is imported at line 1 already. ULID is not used — UUIDv4 is acceptable per consensus (spec uses "ULID" notionally; the only requirement is stability + uniqueness).

- [ ] **Step 5: Add CRUD methods on `AppSettingsManager`**

Add to the existing `AppSettingsManager` class. Reuse `writePatch()` so persistence, watcher suppression, and `onChange` notification stay centralized:

```ts
async createSubagent(input: SubagentInput): Promise<SubagentValidationError | Subagent> {
  try {
    const snapshot = await this.writePatch({ subagents: { create: input } })
    return snapshot.subagents[snapshot.subagents.length - 1]
  } catch (error) {
    if (error instanceof SubagentValidationException) {
      return error.validationError
    }
    throw error
  }
}

async updateSubagent(id: string, patch: SubagentPatch): Promise<SubagentValidationError | Subagent> {
  try {
    const snapshot = await this.writePatch({ subagents: { update: { id, patch } } })
    const updated = snapshot.subagents.find((s) => s.id === id)
    return updated ?? { code: "NOT_FOUND", message: `Subagent ${id} not found` }
  } catch (error) {
    if (error instanceof SubagentValidationException) {
      return error.validationError
    }
    throw error
  }
}

async deleteSubagent(id: string): Promise<void> {
  await this.writePatch({ subagents: { delete: { id } } })
}
```

The existing `writePatch()` calls `setState()`, which pushes snapshots to `onChange` subscribers; do not add a separate `emitSnapshot` path.

- [ ] **Step 6: Commit (broken tests OK — added in Task 4)**

```bash
git add src/server/app-settings.ts src/shared/types.ts
git commit -m "feat(app-settings): subagent CRUD + validation"
```

---

## Task 3 — Protocol commands for subagent CRUD

**Files:**
- Modify: `src/shared/protocol.ts:70-105` (ClientCommand union)
- Modify: `src/server/ws-router.ts` (handle new commands — confirm path)

- [ ] **Step 1: Add commands to `ClientCommand`**

In `src/shared/protocol.ts`, extend the union near the other `appSettings.*` commands:

```ts
| { type: "subagent.create"; input: SubagentInput }
| { type: "subagent.update"; id: string; patch: SubagentPatch }
| { type: "subagent.delete"; id: string }
```

Import the new types at the top:

```ts
import type {
  // ... existing imports
  Subagent,
  SubagentInput,
  SubagentPatch,
  SubagentValidationError,
} from "./types"
```

Define a response shape:

```ts
export type SubagentCommandResult =
  | { ok: true; subagent: Subagent }
  | { ok: false; error: SubagentValidationError }

export type SubagentDeleteResult = { ok: true }
```

Wire `SubagentCommandResult` into the response map alongside other command responses. Search `src/shared/protocol.ts` for `ResponseMap` or similar — there's a typed correspondence between command `type` and response payload.

- [ ] **Step 2: Implement the handlers in `ws-router`**

Run: `grep -n 'settings.writeAppSettingsPatch' src/server/ws-router.ts` to locate the dispatch site. Add the CRUD methods to the `resolvedAppSettings` adapter, then add three sibling command cases:

```ts
case "subagent.create": {
  const result = await resolvedAppSettings.createSubagent(command.input)
  if (isSubagentValidationError(result)) {
    send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: result } })
    return
  }
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true, subagent: result } })
  return
}
case "subagent.update": {
  const result = await resolvedAppSettings.updateSubagent(command.id, command.patch)
  if (isSubagentValidationError(result)) {
    send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: result } })
    return
  }
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true, subagent: result } })
  return
}
case "subagent.delete": {
  await resolvedAppSettings.deleteSubagent(command.id)
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true } })
  return
}
```

For error cases, send `{ ok: false, error: result }` as the ack result before returning; keep the same style as the surrounding `ws-router` switch rather than returning raw objects from the case.

- [ ] **Step 3: Typecheck**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/protocol.ts src/server/ws-router.ts
git commit -m "feat(protocol): subagent.create/update/delete commands"
```

---

## Task 4 — App-settings CRUD tests

**Files:**
- Modify: `src/server/app-settings.test.ts`

- [ ] **Step 1: Write failing tests**

Add at the end of `src/server/app-settings.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AppSettings } from "./app-settings"

describe("subagent CRUD", () => {
  async function setup() {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-subagent-"))
    const filePath = path.join(dir, "app-settings.json")
    const settings = new AppSettings(filePath)
    await settings.ready()
    return { dir, settings }
  }

  function baseInput(overrides: Partial<SubagentInput> = {}): SubagentInput {
    return {
      name: "reviewer",
      provider: "claude",
      model: "claude-opus-4-7",
      modelOptions: { reasoningEffort: "medium", contextWindow: "1m" },
      systemPrompt: "You review PRs.",
      contextScope: "previous-assistant-reply",
      ...overrides,
    }
  }

  test("create returns the new subagent", async () => {
    const { dir, settings } = await setup()
    const result = await settings.createSubagent(baseInput())
    if (!("id" in result)) throw new Error("expected Subagent, got error")
    expect(result.name).toBe("reviewer")
    expect(result.provider).toBe("claude")
    await rm(dir, { recursive: true, force: true })
  })

  test("create rejects duplicate names case-insensitively", async () => {
    const { dir, settings } = await setup()
    await settings.createSubagent(baseInput({ name: "alpha" }))
    const result = await settings.createSubagent(baseInput({ name: "ALPHA" }))
    expect("code" in result && result.code).toBe("DUPLICATE_NAME")
    await rm(dir, { recursive: true, force: true })
  })

  test("create rejects reserved name 'agent'", async () => {
    const { dir, settings } = await setup()
    const result = await settings.createSubagent(baseInput({ name: "agent" }))
    expect("code" in result && result.code).toBe("RESERVED_NAME")
    await rm(dir, { recursive: true, force: true })
  })

  test("create rejects names with '/'", async () => {
    const { dir, settings } = await setup()
    const result = await settings.createSubagent(baseInput({ name: "foo/bar" }))
    expect("code" in result && result.code).toBe("INVALID_CHAR")
    await rm(dir, { recursive: true, force: true })
  })

  test("create rejects empty name", async () => {
    const { dir, settings } = await setup()
    const result = await settings.createSubagent(baseInput({ name: "   " }))
    expect("code" in result && result.code).toBe("EMPTY_NAME")
    await rm(dir, { recursive: true, force: true })
  })

  test("create rejects leading dot", async () => {
    const { dir, settings } = await setup()
    const result = await settings.createSubagent(baseInput({ name: ".hidden" }))
    expect("code" in result && result.code).toBe("INVALID_CHAR")
    await rm(dir, { recursive: true, force: true })
  })

  test("update renames and bumps updatedAt", async () => {
    const { dir, settings } = await setup()
    const created = await settings.createSubagent(baseInput({ name: "old" }))
    if (!("id" in created)) throw new Error("setup failed")
    const updated = await settings.updateSubagent(created.id, { name: "new" })
    if (!("id" in updated)) throw new Error("update failed")
    expect(updated.name).toBe("new")
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.createdAt)
    await rm(dir, { recursive: true, force: true })
  })

  test("update non-existent id returns NOT_FOUND", async () => {
    const { dir, settings } = await setup()
    const result = await settings.updateSubagent("nope", { name: "x" })
    expect("code" in result && result.code).toBe("NOT_FOUND")
    await rm(dir, { recursive: true, force: true })
  })

  test("delete is idempotent on missing id", async () => {
    const { dir, settings } = await setup()
    await expect(settings.deleteSubagent("nope")).resolves.toBeUndefined()
    await rm(dir, { recursive: true, force: true })
  })

  test("CRUD round-trip survives reload", async () => {
    const { dir, settings } = await setup()
    const created = await settings.createSubagent(baseInput({ name: "x" }))
    if (!("id" in created)) throw new Error("setup failed")
    const reloaded = new AppSettings(path.join(dir, "app-settings.json"))
    await reloaded.ready()
    expect(reloaded.snapshot().subagents).toHaveLength(1)
    expect(reloaded.snapshot().subagents[0].id).toBe(created.id)
    await rm(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run tests, verify green**

Run: `bun test src/server/app-settings.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/app-settings.test.ts
git commit -m "test(app-settings): subagent CRUD + validation"
```

---

## Task 5 — Server-side mention parser

**Files:**
- Create: `src/server/mention-parser.ts`
- Create: `src/server/mention-parser.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/mention-parser.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import type { Subagent } from "../shared/types"
import { parseMentions } from "./mention-parser"

function subagent(name: string, id = name): Subagent {
  return {
    id,
    name,
    provider: "claude",
    model: "claude-opus-4-7",
    modelOptions: { reasoningEffort: "medium", contextWindow: "1m" } as any,
    systemPrompt: "",
    contextScope: "previous-assistant-reply",
    createdAt: 1,
    updatedAt: 1,
  }
}

describe("parseMentions", () => {
  test("resolves @agent/<name> to subagent", () => {
    const mentions = parseMentions("hello @agent/reviewer please look", [subagent("reviewer")])
    expect(mentions).toEqual([
      { kind: "subagent", subagentId: "reviewer", raw: "@agent/reviewer" },
    ])
  })

  test("returns unknown-subagent when name missing", () => {
    const mentions = parseMentions("hi @agent/nobody", [])
    expect(mentions).toEqual([
      { kind: "unknown-subagent", name: "nobody", raw: "@agent/nobody" },
    ])
  })

  test("case-insensitive match", () => {
    const mentions = parseMentions("@agent/REVIEWER", [subagent("reviewer")])
    expect(mentions).toEqual([
      { kind: "subagent", subagentId: "reviewer", raw: "@agent/REVIEWER" },
    ])
  })

  test("multiple agents preserve order", () => {
    const mentions = parseMentions("@agent/a then @agent/b", [subagent("a"), subagent("b")])
    expect(mentions.map((m) => "kind" in m && m.kind === "subagent" ? m.subagentId : null)).toEqual(["a", "b"])
  })

  test("returns empty when no @agent/ mentions present", () => {
    expect(parseMentions("plain text", [subagent("reviewer")])).toEqual([])
  })

  test("does not match @agent/ without a name", () => {
    expect(parseMentions("hello @agent/ alone", [subagent("reviewer")])).toEqual([])
  })

  test("does not match mid-word", () => {
    expect(parseMentions("foo@agent/reviewer", [subagent("reviewer")])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, verify red**

Run: `bun test src/server/mention-parser.test.ts 2>&1 | tail -10`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement parser**

Create `src/server/mention-parser.ts`:

```ts
import type { Subagent } from "../shared/types"

export type ParsedMention =
  | { kind: "subagent"; subagentId: string; raw: string }
  | { kind: "unknown-subagent"; name: string; raw: string }

const AGENT_MENTION_REGEX = /(^|[\s\n\t])@agent\/([a-z0-9_-]+)/gi

export function parseMentions(text: string, subagents: Subagent[]): ParsedMention[] {
  const byNameLower = new Map<string, Subagent>()
  for (const subagent of subagents) {
    byNameLower.set(subagent.name.toLowerCase(), subagent)
  }
  const out: ParsedMention[] = []
  for (const match of text.matchAll(AGENT_MENTION_REGEX)) {
    const name = match[2]
    const raw = `@agent/${name}`
    const hit = byNameLower.get(name.toLowerCase())
    if (hit) {
      out.push({ kind: "subagent", subagentId: hit.id, raw })
    } else {
      out.push({ kind: "unknown-subagent", name, raw })
    }
  }
  return out
}
```

Note: phase 2 returns only subagent kinds. Path mentions continue to be parsed client-side (existing `useMentionSuggestions` flow). Phase 3 extends this signature with paths if needed.

- [ ] **Step 4: Run tests, verify green**

Run: `bun test src/server/mention-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/mention-parser.ts src/server/mention-parser.test.ts
git commit -m "feat(mention-parser): server-authoritative @agent/<name> parsing"
```

---

## Task 6 — Extend `MessageEvent` envelope

**Files:**
- Modify: `src/server/events.ts:151-157`
- Modify: `src/server/event-store.ts` (around `message_appended` handler at line 608; and the append site for messages)
- Modify: `src/server/agent.ts` (caller that appends `message_appended` for user prompts)

- [ ] **Step 1: Extend the type**

Edit `src/server/events.ts:151`:

```ts
export type MessageEvent = {
  v: 3
  type: "message_appended"
  timestamp: number
  chatId: string
  entry: TranscriptEntry
  subagentMentions?: Array<{ subagentId: string; raw: string }>
  unknownSubagentMentions?: Array<{ name: string; raw: string }>
}
```

- [ ] **Step 2: Replay handler unchanged (mention fields are no-ops in phase 2)**

The `message_appended` handler at `event-store.ts:608` continues to push `e.entry` only. Phase 3 will consume `e.subagentMentions`.

- [ ] **Step 3: Append mentions at send time**

Find the site that appends `message_appended` for user prompts. Run: `grep -n 'type: "message_appended"' src/server/*.ts`. It's typically in `agent.ts` near the start of `sendMessage`.

Update the call to include mentions:

```ts
import { parseMentions } from "./mention-parser"

const subagents = this.appSettings.snapshot().subagents
const parsed = parseMentions(args.content, subagents)
const subagentMentions = parsed.filter((m): m is Extract<ParsedMention, { kind: "subagent" }> => m.kind === "subagent")
  .map((m) => ({ subagentId: m.subagentId, raw: m.raw }))
const unknownSubagentMentions = parsed.filter((m): m is Extract<ParsedMention, { kind: "unknown-subagent" }> => m.kind === "unknown-subagent")
  .map((m) => ({ name: m.name, raw: m.raw }))

await this.store.appendMessage(chatId, userEntry, {
  subagentMentions: subagentMentions.length ? subagentMentions : undefined,
  unknownSubagentMentions: unknownSubagentMentions.length ? unknownSubagentMentions : undefined,
})
```

Extend `EventStore.appendMessage` signature if it doesn't already accept optional envelope metadata. Today's signature (search `appendMessage` in `event-store.ts`) likely takes `(chatId, entry)`. Replace with:

```ts
async appendMessage(
  chatId: string,
  entry: TranscriptEntry,
  envelope?: Pick<MessageEvent, "subagentMentions" | "unknownSubagentMentions">,
) {
  // ... existing
  const event: MessageEvent = {
    v: STORE_VERSION,
    type: "message_appended",
    timestamp: Date.now(),
    chatId,
    entry,
    ...envelope,
  }
  await this.append(this.messagesLogPath, event)
}
```

- [ ] **Step 4: Test envelope round-trip**

Add to `src/server/event-store.test.ts`:

```ts
test("message_appended carries subagentMentions through replay", async () => {
  const { dir, store } = await freshStore()
  await store.createProject({ localPath: "/tmp", title: "t" })
  // ... existing fixture pattern; consult adjacent tests
  await store.appendMessage(chatId, makeUserEntry("hi @agent/foo"), {
    subagentMentions: [{ subagentId: "foo-id", raw: "@agent/foo" }],
  })
  const reloaded = new EventStore(dir)
  await reloaded.ready()
  // Read the raw turns log line and assert the envelope shape (mentions are not visible via snapshot today)
  const messagesLog = await Bun.file(path.join(dir, "logs", "messages.jsonl")).text()
  const lastLine = messagesLog.trim().split("\n").at(-1)!
  const parsed = JSON.parse(lastLine)
  expect(parsed.subagentMentions).toEqual([{ subagentId: "foo-id", raw: "@agent/foo" }])
})
```

Reuse the helper pattern from existing event-store tests (`freshStore`, `makeUserEntry`). If unavailable, build inline.

- [ ] **Step 5: Run tests, verify green**

Run: `bun test src/server/event-store.test.ts src/server/agent.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/events.ts src/server/event-store.ts src/server/event-store.test.ts src/server/agent.ts
git commit -m "feat(events): carry subagentMentions on message_appended envelope"
```

---

## Task 7 — Client `useSubagentSuggestions` hook

**Files:**
- Create: `src/client/hooks/useSubagentSuggestions.ts`
- Create: `src/client/hooks/useSubagentSuggestions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/client/hooks/useSubagentSuggestions.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { renderHook, act } from "@testing-library/react"
import { useSubagentSuggestions } from "./useSubagentSuggestions"
import { useAppSettingsStore } from "../stores/appSettingsStore"

describe("useSubagentSuggestions", () => {
  test("filters by name prefix (case-insensitive)", () => {
    useAppSettingsStore.setState({
      snapshot: {
        subagents: [
          { id: "a", name: "alpha", provider: "claude", model: "x", modelOptions: {} as any, systemPrompt: "", contextScope: "previous-assistant-reply", createdAt: 1, updatedAt: 1 },
          { id: "b", name: "beta", provider: "claude", model: "x", modelOptions: {} as any, systemPrompt: "", contextScope: "previous-assistant-reply", createdAt: 2, updatedAt: 2 },
        ],
      } as any,
    })
    const { result } = renderHook(() => useSubagentSuggestions("AL"))
    expect(result.current.items.map((s) => s.id)).toEqual(["a"])
  })

  test("empty query returns all in createdAt asc", () => {
    const { result } = renderHook(() => useSubagentSuggestions(""))
    expect(result.current.items.map((s) => s.id)).toEqual(["a", "b"])
  })

  test("matches description substring", () => {
    useAppSettingsStore.setState({
      snapshot: {
        subagents: [{ id: "a", name: "alpha", description: "review code", provider: "claude", model: "x", modelOptions: {} as any, systemPrompt: "", contextScope: "previous-assistant-reply", createdAt: 1, updatedAt: 1 }],
      } as any,
    })
    const { result } = renderHook(() => useSubagentSuggestions("code"))
    expect(result.current.items).toHaveLength(1)
  })
})
```

If `appSettingsStore` is not Zustand or has a different shape, adapt to actual: `grep -n 'export ' src/client/stores/appSettingsStore.ts`.

- [ ] **Step 2: Run tests, verify red**

Run: `bun test src/client/hooks/useSubagentSuggestions.test.ts 2>&1 | tail -10`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement hook**

Create `src/client/hooks/useSubagentSuggestions.ts`:

```ts
import { useMemo } from "react"
import type { Subagent } from "../../shared/types"
import { useAppSettingsStore } from "../stores/appSettingsStore"

export interface SubagentSuggestionsState {
  items: Subagent[]
  loading: boolean
  error: Error | null
}

export function useSubagentSuggestions(query: string): SubagentSuggestionsState {
  const subagents = useAppSettingsStore((s) => s.snapshot?.subagents ?? [])
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [...subagents].sort((a, b) => a.createdAt - b.createdAt)
    return subagents
      .filter((subagent) =>
        subagent.name.toLowerCase().includes(q)
        || (subagent.description?.toLowerCase().includes(q) ?? false),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
  }, [subagents, query])
  return { items, loading: false, error: null }
}
```

If the store selector signature differs, adapt to actual.

- [ ] **Step 4: Run tests, verify green**

Run: `bun test src/client/hooks/useSubagentSuggestions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/hooks/useSubagentSuggestions.ts src/client/hooks/useSubagentSuggestions.test.ts
git commit -m "feat(hooks): useSubagentSuggestions filters app-settings"
```

---

## Task 8 — Mention picker renders two sections

**Files:**
- Modify: `src/client/components/chat-ui/MentionPicker.tsx`
- Modify: `src/client/lib/mention-suggestions.ts` (extend `applyMentionToInput`)
- Modify: `src/client/components/chat-ui/MentionPicker.test.tsx` (or create)

- [ ] **Step 1: Extend `applyMentionToInput` with agent branch**

Edit `src/client/lib/mention-suggestions.ts:27`:

```ts
export function applyMentionToInput(args: {
  value: string
  caret: number
  tokenStart: number
  picked:
    | { kind: "path"; path: string }
    | { kind: "agent"; name: string }
}): { value: string; caret: number } {
  const before = args.value.slice(0, args.tokenStart)
  const after = args.value.slice(args.caret)
  const replacement = args.picked.kind === "agent"
    ? `@agent/${args.picked.name} `
    : `@${args.picked.path}`
  const nextValue = `${before}${replacement}${after}`
  const nextCaret = before.length + replacement.length
  return { value: nextValue, caret: nextCaret }
}
```

This is a breaking signature change for the existing caller. The old `pickedPath: string` becomes `picked: { kind: "path", path: string }`. Update every caller — `grep -n 'applyMentionToInput' src/client` returns two:

- `src/client/components/chat-ui/ChatInput.tsx:312` — wrap the existing argument in `{ kind: "path", path: pickedPath }`.
- `src/client/lib/mention-suggestions.test.ts` — same.

Also update existing tests in `mention-suggestions.test.ts:38-78` to use the new shape. Keep the existing path-mention tests as regression coverage for cursor placement, and add at least one agent-branch test:

```ts
test("inserts @agent/<name> with trailing space", () => {
  const result = applyMentionToInput({
    value: "hi @",
    caret: 4,
    tokenStart: 3,
    picked: { kind: "agent", name: "reviewer" },
  })
  expect(result.value).toBe("hi @agent/reviewer ")
  expect(result.caret).toBe(19)
})
```

- [ ] **Step 2: Update `MentionPicker.tsx`**

Edit `src/client/components/chat-ui/MentionPicker.tsx`:

```tsx
import { useEffect, useRef } from "react"
import { AtSign, Folder, FileText, Bot } from "lucide-react"
import type { ProjectPath } from "../../hooks/useMentionSuggestions"
import type { Subagent } from "../../../shared/types"
import { cn } from "../../lib/utils"

type Row =
  | { kind: "path"; item: ProjectPath }
  | { kind: "agent"; item: Subagent }

interface MentionPickerProps {
  paths: ProjectPath[]
  agents: Subagent[]
  activeIndex: number
  loading: boolean
  onSelect: (row: Row) => void
  onHoverIndex: (index: number) => void
}

const SKELETON_ROWS = 4

export function MentionPicker({ paths, agents, activeIndex, loading, onSelect, onHoverIndex }: MentionPickerProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const rows: Row[] = [
    ...agents.map((item): Row => ({ kind: "agent", item })),
    ...paths.map((item): Row => ({ kind: "path", item })),
  ]

  useEffect(() => {
    const el = listRef.current?.children.item(activeIndex) as HTMLElement | null
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  if (rows.length === 0 && loading) {
    return (
      <ul
        aria-busy="true"
        aria-label="Loading mention suggestions"
        className="absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl rounded-md border border-border bg-popover shadow-md overflow-hidden"
      >
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <li key={i} className="flex items-center gap-2 px-3 py-1.5" data-testid="mention-picker-skeleton-row">
            <span className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
            <span className="h-3 w-40 max-w-full rounded bg-muted animate-pulse" />
          </li>
        ))}
      </ul>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl rounded-md border border-border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No matching suggestions
      </div>
    )
  }

  const agentsCount = agents.length
  const showSectionHeaders = agentsCount > 0 && paths.length > 0

  return (
    <ul
      ref={listRef}
      role="listbox"
      className="absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md"
    >
      {showSectionHeaders && (
        <li className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Agents</li>
      )}
      {agents.map((agent, i) => {
        const row = { kind: "agent" as const, item: agent }
        return (
          <li
            key={`agent:${agent.id}`}
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(event) => { event.preventDefault(); onSelect(row) }}
            onMouseEnter={() => onHoverIndex(i)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm",
              i === activeIndex && "bg-accent text-accent-foreground",
            )}
          >
            <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono truncate">agent/{agent.name}</span>
            {agent.description && (
              <span className="ml-2 truncate text-xs text-muted-foreground">{agent.description}</span>
            )}
          </li>
        )
      })}
      {showSectionHeaders && (
        <li key="files-header" className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Files</li>
      )}
      {paths.map((pathItem, pathIndex) => {
        const i = agentsCount + pathIndex
        const row = { kind: "path" as const, item: pathItem }
        const Icon = pathItem.kind === "dir" ? Folder : FileText
        return (
          <li
            key={`path:${pathItem.path}`}
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(event) => { event.preventDefault(); onSelect(row) }}
            onMouseEnter={() => onHoverIndex(i)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm",
              i === activeIndex && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono truncate">{pathItem.path}</span>
          </li>
        )
      })}
    </ul>
  )
}
```

Section headers are rendered outside the selectable row maps so they do not consume `activeIndex` and cannot replace the first file suggestion.

- [ ] **Step 3: Wire in `ChatInput.tsx`**

Edit `src/client/components/chat-ui/ChatInput.tsx`. Where `useMentionSuggestions` is called, also call `useSubagentSuggestions`:

```ts
const { items: pathItems, loading: pathsLoading } = useMentionSuggestions({ projectId, query: mentionTrigger.query, enabled: mentionTrigger.open })
const { items: agentItems } = useSubagentSuggestions(mentionTrigger.query)
```

When picking, dispatch by row kind:

```ts
onSelect={(row) => {
  const picked = row.kind === "agent"
    ? { kind: "agent" as const, name: row.item.name }
    : { kind: "path" as const, path: row.item.path }
  const { value: nextValue, caret: nextCaret } = applyMentionToInput({
    value, caret, tokenStart: mentionTrigger.tokenStart, picked,
  })
  // ... existing setValue + cursor restore
}}
```

For path-only registration (existing attachment-hint path), keep the registration code under the `row.kind === "path"` branch.

- [ ] **Step 4: Tests for MentionPicker rendering**

Add to `src/client/components/chat-ui/MentionPicker.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { MentionPicker } from "./MentionPicker"

test("renders Agents section then Files section when both present", () => {
  render(
    <MentionPicker
      paths={[{ path: "src/app.ts", kind: "file" }]}
      agents={[{ id: "a", name: "reviewer", provider: "claude", model: "x", modelOptions: {} as any, systemPrompt: "", contextScope: "previous-assistant-reply", createdAt: 1, updatedAt: 1 }]}
      activeIndex={0}
      loading={false}
      onSelect={() => {}}
      onHoverIndex={() => {}}
    />
  )
  expect(screen.getByText("Agents")).toBeInTheDocument()
  expect(screen.getByText("Files")).toBeInTheDocument()
  expect(screen.getByText("agent/reviewer")).toBeInTheDocument()
  expect(screen.getByText("src/app.ts")).toBeInTheDocument()
})

test("hides section headers when only one section has hits", () => {
  render(
    <MentionPicker
      paths={[{ path: "src/app.ts", kind: "file" }]}
      agents={[]}
      activeIndex={0}
      loading={false}
      onSelect={() => {}}
      onHoverIndex={() => {}}
    />
  )
  expect(screen.queryByText("Agents")).not.toBeInTheDocument()
  expect(screen.queryByText("Files")).not.toBeInTheDocument()
})
```

- [ ] **Step 5: Run tests**

Run: `bun test src/client/lib/mention-suggestions.test.ts src/client/components/chat-ui/MentionPicker.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/mention-suggestions.ts src/client/lib/mention-suggestions.test.ts src/client/components/chat-ui/MentionPicker.tsx src/client/components/chat-ui/MentionPicker.test.tsx src/client/components/chat-ui/ChatInput.tsx
git commit -m "feat(chat-input): mention picker renders Agents + Files sections"
```

---

## Task 9 — Mention chips below textarea

**Files:**
- Modify: `src/client/components/chat-ui/ChatInput.tsx`

- [ ] **Step 1: Parse mentions on the client for display only**

Add a `useMemo` in `ChatInput.tsx` that derives chips from `value`. Re-use the client-side regex — keep it identical to the server pattern:

To keep the "server authoritative" contract honest, put the pattern in a tiny shared module (for example `src/shared/mention-pattern.ts`) and import it from both `src/server/mention-parser.ts` and `ChatInput.tsx`. The client still treats chips as UX hints only; the server parse result remains authoritative for send.

```tsx
const subagents = useAppSettingsStore((s) => s.snapshot?.subagents ?? [])
const chips = useMemo(() => {
  const byNameLower = new Map(subagents.map((s) => [s.name.toLowerCase(), s]))
  const matches = [...value.matchAll(/(?:^|[\s\n\t])@agent\/([a-z0-9_-]+)/gi)]
  return matches.map((m) => {
    const name = m[1]
    const hit = byNameLower.get(name.toLowerCase())
    return hit
      ? { kind: "ok" as const, label: hit.name, id: hit.id }
      : { kind: "missing" as const, label: name }
  })
}, [value, subagents])
```

- [ ] **Step 2: Render chip strip below textarea**

Place right below the textarea, above the existing attachment row:

```tsx
{chips.length > 0 && (
  <div className="flex flex-wrap gap-1 px-1 pt-1">
    {chips.map((chip, i) => (
      <span
        key={`${chip.kind}:${chip.label}:${i}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
          chip.kind === "ok" ? "bg-accent text-accent-foreground" : "bg-destructive/15 text-destructive",
        )}
      >
        <Bot className="h-3 w-3" />
        agent/{chip.label}
        {chip.kind === "missing" && <span className="ml-1 font-medium">unknown</span>}
      </span>
    ))}
  </div>
)}
```

Import `Bot` from `lucide-react`.

- [ ] **Step 3: Smoke test in dev**

Run: `bun run dev`. Type `@agent/foo` in the composer with no subagents defined — expect an "unknown" red chip. Create a subagent named `reviewer` via Settings; type `@agent/reviewer` — expect a green chip.

- [ ] **Step 4: Commit**

```bash
git add src/client/components/chat-ui/ChatInput.tsx
git commit -m "feat(chat-input): preview agent mention chips below textarea"
```

---

## Task 10 — Settings UI for subagents

**Files:**
- Modify: `src/client/app/SettingsPage.tsx`
- Modify: `src/client/app/SettingsPage.test.tsx` (extend)

- [ ] **Step 1: Add Subagents section component**

In `SettingsPage.tsx`, add a new section component above the existing sections:

```tsx
function SubagentsSection() {
  const subagents = useAppSettingsStore((s) => s.snapshot?.subagents ?? [])
  const [editing, setEditing] = useState<Subagent | null>(null)
  const [creating, setCreating] = useState(false)
  // ... CRUD wired through the client command emitter (search for existing send-command hook in this file)
  return (
    <section>
      <h2 className="text-lg font-semibold">Subagents</h2>
      <ul>
        {subagents.map((subagent) => (
          <li key={subagent.id} className="flex items-center justify-between py-2">
            <div>
              <div className="font-medium">{subagent.name}</div>
              <div className="text-xs text-muted-foreground">{subagent.description ?? ""} · {subagent.provider} · {subagent.model}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(subagent)}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => sendCommand({ type: "subagent.delete", id: subagent.id })}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
      <Button onClick={() => setCreating(true)}>New subagent</Button>
      {creating && <SubagentEditor onCancel={() => setCreating(false)} onSave={async (input) => { await sendCommand({ type: "subagent.create", input }); setCreating(false) }} />}
      {editing && <SubagentEditor initial={editing} onCancel={() => setEditing(null)} onSave={async (input) => { await sendCommand({ type: "subagent.update", id: editing.id, patch: input }); setEditing(null) }} />}
    </section>
  )
}
```

`sendCommand` is the existing client→server command sender; consult `SettingsPage.tsx` callsites for the exact name (likely `useWsClient().sendCommand` or similar).

- [ ] **Step 2: Add `SubagentEditor` modal**

```tsx
function SubagentEditor({ initial, onCancel, onSave }: { initial?: Subagent; onCancel: () => void; onSave: (input: SubagentInput | SubagentPatch) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [provider, setProvider] = useState<AgentProvider>(initial?.provider ?? "claude")
  const [model, setModel] = useState(initial?.model ?? "claude-opus-4-7")
  const [modelOptions, setModelOptions] = useState<ClaudeModelOptions | CodexModelOptions>(initial?.modelOptions ?? { reasoningEffort: "medium", contextWindow: "1m" } as ClaudeModelOptions)
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "")
  const [contextScope, setContextScope] = useState<SubagentContextScope>(initial?.contextScope ?? "previous-assistant-reply")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Client-side validation mirrors server's SUBAGENT_NAME_REGEX / reserved set
  const nameError = useMemo(() => {
    const trimmed = name.trim()
    if (!trimmed) return "Name is required"
    if (trimmed.length > 64) return "Name too long"
    if (trimmed.startsWith(".") || trimmed.includes("/")) return "No '/' or leading '.'"
    if (!/^[a-z0-9_-]+$/.test(trimmed)) return "Must match [a-z0-9_-]+"
    if (trimmed === "agent" || trimmed === "agents") return "Reserved name"
    return null
  }, [name])

  return (
    <div role="dialog" aria-modal="true" className="...">
      <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      {nameError && <p className="text-xs text-destructive">{nameError}</p>}
      <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <ChatPreferenceControls
        availableProviders={[{ provider: "claude", available: true }, { provider: "codex", available: true }]}
        selectedProvider={provider}
        model={model}
        modelOptions={modelOptions}
        onProviderChange={(next) => { setProvider(next); /* reset model + opts to defaults */ }}
        onModelChange={(_, next) => setModel(next)}
        onModelOptionChange={(change) => { /* reuse switch from ChatInput logic */ }}
      />
      {/* Editing an existing subagent may keep provider fixed if modelOptions migration is not implemented.
          If provider changes are enabled, reset model and modelOptions atomically to that provider's defaults. */}
      <Textarea placeholder="System prompt" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
      <RadioGroup value={contextScope} onValueChange={(value: SubagentContextScope) => setContextScope(value)}>
        <RadioGroupItem value="previous-assistant-reply" label="Previous assistant reply only" />
        <RadioGroupItem value="full-transcript" label="Full conversation transcript" />
      </RadioGroup>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={nameError !== null || saving}
          onClick={async () => {
            setSaving(true)
            try {
              await onSave({ name, description, provider, model, modelOptions, systemPrompt, contextScope })
            } catch (e) {
              setError(e instanceof Error ? e.message : "Save failed")
            } finally {
              setSaving(false)
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
```

Confirm component names (`Input`, `Textarea`, `Button`, `RadioGroup`) match the project's primitives in `src/client/components/ui/*` — these are conventional shadcn names, but verify by reading any existing modal in `SettingsPage.tsx`.

- [ ] **Step 3: Place section in page**

Insert `<SubagentsSection />` between the provider settings section and the next section. Look at existing section order in the JSX root of `SettingsPage.tsx` and place accordingly.

- [ ] **Step 4: Test client-side validation**

Add to `SettingsPage.test.tsx`:

```tsx
test("subagent editor rejects '/' in name", async () => {
  // render the section, click "New subagent", type a slashy name, expect error message visible and Save disabled.
})
```

Mirror an existing form test in the file for exact harness syntax.

- [ ] **Step 5: Smoke test**

Run: `bun run dev`. Open Settings. Add a subagent named `reviewer` with Claude provider. Verify it appears in the list. Edit it; rename to `reviewer2`. Delete it. Each step should persist a reload.

- [ ] **Step 6: Commit**

```bash
git add src/client/app/SettingsPage.tsx src/client/app/SettingsPage.test.tsx
git commit -m "feat(settings): subagents CRUD UI"
```

---

## Task 11 — Full test sweep

**Files:** (none)

- [ ] **Step 1: Run full suite**

Run: `bun test 2>&1 | tail -20`
Expected: ALL PASS.

- [ ] **Step 2: Typecheck**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin plans/model-independent-chat-phase2
gh pr create --repo cuongtranba/kanna --base main --head plans/model-independent-chat-phase2 --title "feat: phase 2 subagent CRUD + mentions" --body "$(cat <<'EOF'
## Summary
- Subagent CRUD via app-settings.json with name validation
- Server-authoritative @agent/<name> mention parser
- MentionPicker renders Agents + Files sections
- Settings UI for subagent CRUD

Phase 2 does not run subagents — phase 3 wires the orchestrator.

## Test plan
- [ ] bun test
- [ ] Create subagent, rename, delete via Settings
- [ ] Type @agent/<name> in composer, see green chip
- [ ] Type @agent/unknown, see red chip
EOF
)"
```

---

## Self-review checklist

- [ ] `Subagent` type only declared once (in `src/shared/types.ts`); CRUD methods route through it.
- [ ] Name validation runs both client-side (form) and server-side (`validateSubagentName`) with identical rules.
- [ ] `applyMentionToInput` accepts both `path` and `agent` picks; existing path callers updated.
- [ ] `MessageEvent` carries optional `subagentMentions` — `TranscriptEntry` is untouched.
- [ ] Phase 2 does NOT spawn any subagent runs (orchestrator hook deferred to phase 3).
- [ ] `bun test` and `bun run check` pass.
