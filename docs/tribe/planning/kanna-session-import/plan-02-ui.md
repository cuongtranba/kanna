# PR B — Import Dialog (WS-UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's bare "import all?" confirm with a dialog that accepts pasted session id(s) and navigates to the imported chat; empty input keeps Import-all unchanged.

**Architecture:** New `ImportSessionsDialog` component owned by `KannaSidebar`; splits pasted text via shared `extractSessionIds`; calls the new `importClaudeSession(sessionIds)` hook (PR A) or the existing `importClaudeSessions()` bulk hook; App-level callback navigates to the first resulting chatId via react-router.

**Tech Stack:** React 19 + TypeScript, kanna-react-style conventions, bun test with `@testing-library/react` (follow the colocated component-test pattern used by neighboring components in `src/client/components/`).

## Global Constraints

- Depends on PR A merged (`sessions.importClaudeSession`, `extractSessionIds`, `ImportSessionsByIdsResult` in `src/shared/protocol.ts`).
- Follow the `kanna-react-style` skill (invoke it before editing): component shape, project-Tooltip-over-title, colocated tests, stable refs.
- WALL: bulk import path (`importClaudeSessions()` + result alert in `App.tsx:278-299`) keeps identical behavior when the input is empty.
- Mobile: the import affordance stays visible on mobile (regression guard for adr-20260420-import-button-mobile-visible).
- `bun run test` + `bun run lint` green; no agent co-author in commits; PR targets `cuongtranba/kanna`.

---

### Task 1: `ImportSessionsDialog` component

**Files:**
- Create: `src/client/components/ImportSessionsDialog.tsx`
- Test: `src/client/components/ImportSessionsDialog.test.tsx`

**Interfaces:**
- Consumes: `extractSessionIds` from `src/shared/claude-session-id`.
- Produces (Task 2 consumes):

```tsx
export interface ImportSessionsDialogProps {
  open: boolean
  busy: boolean
  onClose: () => void
  onImportAll: () => void
  onImportSessions: (sessionIds: string[]) => void
}
export function ImportSessionsDialog(props: ImportSessionsDialogProps): React.JSX.Element | null
```

- [ ] **Step 1: Write the failing test**

```tsx
// src/client/components/ImportSessionsDialog.test.tsx
import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ImportSessionsDialog } from "./ImportSessionsDialog"

const ID = "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"

function renderDialog(overrides: Partial<Parameters<typeof ImportSessionsDialog>[0]> = {}) {
  const onImportAll = mock(() => {})
  const onImportSessions = mock((_ids: string[]) => {})
  render(
    <ImportSessionsDialog
      open busy={false} onClose={() => {}}
      onImportAll={onImportAll} onImportSessions={onImportSessions}
      {...overrides}
    />,
  )
  return { onImportAll, onImportSessions }
}

describe("ImportSessionsDialog", () => {
  test("empty input: Import session disabled, Import all fires bulk", () => {
    const { onImportAll } = renderDialog()
    expect(screen.getByRole("button", { name: /import sessions?$/i })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /import all/i }))
    expect(onImportAll).toHaveBeenCalledTimes(1)
  })
  test("pasted path + uuid list: extracts ids and fires onImportSessions", () => {
    const { onImportSessions } = renderDialog()
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: `/x/y/${ID}.jsonl\n00000000-0000-4000-8000-000000000000` },
    })
    fireEvent.click(screen.getByRole("button", { name: /import sessions?$/i }))
    expect(onImportSessions).toHaveBeenCalledWith([ID, "00000000-0000-4000-8000-000000000000"])
  })
  test("garbage input shows inline validation, no call", () => {
    const { onImportSessions } = renderDialog()
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "not-a-uuid" } })
    expect(screen.getByText(/no valid session id/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /import sessions?$/i })).toBeDisabled()
    expect(onImportSessions).not.toHaveBeenCalled()
  })
  test("busy disables all action buttons", () => {
    renderDialog({ busy: true })
    expect(screen.getByRole("button", { name: /import all/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run to verify fail** — `bun test --conditions production src/client/components/ImportSessionsDialog.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement.** Build with the same dialog primitives neighboring modals use (check `src/client/components/NewProjectModal.tsx` for the house pattern — overlay, card, header, footer buttons). Core logic:

