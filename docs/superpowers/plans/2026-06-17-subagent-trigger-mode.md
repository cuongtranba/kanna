# Subagent Trigger Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-subagent `triggerMode` (`"auto" | "manual"`) so the main model may auto-delegate only to `auto` subagents; `manual` subagents run only when the user `@agent/<name>`-mentions them (hard server block).

**Architecture:** New `triggerMode` field on `Subagent` (default `auto`, no migration). The system-prompt roster splits into an auto section (delegatable) and a manual section (gated). The orchestrator's `delegateRun` rejects a manual target unless its id is in the turn's user-mention set, which is threaded from `agent.ts` through the kanna-mcp delegation context. New `MANUAL_ONLY` error code surfaces in the UI.

**Tech Stack:** TypeScript, Bun test, React 19, Zod, kanna event-sourced settings.

---

## File Structure

- `src/shared/types.ts` — `SubagentTriggerMode`, field on `Subagent`/`SubagentInput`/`SubagentPatch`, `MANUAL_ONLY` code.
- `src/server/app-settings.ts` — normalize default + create/patch mapping.
- `src/shared/kanna-system-prompt.ts` — roster split.
- `src/server/subagent-orchestrator.ts` — `mentionedSubagentIds` arg + `MANUAL_ONLY` block.
- `src/server/kanna-mcp-tools/delegate-subagent.ts` — context field + pass-through.
- `src/server/kanna-mcp.ts` — `KannaMcpDelegationContext` field + handler wiring.
- `src/server/agent.ts` — `mentionedSubagentIdsByChat` map + both delegationContext sites.
- `src/client/components/messages/SubagentErrorCard.tsx` — badge.
- `src/client/app/SubagentsSection.tsx` — Trigger `SegmentedControl`.
- `.c3/` ADR + c3-210 contract (Task 9).

---

### Task 1: Type + error code

**Files:**
- Modify: `src/shared/types.ts:161` (after `SubagentContextScope`), `:163` (`Subagent`), `:176` (`SubagentInput`), `:186` (`SubagentPatch`), `SubagentErrorCode` union (~`:1488`).
- Test: `src/shared/kanna-system-prompt.test.ts` (compile-time use in Task 3; no separate unit test for the bare type).

- [ ] **Step 1: Add the type + fields**

In `src/shared/types.ts`, after the `SubagentContextScope` line:

```ts
export type SubagentTriggerMode = "auto" | "manual"
```

Add to `interface Subagent` (after `contextScope: SubagentContextScope`):

```ts
  triggerMode: SubagentTriggerMode
```

Add to `interface SubagentInput` (after its `contextScope` line):

```ts
  triggerMode?: SubagentTriggerMode
```

Add to `interface SubagentPatch` (after its `contextScope?` line):

```ts
  triggerMode?: SubagentTriggerMode
```

Add `"MANUAL_ONLY"` to the `SubagentErrorCode` union:

```ts
export type SubagentErrorCode =
  | "AUTH_REQUIRED"
  | "UNKNOWN_SUBAGENT"
  | "MANUAL_ONLY"
  | "LOOP_DETECTED"
  | "DEPTH_EXCEEDED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INTERRUPTED"
  | "USER_CANCELLED"
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | head -30`
Expected: errors only where `triggerMode` is now required on `Subagent` literals (fixed in later tasks/tests). Note them; do not fix unrelated files.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(subagent): add SubagentTriggerMode type + MANUAL_ONLY code"
```

---

### Task 2: Persistence (normalize + create + patch default auto)

**Files:**
- Modify: `src/server/app-settings.ts:455` (`normalizeSubagentEntry`), `:1083` (create), patch-apply block (the `contextScope`-bearing object near `:1093`+).
- Test: `src/server/app-settings.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/server/app-settings.test.ts` (near other subagent normalize tests):

```ts
test("legacy subagent without triggerMode defaults to auto", () => {
  const warnings: string[] = []
  const loaded = loadAppSettingsFromObject(
    { subagents: [{ id: "sa-1", name: "x", provider: "claude", systemPrompt: "" }] },
    warnings,
  )
  expect(loaded.subagents[0].triggerMode).toBe("auto")
})

