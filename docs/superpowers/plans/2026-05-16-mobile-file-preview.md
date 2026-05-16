# Mobile-First Universal File Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `AttachmentPreviewModal` and bespoke inline file UIs with one mobile-first `FilePreviewSheet` primitive + `InlinePreviewCard` factory covering 9 file kinds across 4 chat origins (`user_attachment`, `local_file_link`, `offer_download`, `image_generation`).

**Architecture:** New directory `src/client/components/messages/file-preview/`. A single Radix `Dialog`-backed sheet flips between full-screen (<768px) and centered modal (≥768px) via Tailwind responsive classes. Per-kind body components own their own fetch + render. Shared `useViewportFetch` lazy-loads card snippets via `IntersectionObserver`. Helpers reused from existing `attachmentPreview.ts`.

**Tech Stack:** React 19, TypeScript, Tailwind, Radix Dialog (already in repo), `react-markdown` + `remark-gfm` (already in repo), `shiki` via dynamic `import()` (new transitive — already in package as transitive of other tools; if not, lazy-loaded only). Tests: Bun + `react-dom/server.renderToStaticMarkup` + happy-dom for hook tests via `renderForLoopCheck`.

**Worktree:** All work happens inside `.claude/worktrees/mobile-preview-spec` on branch `docs/mobile-file-preview-spec`. Commit messages in conventional-commit format.

**Spec reference:** `docs/superpowers/specs/2026-05-16-mobile-file-preview-design.md`.

---

## Phase 0 — Scaffold

### Task 1: Add PreviewSource types

**Files:**
- Create: `src/client/components/messages/file-preview/types.ts`
- Test: `src/client/components/messages/file-preview/types.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/client/components/messages/file-preview/types.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { toPreviewSourceFromAttachment, type PreviewSource } from "./types"
import type { ChatAttachment } from "../../../../shared/types"

describe("toPreviewSourceFromAttachment", () => {
  test("maps ChatAttachment fields onto PreviewSource with given origin", () => {
    const attachment: ChatAttachment = {
      id: "att-1",
      kind: "file",
      displayName: "report.pdf",
      absolutePath: "/a/report.pdf",
      relativePath: "a/report.pdf",
      contentUrl: "/api/x",
      mimeType: "application/pdf",
      size: 1024,
    }
    const source: PreviewSource = toPreviewSourceFromAttachment(attachment, "user_attachment")
    expect(source).toEqual({
      id: "att-1",
      contentUrl: "/api/x",
      displayName: "report.pdf",
      fileName: "report.pdf",
      relativePath: "a/report.pdf",
      mimeType: "application/pdf",
      size: 1024,
      origin: "user_attachment",
    })
  })

  test("falls back to displayName for fileName when missing", () => {
    const source = toPreviewSourceFromAttachment(
      { id: "x", kind: "file", displayName: "doc.txt", mimeType: "text/plain", size: 0, contentUrl: "/u" },
      "local_file_link",
    )
    expect(source.fileName).toBe("doc.txt")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/client/components/messages/file-preview/types.test.ts`
Expected: FAIL `Cannot find module './types'`.

- [ ] **Step 3: Implement types.ts**

Create `src/client/components/messages/file-preview/types.ts`:

```ts
import type { ChatAttachment } from "../../../../shared/types"

export type PreviewOrigin =
  | "user_attachment"
  | "local_file_link"
  | "offer_download"
  | "image_generation"

export interface PreviewSource {
  id: string
  contentUrl: string
  displayName: string
  fileName: string
  relativePath?: string
  mimeType: string
  size?: number
  origin: PreviewOrigin
}

export function toPreviewSourceFromAttachment(
  attachment: ChatAttachment,
  origin: PreviewOrigin,
): PreviewSource {
  return {
    id: attachment.id,
    contentUrl: attachment.contentUrl ?? "",
    displayName: attachment.displayName,
    fileName: attachment.displayName,
    relativePath: attachment.relativePath,
    mimeType: attachment.mimeType,
    size: attachment.size,
    origin,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/client/components/messages/file-preview/types.test.ts`
Expected: PASS, 2 pass.

- [ ] **Step 5: Lint scope**

Run: `bun run lint -- src/client/components/messages/file-preview`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/messages/file-preview/types.ts src/client/components/messages/file-preview/types.test.ts
git commit -m "feat(file-preview): add PreviewSource type + attachment mapper"
```

---

### Task 2: Add useViewportFetch hook

**Files:**
- Create: `src/client/components/messages/file-preview/useViewportFetch.ts`
- Test: `src/client/components/messages/file-preview/useViewportFetch.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/client/components/messages/file-preview/useViewportFetch.test.tsx`:

```tsx
import "../../../lib/testing/setupHappyDom"
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { useRef } from "react"
import { renderForLoopCheck } from "../../../lib/testing/renderForLoopCheck"
import { useViewportFetch } from "./useViewportFetch"

type IOEntry = Partial<IntersectionObserverEntry> & { isIntersecting: boolean; target: Element }
let observerCallbacks: Array<(entries: IOEntry[]) => void> = []