```tsx
const [text, setText] = useState("")
const ids = useMemo(() => extractSessionIds(text), [text])
const hasText = text.trim().length > 0
const invalid = hasText && ids.length === 0
// textarea placeholder: "Paste one or more session ids (uuid, filename, or full path)…"
// helper copy under the field: "Empty input imports ALL sessions (full scan). Active sessions
// import as a live view — sending a message there takes over the session."
// footer: [Import N session(s)] disabled when ids.length===0 || busy
//         [Import all] disabled when busy   [Cancel]
```

Reset `text` when `open` flips false→true (so a reopened dialog starts clean).

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit** — `git commit -m "feat(client): import-sessions dialog with pasted session ids"`

### Task 2: Wire dialog into sidebar + navigation

**Files:**
- Modify: `src/client/app/KannaSidebar.tsx` (`handleImport` at ~460 and the button at ~580)
- Modify: `src/client/app/App.tsx` (handler block at ~278)
- Modify: `src/client/app/useKannaState.ts` (only if PR A's `importClaudeSession` export needs surfacing in the state object)

**Interfaces:**
- Consumes: `importClaudeSession(sessionIds)` (PR A), `ImportSessionsDialog` (Task 1), react-router `useNavigate` (chat route is `/chat/<chatId>` — same shape c3-224's chat links use).
- Produces: `onImportClaudeSessionIds(sessionIds: string[]): Promise<void>` prop threaded App → Sidebar.

- [ ] **Step 1: Replace the confirm with the dialog.** In `KannaSidebar.tsx`: add `const [importOpen, setImportOpen] = useState(false)`; the header button now `setImportOpen(true)` (keep `isImporting` to drive `busy`). Render `<ImportSessionsDialog open={importOpen} busy={isImporting} onClose={...} onImportAll={...} onImportSessions={...} />`. `onImportAll` = existing `onImportClaudeSessions()` flow (unchanged semantics — the dialog itself now carries the "scans everything" copy, so drop the old `dialog.confirm`); `onImportSessions` = new `onImportClaudeSessionIds` prop.

- [ ] **Step 2: App-level handler with navigation.** In `App.tsx` next to `handleImportClaudeSessions`:

```tsx
const navigate = useNavigate() // if not already present in this component
const handleImportClaudeSessionIds = useCallback(async (sessionIds: string[]) => {
  try {
    const result = await importClaudeSession(sessionIds)
    const firstChat = result.results.find((r) => r.chatId)
    const failures = result.results.filter((r) => r.status === "failed")
    if (failures.length > 0) {
      await dialog.alert({
        title: firstChat ? "Imported with errors" : "Import failed",
        description: failures.map((f) => `${f.sessionId}: ${f.error}`).join("\n"),
      })
    }
    if (firstChat?.chatId) navigate(`/chat/${firstChat.chatId}`)
  } catch (error) {
    console.error("[kanna/import] failed", error)
    await dialog.alert({ title: "Import failed", description: "See console for details." })
  }
}, [dialog, importClaudeSession, navigate])
```

Thread as `onImportClaudeSessionIds` down to `KannaSidebar` beside `onImportClaudeSessions`.

- [ ] **Step 3: Gates.** `bun run test && bun run lint`; manually smoke via the `run` skill: open dialog, paste a real uuid from `~/.claude/projects/-Users-home-repos-kanna/`, confirm navigation; click Import all with empty input, confirm the old result alert appears.

- [ ] **Step 4: Screenshots** for the PR (dialog closed/open, error state) — save under the PR body, not the repo.

- [ ] **Step 5: Commit + PR**

```bash
git add -A && git commit -m "feat(client): paste session ids in import dialog, navigate to imported chat"
gh pr create --repo cuongtranba/kanna --base main --title "feat: import dialog with paste-a-session-id" --body "..."
```

## Self-review checklist

- [ ] Empty-input path calls the SAME `onImportClaudeSessions` as before (bulk alert intact).
- [ ] Import button still visible on mobile viewport.
- [ ] No inline `?? []` selector patterns introduced (render-loop rule).
- [ ] Dialog copy warns about active-session takeover (SPEC §2).