test("explicit manual triggerMode round-trips", () => {
  const warnings: string[] = []
  const loaded = loadAppSettingsFromObject(
    { subagents: [{ id: "sa-1", name: "x", provider: "claude", systemPrompt: "", triggerMode: "manual" }] },
    warnings,
  )
  expect(loaded.subagents[0].triggerMode).toBe("manual")
})
```

> If the test helper that parses a raw object is named differently, grep `app-settings.test.ts` for the existing normalize test and mirror its setup exactly (same loader function + args).

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/server/app-settings.test.ts -t "triggerMode"`
Expected: FAIL — `triggerMode` is `undefined`.

- [ ] **Step 3: Implement normalize default**

In `normalizeSubagentEntry` (`app-settings.ts`), after the `contextScope` const (line ~475) add:

```ts
  const triggerMode: SubagentTriggerMode =
    source.triggerMode === "manual" ? "manual" : "auto"
```

Add `triggerMode,` to the returned object (next to `contextScope,`). Import `SubagentTriggerMode` from `../shared/types` in the existing type-import block.

- [ ] **Step 4: Implement create + patch mapping**

In the create block (`:1085`), add after `contextScope: input.contextScope,`:

```ts
        triggerMode: input.triggerMode ?? "auto",
```

In the patch-apply object (the one merging `subagentPatch`, near the `workingDir` merge), add:

```ts
      triggerMode: subagentPatch.triggerMode ?? existing.triggerMode,
```

- [ ] **Step 5: Run tests**

Run: `bun test src/server/app-settings.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/app-settings.ts src/server/app-settings.test.ts
git commit -m "feat(subagent): persist triggerMode with auto default"
```

---

### Task 3: Roster split in system prompt

**Files:**
- Modify: `src/shared/kanna-system-prompt.ts:73-98`
- Test: `src/shared/kanna-system-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/shared/kanna-system-prompt.test.ts` (the `fakeSubagent()` helper already exists; pass `triggerMode`):

```ts
test("manual subagents render in a separate gated section", () => {
  const out = buildKannaSystemPromptAppend([
    fakeSubagent({ id: "a", name: "autoone", triggerMode: "auto" }),
    fakeSubagent({ id: "m", name: "manualone", triggerMode: "manual" }),
  ])
  expect(out).toContain("## Available subagents")
  expect(out).toContain("- autoone [id=a]")
  expect(out).toContain("## Manual subagents")
  expect(out).toContain("- manualone [id=m]")
  // auto section must not list the manual one
  const autoSection = out.split("## Manual subagents")[0]
  expect(autoSection).not.toContain("manualone")
})

test("no manual section when all subagents are auto", () => {
  const out = buildKannaSystemPromptAppend([fakeSubagent({ triggerMode: "auto" })])
  expect(out).not.toContain("## Manual subagents")
})

test("no auto section when all subagents are manual", () => {
  const out = buildKannaSystemPromptAppend([fakeSubagent({ id: "m", name: "m1", triggerMode: "manual" })])
  expect(out).not.toContain("## Available subagents")
  expect(out).toContain("## Manual subagents")
})
```

Update `fakeSubagent` in that test file to default `triggerMode: "auto"` if it builds the object literal.

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/shared/kanna-system-prompt.test.ts -t "manual"`
Expected: FAIL — no `## Manual subagents` section.

- [ ] **Step 3: Implement the split**

Replace the `if (subagents.length > 0) { … }` block (`:73-98`) with:

```ts
  if (subagents.length > 0) {
    const ranked = [...subagents]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, KANNA_SUBAGENT_ROSTER_LIMIT)

    const line = (s: Subagent) =>
      `- ${s.name} [id=${s.id}]: ${s.description?.trim() || "(no description)"}`

    const autoOnes = ranked.filter((s) => s.triggerMode !== "manual")
    const manualOnes = ranked.filter((s) => s.triggerMode === "manual")

    if (autoOnes.length > 0) {
      sections.push(
        "",
        "## Available subagents",
        "",
        "You can hand off focused work to specialized subagents. Each runs in its own session with its own system prompt and cannot see your conversation history except for the prompt you pass.",
        "",
        ...autoOnes.map(line),
      )
    }

    if (manualOnes.length > 0) {
      sections.push(
        "",
        "## Manual subagents (delegate ONLY when the user @-mentions them)",
        "",
        "These subagents are manual-trigger. Do NOT call delegate_subagent for them unless the user explicitly wrote `@agent/<name>` for that subagent in their latest message. The server rejects unrequested manual delegations.",
        "",
        ...manualOnes.map(line),
      )
    }

    if (subagents.length > ranked.length) {
      sections.push(
        "",
        `(${subagents.length - ranked.length} more subagents omitted; use the most recent ones above or ask the user for the full list.)`,
      )
    }
    sections.push("", DELEGATION_GUIDANCE)
  }
```