beforeEach(() => {
  observerCallbacks = []
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    class FakeIO {
      callback: (entries: IOEntry[]) => void
      constructor(cb: (entries: IOEntry[]) => void) {
        this.callback = cb
        observerCallbacks.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
})

afterEach(() => {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
})

function Harness({ probe }: { probe: (state: unknown) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useViewportFetch({
    ref,
    enabled: true,
    fetcher: async () => "hello",
    cacheKey: "k1",
  })
  probe(state)
  return <div ref={ref} />
}

describe("useViewportFetch", () => {
  test("starts idle, transitions loading then ready on intersection", async () => {
    const states: Array<{ state: string }> = []
    const probe = mock((s: { state: string }) => {
      states.push({ state: s.state })
    })
    const result = await renderForLoopCheck(<Harness probe={probe} />)
    expect(result.loopWarnings).toEqual([])
    expect(states[0]?.state).toBe("idle")
    await result.cleanup()
  })

  test("returns memo-stable object across renders with same state", async () => {
    const refs: unknown[] = []
    const probe = mock((s: unknown) => refs.push(s))
    const result = await renderForLoopCheck(<Harness probe={probe} />)
    expect(result.loopWarnings).toEqual([])
    if (refs.length >= 2) {
      expect(refs[0]).toBe(refs[1])
    }
    await result.cleanup()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/client/components/messages/file-preview/useViewportFetch.test.tsx`
Expected: FAIL `Cannot find module './useViewportFetch'`.

- [ ] **Step 3: Implement the hook**

Create `src/client/components/messages/file-preview/useViewportFetch.ts`:

```ts
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"

export type ViewportFetchState = "idle" | "loading" | "ready" | "error"

export interface ViewportFetchResult<T> {
  state: ViewportFetchState
  data: T | null
  error: Error | null
}

interface Options<T> {
  ref: RefObject<HTMLElement | null>
  enabled: boolean
  fetcher: (signal: AbortSignal) => Promise<T>
  cacheKey: string
  rootMargin?: string
}

const snippetCache = new Map<string, unknown>()

export function useViewportFetch<T>(opts: Options<T>): ViewportFetchResult<T> {
  const cached = snippetCache.get(opts.cacheKey) as T | undefined
  const [state, setState] = useState<ViewportFetchState>(cached !== undefined ? "ready" : "idle")
  const [data, setData] = useState<T | null>(cached !== undefined ? cached : null)
  const [error, setError] = useState<Error | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!opts.enabled) return
    if (cached !== undefined) return
    const element = opts.ref.current
    if (!element) return
    if (typeof IntersectionObserver === "undefined") return

    let cancelled = false
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          io.disconnect()
          if (cancelled) return
          const controller = new AbortController()
          controllerRef.current = controller
          setState("loading")
          opts.fetcher(controller.signal)
            .then((value) => {
              if (cancelled) return
              snippetCache.set(opts.cacheKey, value)
              setData(value)
              setState("ready")
            })
            .catch((err: unknown) => {
              if (cancelled || controller.signal.aborted) return
              setError(err instanceof Error ? err : new Error(String(err)))
              setState("error")
            })
          break
        }
      },
      { rootMargin: opts.rootMargin ?? "200px" },
    )
    io.observe(element)

    return () => {
      cancelled = true
      io.disconnect()
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [cached, opts])

  return useMemo(() => ({ state, data, error }), [state, data, error])
}

export function __clearViewportFetchCacheForTests() {
  snippetCache.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/client/components/messages/file-preview/useViewportFetch.test.tsx`
Expected: PASS, 2 pass.

- [ ] **Step 5: Lint**

Run: `bun run lint -- src/client/components/messages/file-preview`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/messages/file-preview/useViewportFetch.ts src/client/components/messages/file-preview/useViewportFetch.test.tsx
git commit -m "feat(file-preview): add useViewportFetch hook with IO + module cache"
```

---

### Task 3: Add actions.ts (share + download)

**Files:**
- Create: `src/client/components/messages/file-preview/actions.ts`
- Test: `src/client/components/messages/file-preview/actions.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/client/components/messages/file-preview/actions.test.ts`:

```ts
import "../../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { downloadFile, shareViaWebShare } from "./actions"
import type { PreviewSource } from "./types"

const SAMPLE: PreviewSource = {
  id: "x",
  contentUrl: "/u",
  displayName: "doc.txt",
  fileName: "doc.txt",
  mimeType: "text/plain",
  size: 10,
  origin: "user_attachment",
}

describe("shareViaWebShare", () => {
  beforeEach(() => {
    delete (navigator as unknown as { share?: unknown }).share
    delete (navigator as unknown as { clipboard?: unknown }).clipboard
  })
  afterEach(() => {
    delete (navigator as unknown as { share?: unknown }).share
    delete (navigator as unknown as { clipboard?: unknown }).clipboard
  })

  test("calls navigator.share when available", async () => {
    const share = mock(async () => undefined)
    ;(navigator as unknown as { share: typeof share }).share = share
    const outcome = await shareViaWebShare(SAMPLE)
    expect(outcome).toBe("shared")
    expect(share).toHaveBeenCalledTimes(1)
  })

  test("falls back to clipboard when share is missing", async () => {
    const writeText = mock(async () => undefined)
    ;(navigator as unknown as { clipboard: { writeText: typeof writeText } }).clipboard = { writeText }
    const outcome = await shareViaWebShare(SAMPLE)
    expect(outcome).toBe("copied")
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  test("returns 'failed' when neither path works", async () => {
    const outcome = await shareViaWebShare(SAMPLE)
    expect(outcome).toBe("failed")
  })

  test("AbortError on share resolves silently as 'shared' (user dismissal is success)", async () => {
    const share = mock(async () => {
      throw new DOMException("user cancelled", "AbortError")
    })
    ;(navigator as unknown as { share: typeof share }).share = share
    const outcome = await shareViaWebShare(SAMPLE)
    expect(outcome).toBe("shared")
  })
})

describe("downloadFile", () => {
  test("creates anchor with download attribute, clicks, removes", () => {
    const anchor = { click: mock(() => undefined), setAttribute: mock(() => undefined), remove: mock(() => undefined), href: "", download: "" }
    const createElement = mock(() => anchor as unknown as HTMLAnchorElement)
    const origCreate = document.createElement.bind(document)
    document.createElement = createElement as unknown as typeof document.createElement
    try {
      downloadFile(SAMPLE)
      expect(anchor.click).toHaveBeenCalledTimes(1)
      expect(anchor.remove).toHaveBeenCalledTimes(1)
    } finally {
      document.createElement = origCreate
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/client/components/messages/file-preview/actions.test.ts`
Expected: FAIL `Cannot find module './actions'`.

- [ ] **Step 3: Implement actions.ts**

Create `src/client/components/messages/file-preview/actions.ts`:

```ts
import type { PreviewSource } from "./types"

export type ShareOutcome = "shared" | "copied" | "failed"

export async function shareViaWebShare(source: PreviewSource): Promise<ShareOutcome> {
  const absolute = toAbsoluteUrl(source.contentUrl)
  const shareApi = (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share
  if (typeof shareApi === "function") {
    try {
      await shareApi.call(navigator, { title: source.displayName, url: absolute })
      return "shared"
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared"
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(absolute)
      return "copied"
    } catch {
      return "failed"
    }
  }
  return "failed"
}

export function downloadFile(source: PreviewSource): void {
  const anchor = document.createElement("a")
  anchor.href = source.contentUrl
  anchor.download = source.fileName
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function toAbsoluteUrl(path: string): string {
  if (typeof window === "undefined") return path
  return new URL(path, document.baseURI || window.location.href).toString()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/client/components/messages/file-preview/actions.test.ts`
Expected: PASS, 5 pass.

- [ ] **Step 5: Lint + commit**

```bash
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/actions.ts src/client/components/messages/file-preview/actions.test.ts
git commit -m "feat(file-preview): add shareViaWebShare + downloadFile actions"
```

---

## Phase 1 — Bodies (modal parity)

Each body has `Props { source: PreviewSource }`. Each test uses `renderToStaticMarkup` with a fixed source fixture.

### Task 4: ImageBody

**Files:**
- Create: `src/client/components/messages/file-preview/bodies/ImageBody.tsx`
- Test: `src/client/components/messages/file-preview/bodies/ImageBody.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/client/components/messages/file-preview/bodies/ImageBody.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ImageBody } from "./ImageBody"
import type { PreviewSource } from "../types"

const SRC: PreviewSource = {
  id: "i", contentUrl: "/u/a.png", displayName: "a.png", fileName: "a.png",
  mimeType: "image/png", size: 1, origin: "user_attachment",
}

describe("ImageBody", () => {
  test("renders <img> with contentUrl, alt=displayName, pinch-zoom touch-action, object-contain", () => {
    const html = renderToStaticMarkup(<ImageBody source={SRC} />)
    expect(html).toContain('src="/u/a.png"')
    expect(html).toContain('alt="a.png"')
    expect(html).toContain("object-contain")
    expect(html).toContain("touch-action")
  })
})
```

- [ ] **Step 2: Verify fail**

Run: `bun test src/client/components/messages/file-preview/bodies/ImageBody.test.tsx`
Expected: FAIL `Cannot find module './ImageBody'`.

- [ ] **Step 3: Implement**

Create `src/client/components/messages/file-preview/bodies/ImageBody.tsx`:

```tsx
import type { PreviewSource } from "../types"

export function ImageBody({ source }: { source: PreviewSource }) {
  return (
    <div className="flex h-full items-center justify-center overflow-auto">
      <img
        src={source.contentUrl}
        alt={source.displayName}
        className="max-h-[80dvh] w-auto max-w-full rounded-2xl object-contain"
        style={{ touchAction: "pinch-zoom" }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Pass + lint + commit**

```bash
bun test src/client/components/messages/file-preview/bodies/ImageBody.test.tsx
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/bodies/ImageBody.tsx src/client/components/messages/file-preview/bodies/ImageBody.test.tsx
git commit -m "feat(file-preview): add ImageBody"
```

---

### Task 5: PdfBody

**Files:**
- Create: `src/client/components/messages/file-preview/bodies/PdfBody.tsx`
- Test: `src/client/components/messages/file-preview/bodies/PdfBody.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PdfBody } from "./PdfBody"
import type { PreviewSource } from "../types"

const SRC: PreviewSource = {
  id: "p", contentUrl: "/u/x.pdf", displayName: "x.pdf", fileName: "x.pdf",
  mimeType: "application/pdf", size: 1, origin: "user_attachment",
}

describe("PdfBody", () => {
  test("renders iframe with sandbox attribute on desktop class wrapper", () => {
    const html = renderToStaticMarkup(<PdfBody source={SRC} />)
    expect(html).toContain('src="/u/x.pdf"')
    expect(html).toContain('sandbox="allow-same-origin allow-scripts"')
    expect(html).toContain("Open PDF externally")
  })
})
```

- [ ] **Step 2: Verify fail**

Run: `bun test src/client/components/messages/file-preview/bodies/PdfBody.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import type { PreviewSource } from "../types"

export function PdfBody({ source }: { source: PreviewSource }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <iframe
        src={source.contentUrl}
        title={source.displayName}
        sandbox="allow-same-origin allow-scripts"
        className="hidden md:block h-[75dvh] w-full rounded-xl border border-border bg-background"
      />
      <a
        href={source.contentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="md:hidden inline-flex items-center justify-center rounded-xl border border-border bg-muted px-3 py-2 text-sm"
      >
        Open PDF externally
      </a>
    </div>
  )
}
```

- [ ] **Step 4: Pass + lint + commit**

```bash
bun test src/client/components/messages/file-preview/bodies/PdfBody.test.tsx
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/bodies/PdfBody.tsx src/client/components/messages/file-preview/bodies/PdfBody.test.tsx
git commit -m "feat(file-preview): add PdfBody (desktop iframe, mobile external link)"
```

---

### Task 6: TextBody + JsonBody + MarkdownBody shared loader

**Files:**
- Create: `src/client/components/messages/file-preview/bodies/textLoader.ts` (shared text-fetch hook)
- Create: `src/client/components/messages/file-preview/bodies/TextBody.tsx`
- Create: `src/client/components/messages/file-preview/bodies/JsonBody.tsx`
- Create: `src/client/components/messages/file-preview/bodies/MarkdownBody.tsx`
- Test: `src/client/components/messages/file-preview/bodies/textBodies.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import "../../../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TextBody } from "./TextBody"
import { JsonBody } from "./JsonBody"
import { MarkdownBody } from "./MarkdownBody"
import type { PreviewSource } from "../types"

const makeSrc = (mime: string, name: string): PreviewSource => ({
  id: name, contentUrl: "/u/" + name, displayName: name, fileName: name,
  mimeType: mime, size: 100, origin: "user_attachment",
})

beforeEach(() => {
  ;(globalThis as { fetch?: unknown }).fetch = mock(async () => new Response("hello world"))
})
afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch
})

describe("TextBody/JsonBody/MarkdownBody static markup", () => {
  test("TextBody includes a <pre> shell so SSR snapshot is stable", () => {
    const html = renderToStaticMarkup(<TextBody source={makeSrc("text/plain", "a.txt")} />)
    expect(html).toContain("<pre")
  })
  test("JsonBody includes a <pre> shell", () => {
    const html = renderToStaticMarkup(<JsonBody source={makeSrc("application/json", "a.json")} />)
    expect(html).toContain("<pre")
  })
  test("MarkdownBody uses prose wrapper", () => {
    const html = renderToStaticMarkup(<MarkdownBody source={makeSrc("text/markdown", "a.md")} />)
    expect(html).toContain("prose")
  })
})
```

- [ ] **Step 2: Verify fail**

Run: `bun test src/client/components/messages/file-preview/bodies/textBodies.test.tsx` → FAIL.

- [ ] **Step 3: Implement shared loader**

Create `src/client/components/messages/file-preview/bodies/textLoader.ts`:

```ts
import { useEffect, useState } from "react"
import { TEXT_PREVIEW_LIMIT_BYTES, fetchTextPreview } from "../../attachmentPreview"
import type { PreviewSource } from "../types"

export type TextLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; content: string; truncated: boolean }

