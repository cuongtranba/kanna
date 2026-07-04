# Preview-File Feature — Visual Evidence Manifest

Captured: 2026-07-04  
Branch: `feat/preview-file-in-chat` (worktree: `.worktrees/preview-file-in-chat`)  
Viewport: 390 × 844 (iPhone SE / mobile)

---

## Screenshot Table

| # | File | Case | What It Proves | Result |
|---|------|------|----------------|--------|
| 01 | `01-transcript-cards.png` | Transcript with 6 preview cards + bash cards | Cards render inline (not collapsed into N-tool-call group); Bash calls between them prove non-collapse | PASS |
| 02 | `02-sheet-markdown.png` | Click `spec.md` preview card | `FilePreviewSheet` opens; `MarkdownBody` renders (extension `.md` → classified as markdown) | PASS |
| 03 | `03-sheet-mermaid.png` | Click `flow.mmd` preview card | `MermaidBody` renders the Mermaid diagram SVG (extension `.mmd` → classified as mermaid) | PASS |
| 04 | `04-sheet-code.png` | Click `main.ts` preview card | `CodeBody` renders syntax-highlighted TypeScript (extension `.ts` → classified as code) | PASS |
| 05 | `05-sheet-csv.png` | Click `data.csv` preview card | `TableBody` renders CSV as a table (extension `.csv` → classified as table) | PASS |
| 06 | `06-sheet-json.png` | Click `config.json` preview card | `JsonBody` renders formatted JSON (extension `.json` → classified as json) | PASS |
| 07 | `07-sheet-image.png` | Click `logo.png` preview card | `ImageBody` renders the PNG image (extension `.png` → classified as image) | PASS |
| 08 | `08-footer-share-only.png` | Footer of a `preview_file` sheet (logo.png) | Footer shows **Share only** — no Download button; `preview_file` origin does not grant download | PASS |
| 09 | `09-offer-download-regression.png` | Click `report.md` offer_download card | `FilePreviewSheet` opens with **both Share AND Download** buttons; `offer_download` origin grants download | PASS |

---

## Key Findings

- `displayName` in the tool result payload **must include the file extension** (e.g. `"spec.md"` not `"Project Spec"`). `classifyAttachmentIcon` in `attachmentPreview.ts` calls `getFileExtension(attachment.displayName)` — extension determines which body component is used, not `mimeType`.
- `preview_file` sheets show **Share only** in the footer; `offer_download` sheets show **Share + Download**.
- `.zip` files via `offer_download` render as a direct `<a href>` download link (not a sheet). To test the offer_download sheet path use a previewable type like `.md`.
- Preview cards do **not** collapse into N-tool-call group even when interleaved with Bash calls.

---

## Server Boot Command

```bash
# Data dir: throwaway, no ~/.kanna-dev pollution
export KANNA_HOME=/tmp/kanna-evidence-home
export KANNA_RUNTIME_PROFILE=dev
cd /Users/home/repos/kanna/.worktrees/preview-file-in-chat

# Build + start (Vite dev on :3219, API on :3220)
bun run dev &
```

Wait ~5 s for both servers ready, then inject.

---

## Demo Project Files

Created at `/tmp/kanna-evidence-project/`:

| File | Content |
|------|---------|
| `spec.md` | Markdown spec with headings, bullets, code block |
| `flow.mmd` | Mermaid flowchart (`graph TD` with 5 nodes) |
| `main.ts` | TypeScript module with a class and async function |
| `data.csv` | CSV with 5 employee rows (Name, Department, Salary, Notes) |
| `config.json` | JSON config with server + feature flags |
| `logo.png` | Kanna logo PNG (copied from `public/`) |
| `report.md` | Markdown used for `offer_download` regression test |

---

## Injection Script

The server must be **stopped** before injection. The script reads and patches
`snapshot.json` directly, then writes the transcript JSONL file.

```typescript
/**
 * Direct snapshot injection — writes project/chat to snapshot.json and
 * creates the transcript file directly. Run while server is STOPPED.
 *
 * Usage: bun run /tmp/inject-snapshot.ts
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import { join } from "node:path"
import crypto from "node:crypto"

const DATA_DIR = "/tmp/kanna-evidence-home/data"
const PROJECT_DIR = "/tmp/kanna-evidence-project"
const SNAPSHOT_PATH = join(DATA_DIR, "snapshot.json")
const TRANSCRIPTS_DIR = join(DATA_DIR, "transcripts")

function uid() { return crypto.randomUUID() }
function toolId() { return `toolu_01${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}` }

const NOW = Date.now()
const PROJECT_ID = "evidence-" + uid()
const CHAT_ID = uid()

// Patch snapshot.json
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"))
snapshot.projects.push({ id: PROJECT_ID, localPath: PROJECT_DIR, title: "Evidence Project", createdAt: NOW, updatedAt: NOW })
snapshot.chats.push({ id: CHAT_ID, projectId: PROJECT_ID, title: "Preview File Feature", createdAt: NOW, updatedAt: NOW, unread: false, provider: null, planMode: false, sessionToken: null, sourceHash: null, lastTurnOutcome: null })
snapshot.generatedAt = NOW
writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf8")

// Write transcript JSONL
// CRITICAL: displayName must include file extension for classifyAttachmentIcon
function makePreviewFilePair(filePath: string, mimeType: string): object[] {
  const tid = toolId()
  const fileName = filePath.split("/").at(-1)!
  const relativePath = filePath.replace(PROJECT_DIR + "/", "")
  const size = (() => { try { return statSync(filePath).size } catch { return 0 } })()
  const call = {
    _id: uid(), createdAt: NOW, kind: "tool_call",
    tool: { kind: "tool", toolKind: "preview_file", toolName: "mcp__kanna__preview_file", toolId: tid, input: { path: filePath } },
  }
  const result = {
    _id: uid(), createdAt: NOW + 1, kind: "tool_result", toolId: tid, isError: false,
    content: JSON.stringify({ contentUrl: `/api/local-file?path=${encodeURIComponent(filePath)}`, relativePath, fileName, displayName: fileName, size, mimeType }),
  }
  return [call, result]
}

const entries: object[] = [
  { _id: uid(), createdAt: NOW, kind: "user_prompt", content: "Show me the project files." },
  { _id: uid(), createdAt: NOW + 10, kind: "assistant_text", text: "I'll preview all the project files for you." },
  ...makePreviewFilePair(`${PROJECT_DIR}/spec.md`, "text/markdown"),
  // ... (bash call, more preview pairs, offer_download pair)
  { _id: uid(), createdAt: NOW + 100, kind: "result", subtype: "success", isError: false, durationMs: 3200, result: "Done.", costUsd: 0.012 },
]

mkdirSync(TRANSCRIPTS_DIR, { recursive: true })
writeFileSync(join(TRANSCRIPTS_DIR, `${CHAT_ID}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8")
console.log(`URL: http://localhost:3219/chats/${CHAT_ID}`)
```

Full script at `/tmp/inject-snapshot.ts`.

---

## Navigation Note

At 390 px mobile viewport, direct URL navigation (`/chats/<id>`) renders a
blank React root. Always navigate from the home page (`/`) via the sidebar
chat list — the app loads correctly through that route.