- [ ] **Step 4: Run tests**

Run: `bun test src/shared/kanna-system-prompt.test.ts`
Expected: PASS. If an older test asserted the literal single-roster header for a manual fixture, update it to the new sectioning.

- [ ] **Step 5: Commit**

```bash
git add src/shared/kanna-system-prompt.ts src/shared/kanna-system-prompt.test.ts
git commit -m "feat(subagent): split roster into auto + manual sections"
```

---

### Task 4: Orchestrator MANUAL_ONLY block

**Files:**
- Modify: `src/server/subagent-orchestrator.ts` (`delegateRun` args + body near the `resolveSubagent` / `UNKNOWN_SUBAGENT` block).
- Test: `src/server/subagent-orchestrator.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the `delegateRun` describe block in `src/server/subagent-orchestrator.test.ts`:

```ts
test("manual subagent without a matching mention fails MANUAL_ONLY", async () => {
  const h = await setupHarness({ subagents: [makeSubagent({ id: "sa-1", triggerMode: "manual" })] })
  const outcome = await h.orchestrator.delegateRun({
    chatId: h.chatId,
    parentUserMessageId: h.userMessageId,
    parentRunId: null,
    parentSubagentId: null,
    ancestorSubagentIds: [],
    depth: 0,
    subagentId: "sa-1",
    prompt: "x",
    mentionedSubagentIds: [],
  })
  expect(outcome.status).toBe("failed")
  if (outcome.status !== "failed") throw new Error("unreachable")
  expect(outcome.errorCode).toBe("MANUAL_ONLY")
})

test("manual subagent runs when it is in the mention set", async () => {
  const h = await setupHarness({ subagents: [makeSubagent({ id: "sa-1", triggerMode: "manual" })] })
  h.programReply("sa-1", "ran")
  const outcome = await h.orchestrator.delegateRun({
    chatId: h.chatId,
    parentUserMessageId: h.userMessageId,
    parentRunId: null,
    parentSubagentId: null,
    ancestorSubagentIds: [],
    depth: 0,
    subagentId: "sa-1",
    prompt: "x",
    mentionedSubagentIds: ["sa-1"],
  })
  expect(outcome.status).toBe("completed")
})

test("auto subagent ignores the mention set", async () => {
  const h = await setupHarness({ subagents: [makeSubagent({ id: "sa-1", triggerMode: "auto" })] })
  h.programReply("sa-1", "ran")
  const outcome = await h.orchestrator.delegateRun({
    chatId: h.chatId,
    parentUserMessageId: h.userMessageId,
    parentRunId: null,
    parentSubagentId: null,
    ancestorSubagentIds: [],
    depth: 0,
    subagentId: "sa-1",
    prompt: "x",
    mentionedSubagentIds: [],
  })
  expect(outcome.status).toBe("completed")
})
```

Update `makeSubagent` in this test file to default `triggerMode: over.triggerMode ?? "auto"`.

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/server/subagent-orchestrator.test.ts -t "MANUAL_ONLY|mention set"`
Expected: FAIL — `mentionedSubagentIds` not in args type / no block.

- [ ] **Step 3: Implement**

Add `mentionedSubagentIds: string[]` to the `delegateRun(args: { … })` type (next to `subagentId: string`).

After the `resolveSubagent` + `if (!subagent) { … UNKNOWN_SUBAGENT … }` block, before the depth check, add:

```ts
    if (subagent.triggerMode === "manual" && !args.mentionedSubagentIds.includes(subagent.id)) {
      const runId = crypto.randomUUID()
      await this.deps.store.appendSubagentEvent({
        v: 3,
        type: "subagent_run_started",
        timestamp: this.now(),
        chatId: args.chatId,
        runId,
        subagentId: subagent.id,
        subagentName: subagent.name,
        provider: "claude",
        model: "",
        parentUserMessageId: args.parentUserMessageId,
        parentRunId: args.parentRunId,
        depth: args.depth,
      })
      return await this.failRun(
        args.chatId,
        runId,
        "MANUAL_ONLY",
        `Subagent ${subagent.name} is manual-trigger; the user must @-mention it to delegate`,
      )
    }
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/subagent-orchestrator.test.ts`
Expected: PASS (existing tests that call `delegateRun` now need `mentionedSubagentIds`; add `mentionedSubagentIds: []` to each existing `delegateRun` call in this file — grep `delegateRun({` and patch).