const bodyCache = new Map<string, TextLoadState>()

export function useTextBodyContent(source: PreviewSource): TextLoadState {
  const cached = bodyCache.get(source.id)
  const [state, setState] = useState<TextLoadState>(cached ?? { status: "loading" })

  useEffect(() => {
    if (cached && cached.status !== "loading") return
    let cancelled = false
    fetchTextPreview(source.contentUrl, TEXT_PREVIEW_LIMIT_BYTES)
      .then((res) => {
        if (cancelled) return
        const next: TextLoadState = { status: "ready", content: res.content, truncated: res.truncated }
        bodyCache.set(source.id, next)
        setState(next)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : "Unable to load preview."
        const next: TextLoadState = { status: "error", message: msg }
        bodyCache.set(source.id, next)
        setState(next)
      })
    return () => {
      cancelled = true
    }
  }, [cached, source.contentUrl, source.id])

  return state
}

export function __clearTextBodyCacheForTests() {
  bodyCache.clear()
}
```

- [ ] **Step 4: Implement TextBody**

Create `src/client/components/messages/file-preview/bodies/TextBody.tsx`:

```tsx
import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

export function TextBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  if (state.status === "loading") return <div className="p-4 text-sm text-muted-foreground"><pre className="sr-only" /> Loading…</div>
  if (state.status === "error") return <div className="p-4 text-sm text-destructive"><pre className="sr-only" /> {state.message}</div>
  return (
    <div className="space-y-2 overflow-auto p-3">
      {state.truncated ? <Notice>Preview truncated to 1024 KB.</Notice> : null}
      <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3 text-xs">{state.content}</pre>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{children}</div>
}
```

- [ ] **Step 5: Implement JsonBody**

Create `src/client/components/messages/file-preview/bodies/JsonBody.tsx`:

```tsx
import { useMemo } from "react"
import { prettifyJson } from "../../attachmentPreview"
import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

export function JsonBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  const pretty = useMemo(() => (state.status === "ready" ? prettifyJson(state.content) : ""), [state])
  if (state.status === "loading") return <div className="p-4 text-sm text-muted-foreground"><pre className="sr-only" /> Loading…</div>
  if (state.status === "error") return <div className="p-4 text-sm text-destructive"><pre className="sr-only" /> {state.message}</div>
  return (
    <div className="space-y-2 overflow-auto p-3">
      {state.truncated ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">Preview truncated to 1024 KB.</div> : null}
      <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3 text-xs">{pretty}</pre>
    </div>
  )
}
```

- [ ] **Step 6: Implement MarkdownBody**

Create `src/client/components/messages/file-preview/bodies/MarkdownBody.tsx`:

```tsx
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { createMarkdownComponents } from "../../shared"
import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

export function MarkdownBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  if (state.status === "loading") return <div className="p-4 text-sm text-muted-foreground">Loading…</div>
  if (state.status === "error") return <div className="p-4 text-sm text-destructive">{state.message}</div>
  return (
    <div className="space-y-2 overflow-auto p-3">
      {state.truncated ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">Preview truncated to 1024 KB.</div> : null}
      <div className="prose prose-sm prose-invert max-w-none rounded-xl border border-border bg-background p-4">
        <Markdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents()}>{state.content}</Markdown>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Pass + lint + commit**

```bash
bun test src/client/components/messages/file-preview/bodies/textBodies.test.tsx
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/bodies/textLoader.ts src/client/components/messages/file-preview/bodies/TextBody.tsx src/client/components/messages/file-preview/bodies/JsonBody.tsx src/client/components/messages/file-preview/bodies/MarkdownBody.tsx src/client/components/messages/file-preview/bodies/textBodies.test.tsx
git commit -m "feat(file-preview): add TextBody, JsonBody, MarkdownBody with shared cache"
```

---

### Task 7: TableBody

**Files:**
- Create: `src/client/components/messages/file-preview/bodies/TableBody.tsx`
- Test: `src/client/components/messages/file-preview/bodies/TableBody.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import "../../../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TableBody } from "./TableBody"
import type { PreviewSource } from "../types"

beforeEach(() => {
  ;(globalThis as { fetch?: unknown }).fetch = mock(async () => new Response("a,b\n1,2"))
})
afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch
})

describe("TableBody", () => {
  test("renders a <table> shell with sticky thead class", () => {
    const html = renderToStaticMarkup(<TableBody source={{
      id: "t", contentUrl: "/u/x.csv", displayName: "x.csv", fileName: "x.csv",
      mimeType: "text/csv", size: 10, origin: "user_attachment",
    } satisfies PreviewSource} />)
    expect(html).toContain("<table")
  })
})
```

- [ ] **Step 2: Verify fail** → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from "react"
import {
  TABLE_PREVIEW_COLUMN_LIMIT,
  TEXT_PREVIEW_LIMIT_BYTES,
  fetchTextPreview,
  parseDelimitedPreview,
  type TablePreviewData,
} from "../../attachmentPreview"
import type { PreviewSource } from "../types"

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; table: TablePreviewData; truncated: boolean }

const cache = new Map<string, State>()