- [ ] **Step 5: Commit**

```bash
git add src/server/subagent-orchestrator.ts src/server/subagent-orchestrator.test.ts
git commit -m "feat(subagent): block manual delegation without user mention"
```

---

### Task 5: Delegate-tool context plumbing

**Files:**
- Modify: `src/server/kanna-mcp-tools/delegate-subagent.ts` (`DelegateSubagentContext` + handler), `src/server/kanna-mcp.ts:42` (`KannaMcpDelegationContext`) + handler (`:246`).
- Test: `src/server/kanna-mcp-tools/delegate-subagent.test.ts`

- [ ] **Step 1: Write failing test**

Add to `delegate-subagent.test.ts` (mirror the existing handler test setup — it stubs an orchestrator; assert the array is forwarded):

```ts
test("forwards mentionedSubagentIds from context to delegateRun", async () => {
  const calls: Array<{ mentionedSubagentIds: string[] }> = []
  const orchestrator = {
    delegateRun: async (a: { mentionedSubagentIds: string[] }) => {
      calls.push({ mentionedSubagentIds: a.mentionedSubagentIds })
      return { status: "completed" as const, runId: "r1", text: "ok" }
    },
  } as unknown as SubagentOrchestrator
  const tool = createDelegateSubagentTool({ orchestrator })
  await tool.handler(
    { subagent_id: "sa-1", prompt: "x" },
    {
      chatId: "c1",
      parentSubagentId: null,
      parentRunId: null,
      ancestorSubagentIds: [],
      depth: 0,
      getParentUserMessageId: () => "msg-1",
      getMentionedSubagentIds: () => ["sa-1"],
    },
  )
  expect(calls[0].mentionedSubagentIds).toEqual(["sa-1"])
})
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/server/kanna-mcp-tools/delegate-subagent.test.ts -t "mentionedSubagentIds"`
Expected: FAIL — `getMentionedSubagentIds` not on context type; not forwarded.

- [ ] **Step 3: Implement**

In `delegate-subagent.ts`, add to `DelegateSubagentContext` (after `getParentUserMessageId`):

```ts
  /** Subagent ids the user @-mentioned in the message that started the turn. Gates manual-trigger subagents. */
  getMentionedSubagentIds: () => string[]
```

In the handler, after computing `parentUserMessageId`, add:

```ts
      const mentionedSubagentIds = ctx.getMentionedSubagentIds()
```

Add `mentionedSubagentIds,` to the `deps.orchestrator.delegateRun({ … })` call (next to `subagentId`).

In `kanna-mcp.ts`, add to `KannaMcpDelegationContext` (after `getParentUserMessageId`):

```ts
  getMentionedSubagentIds: () => string[]
```

In the `handlerCtx: DelegateSubagentContext` object (`:246`), add:

```ts
          getMentionedSubagentIds: ctx.getMentionedSubagentIds,
```

- [ ] **Step 4: Run tests**

Run: `bun test src/server/kanna-mcp-tools/delegate-subagent.test.ts src/server/kanna-mcp.test.ts`
Expected: PASS (the `kanna-mcp.test.ts` stub context at `:319` needs `getMentionedSubagentIds: () => []` added — patch it).

- [ ] **Step 5: Commit**

```bash
git add src/server/kanna-mcp-tools/delegate-subagent.ts src/server/kanna-mcp-tools/delegate-subagent.test.ts src/server/kanna-mcp.ts
git commit -m "feat(subagent): thread mentionedSubagentIds through delegate context"
```

---

### Task 6: agent.ts turn-mention wiring

**Files:**
- Modify: `src/server/agent.ts` — new map field (near `:1334`), append block (`:2059`), both delegationContext sites (`:2486` main, `:2846` subagent).
- Test: covered by `src/server/agent.test.ts` (delegation context smoke) — add a focused test.

- [ ] **Step 1: Write failing test**

Add to `src/server/agent.test.ts` near the existing delegation-context tests:

```ts
test("main delegationContext exposes user-mentioned subagent ids for the turn", async () => {
  // Build a coordinator with one manual subagent "sa-m"; send a user message
  // that @-mentions it; assert getMentionedSubagentIds() returns ["sa-m"].
  // Mirror the existing agent.test delegation harness setup.
})
```

> Use the nearest existing agent.test delegation-context harness as the template (grep `getParentUserMessageId` in `agent.test.ts`). The assertion: after a `@agent/<name>` send, the constructed `delegationContext.getMentionedSubagentIds()` includes the resolved id.

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/server/agent.test.ts -t "user-mentioned subagent ids"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the field near the other coordinator maps (`:1334`):

```ts
  private readonly mentionedSubagentIdsByChat = new Map<string, string[]>()
```

In the append block (`:2059`), after `subagentMentions` is built, add:

```ts
      this.mentionedSubagentIdsByChat.set(
        args.chatId,
        subagentMentions.map((m) => m.subagentId),
      )
```

In the main delegationContext (`:2486`), add:

```ts
        getMentionedSubagentIds: () => this.mentionedSubagentIdsByChat.get(chatIdForCtx) ?? [],
```

In the subagent (sub-spawn) delegationContext (`:2846`), add:

```ts
      getMentionedSubagentIds: () => [],
```

(Empty by design: a subagent cannot drive a manual subagent — user-mention authority lives only at the top turn.)

- [ ] **Step 4: Run tests**

Run: `bun test src/server/agent.test.ts -t "delegation|mentioned"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(subagent): expose turn user-mentions to delegation context"
```

---

### Task 7: Error card badge

**Files:**
- Modify: `src/client/components/messages/SubagentErrorCard.tsx:12`
- Test: `src/client/components/messages/SubagentErrorCard.test.tsx` (create if absent; otherwise add a case)

- [ ] **Step 1: Write failing test**

If a test file exists, add; else create `SubagentErrorCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { SubagentErrorCard } from "./SubagentErrorCard"

test("renders MANUAL_ONLY badge", () => {
  render(
    <SubagentErrorCard
      error={{ code: "MANUAL_ONLY", message: "manual only" }}
      runId="r1"
      subagentId="sa-1"
    />,
  )
  expect(screen.getByText("Manual only")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/client/components/messages/SubagentErrorCard.test.tsx`
Expected: FAIL — badge falls through to "Error".

- [ ] **Step 3: Implement**

Add to `badgeText` switch (after `UNKNOWN_SUBAGENT`):

```ts
    case "MANUAL_ONLY": return "Manual only"
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/components/messages/SubagentErrorCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/messages/SubagentErrorCard.tsx src/client/components/messages/SubagentErrorCard.test.tsx
git commit -m "feat(subagent): MANUAL_ONLY error badge"
```

---

### Task 8: UI — Trigger control

**Files:**
- Modify: `src/client/app/SubagentsSection.tsx` — options const (~`:212`), Trigger `FormRow` (after the Context scope row ~`:411`), create-defaults (`:631`, `:611`), dirty-diff (`hasUnsavedChanges` ~`:633`).
- Test: `src/client/app/SubagentsSection.test.tsx`

- [ ] **Step 1: Write failing test**

Add to `SubagentsSection.test.tsx`:

```tsx
test("Trigger control toggles draft.triggerMode and dirties the form", async () => {
  // Mount the editor for a new/auto subagent (mirror the existing edit test setup).
  // Click the "Manual" segment.
  // Assert the Save button becomes enabled (form dirty) and the segment reflects manual.
})
```

> Use the existing "Context scope" interaction test as the template (grep `Context scope` / `contextScope` in the test file). Reuse its render harness + query helpers.

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/client/app/SubagentsSection.test.tsx -t "Trigger"`
Expected: FAIL — no Trigger control.

- [ ] **Step 3: Implement**

Add the options const near `CONTEXT_SCOPE_OPTIONS` (`:212`):

```ts
const TRIGGER_MODE_OPTIONS = [
  { value: "auto" as const, label: "Auto" },
  { value: "manual" as const, label: "Manual" },
]
```

Add a `FormRow` right after the Context scope `FormRow` (`:418`):

```tsx
      <FormRow
        label="Trigger"
        hint="Auto: the main agent may delegate on its own. Manual: only runs when you @-mention it."
      >
        <SegmentedControl
          value={draft.triggerMode ?? "auto"}
          onValueChange={(value) => patchDraft({ triggerMode: value as SubagentTriggerMode })}
          options={TRIGGER_MODE_OPTIONS}
          size="sm"
        />
      </FormRow>