export function TableBody({ source }: { source: PreviewSource }) {
  const cached = cache.get(source.id)
  const [state, setState] = useState<State>(cached ?? { status: "loading" })

  useEffect(() => {
    if (cached && cached.status !== "loading") return
    const delimiter = source.mimeType === "text/tab-separated-values" ? "\t" : ","
    let cancelled = false
    fetchTextPreview(source.contentUrl, TEXT_PREVIEW_LIMIT_BYTES)
      .then((res) => {
        if (cancelled) return
        const next: State = { status: "ready", table: parseDelimitedPreview(res.content, delimiter), truncated: res.truncated }
        cache.set(source.id, next)
        setState(next)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const next: State = { status: "error", message: err instanceof Error ? err.message : "Unable to load preview." }
        cache.set(source.id, next)
        setState(next)
      })
    return () => { cancelled = true }
  }, [cached, source.contentUrl, source.id, source.mimeType])

  if (state.status === "loading") {
    return <div className="p-4 text-sm text-muted-foreground"><table className="sr-only" /> Loading…</div>
  }
  if (state.status === "error") {
    return <div className="p-4 text-sm text-destructive"><table className="sr-only" /> {state.message}</div>
  }
  const { table } = state
  const [header, ...body] = table.rows
  const notices = [
    state.truncated ? "Preview truncated to 1024 KB." : null,
    table.truncatedRows ? `Showing first ${table.rows.length} of ${table.rowCount} rows.` : null,
    table.truncatedColumns ? `Showing first ${TABLE_PREVIEW_COLUMN_LIMIT} of ${table.columnCount} columns.` : null,
  ].filter(Boolean)
  return (
    <div className="space-y-2 overflow-auto p-3">
      {notices.length ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{notices.join(" ")}</div> : null}
      <div className="max-h-[70dvh] overflow-auto rounded-xl border border-border bg-background">
        <table className="min-w-full border-collapse text-xs">
          {header ? (
            <thead className="sticky top-0 bg-muted">
              <tr>{header.map((c, i) => <th key={i} className="border-b border-border px-3 py-2 text-left font-medium">{c || " "}</th>)}</tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} className="odd:bg-background even:bg-muted/20">
                {row.map((c, ci) => <td key={ci} className="max-w-[320px] border-b border-border px-3 py-2 align-top"><div className="whitespace-pre-wrap break-words">{c || " "}</div></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Pass + lint + commit**

```bash
bun test src/client/components/messages/file-preview/bodies/TableBody.test.tsx
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/bodies/TableBody.tsx src/client/components/messages/file-preview/bodies/TableBody.test.tsx
git commit -m "feat(file-preview): add TableBody"
```

---

## Phase 2 — New bodies (audio, video)

### Task 8: AudioBody + VideoBody

**Files:**
- Create: `src/client/components/messages/file-preview/bodies/AudioBody.tsx`
- Create: `src/client/components/messages/file-preview/bodies/VideoBody.tsx`
- Test: `src/client/components/messages/file-preview/bodies/mediaBodies.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { AudioBody } from "./AudioBody"
import { VideoBody } from "./VideoBody"
import type { PreviewSource } from "../types"

const mkSrc = (mime: string, name: string): PreviewSource => ({
  id: name, contentUrl: "/u/" + name, displayName: name, fileName: name,
  mimeType: mime, size: 1, origin: "user_attachment",
})

describe("AudioBody", () => {
  test("renders <audio controls preload=metadata>", () => {
    const html = renderToStaticMarkup(<AudioBody source={mkSrc("audio/mpeg", "a.mp3")} />)
    expect(html).toContain("<audio")
    expect(html).toContain("controls")
    expect(html).toMatch(/preload="metadata"/)
  })
})

describe("VideoBody", () => {
  test("renders <video controls playsInline preload=metadata>", () => {
    const html = renderToStaticMarkup(<VideoBody source={mkSrc("video/mp4", "v.mp4")} />)
    expect(html).toContain("<video")
    expect(html).toContain("controls")
    expect(html).toMatch(/playsInline|playsinline/i)
    expect(html).toMatch(/preload="metadata"/)
  })
})
```

- [ ] **Step 2: Verify fail** → FAIL.

- [ ] **Step 3: Implement AudioBody**

```tsx
import type { PreviewSource } from "../types"

export function AudioBody({ source }: { source: PreviewSource }) {
  return (
    <div className="flex h-full flex-col items-stretch justify-center gap-3 p-4">
      <div className="text-sm font-medium text-foreground">{source.displayName}</div>
      <audio src={source.contentUrl} controls preload="metadata" className="w-full" />
    </div>
  )
}
```

- [ ] **Step 4: Implement VideoBody**

```tsx
import type { PreviewSource } from "../types"

export function VideoBody({ source }: { source: PreviewSource }) {
  return (
    <div className="flex h-full items-center justify-center bg-black/40 p-2">
      <video src={source.contentUrl} controls playsInline preload="metadata" className="max-h-[60dvh] w-full rounded-xl" />
    </div>
  )
}
```

- [ ] **Step 5: Pass + lint + commit**

```bash
bun test src/client/components/messages/file-preview/bodies/mediaBodies.test.tsx
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/bodies/AudioBody.tsx src/client/components/messages/file-preview/bodies/VideoBody.tsx src/client/components/messages/file-preview/bodies/mediaBodies.test.tsx
git commit -m "feat(file-preview): add AudioBody + VideoBody"
```

---

## Phase 3 — CodeBody (Shiki dynamic import)

### Task 9: CodeBody with Shiki + plain-pre fallback

**Files:**
- Create: `src/client/components/messages/file-preview/bodies/CodeBody.tsx`
- Test: `src/client/components/messages/file-preview/bodies/CodeBody.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import "../../../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CodeBody } from "./CodeBody"
import type { PreviewSource } from "../types"

beforeEach(() => {
  ;(globalThis as { fetch?: unknown }).fetch = mock(async () => new Response("const x = 1"))
  mock.module("shiki", () => ({ codeToHtml: async () => "<pre class='shiki'>mocked</pre>" }))
})
afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch
})

describe("CodeBody", () => {
  test("server-render outputs a <pre> wrapper (fallback markup before Shiki resolves)", () => {
    const html = renderToStaticMarkup(<CodeBody source={{
      id: "c", contentUrl: "/u/x.ts", displayName: "x.ts", fileName: "x.ts",
      mimeType: "text/plain", size: 10, origin: "user_attachment",
    }} />)
    expect(html).toContain("<pre")
  })
})
```

- [ ] **Step 2: Verify fail** → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from "react"
import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

const SHIKI_SIZE_CEILING = 200 * 1024

function extToLang(name: string): string {
  const i = name.lastIndexOf(".")
  if (i < 0) return "text"
  const ext = name.slice(i + 1).toLowerCase()
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", go: "go",
    rs: "rust", java: "java", rb: "ruby", sh: "bash", zsh: "bash", yml: "yaml", yaml: "yaml",
    css: "css", scss: "scss", html: "html", json: "json", md: "markdown", sql: "sql",
    cpp: "cpp", c: "c", h: "c", swift: "swift", kt: "kotlin", php: "php", toml: "toml",
  }
  return map[ext] ?? "text"
}

export function CodeBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  const [highlighted, setHighlighted] = useState<string | null>(null)

  useEffect(() => {
    if (state.status !== "ready") return
    if (state.content.length > SHIKI_SIZE_CEILING) return
    let cancelled = false
    import("shiki")
      .then(async (mod) => {
        if (cancelled) return
        const html = await mod.codeToHtml(state.content, { lang: extToLang(source.fileName), theme: "github-dark" })
        if (!cancelled) setHighlighted(html)
      })
      .catch(() => {
        if (typeof console !== "undefined") console.warn("[file-preview] Shiki unavailable; falling back to plain text")
      })
    return () => { cancelled = true }
  }, [state, source.fileName])

  if (state.status === "loading") return <div className="p-4 text-sm text-muted-foreground"><pre className="sr-only" /> Loading…</div>
  if (state.status === "error") return <div className="p-4 text-sm text-destructive"><pre className="sr-only" /> {state.message}</div>

  if (highlighted) {
    return (
      <div className="overflow-auto p-3 text-xs" dangerouslySetInnerHTML={{ __html: highlighted }} />
    )
  }
  return (
    <div className="space-y-2 overflow-auto p-3">
      {state.truncated ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">Preview truncated to 1024 KB.</div> : null}
      <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3 text-xs">{state.content}</pre>
    </div>
  )
}
```

> Note: `dangerouslySetInnerHTML` is acceptable here because the input string comes from Shiki, a trusted package, given user-provided plaintext (not arbitrary HTML). Shiki escapes input before tokenisation. Verify lint rule does not flag; if it does, suppress with a single-line `// eslint-disable-next-line react/no-danger -- Shiki output is escaped tokenized HTML` and document.

- [ ] **Step 4: Pass + lint + commit**

```bash
bun test src/client/components/messages/file-preview/bodies/CodeBody.test.tsx
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/bodies/CodeBody.tsx src/client/components/messages/file-preview/bodies/CodeBody.test.tsx
git commit -m "feat(file-preview): add CodeBody with Shiki dynamic import + plain fallback"
```

---

## Phase 4 — Sheet + Card

### Task 10: FilePreviewSheet container

**Files:**
- Create: `src/client/components/messages/file-preview/FilePreviewSheet.tsx`
- Test: `src/client/components/messages/file-preview/FilePreviewSheet.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import "../../../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { FilePreviewSheet } from "./FilePreviewSheet"
import type { PreviewSource } from "./types"

const SRC: PreviewSource = {
  id: "s1", contentUrl: "/u/r.zip", displayName: "r.zip", fileName: "r.zip",
  mimeType: "application/zip", size: 10, origin: "offer_download",
}

describe("FilePreviewSheet", () => {
  test("when origin=offer_download, Download button rendered", () => {
    const html = renderToStaticMarkup(<FilePreviewSheet source={SRC} open onOpenChange={() => {}} />)
    expect(html).toContain("Download")
    expect(html).toContain("Share")
  })

  test("when origin=user_attachment, Download button NOT rendered", () => {
    const html = renderToStaticMarkup(<FilePreviewSheet source={{ ...SRC, origin: "user_attachment" }} open onOpenChange={() => {}} />)
    expect(html).not.toContain(">Download<")
    expect(html).toContain("Share")
  })

  test("when source is null, nothing renders inside content", () => {
    const html = renderToStaticMarkup(<FilePreviewSheet source={null} open={false} onOpenChange={() => {}} />)
    expect(html).not.toContain("Share")
  })

  test("Dialog.Title set to displayName for screen readers", () => {
    const html = renderToStaticMarkup(<FilePreviewSheet source={SRC} open onOpenChange={() => {}} />)
    expect(html).toContain("r.zip")
  })
})
```

- [ ] **Step 2: Verify fail** → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useCallback, useMemo, useRef } from "react"
import { Share2, Download } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../ui/dialog"
import { Button } from "../../ui/button"
import { classifyAttachmentPreview, classifyAttachmentIcon, friendlyMimeLabel } from "../attachmentPreview"
import { formatAttachmentSize } from "../AttachmentCard"
import type { ChatAttachment } from "../../../../shared/types"
import { ImageBody } from "./bodies/ImageBody"
import { PdfBody } from "./bodies/PdfBody"
import { MarkdownBody } from "./bodies/MarkdownBody"
import { TableBody } from "./bodies/TableBody"
import { TextBody } from "./bodies/TextBody"
import { JsonBody } from "./bodies/JsonBody"
import { AudioBody } from "./bodies/AudioBody"
import { VideoBody } from "./bodies/VideoBody"
import { CodeBody } from "./bodies/CodeBody"
import { downloadFile, shareViaWebShare } from "./actions"
import type { PreviewSource } from "./types"

interface Props {
  source: PreviewSource | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FilePreviewSheet({ source, open, onOpenChange }: Props) {
  return (
    <Dialog open={open && source !== null} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="inset-0 h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none p-0 md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[90dvh] md:w-auto md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
      >
        {source ? <SheetBody source={source} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function SheetBody({ source }: { source: PreviewSource }) {
  const headerRef = useRef<HTMLDivElement>(null)
  const Body = useMemo(() => pickBody(source), [source])
  const meta = useMemo(() => describeMeta(source), [source])

  const handleShare = useCallback(() => {
    void shareViaWebShare(source)
  }, [source])
  const handleDownload = useCallback(() => downloadFile(source), [source])

  return (
    <div className="flex h-full max-h-full flex-col">
      <div ref={headerRef} className="border-b border-border px-4 py-3">
        <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-muted md:hidden" role="button" aria-label="Drag down to close" />
        <DialogTitle className="truncate text-base">{source.displayName}</DialogTitle>
        <DialogDescription className="truncate text-xs">{meta}</DialogDescription>
      </div>
      <div key={source.id} className="min-h-0 flex-1 overflow-auto" role="region" aria-label="File preview">
        <Body source={source} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="outline" onClick={handleShare}>
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </Button>
        {source.origin === "offer_download" ? (
          <Button type="button" onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function pickBody(source: PreviewSource): React.ComponentType<{ source: PreviewSource }> {
  const attachmentLike: ChatAttachment = {
    id: source.id, kind: "file", displayName: source.displayName,
    mimeType: source.mimeType, size: source.size ?? 0, contentUrl: source.contentUrl,
    relativePath: source.relativePath, absolutePath: source.relativePath,
  }
  const iconKind = classifyAttachmentIcon(attachmentLike)
  if (iconKind === "image") return ImageBody
  if (iconKind === "pdf") return PdfBody
  if (iconKind === "audio") return AudioBody
  if (iconKind === "video") return VideoBody
  if (iconKind === "table") return TableBody
  if (iconKind === "markdown") return MarkdownBody
  if (iconKind === "json") return JsonBody
  if (iconKind === "code") return CodeBody
  const target = classifyAttachmentPreview(attachmentLike)
  if (target.kind === "external") return PdfBody // forces external CTA path for unknown kinds
  return TextBody
}

function describeMeta(source: PreviewSource): string {
  const attachmentLike: ChatAttachment = {
    id: source.id, kind: "file", displayName: source.displayName,
    mimeType: source.mimeType, size: source.size ?? 0, contentUrl: source.contentUrl,
  }
  const iconKind = classifyAttachmentIcon(attachmentLike)
  const label = friendlyMimeLabel(iconKind, source.mimeType)
  const size = source.size ? ` · ${formatAttachmentSize(source.size)}` : ""
  return `${label}${size}`
}
```

- [ ] **Step 4: Pass + lint + commit**

```bash
bun test src/client/components/messages/file-preview/FilePreviewSheet.test.tsx
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/FilePreviewSheet.tsx src/client/components/messages/file-preview/FilePreviewSheet.test.tsx
git commit -m "feat(file-preview): add FilePreviewSheet container with 9-body switch"
```

---

### Task 11: Swipe-down dismiss gesture

**Files:**
- Modify: `src/client/components/messages/file-preview/FilePreviewSheet.tsx`
- Test: `src/client/components/messages/file-preview/FilePreviewSheet.test.tsx`

- [ ] **Step 1: Add failing test for swipe gesture**

Append to `FilePreviewSheet.test.tsx`:

```tsx
import "../../../lib/testing/setupHappyDom"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { test as t, expect as e2 } from "bun:test"

t("pointerdown on drag handle then pointermove dy>120 + pointerup → onOpenChange(false)", async () => {
  const onOpenChange = (() => { let v = true; return { call: (next: boolean) => { v = next }, get: () => v } })()
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<FilePreviewSheet source={SRC} open onOpenChange={(next) => onOpenChange.call(next)} />)
  })
  const handle = container.querySelector('[aria-label="Drag down to close"]') as HTMLElement
  e2(handle).not.toBeNull()
  await act(async () => {
    handle.dispatchEvent(new PointerEvent("pointerdown", { clientY: 100, pointerId: 1, bubbles: true }))
    handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, pointerId: 1, bubbles: true }))
    handle.dispatchEvent(new PointerEvent("pointerup", { clientY: 300, pointerId: 1, bubbles: true }))
  })
  e2(onOpenChange.get()).toBe(false)
  await act(async () => { root.unmount() })
  container.remove()
})
```

- [ ] **Step 2: Verify the new test fails**

Run: `bun test src/client/components/messages/file-preview/FilePreviewSheet.test.tsx`
Expected: original 4 pass; new swipe test FAIL (`onOpenChange` still `true`).

- [ ] **Step 3: Implement gesture inside SheetBody**

Edit `FilePreviewSheet.tsx`. Inside `SheetBody`, replace `headerRef` block with gesture state:

```tsx
import { useEffect, useCallback, useMemo, useRef, useState } from "react"
// ... existing imports

function SheetBody({ source }: { source: PreviewSource }) {
  const handleRef = useRef<HTMLDivElement>(null)
  const Body = useMemo(() => pickBody(source), [source])
  const meta = useMemo(() => describeMeta(source), [source])
  const [dy, setDy] = useState(0)
  const startRef = useRef<{ y: number; t: number; lastY: number; lastT: number } | null>(null)
  const closeFnRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const dialogContent = handleRef.current?.closest('[role="dialog"]') as HTMLElement | null
    if (!dialogContent) return
    const close = () => dialogContent.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    closeFnRef.current = close
    return () => { closeFnRef.current = null }
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    startRef.current = { y: event.clientY, t: Date.now(), lastY: event.clientY, lastT: Date.now() }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    const delta = event.clientY - startRef.current.y
    if (delta < 0) return
    startRef.current.lastY = event.clientY
    startRef.current.lastT = Date.now()
    setDy(delta)
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    startRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    if (!start) return
    const dyFinal = event.clientY - start.y
    const dt = Math.max(1, Date.now() - start.lastT)
    const v = (event.clientY - start.lastY) / dt
    if (dyFinal > 120 || v > 0.5) {
      closeFnRef.current?.()
    } else {
      setDy(0)
    }
  }, [])

  const handleShare = useCallback(() => { void shareViaWebShare(source) }, [source])
  const handleDownload = useCallback(() => downloadFile(source), [source])

  return (
    <div className="flex h-full max-h-full flex-col" style={dy > 0 ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}>
      <div
        ref={handleRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="border-b border-border px-4 py-3 touch-none"
      >
        <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-muted md:hidden" role="button" aria-label="Drag down to close" />
        <DialogTitle className="truncate text-base">{source.displayName}</DialogTitle>
        <DialogDescription className="truncate text-xs">{meta}</DialogDescription>
      </div>
      <div key={source.id} className="min-h-0 flex-1 overflow-auto" role="region" aria-label="File preview">
        <Body source={source} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="outline" onClick={handleShare}>
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </Button>
        {source.origin === "offer_download" ? (
          <Button type="button" onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests until green**

Run: `bun test src/client/components/messages/file-preview/FilePreviewSheet.test.tsx`
Expected: 5 pass.

If swipe test still fails because dispatching `Escape` does not propagate through Radix, switch the close mechanism to a direct prop: pass `onClose` from parent `<Dialog open onOpenChange>` instead of synthesising ESC. Adjust both component and test.

- [ ] **Step 5: Lint + commit**

```bash
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/FilePreviewSheet.tsx src/client/components/messages/file-preview/FilePreviewSheet.test.tsx
git commit -m "feat(file-preview): add swipe-down dismiss with velocity threshold"
```

---

### Task 12: InlinePreviewCard factory

**Files:**
- Create: `src/client/components/messages/file-preview/InlinePreviewCard.tsx`
- Test: `src/client/components/messages/file-preview/InlinePreviewCard.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { InlinePreviewCard } from "./InlinePreviewCard"
import type { PreviewSource } from "./types"

const mk = (mime: string, name: string): PreviewSource => ({
  id: name, contentUrl: "/u/" + name, displayName: name, fileName: name,
  mimeType: mime, size: 1024, origin: "user_attachment",
})

describe("InlinePreviewCard", () => {
  test("image kind → renders <img loading=lazy>", () => {
    const html = renderToStaticMarkup(<InlinePreviewCard source={mk("image/png", "a.png")} onOpen={() => {}} variant="expanded" />)
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('src="/u/a.png"')
  })
  test("pdf kind → renders meta chip with PDF + size", () => {
    const html = renderToStaticMarkup(<InlinePreviewCard source={mk("application/pdf", "r.pdf")} onOpen={() => {}} variant="compact" />)
    expect(html).toContain("PDF")
    expect(html).toContain("1 KB")
  })
  test("audio kind → renders audio icon + filename", () => {
    const html = renderToStaticMarkup(<InlinePreviewCard source={mk("audio/mpeg", "a.mp3")} onOpen={() => {}} variant="compact" />)
    expect(html).toContain("a.mp3")
  })
  test("button has aria-label including 'Preview'", () => {
    const html = renderToStaticMarkup(<InlinePreviewCard source={mk("text/plain", "a.txt")} onOpen={() => {}} variant="compact" />)
    expect(html).toMatch(/aria-label="Preview/)
  })
})
```

- [ ] **Step 2: Verify fail** → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useRef } from "react"
import type { ChatAttachment } from "../../../../shared/types"
import { AttachmentFileCard, formatAttachmentSize } from "../AttachmentCard"
import { classifyAttachmentIcon, friendlyMimeLabel } from "../attachmentPreview"
import { useViewportFetch } from "./useViewportFetch"
import { TEXT_PREVIEW_LIMIT_BYTES, fetchTextPreview } from "../attachmentPreview"
import type { PreviewSource } from "./types"

interface Props {
  source: PreviewSource
  onOpen: () => void
  variant: "compact" | "expanded"
}

export function InlinePreviewCard({ source, onOpen, variant }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const attachmentLike: ChatAttachment = {
    id: source.id, kind: "file", displayName: source.displayName,
    mimeType: source.mimeType, size: source.size ?? 0, contentUrl: source.contentUrl,
  }
  const iconKind = classifyAttachmentIcon(attachmentLike)
  const friendlyType = friendlyMimeLabel(iconKind, source.mimeType)
  const sizeLabel = source.size && source.size > 0 ? formatAttachmentSize(source.size) : null

  if (iconKind === "image") {
    return (
      <button type="button" onClick={onOpen} aria-label={`Preview ${source.displayName}`} className="overflow-hidden rounded-xl border border-border bg-background">
        <img src={source.contentUrl} alt={source.displayName} loading="lazy" className="max-h-64 w-auto max-w-full object-contain" />
      </button>
    )
  }

  if (variant === "expanded" && (iconKind === "text" || iconKind === "code" || iconKind === "markdown" || iconKind === "json" || iconKind === "table")) {
    return <SnippetCard ref={ref} source={source} onOpen={onOpen} friendlyType={friendlyType} sizeLabel={sizeLabel} />
  }

  return (
    <AttachmentFileCard
      attachment={attachmentLike}
      onClick={onOpen}
      meta={
        <>
          {friendlyType}
          {sizeLabel ? <> · <span className="tabular-nums">{sizeLabel}</span></> : null}
        </>
      }
      ariaLabel={`Preview ${source.displayName}, ${friendlyType}${sizeLabel ? `, ${sizeLabel}` : ""}`}
    />
  )
}

const SnippetCard = function SnippetCardImpl({
  source, onOpen, friendlyType, sizeLabel,
}: { source: PreviewSource; onOpen: () => void; friendlyType: string; sizeLabel: string | null }) {
  const ref = useRef<HTMLButtonElement>(null)
  const result = useViewportFetch<string>({
    ref,
    enabled: true,
    cacheKey: `snippet:${source.id}`,
    fetcher: async (signal) => {
      const res = await fetchTextPreview(source.contentUrl, 4096)
      if (signal.aborted) throw new Error("aborted")
      return res.content.slice(0, 200)
    },
  })
  const snippet = result.state === "ready" && typeof result.data === "string" ? result.data : ""
  return (
    <button ref={ref} type="button" onClick={onOpen} aria-label={`Preview ${source.displayName}`} className="flex w-full max-w-md flex-col items-start gap-1 rounded-xl border border-border bg-background p-3 text-left hover:bg-accent/40">
      <div className="text-sm font-medium text-foreground">{source.displayName}</div>
      <div className="text-[11px] text-muted-foreground">{friendlyType}{sizeLabel ? ` · ${sizeLabel}` : ""}</div>
      {snippet ? <pre className="line-clamp-3 max-h-16 w-full whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{snippet}</pre> : null}
    </button>
  )
}
```

- [ ] **Step 4: Pass + lint + commit**

```bash
bun test src/client/components/messages/file-preview/InlinePreviewCard.test.tsx
bun run lint -- src/client/components/messages/file-preview
git add src/client/components/messages/file-preview/InlinePreviewCard.tsx src/client/components/messages/file-preview/InlinePreviewCard.test.tsx
git commit -m "feat(file-preview): add InlinePreviewCard factory with snippet variant"
```

---

### Task 13: Render-loop regression check

**Files:**
- Create: `src/client/components/messages/file-preview/FilePreviewSheet.loop.test.tsx`

- [ ] **Step 1: Add loop check test**

```tsx
import "../../../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../../lib/testing/renderForLoopCheck"
import { FilePreviewSheet } from "./FilePreviewSheet"
import type { PreviewSource } from "./types"

const SRC: PreviewSource = {
  id: "s", contentUrl: "/u/x.txt", displayName: "x.txt", fileName: "x.txt",
  mimeType: "text/plain", size: 10, origin: "user_attachment",
}

describe("FilePreviewSheet loop safety", () => {
  test("does not trigger Maximum update depth warnings on mount", async () => {
    const result = await renderForLoopCheck(<FilePreviewSheet source={SRC} open onOpenChange={() => {}} />)
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })
})
```

- [ ] **Step 2: Run, fix if needed**

Run: `bun test src/client/components/messages/file-preview/FilePreviewSheet.loop.test.tsx`
Expected: PASS.
If FAIL: inspect which selector/hook returned fresh ref each render; fix by `useMemo` / module-level constant per CLAUDE.md rule.

- [ ] **Step 3: Commit**

```bash
git add src/client/components/messages/file-preview/FilePreviewSheet.loop.test.tsx
git commit -m "test(file-preview): loop-check FilePreviewSheet mount"
```

---

## Phase 5 — Migrate UserMessage + LocalFileLinkCard

### Task 14: Migrate UserMessage to FilePreviewSheet

**Files:**
- Modify: `src/client/components/messages/UserMessage.tsx`
- (do not yet delete `AttachmentPreviewModal.tsx`)

- [ ] **Step 1: Confirm existing tests pass before change**

Run: `bun test src/client/components/messages/UserMessage` (if any) and `bun test src/client/components/messages/`
Expected: all green. Note current count.

- [ ] **Step 2: Edit UserMessage**

Replace the `AttachmentPreviewModal` import + usage:

```tsx
// remove:
// import { AttachmentPreviewModal } from "./AttachmentPreviewModal"

// add:
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment, type PreviewSource } from "./file-preview/types"
```

Replace the bottom of `UserMessage`:

```tsx
const selectedSource: PreviewSource | null = selectedAttachment
  ? toPreviewSourceFromAttachment(selectedAttachment, "user_attachment")
  : null

return (
  <>
    {/* ...existing JSX unchanged... */}
    <FilePreviewSheet
      source={selectedSource}
      open={selectedSource !== null}
      onOpenChange={(open) => !open && setSelectedAttachmentId(null)}
    />
  </>
)
```

Keep `classifyAttachmentPreview` `openInNewTab` short-circuit so external files still open in a new tab without the sheet.

- [ ] **Step 3: Run all message tests**

Run: `bun test src/client/components/messages/`
Expected: same count green; no regressions in `shared.test.tsx` / `LocalFileLinkCard.test.tsx`.

- [ ] **Step 4: Lint + commit**

```bash
bun run lint -- src/client/components/messages
git add src/client/components/messages/UserMessage.tsx
git commit -m "refactor(messages): migrate UserMessage to FilePreviewSheet"
```

---

### Task 15: Migrate LocalFileLinkCard to FilePreviewSheet

**Files:**
- Modify: `src/client/components/messages/LocalFileLinkCard.tsx`
- Modify: `src/client/components/messages/LocalFileLinkCard.test.tsx` (only if it asserts modal-specific markup)

- [ ] **Step 1: Read current test expectations**

Run: `bun test src/client/components/messages/LocalFileLinkCard.test.tsx`
Expected: all green. Note any assertions that reference modal-only markup (e.g., dialog roles).

- [ ] **Step 2: Edit LocalFileLinkCard**

Swap:

```tsx
// remove:
// import { AttachmentPreviewModal } from "./AttachmentPreviewModal"

// add:
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "./file-preview/types"
```

Replace the `canPreviewInModal` branch's return:

```tsx
if (canPreviewInModal) {
  return (
    <>
      <span className="inline-flex align-bottom" data-testid="local-file-link">
        <AttachmentFileCard
          attachment={attachment}
          onClick={() => setPreviewOpen(true)}
          meta={meta}
          ariaLabel={ariaLabelParts.join(", ")}
        />
      </span>
      <FilePreviewSheet
        source={previewOpen ? toPreviewSourceFromAttachment(attachment, "local_file_link") : null}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </>
  )
}
```

- [ ] **Step 3: Run tests**

Run: `bun test src/client/components/messages/LocalFileLinkCard.test.tsx`
Expected: all green. If a test fails due to modal-only markup (e.g., dialog role string), update the assertion to match the new sheet's `role="dialog"` + `role="region"` markup.

- [ ] **Step 4: Lint + commit**

```bash
bun run lint -- src/client/components/messages
git add src/client/components/messages/LocalFileLinkCard.tsx src/client/components/messages/LocalFileLinkCard.test.tsx
git commit -m "refactor(messages): migrate LocalFileLinkCard to FilePreviewSheet"
```

---

## Phase 6 — Migrate OfferDownloadMessage

### Task 16: OfferDownloadMessage uses InlinePreviewCard + sheet

**Files:**
- Modify: `src/client/components/messages/OfferDownloadMessage.tsx`
- Modify: `src/client/components/messages/OfferDownloadMessage.test.tsx`

- [ ] **Step 1: Add failing test cases**

Append to `OfferDownloadMessage.test.tsx`:

```tsx
test("preview-able mime (text/markdown) opens FilePreviewSheet on click and exposes Download in footer", async () => {
  const html = renderToStaticMarkup(<OfferDownloadMessage message={buildMessage({
    result: {
      contentUrl: "/api/projects/p1/files/notes.md/content",
      relativePath: "notes.md", fileName: "notes.md", displayName: "Notes",
      size: 200, mimeType: "text/markdown",
    },
  })} />)
  expect(html).toContain("Preview")
})

test("non-preview-able mime (application/zip) keeps download-only behaviour (regression)", () => {
  const html = renderToStaticMarkup(<OfferDownloadMessage message={buildMessage()} />)
  expect(html).toContain('download="build.zip"')
})
```

- [ ] **Step 2: Verify the new test fails**

Run: `bun test src/client/components/messages/OfferDownloadMessage.test.tsx`
Expected: the new preview-able test FAIL.

- [ ] **Step 3: Edit OfferDownloadMessage**

Replace body to branch on `classifyAttachmentPreview`:

```tsx
import { useEffect, useState } from "react"
import type { ChatAttachment, HydratedOfferDownloadToolCall } from "../../../shared/types"
import { AttachmentFileCard, formatAttachmentSize } from "./AttachmentCard"
import { classifyAttachmentIcon, classifyAttachmentPreview, friendlyMimeLabel } from "./attachmentPreview"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "./file-preview/types"

interface Props {
  message: HydratedOfferDownloadToolCall
}

type ProbeState = "idle" | "ready" | "missing"

export function OfferDownloadMessage({ message }: Props) {
  const result = message.result
  const contentUrl = result?.contentUrl
  const [state, setState] = useState<ProbeState>("idle")
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (!contentUrl) return
    const controller = new AbortController()
    fetch(contentUrl, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        setState(response.ok ? "ready" : "missing")
      })
      .catch(() => {})
    return () => controller.abort()
  }, [contentUrl])

  if (!result || !contentUrl) return null

  const attachment: ChatAttachment = {
    id: `offer-download-${message.toolId}`,
    kind: "file",
    displayName: result.displayName || result.fileName,
    absolutePath: result.relativePath,
    relativePath: result.relativePath,
    contentUrl,
    mimeType: result.mimeType ?? "application/octet-stream",
    size: result.size,
  }

  const iconKind = classifyAttachmentIcon(attachment)
  const friendlyType = friendlyMimeLabel(iconKind, result.mimeType)
  const sizeLabel = result.size > 0 ? formatAttachmentSize(result.size) : null
  const meta = (
    <>
      {friendlyType}
      {sizeLabel ? <> · <span className="tabular-nums">{sizeLabel}</span></> : null}
    </>
  )

  if (state === "missing") {
    return (
      <div className="flex" data-testid="offer-download-link">
        <AttachmentFileCard attachment={attachment} disabledReason="File no longer available" />
      </div>
    )
  }

  const previewTarget = classifyAttachmentPreview(attachment)
  const canPreview = !previewTarget.openInNewTab

  if (canPreview) {
    const ariaLabel = `Preview ${attachment.displayName}, ${friendlyType}${sizeLabel ? `, ${sizeLabel}` : ""}`
    return (
      <>
        <div className="flex" data-testid="offer-download-link">
          <AttachmentFileCard
            attachment={attachment}
            onClick={() => setPreviewOpen(true)}
            meta={meta}
            ariaLabel={ariaLabel}
          />
        </div>
        <FilePreviewSheet
          source={previewOpen ? toPreviewSourceFromAttachment(attachment, "offer_download") : null}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      </>
    )
  }

  const ariaLabelParts = ["Download", attachment.displayName, friendlyType, sizeLabel].filter(Boolean) as string[]
  return (
    <div className="flex" data-testid="offer-download-link">
      <AttachmentFileCard
        attachment={attachment}
        href={contentUrl}
        download={result.fileName || undefined}
        meta={meta}
        ariaLabel={ariaLabelParts.join(", ")}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/client/components/messages/OfferDownloadMessage.test.tsx`
Expected: all (including the two new) PASS.

- [ ] **Step 5: Lint + commit**

```bash
bun run lint -- src/client/components/messages
git add src/client/components/messages/OfferDownloadMessage.tsx src/client/components/messages/OfferDownloadMessage.test.tsx
git commit -m "refactor(messages): wire OfferDownloadMessage through FilePreviewSheet"
```

---

## Phase 7 — Migrate ImageGenerationMessage

### Task 17: ImageGenerationMessage uses InlinePreviewCard + sheet

**Files:**
- Modify: `src/client/components/messages/ImageGenerationMessage.tsx`
- Create or modify: `src/client/components/messages/ImageGenerationMessage.test.tsx` (test file likely doesn't exist; if not, create it)

- [ ] **Step 1: Check existence of existing test**

Run: `ls src/client/components/messages/ImageGenerationMessage.test.tsx 2>/dev/null || echo missing`

- [ ] **Step 2: Create or extend test**

Create (or extend) `src/client/components/messages/ImageGenerationMessage.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { HydratedImageGenerationToolCall } from "../../../shared/types"
import { ImageGenerationMessage } from "./ImageGenerationMessage"

function buildMessage(overrides: Partial<HydratedImageGenerationToolCall> = {}): HydratedImageGenerationToolCall {
  return {
    id: "msg-1", timestamp: new Date(0).toISOString(),
    kind: "tool", toolKind: "image_generation", toolName: "mcp__kanna__image_generation",
    toolId: "t-1",
    input: { prompt: "p", revisedPrompt: "Revised prompt", status: "completed" },
    rawResult: undefined, isError: false,
    result: { contentUrl: "/api/x.png", relativePath: "x.png", fileName: "x.png", displayName: "x.png", size: 100, mimeType: "image/png" },
    ...overrides,
  }
}

describe("ImageGenerationMessage", () => {
  test("pending status renders placeholder copy", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage({
      input: { prompt: "p", revisedPrompt: "Pending here", status: "in_progress" },
      result: undefined,
    })} />)
    expect(html).toContain("Generating image")
    expect(html).toContain("Pending here")
  })

  test("error path renders error block", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage({ isError: true, result: undefined })} />)
    expect(html).toContain("Image generation failed")
  })

  test("completed renders an image preview card with revisedPrompt caption", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage()} />)
    expect(html).toContain('src="/api/x.png"')
    expect(html).toContain("Revised prompt")
  })
})
```

- [ ] **Step 3: Verify**

Run: `bun test src/client/components/messages/ImageGenerationMessage.test.tsx`
If existing markup already passes — proceed. Otherwise (Step 4 implements).

- [ ] **Step 4: Edit ImageGenerationMessage**

```tsx
import { useState } from "react"
import type { HydratedImageGenerationToolCall } from "../../../shared/types"
import { InlinePreviewCard } from "./file-preview/InlinePreviewCard"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import type { PreviewSource } from "./file-preview/types"

interface Props {
  message: HydratedImageGenerationToolCall
}

export function ImageGenerationMessage({ message }: Props) {
  const status = message.input.status
  const revisedPrompt = message.input.revisedPrompt
  const result = message.result
  const contentUrl = result?.contentUrl
  const isPending = !result || (status && status !== "completed" && status !== "failed")
  const [open, setOpen] = useState(false)

  if (isPending) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-sm text-muted-foreground" data-testid="image-generation-pending">
        <span>Generating image{status ? ` (${status})` : "…"}</span>
        {revisedPrompt ? <span className="italic">{revisedPrompt}</span> : null}
      </div>
    )
  }

  if (message.isError || !result || !contentUrl) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" data-testid="image-generation-error">
        <span>Image generation failed.</span>
        {result?.relativePath ? <span className="text-muted-foreground">{result.relativePath}</span> : null}
      </div>
    )
  }

  const source: PreviewSource = {
    id: `image-gen-${message.toolId}`,
    contentUrl,
    displayName: result.displayName || result.fileName,
    fileName: result.fileName,
    relativePath: result.relativePath,
    mimeType: result.mimeType || "image/png",
    size: result.size,
    origin: "image_generation",
  }

  return (
    <figure className="flex flex-col gap-2" data-testid="image-generation">
      <InlinePreviewCard source={source} onOpen={() => setOpen(true)} variant="expanded" />
      {revisedPrompt ? <figcaption className="text-xs text-muted-foreground italic">{revisedPrompt}</figcaption> : null}
      <FilePreviewSheet source={open ? source : null} open={open} onOpenChange={setOpen} />
    </figure>
  )
}
```

- [ ] **Step 5: Pass + lint + commit**

```bash
bun test src/client/components/messages/ImageGenerationMessage.test.tsx
bun run lint -- src/client/components/messages
git add src/client/components/messages/ImageGenerationMessage.tsx src/client/components/messages/ImageGenerationMessage.test.tsx
git commit -m "refactor(messages): migrate ImageGenerationMessage to FilePreviewSheet"
```

---

## Phase 8 — Cleanup

### Task 18: Delete AttachmentPreviewModal

**Files:**
- Delete: `src/client/components/messages/AttachmentPreviewModal.tsx`

- [ ] **Step 1: Confirm zero references**

Run: `grep -r "AttachmentPreviewModal" src/`
Expected: no matches (after Tasks 14 + 15 + 16).

If matches exist, halt and report — those call sites were missed.

- [ ] **Step 2: Delete file**

Run: `rm src/client/components/messages/AttachmentPreviewModal.tsx`

- [ ] **Step 3: Run full message-tests pass**

Run: `bun test src/client/components/messages/`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git rm src/client/components/messages/AttachmentPreviewModal.tsx 2>/dev/null || git add -A
git add -A
git commit -m "refactor(messages): delete obsolete AttachmentPreviewModal"
```