```

Import `SubagentTriggerMode` from `../../shared/types` (add to the existing type import).

In `createDefaultSubagentDraft` (both provider branches return objects), add `triggerMode: "auto",`.

In `hasUnsavedChanges` (the draft/baseline diff), add:

```ts
  if ((draft.triggerMode ?? "auto") !== (baseline.triggerMode ?? "auto")) return true
```

In the baseline-from-subagent builder (`:623` area, where `contextScope: subagent.contextScope` is set), add `triggerMode: subagent.triggerMode,`.

- [ ] **Step 4: Run tests + lint**

Run: `bun test src/client/app/SubagentsSection.test.tsx && bunx eslint src/client/app/SubagentsSection.tsx --max-warnings=0`
Expected: PASS, lint clean.

- [ ] **Step 5: Apply impeccable polish + manual browser check**

Invoke the `impeccable` skill; confirm the Trigger row matches sibling-row spacing/labels. Start dev server, open Settings → Subagents, toggle Auto/Manual, save, reload — verify persistence and that the segment reflects the saved value. If you cannot run the browser, state so explicitly.

- [ ] **Step 6: Commit**

```bash
git add src/client/app/SubagentsSection.tsx src/client/app/SubagentsSection.test.tsx
git commit -m "feat(subagent): Trigger (auto/manual) control in settings"
```

---

### Task 9: C3 docs + full verify

**Files:**
- `.c3/` ADR `adr-20260617-subagent-trigger-mode` (via c3x), c3-210 Contract update.

- [ ] **Step 1: Create + wire ADR**

```bash
C3X_MODE=agent bash <c3-skill>/bin/c3x.sh schema adr   # read contract first
# author body to the schema, then:
C3X_MODE=agent bash <c3-skill>/bin/c3x.sh add adr subagent-trigger-mode --file <body>.md
C3X_MODE=agent bash <c3-skill>/bin/c3x.sh wire adr-20260617-subagent-trigger-mode c3-210
```

ADR must cover: new `triggerMode` field + default auto; roster split; `mentionedSubagentIds` delegation input; `MANUAL_ONLY` outcome; affected c3-210 + subagent-settings component.

- [ ] **Step 2: Update c3-210 Contract**

Add the `delegateRun` input note (`mentionedSubagentIds` gates manual) and `MANUAL_ONLY` outcome to the c3-210 Contract section via `c3x write c3-210 --section Contract --file <updated>.md`.

- [ ] **Step 3: Mark ADR implemented + check**

```bash
C3X_MODE=agent bash <c3-skill>/bin/c3x.sh set adr-20260617-subagent-trigger-mode status accepted
C3X_MODE=agent bash <c3-skill>/bin/c3x.sh set adr-20260617-subagent-trigger-mode status implemented
C3X_MODE=agent bash <c3-skill>/bin/c3x.sh check --only c3-210
```

Expected: no issues.

- [ ] **Step 4: Full repo verify**

Run: `bun test && bun run lint`
Expected: all pass, 0 lint warnings.

- [ ] **Step 5: Commit + PR**

```bash
git add .c3/
git commit -m "docs(c3): ADR + c3-210 contract for subagent triggerMode"
git push -u origin feat/subagent-trigger-mode
gh pr create --repo cuongtranba/kanna --base main --head feat/subagent-trigger-mode \
  --title "feat(subagent): per-subagent trigger mode (auto/manual)" --body "<summary + test plan>"
```

---

## Self-Review

- **Spec coverage:** triggerMode type (T1), persistence default auto (T2), roster split (T3), hard MANUAL_ONLY block (T4), mention threading (T5+T6), error surface (T1 code + T7 badge), UI (T8), C3 (T9). All spec sections mapped.
- **Type consistency:** `SubagentTriggerMode`, `triggerMode`, `mentionedSubagentIds`, `getMentionedSubagentIds`, `MANUAL_ONLY` used identically across tasks.
- **Sub-spawn safety:** Task 6 sets subagent-context `getMentionedSubagentIds: () => []` — manual not sub-delegatable, per spec.
- **No placeholders:** the three "mirror existing harness" steps (T6, T8 tests) point at a concrete existing test to copy; acceptable since the harness is large and project-specific.