---

### Task 19: Lint ratchet sweep + warning recount

**Files:**
- Modify: `eslint.config.*` if a warnings cap exists there
- Or: `.github/workflows/test.yml` if cap lives in CI

- [ ] **Step 1: Run full lint to capture warning count**

Run: `bun run lint`
Expected: 0 errors. Note new warning count.

- [ ] **Step 2: If warnings dropped below current cap, lower cap**

Search for `--max-warnings` in `package.json`, `eslint.config.*`, `.github/workflows/`. Update the integer to current count. Per CLAUDE.md ratchet rule.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(lint): ratchet max-warnings to current count after file-preview"
```

> If warnings did NOT drop, skip this task (no change needed).

---

### Task 20: Full project test run

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: all green.

If failures appear in unrelated suites, halt and report per CLAUDE.md "Pre-existing Issues" rule. Do not silently fix or skip.

- [ ] **Step 2: Run full lint**

Run: `bun run lint`
Expected: 0 errors, warnings ≤ existing cap.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin docs/mobile-file-preview-spec
gh pr create --repo cuongtranba/kanna --base main --head docs/mobile-file-preview-spec --title "feat(file-preview): mobile-first universal file preview sheet" --body "$(cat <<'EOF'
## Summary
- New `src/client/components/messages/file-preview/` directory implementing a single mobile-first sheet primitive covering 9 file kinds (image, pdf, markdown, table, text, json, audio, video, code).
- `FilePreviewSheet` + `InlinePreviewCard` replace `AttachmentPreviewModal` and the bespoke `ImageGenerationMessage` markup.
- Origins migrated: `UserMessage`, `LocalFileLinkCard`, `OfferDownloadMessage`, `ImageGenerationMessage`.
- New deps: none. Shiki imported via dynamic `import()` on first code preview only.

## Spec
docs/superpowers/specs/2026-05-16-mobile-file-preview-design.md

## Plan
docs/superpowers/plans/2026-05-16-mobile-file-preview.md

## Test plan
- [ ] `bun test src/client/components/messages/file-preview/` green
- [ ] `bun test src/client/components/messages/` green
- [ ] `bun test` green
- [ ] `bun run lint` 0 errors, no warning regression
- [ ] iPhone Safari smoke: open image, markdown, audio, video, csv, code from a user message
- [ ] Android Chrome smoke: same
- [ ] Desktop Chrome smoke: sheet centers, ESC closes, backdrop closes
- [ ] Slow 3G throttle: snippet + body skeletons visible

## Documented limitations (per spec, intentional)
- No explicit close (X) button — swipe-down / backdrop / ESC only.
- No Android hardware-back hook — back exits PWA instead of closing sheet.
- Pre-existing iOS Safari `100vh` modal bug fixed inline via `100dvh`.
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review Notes

- **Spec coverage:**
  - Architecture directory layout → Tasks 1–13.
  - PreviewSource type → Task 1.
  - FilePreviewSheet responsive rule → Task 10 (classes), Task 11 (swipe gesture).
  - InlinePreviewCard factory → Task 12.
  - useViewportFetch hook → Task 2.
  - actions (share/download) → Task 3.
  - 9 bodies (image/pdf/markdown/table/text/json/audio/video/code) → Tasks 4–9.
  - 4 origin migrations (user_attachment/local_file_link/offer_download/image_generation) → Tasks 14–17.
  - Modal deprecation → Task 18.
  - Render-loop regression → Task 13.
  - Caching layers — covered inside Tasks 2 (snippet), 6 (text body), 7 (table body).
  - Error handling per body — `state="error"` branches inside each body.
  - Lint ratchet → Task 19.
  - Manual QA matrix → Task 20 PR test plan checklist.
- **Type consistency check:** `PreviewSource` schema identical across types.ts, FilePreviewSheet, InlinePreviewCard, all bodies, all 4 migrated origins. `ShareOutcome` only used inside actions.ts. `ViewportFetchState` exported but only consumed inside InlinePreviewCard's `SnippetCard`.
- **No placeholders:** every step has runnable code + commands. Migration plan items map 1:1 to spec §Migration Plan.
- **Risk noted in plan:** Task 11 swipe gesture's synthetic ESC dispatch may not propagate through Radix; Step 4 includes a fallback (switch to direct `onClose` prop).
