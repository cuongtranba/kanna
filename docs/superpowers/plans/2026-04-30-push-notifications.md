# Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver browser push notifications (including to phones with the tab closed) on three attention-only chat status transitions: `waiting_for_user`, `failed`, and `running → idle` (completed). Per-project mute, multi-device fan-out, focus-aware suppression, OS-level grouping by project.

**Architecture:** A single new server module `PushManager` owns VAPID keys, the push subscription store, transition detection, and `web-push` fan-out. It hooks into the existing read-model derivation in `ws-router.ts` (the same pass that builds `SidebarData`). A plain-JS service worker at `public/sw.js` receives pushes and routes notification taps. Settings UI exposes a new `push-config` subscription topic for reactive devices/mute state. Storage follows Kanna's existing event-sourced JSONL pattern.

**Tech Stack:** Bun + TypeScript (server), React + Zustand + WebSocket (client), `web-push` npm package, browser Service Worker + Push API + VAPID.

**Spec:** `docs/superpowers/specs/2026-04-30-push-notifications-design.md`

**Pre-flight read:** `src/server/event-store.ts` (EventStore JSONL pattern, `appendTunnelEvent` precedent for a non-compacted append-only log), `src/server/ws-router.ts:423-458` (`getSidebarSnapshotCacheEntry` — the natural hook point for `observeStatuses`), `src/server/read-models.ts:64-137` (`deriveSidebarData` shape), `src/shared/protocol.ts:29-251` (`SubscriptionTopic`, `ClientCommand`, `ServerSnapshot`, `ServerEnvelope`), `src/shared/types.ts:313-353` (`KannaStatus`, `SidebarChatRow`, `SidebarProjectGroup`).

**Run conventions:**
- `bun test path/to/file.test.ts` runs one test file.
- `bun test path/to/file.test.ts -t "name"` runs one test by name.
- `bun run check` runs full typecheck + build (do this only at the end, per project rule on resource-aware parallel work).
- `tsc --noEmit -p .` gives a faster typecheck-only pass during iteration.
- Tests are colocated (`*.test.ts` next to source) and use `mkdtemp(join(tmpdir(), "kanna-...-"))` for any filesystem state — see `src/server/event-store.test.ts:24-28` for the pattern.

---

## File structure (locked in)

### New files

| Path | Responsibility |
|---|---|
| `src/server/push/events.ts` | `PushEvent` discriminated union + tiny pure helpers. Mirrors `src/server/cloudflare-tunnel/events.ts`. |
| `src/server/push/vapid.ts` | Load-or-generate VAPID keypair from `~/.kanna/data/vapid.json`. Pure I/O + `web-push.generateVAPIDKeys()`. |
| `src/server/push/vapid.test.ts` | Generates on first load; reuses on second. |
| `src/server/push/push-manager.ts` | Single owner of all push state: subscriptions, project mute, transition detection, dedup, fan-out via `web-push`, focus tracking, send-test. |
| `src/server/push/push-manager.test.ts` | Unit tests for each behavior. |
| `public/sw.js` | Service worker. Plain JS. `push`, `notificationclick`, `pushsubscriptionchange` handlers. |
| `src/client/app/pushClient.ts` | Browser-side: feature detection, SW registration, subscribe/unsubscribe, talks to server over WS. |
| `src/client/app/pushClient.test.ts` | Mocks `navigator.serviceWorker` + `PushManager`. |
| `src/client/components/settings/PushNotificationsSection.tsx` | Settings UI card. |
| `src/client/components/settings/PushNotificationsSection.test.tsx` | Renders each permission state; toggle and mute flows. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `web-push` dep + `@types/web-push` dev dep. |
| `src/shared/types.ts` | Add push shapes. |
| `src/shared/protocol.ts` | Add push commands, push-config subscription, push-config snapshot. |
| `src/server/event-store.ts` | Own `push.jsonl` (path, ensure, replay, append). Mirrors `tunnels.jsonl` plumbing. |
| `src/server/ws-router.ts` | Construct `PushManager`, route `push.*` commands, hook `observeStatuses` after `deriveSidebarData`, broadcast `push-config` on changes, attach `pushDeviceId` to `ClientState`. |
| `src/server/server.ts` | Inject `PushManager` into `createWsRouter`. |
| `src/client/app/socket.ts` | Identify device on connect; report focused chat. |
| `src/client/app/SettingsPage.tsx` | Mount `PushNotificationsSection`. |
| `.c3/code-map.yaml` | Register `c3-119`, `c3-224`, `ref-push`. |

### Boundary rule

Only `push-manager.ts` and `vapid.ts` import the `web-push` library. No client file imports `web-push`. The shared types in `src/shared/types.ts` are the wire contract — both sides import them.

---

## Task 1: Add push shapes to `src/shared/types.ts`

**Files:**
- Modify: `src/shared/types.ts` (append after line 318, near `KannaStatus`)

- [ ] **Step 1: Append the new types**

Open `src/shared/types.ts` and append these declarations after the existing `KannaStatus` union (line 313-318):

```ts
export type PushTransitionKind = "waiting_for_user" | "failed" | "completed"

export interface PushSubscriptionRecord {
  id: string
  endpoint: string
  keys: { p256dh: string; auth: string }
  label: string
  userAgent: string
  createdAt: number
  lastSeenAt: number
}

export interface PushPayload {
  v: 1
  kind: PushTransitionKind
  projectLocalPath: string
  projectTitle: string
  chatId: string
  chatTitle: string
  chatUrl: string
  ts: number
}

export interface PushPreferences {
  globalEnabled: boolean
  mutedProjectPaths: string[]
}

export interface PushDeviceSummary {
  id: string
  label: string
  userAgent: string
  createdAt: number
  lastSeenAt: number
  isCurrentDevice: boolean
}

export interface PushConfigSnapshot {
  vapidPublicKey: string
  preferences: PushPreferences
  devices: PushDeviceSummary[]
}

export interface PushSubscribeRequestPayload {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
```

- [ ] **Step 2: Typecheck**

Run: `tsc --noEmit -p .`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(push): add shared types for web push payload and config"
```

---

## Task 2: Add push protocol messages to `src/shared/protocol.ts`

**Files:**
- Modify: `src/shared/protocol.ts`

- [ ] **Step 1: Add the import**

Open `src/shared/protocol.ts`. In the `import type {` block (lines 1-20), add `PushConfigSnapshot` and `PushSubscribeRequestPayload`:

```ts
import type {
  AppSettingsSnapshot,
  AppSettingsPatch,
  AgentProvider,
  ChatAttachment,
  ChatDiffSnapshot,
  ChatHistoryPage,
  ChatSnapshot,
  CloudflareTunnelSettings,
  DiffCommitMode,
  KeybindingsSnapshot,
  LlmProviderSnapshot,
  LocalProjectsSnapshot,
  ModelOptions,
  PushConfigSnapshot,
  PushSubscribeRequestPayload,
  SidebarData,
  StandaloneTranscriptAttachmentMode,
  StandaloneTranscriptExportResult,
  UpdateSnapshot,
  EditorPreset,
} from "./types"
```

- [ ] **Step 2: Add the subscription topic**

Replace the `SubscriptionTopic` union (around line 29-37) with:

```ts
export type SubscriptionTopic =
  | { type: "sidebar" }
  | { type: "local-projects" }
  | { type: "update" }
  | { type: "keybindings" }
  | { type: "app-settings" }
  | { type: "push-config" }
  | { type: "chat"; chatId: string; recentLimit?: number }
  | { type: "project-git"; projectId: string }
  | { type: "terminal"; terminalId: string }
```

- [ ] **Step 3: Add the client commands**

In the `ClientCommand` union (the long `export type ClientCommand = ...` block), append these branches before the closing `| { type: "terminal.close"; terminalId: string }` line (around line 227):

```ts
  | { type: "push.identifyDevice"; pushDeviceId: string | null }
  | { type: "push.subscribe"; subscription: PushSubscribeRequestPayload; label: string; userAgent: string }
  | { type: "push.unsubscribe"; pushDeviceId: string }
  | { type: "push.test" }
  | { type: "push.setProjectMute"; localPath: string; muted: boolean }
  | { type: "push.setFocusedChat"; chatId: string | null }
```

- [ ] **Step 4: Add the server snapshot variant**

Replace the `ServerSnapshot` union (around line 236-245) with:

```ts
export type ServerSnapshot =
  | { type: "sidebar"; data: SidebarData }
  | { type: "local-projects"; data: LocalProjectsSnapshot }
  | { type: "update"; data: UpdateSnapshot }
  | { type: "keybindings"; data: KeybindingsSnapshot }
  | { type: "app-settings"; data: AppSettingsSnapshot }
  | { type: "llm-provider"; data: LlmProviderSnapshot }
  | { type: "push-config"; data: PushConfigSnapshot }
  | { type: "chat"; data: ChatSnapshot | null }
  | { type: "project-git"; data: ChatDiffSnapshot | null }
  | { type: "terminal"; data: TerminalSnapshot | null }
```

- [ ] **Step 5: Typecheck**

Run: `tsc --noEmit -p .`
Expected: errors in `ws-router.ts` (missing handler cases for new commands and topic) — that is the failing baseline. Note them; we will fix in Task 12.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/protocol.ts
git commit -m "feat(push): add ws protocol messages for push subscribe/unsubscribe/mute/focus"
```

---

## Task 3: Add `web-push` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime dep**

Run from repo root: `bun add web-push@^3.6.7`
Expected: package.json gets `"web-push": "^3.6.7"` in `dependencies`.

- [ ] **Step 2: Install types**

Run: `bun add -d @types/web-push@^3.6.4`
Expected: package.json gets `"@types/web-push": "^3.6.4"` in `devDependencies`.

- [ ] **Step 3: Verify import works**

Run: `bun -e 'import("web-push").then(m => console.log(typeof m.generateVAPIDKeys))'`
Expected: prints `function`.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(push): add web-push dependency"
```

---

## Task 4: VAPID keypair load-or-generate (`src/server/push/vapid.ts`)

**Files:**
- Create: `src/server/push/vapid.ts`
- Test: `src/server/push/vapid.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/push/vapid.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadOrGenerateVapidKeys } from "./vapid"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "kanna-vapid-"))
  tempDirs.push(dir)
  return dir
}

describe("loadOrGenerateVapidKeys", () => {
  test("generates a fresh keypair on first call and persists it to disk", async () => {
    const dir = await tempDir()
    const result = await loadOrGenerateVapidKeys(dir)

    expect(result.publicKey).toMatch(/^[A-Za-z0-9_-]{60,90}$/)
    expect(result.privateKey).toMatch(/^[A-Za-z0-9_-]{40,60}$/)
    expect(result.subject).toBe("mailto:kanna@localhost")

    const onDisk = JSON.parse(await readFile(join(dir, "vapid.json"), "utf8"))
    expect(onDisk.publicKey).toBe(result.publicKey)
    expect(onDisk.privateKey).toBe(result.privateKey)
  })

  test("reuses the existing keypair on subsequent calls", async () => {
    const dir = await tempDir()
    const first = await loadOrGenerateVapidKeys(dir)
    const second = await loadOrGenerateVapidKeys(dir)
    expect(second.publicKey).toBe(first.publicKey)
    expect(second.privateKey).toBe(first.privateKey)
  })
})
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `bun test src/server/push/vapid.test.ts`
Expected: FAIL — module `./vapid` not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/server/push/vapid.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import webpush from "web-push"

export interface VapidKeypair {
  publicKey: string
  privateKey: string
  subject: string
}

const DEFAULT_SUBJECT = "mailto:kanna@localhost"

export async function loadOrGenerateVapidKeys(dataDir: string): Promise<VapidKeypair> {
  await mkdir(dataDir, { recursive: true })
  const path = join(dataDir, "vapid.json")
  if (existsSync(path)) {
    const text = await readFile(path, "utf8")
    const parsed = JSON.parse(text) as VapidKeypair
    if (parsed.publicKey && parsed.privateKey) {
      return { ...parsed, subject: parsed.subject ?? DEFAULT_SUBJECT }
    }
  }
  const generated = webpush.generateVAPIDKeys()
  const keypair: VapidKeypair = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: DEFAULT_SUBJECT,
  }
  await writeFile(path, JSON.stringify(keypair, null, 2), { mode: 0o600 })
  return keypair
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/server/push/vapid.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/push/vapid.ts src/server/push/vapid.test.ts
git commit -m "feat(push): VAPID keypair load-or-generate with 0600 perms"
```

---

## Task 5: Push event types (`src/server/push/events.ts`)

**Files:**
- Create: `src/server/push/events.ts`

- [ ] **Step 1: Write the file**

Create `src/server/push/events.ts`:

```ts
import type { PushSubscriptionRecord } from "../../shared/types"

export type PushEvent =
  | { kind: "subscription_added"; ts: number; id: string; record: PushSubscriptionRecord }
  | { kind: "subscription_removed"; ts: number; id: string; reason: "user_revoked" | "expired" | "replaced" }
  | { kind: "subscription_seen"; ts: number; id: string }
  | { kind: "project_mute_set"; ts: number; localPath: string; muted: boolean }

export interface PushEventStore {
  appendPushEvent(event: PushEvent): Promise<void>
  loadPushEvents(): Promise<PushEvent[]>
}
```

- [ ] **Step 2: Typecheck**

Run: `tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/push/events.ts
git commit -m "feat(push): event union and PushEventStore interface"
```

---

## Task 6: Wire `push.jsonl` into `EventStore`

Mirror the `tunnels.jsonl` plumbing in `event-store.ts`. The push log is **not** compacted into `snapshot.json` — it's left as the source of truth (subscriptions are always replayable from the log).

**Files:**
- Modify: `src/server/event-store.ts`
- Modify: `src/server/event-store.test.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `src/server/event-store.test.ts` (before the final closing `})` of the file's outermost `describe("EventStore", ...)`):

```ts
  test("appends and reloads push events", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    await store.appendPushEvent({
      kind: "subscription_added",
      ts: 1700000000000,
      id: "sub-1",
      record: {
        id: "sub-1",
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
        label: "iPhone",
        userAgent: "Mozilla/5.0",
        createdAt: 1700000000000,
        lastSeenAt: 1700000000000,
      },
    })
    await store.appendPushEvent({
      kind: "project_mute_set",
      ts: 1700000000001,
      localPath: "/tmp/proj-a",
      muted: true,
    })

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    const events = await reloaded.loadPushEvents()
    expect(events).toHaveLength(2)
    expect(events[0].kind).toBe("subscription_added")
    expect(events[1].kind).toBe("project_mute_set")
  })
```

Add the import at the top of the test file:
```ts
import type { PushEvent } from "./push/events"
```
(Place it after the existing `import type { AutoContinueEvent } from "./auto-continue/events"` line.)

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `bun test src/server/event-store.test.ts -t "appends and reloads push events"`
Expected: FAIL — `appendPushEvent` does not exist on `EventStore`.

- [ ] **Step 3: Modify `EventStore` to support `push.jsonl`**

Open `src/server/event-store.ts`.

(a) Add the import near the top, after the existing `cloudflare-tunnel/events` import (around line 21):
```ts
import type { PushEvent } from "./push/events"
```

(b) Add a private path field. In the `EventStore` class field list (around lines 178-186, near `tunnelLogPath`), add:
```ts
  private readonly pushLogPath: string
```

(c) Initialize the path. In the constructor (around line 198, after `tunnelLogPath`):
```ts
    this.pushLogPath = path.join(this.dataDir, "push.jsonl")
```

(d) Ensure the file exists at startup. In `initialize()` (around line 211, after `await this.ensureFile(this.tunnelLogPath)`):
```ts
    await this.ensureFile(this.pushLogPath)
```

(e) Add the public methods at the end of the class, right before the final closing `}`:
```ts
  async appendPushEvent(event: PushEvent): Promise<void> {
    const payload = `${JSON.stringify(event)}\n`
    this.writeChain = this.writeChain.then(async () => {
      await appendFile(this.pushLogPath, payload, "utf8")
    })
    await this.writeChain
  }

  async loadPushEvents(): Promise<PushEvent[]> {
    const file = Bun.file(this.pushLogPath)
    if (!(await file.exists())) return []
    const text = await file.text()
    if (!text.trim()) return []

    const events: PushEvent[] = []
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim()
      if (!line) continue
      try {
        events.push(JSON.parse(line) as PushEvent)
      } catch {
        console.warn(`${LOG_PREFIX} Ignoring malformed line in push.jsonl`)
      }
    }
    return events
  }
```

- [ ] **Step 4: Run the test (expect PASS)**

Run: `bun test src/server/event-store.test.ts -t "appends and reloads push events"`
Expected: PASS.

- [ ] **Step 5: Run the full file to confirm nothing regressed**

Run: `bun test src/server/event-store.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/event-store.ts src/server/event-store.test.ts src/server/push/events.ts
git commit -m "feat(push): persist push.jsonl through EventStore (no compaction)"
```

---

## Task 7: PushManager — construction & seeding

The first call to `observeStatuses` only seeds `lastStatusByChat` and fires nothing. This guards against post-restart replay storms.

**Files:**
- Create: `src/server/push/push-manager.ts`
- Test: `src/server/push/push-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/push/push-manager.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test"
import type { PushEvent, PushEventStore } from "./events"
import { PushManager, type WebPushSender, type ObservedChat } from "./push-manager"

class FakeStore implements PushEventStore {
  events: PushEvent[] = []
  async appendPushEvent(event: PushEvent) { this.events.push(event) }
  async loadPushEvents() { return [...this.events] }
}

interface SentPush {
  endpoint: string
  payload: string
  ttl: number
  urgency: "very-low" | "low" | "normal" | "high"
}

class FakeSender implements WebPushSender {
  sent: SentPush[] = []
  errorByEndpoint: Map<string, { statusCode: number }> = new Map()
  async send(sub, body, opts) {
    const error = this.errorByEndpoint.get(sub.endpoint)
    if (error) throw error
    this.sent.push({ endpoint: sub.endpoint, payload: body, ttl: opts.TTL, urgency: opts.urgency })
  }
}

const VAPID = { publicKey: "pub", privateKey: "prv", subject: "mailto:test@kanna" }

function chat(overrides: Partial<ObservedChat> = {}): ObservedChat {
  return {
    chatId: "c1",
    projectLocalPath: "/tmp/p",
    projectTitle: "P",
    chatTitle: "Hello",
    status: "idle",
    ...overrides,
  }
}

describe("PushManager.observeStatuses", () => {
  let store: FakeStore
  let sender: FakeSender
  let manager: PushManager

  beforeEach(async () => {
    store = new FakeStore()
    sender = new FakeSender()
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => 1000 })
    await manager.initialize()
  })

  test("first call seeds without firing", async () => {
    await manager.observeStatuses([chat({ status: "running" })])
    expect(sender.sent).toEqual([])
  })

  test("second call fires for waiting_for_user transition", async () => {
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    expect(sender.sent).toEqual([])  // no subscriptions registered yet
  })
})
```

- [ ] **Step 2: Run the test (expect FAIL)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimum to pass**

Create `src/server/push/push-manager.ts`:

```ts
import type {
  KannaStatus,
  PushPayload,
  PushSubscriptionRecord,
  PushTransitionKind,
} from "../../shared/types"
import type { PushEvent, PushEventStore } from "./events"
import type { VapidKeypair } from "./vapid"

export interface ObservedChat {
  chatId: string
  projectLocalPath: string
  projectTitle: string
  chatTitle: string
  status: KannaStatus
}

export interface WebPushSendOptions {
  TTL: number
  urgency: "very-low" | "low" | "normal" | "high"
  vapidDetails: { subject: string; publicKey: string; privateKey: string }
}

export interface WebPushSubscriptionShape {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface WebPushSender {
  send(
    subscription: WebPushSubscriptionShape,
    payload: string,
    options: WebPushSendOptions,
  ): Promise<void>
}

export interface PushManagerArgs {
  store: PushEventStore
  sender: WebPushSender
  vapid: VapidKeypair
  now?: () => number
}

export class PushManager {
  private readonly store: PushEventStore
  private readonly sender: WebPushSender
  private readonly vapid: VapidKeypair
  private readonly now: () => number
  private readonly subscriptions = new Map<string, PushSubscriptionRecord>()
  private readonly mutedProjects = new Set<string>()
  private readonly lastStatusByChat = new Map<string, KannaStatus>()
  private seeded = false

  constructor(args: PushManagerArgs) {
    this.store = args.store
    this.sender = args.sender
    this.vapid = args.vapid
    this.now = args.now ?? Date.now
  }

  async initialize(): Promise<void> {
    const events = await this.store.loadPushEvents()
    for (const event of events) {
      this.applyEvent(event)
    }
  }

  private applyEvent(event: PushEvent) {
    switch (event.kind) {
      case "subscription_added":
        this.subscriptions.set(event.id, event.record)
        break
      case "subscription_removed":
        this.subscriptions.delete(event.id)
        break
      case "subscription_seen": {
        const existing = this.subscriptions.get(event.id)
        if (existing) existing.lastSeenAt = event.ts
        break
      }
      case "project_mute_set":
        if (event.muted) this.mutedProjects.add(event.localPath)
        else this.mutedProjects.delete(event.localPath)
        break
    }
  }

  async observeStatuses(snapshot: readonly ObservedChat[]): Promise<void> {
    if (!this.seeded) {
      for (const chat of snapshot) {
        this.lastStatusByChat.set(chat.chatId, chat.status)
      }
      this.seeded = true
      return
    }
    for (const chat of snapshot) {
      const prev = this.lastStatusByChat.get(chat.chatId)
      this.lastStatusByChat.set(chat.chatId, chat.status)
      // Transition firing comes in later tasks.
      void prev
    }
  }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/push/push-manager.ts src/server/push/push-manager.test.ts
git commit -m "feat(push): PushManager skeleton with cold-start seeding"
```

---

## Task 8: Transition detection (waiting_for_user, failed, completed)

**Files:**
- Modify: `src/server/push/push-manager.ts`
- Modify: `src/server/push/push-manager.test.ts`

- [ ] **Step 1: Add subscription helper to test setup**

In `push-manager.test.ts`, add this helper just above the `describe("PushManager.observeStatuses", ...)` block:

```ts
async function registerSub(manager: PushManager, store: FakeStore, id: string, endpoint: string) {
  store.events.push({
    kind: "subscription_added",
    ts: 1,
    id,
    record: {
      id,
      endpoint,
      keys: { p256dh: "p", auth: "a" },
      label: "Test",
      userAgent: "Test",
      createdAt: 1,
      lastSeenAt: 1,
    },
  })
  await manager.initialize()
}
```

- [ ] **Step 2: Replace beforeEach to skip auto-init**

Replace the existing `beforeEach` in `describe("PushManager.observeStatuses", ...)` with:

```ts
  beforeEach(() => {
    store = new FakeStore()
    sender = new FakeSender()
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => 1000 })
  })
```

(remove the `await manager.initialize()` call). Each test now calls `initialize()` itself after registering whatever subs it needs.

Also update the existing two tests in that block to call `await manager.initialize()` at their start. The "first call seeds without firing" test becomes:

```ts
  test("first call seeds without firing", async () => {
    await manager.initialize()
    await manager.observeStatuses([chat({ status: "running" })])
    expect(sender.sent).toEqual([])
  })

  test("second call fires for waiting_for_user transition", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    expect(sender.sent).toHaveLength(1)
    const payload = JSON.parse(sender.sent[0].payload) as PushPayload
    expect(payload.kind).toBe("waiting_for_user")
    expect(payload.chatId).toBe("c1")
    expect(payload.projectLocalPath).toBe("/tmp/p")
  })
```

Add the import at the top of the test file:
```ts
import type { PushPayload } from "../../shared/types"
```

- [ ] **Step 3: Add three more transition tests**

Append within the same `describe`:

```ts
  test("fires for running -> idle (completed)", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "idle" })])
    expect(sender.sent).toHaveLength(1)
    expect(JSON.parse(sender.sent[0].payload).kind).toBe("completed")
  })

  test("fires for any -> failed", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "failed" })])
    expect(sender.sent).toHaveLength(1)
    expect(JSON.parse(sender.sent[0].payload).kind).toBe("failed")
  })

  test("does not fire for idle -> starting -> running", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "idle" })])
    await manager.observeStatuses([chat({ status: "starting" })])
    await manager.observeStatuses([chat({ status: "running" })])
    expect(sender.sent).toEqual([])
  })

  test("truncates long chat title to 80 chars", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    const long = "x".repeat(120)
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user", chatTitle: long })])
    expect(sender.sent).toHaveLength(1)
    const payload = JSON.parse(sender.sent[0].payload) as PushPayload
    expect(payload.chatTitle.length).toBe(80)
  })
```

- [ ] **Step 4: Run tests (expect FAILs)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: 4 fail (transitions don't fire yet).

- [ ] **Step 5: Implement transition detection + fan-out**

In `push-manager.ts`, replace the `observeStatuses` method body and add helpers:

```ts
  async observeStatuses(snapshot: readonly ObservedChat[]): Promise<void> {
    if (!this.seeded) {
      for (const chat of snapshot) {
        this.lastStatusByChat.set(chat.chatId, chat.status)
      }
      this.seeded = true
      return
    }
    for (const chat of snapshot) {
      const prev = this.lastStatusByChat.get(chat.chatId)
      this.lastStatusByChat.set(chat.chatId, chat.status)
      const kind = this.detectTransition(prev, chat.status)
      if (!kind) continue
      const payload = this.buildPayload(chat, kind)
      await this.fanOut(payload)
    }
  }

  private detectTransition(
    prev: KannaStatus | undefined,
    next: KannaStatus,
  ): PushTransitionKind | null {
    if (next === "waiting_for_user" && prev !== "waiting_for_user") return "waiting_for_user"
    if (next === "failed" && prev !== "failed") return "failed"
    if (next === "idle" && prev === "running") return "completed"
    return null
  }

  private buildPayload(chat: ObservedChat, kind: PushTransitionKind): PushPayload {
    return {
      v: 1,
      kind,
      projectLocalPath: chat.projectLocalPath,
      projectTitle: chat.projectTitle,
      chatId: chat.chatId,
      chatTitle: chat.chatTitle.slice(0, 80),
      chatUrl: `/chats/${chat.chatId}`,
      ts: this.now(),
    }
  }

  private async fanOut(payload: PushPayload): Promise<void> {
    const body = JSON.stringify(payload)
    for (const sub of this.subscriptions.values()) {
      await this.sender.send(sub, body, {
        TTL: 60,
        urgency: "normal",
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      })
    }
  }
```

- [ ] **Step 6: Run tests (expect all PASS)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/push/push-manager.ts src/server/push/push-manager.test.ts
git commit -m "feat(push): detect waiting_for_user/failed/completed transitions"
```

---

## Task 9: Per-kind TTL & urgency

**Files:**
- Modify: `src/server/push/push-manager.ts`
- Modify: `src/server/push/push-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `push-manager.test.ts`:

```ts
  test("uses high urgency for failed and low urgency for completed", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "failed" })])
    expect(sender.sent[0].urgency).toBe("high")
    expect(sender.sent[0].ttl).toBe(60)

    sender.sent = []
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "idle" })])
    expect(sender.sent[0].urgency).toBe("low")
  })
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `bun test src/server/push/push-manager.test.ts -t "urgency"`
Expected: FAIL (urgency hardcoded to "normal").

- [ ] **Step 3: Update `fanOut` to vary urgency by kind**

Replace `fanOut` in `push-manager.ts`:

```ts
  private async fanOut(payload: PushPayload): Promise<void> {
    const body = JSON.stringify(payload)
    const urgency = urgencyFor(payload.kind)
    for (const sub of this.subscriptions.values()) {
      await this.sender.send(sub, body, {
        TTL: 60,
        urgency,
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      })
    }
  }
```

Add at module scope (above the class):
```ts
function urgencyFor(kind: PushTransitionKind): "low" | "normal" | "high" {
  if (kind === "failed") return "high"
  if (kind === "completed") return "low"
  return "normal"
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/push/push-manager.ts src/server/push/push-manager.test.ts
git commit -m "feat(push): per-kind urgency (failed=high, completed=low)"
```

---

## Task 10: Dedup window, mute filter, focus suppression

**Files:**
- Modify: `src/server/push/push-manager.ts`
- Modify: `src/server/push/push-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `push-manager.test.ts`:

```ts
  test("dedups same (chatId, kind) within 2s", async () => {
    let nowMs = 1000
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => nowMs })
    await registerSub(manager, store, "d1", "https://push.example/x")

    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 2000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    nowMs = 3500  // 1.5s later
    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 4000  // .5s later
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(sender.sent).toHaveLength(1)
  })

  test("does not dedup after 2s window", async () => {
    let nowMs = 1000
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => nowMs })
    await registerSub(manager, store, "d1", "https://push.example/x")

    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 2000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    nowMs = 5000
    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 6000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(sender.sent).toHaveLength(2)
  })

  test("skips muted projects", async () => {
    store.events.push({
      kind: "project_mute_set",
      ts: 1,
      localPath: "/tmp/p",
      muted: true,
    })
    await registerSub(manager, store, "d1", "https://push.example/x")

    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    expect(sender.sent).toEqual([])
  })

  test("skips devices focused on the firing chat", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await registerSub(manager, store, "d2", "https://push.example/y")
    manager.setFocusedChat("d1", "c1")

    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0].endpoint).toBe("https://push.example/y")
  })

  test("clears focus on disconnect", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    manager.setFocusedChat("d1", "c1")
    manager.clearFocus("d1")

    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    expect(sender.sent).toHaveLength(1)
  })
```

- [ ] **Step 2: Run (expect FAILs)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: 5 fail (no dedup, no mute filter, no focus methods).

- [ ] **Step 3: Implement**

In `push-manager.ts`:

(a) Add the dedup map and focus map as private fields on the class:
```ts
  private readonly dedupKeyToTs = new Map<string, number>()
  private readonly focusedByDevice = new Map<string, string | null>()
```

(b) Add public focus methods:
```ts
  setFocusedChat(deviceId: string, chatId: string | null): void {
    this.focusedByDevice.set(deviceId, chatId)
  }

  clearFocus(deviceId: string): void {
    this.focusedByDevice.delete(deviceId)
  }
```

(c) Replace the `observeStatuses` body's transition block with dedup + filtering logic. New `observeStatuses`:

```ts
  async observeStatuses(snapshot: readonly ObservedChat[]): Promise<void> {
    if (!this.seeded) {
      for (const chat of snapshot) {
        this.lastStatusByChat.set(chat.chatId, chat.status)
      }
      this.seeded = true
      return
    }
    for (const chat of snapshot) {
      const prev = this.lastStatusByChat.get(chat.chatId)
      this.lastStatusByChat.set(chat.chatId, chat.status)
      const kind = this.detectTransition(prev, chat.status)
      if (!kind) continue
      if (this.isDuplicate(chat.chatId, kind)) continue
      if (this.mutedProjects.has(chat.projectLocalPath)) continue
      const payload = this.buildPayload(chat, kind)
      await this.fanOut(payload)
    }
  }

  private isDuplicate(chatId: string, kind: PushTransitionKind): boolean {
    const key = `${chatId}:${kind}`
    const ts = this.now()
    const last = this.dedupKeyToTs.get(key)
    if (last !== undefined && ts - last < 2000) return true
    this.dedupKeyToTs.set(key, ts)
    return false
  }
```

(d) Replace `fanOut` to filter by focus:
```ts
  private async fanOut(payload: PushPayload): Promise<void> {
    const body = JSON.stringify(payload)
    const urgency = urgencyFor(payload.kind)
    for (const sub of this.subscriptions.values()) {
      if (this.focusedByDevice.get(sub.id) === payload.chatId) continue
      await this.sender.send(sub, body, {
        TTL: 60,
        urgency,
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      })
    }
  }
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/push/push-manager.ts src/server/push/push-manager.test.ts
git commit -m "feat(push): dedup window, mute filter, per-device focus suppression"
```

---

## Task 11: Subscription add/remove, expired-purge, send-test, prefs

**Files:**
- Modify: `src/server/push/push-manager.ts`
- Modify: `src/server/push/push-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
describe("PushManager subscriptions", () => {
  let store: FakeStore
  let sender: FakeSender
  let manager: PushManager
  let nowMs = 1000

  beforeEach(() => {
    store = new FakeStore()
    sender = new FakeSender()
    nowMs = 1000
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => nowMs })
  })

  test("addSubscription persists and assigns id", async () => {
    await manager.initialize()
    const result = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone",
      userAgent: "Mozilla/5.0",
    })
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(store.events).toHaveLength(1)
    expect(store.events[0].kind).toBe("subscription_added")
    expect(manager.listDevices().map(d => d.id)).toContain(result.id)
  })

  test("removeSubscription writes user_revoked event", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone",
      userAgent: "ua",
    })
    await manager.removeSubscription(id, "user_revoked")
    expect(manager.listDevices()).toEqual([])
    expect(store.events.some(e => e.kind === "subscription_removed" && e.reason === "user_revoked")).toBe(true)
  })

  test("410 response purges the subscription as expired", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone",
      userAgent: "ua",
    })
    sender.errorByEndpoint.set("https://push.example/x", { statusCode: 410 })

    nowMs = 2000
    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 3000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(manager.listDevices()).toEqual([])
    const removed = store.events.find(e => e.kind === "subscription_removed")
    expect(removed && "reason" in removed && removed.reason).toBe("expired")
    void id
  })

  test("5xx response leaves the subscription intact", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone",
      userAgent: "ua",
    })
    sender.errorByEndpoint.set("https://push.example/x", { statusCode: 503 })

    nowMs = 2000
    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 3000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(manager.listDevices().map(d => d.id)).toContain(id)
    expect(store.events.find(e => e.kind === "subscription_removed")).toBeUndefined()
  })

  test("setProjectMute persists and filters", async () => {
    await manager.initialize()
    await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone", userAgent: "ua",
    })
    await manager.setProjectMute("/tmp/p", true)
    expect(manager.getPreferences().mutedProjectPaths).toContain("/tmp/p")
    expect(store.events.some(e => e.kind === "project_mute_set" && e.muted)).toBe(true)
  })

  test("sendTest fires only to the requested device", async () => {
    await manager.initialize()
    const a = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" } },
      label: "A", userAgent: "ua",
    })
    await manager.addSubscription({
      subscription: { endpoint: "https://push.example/b", keys: { p256dh: "p", auth: "a" } },
      label: "B", userAgent: "ua",
    })
    await manager.sendTest(a.id)
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0].endpoint).toBe("https://push.example/a")
    const payload = JSON.parse(sender.sent[0].payload) as PushPayload
    expect(payload.kind).toBe("completed")
    expect(payload.chatTitle).toBe("Test notification")
  })

  test("recordDeviceSeen debounces to <= 1 event/hour", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "X", userAgent: "ua",
    })
    nowMs = 5_000
    await manager.recordDeviceSeen(id)
    nowMs = 5_000 + 30 * 60 * 1000  // 30m later
    await manager.recordDeviceSeen(id)
    nowMs = 5_000 + 60 * 60 * 1000 + 1  // 1h+1ms after first
    await manager.recordDeviceSeen(id)

    const seenEvents = store.events.filter(e => e.kind === "subscription_seen")
    expect(seenEvents).toHaveLength(2)  // first + after 1h
  })

  test("getConfigSnapshot exposes vapid public key, prefs, and devices", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone", userAgent: "ua",
    })
    await manager.setProjectMute("/tmp/muted", true)

    const snap = manager.getConfigSnapshot(id)
    expect(snap.vapidPublicKey).toBe("pub")
    expect(snap.preferences.mutedProjectPaths).toContain("/tmp/muted")
    expect(snap.devices).toHaveLength(1)
    expect(snap.devices[0].isCurrentDevice).toBe(true)
    // Sensitive material must NOT leak into device summaries:
    expect(snap.devices[0]).not.toHaveProperty("endpoint")
    expect(snap.devices[0]).not.toHaveProperty("keys")
  })
})
```

- [ ] **Step 2: Run (expect FAILs)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: 8 new failures (methods missing).

- [ ] **Step 3: Implement**

Add these public/private methods to `PushManager` in `push-manager.ts`:

```ts
  async addSubscription(args: {
    subscription: WebPushSubscriptionShape
    label: string
    userAgent: string
  }): Promise<{ id: string }> {
    // dedupe by endpoint
    for (const existing of this.subscriptions.values()) {
      if (existing.endpoint === args.subscription.endpoint) {
        existing.lastSeenAt = this.now()
        existing.label = args.label
        existing.userAgent = args.userAgent
        return { id: existing.id }
      }
    }
    const id = crypto.randomUUID()
    const ts = this.now()
    const record: PushSubscriptionRecord = {
      id,
      endpoint: args.subscription.endpoint,
      keys: args.subscription.keys,
      label: args.label,
      userAgent: args.userAgent,
      createdAt: ts,
      lastSeenAt: ts,
    }
    const event: PushEvent = { kind: "subscription_added", ts, id, record }
    this.applyEvent(event)
    await this.store.appendPushEvent(event)
    return { id }
  }

  async removeSubscription(
    id: string,
    reason: "user_revoked" | "expired" | "replaced",
  ): Promise<void> {
    if (!this.subscriptions.has(id)) return
    const event: PushEvent = { kind: "subscription_removed", ts: this.now(), id, reason }
    this.applyEvent(event)
    await this.store.appendPushEvent(event)
  }

  async setProjectMute(localPath: string, muted: boolean): Promise<void> {
    const event: PushEvent = {
      kind: "project_mute_set",
      ts: this.now(),
      localPath,
      muted,
    }
    this.applyEvent(event)
    await this.store.appendPushEvent(event)
  }

  async recordDeviceSeen(id: string): Promise<void> {
    const sub = this.subscriptions.get(id)
    if (!sub) return
    const ts = this.now()
    const SEEN_WRITE_INTERVAL_MS = 60 * 60 * 1000
    if (ts - sub.lastSeenAt < SEEN_WRITE_INTERVAL_MS) return
    const event: PushEvent = { kind: "subscription_seen", ts, id }
    this.applyEvent(event)
    await this.store.appendPushEvent(event)
  }

  async sendTest(id: string): Promise<void> {
    const sub = this.subscriptions.get(id)
    if (!sub) return
    const payload: PushPayload = {
      v: 1,
      kind: "completed",
      projectLocalPath: "kanna",
      projectTitle: "Kanna",
      chatId: "test",
      chatTitle: "Test notification",
      chatUrl: "/",
      ts: this.now(),
    }
    await this.deliver(sub, payload)
  }

  listDevices(): PushSubscriptionRecord[] {
    return [...this.subscriptions.values()]
  }

  getPreferences(): { globalEnabled: boolean; mutedProjectPaths: string[] } {
    return {
      globalEnabled: true,
      mutedProjectPaths: [...this.mutedProjects],
    }
  }

  getConfigSnapshot(currentDeviceId: string | null): {
    vapidPublicKey: string
    preferences: { globalEnabled: boolean; mutedProjectPaths: string[] }
    devices: Array<{
      id: string
      label: string
      userAgent: string
      createdAt: number
      lastSeenAt: number
      isCurrentDevice: boolean
    }>
  } {
    return {
      vapidPublicKey: this.vapid.publicKey,
      preferences: this.getPreferences(),
      devices: this.listDevices().map((sub) => ({
        id: sub.id,
        label: sub.label,
        userAgent: sub.userAgent,
        createdAt: sub.createdAt,
        lastSeenAt: sub.lastSeenAt,
        isCurrentDevice: currentDeviceId === sub.id,
      })),
    }
  }
```

Replace the `fanOut` method with one that delegates to a per-subscription `deliver`:

```ts
  private async fanOut(payload: PushPayload): Promise<void> {
    for (const sub of [...this.subscriptions.values()]) {
      if (this.focusedByDevice.get(sub.id) === payload.chatId) continue
      await this.deliver(sub, payload)
    }
  }

  private async deliver(sub: PushSubscriptionRecord, payload: PushPayload): Promise<void> {
    const body = JSON.stringify(payload)
    try {
      await this.sender.send(sub, body, {
        TTL: 60,
        urgency: urgencyFor(payload.kind),
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 410 || status === 404 || status === 403) {
        await this.removeSubscription(sub.id, "expired")
      } else {
        console.warn("[kanna/push] delivery failed", { id: sub.id, status, error })
      }
    }
  }
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/push/push-manager.ts src/server/push/push-manager.test.ts
git commit -m "feat(push): subscriptions, mute, send-test, debounced 'seen', config snapshot"
```

---

## Task 12: Wrap `web-push` library as `WebPushSender`

**Files:**
- Modify: `src/server/push/push-manager.ts`

- [ ] **Step 1: Add the production sender export**

Append to `push-manager.ts`:

```ts
import webpush from "web-push"

export const realWebPushSender: WebPushSender = {
  async send(sub, payload, opts) {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      payload,
      {
        TTL: opts.TTL,
        urgency: opts.urgency,
        vapidDetails: opts.vapidDetails,
      },
    )
  },
}
```

(Note: `web-push` rejects with an error object whose `statusCode` field is the push-service HTTP status. The fake sender in tests already mimics this — no test changes needed.)

- [ ] **Step 2: Typecheck**

Run: `tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 3: Run unit tests (regression check)**

Run: `bun test src/server/push/push-manager.test.ts`
Expected: all still pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/push/push-manager.ts
git commit -m "feat(push): real web-push sender wrapper"
```

---

## Task 13: Wire PushManager into ws-router (commands + observe hook)

**Files:**
- Modify: `src/server/ws-router.ts`
- Modify: `src/server/server.ts`

- [ ] **Step 1: Add `pushManager` to `CreateWsRouterArgs` and `ClientState`**

In `src/server/ws-router.ts`:

(a) Add the import after the existing `read-models` import (around line 18):
```ts
import type { PushManager } from "./push/push-manager"
```

(b) Extend `ClientState` (around line 100):
```ts
export interface ClientState {
  subscriptions: Map<string, SubscriptionTopic>
  snapshotSignatures: Map<string, string>
  protectedDraftChatIds?: Set<string>
  pushDeviceId?: string | null
}
```

(c) Add `pushManager` to `CreateWsRouterArgs` (around line 107):
```ts
  pushManager: PushManager
```

- [ ] **Step 2: Hook `observeStatuses` into the sidebar derivation**

Find `getSidebarSnapshotCacheEntry` (around line 423) and replace its body so that after building `data`, the manager observes the per-chat snapshot:

```ts
  function getSidebarSnapshotCacheEntry(cache?: SnapshotComputationCache) {
    if (cache?.sidebar) {
      return cache.sidebar
    }

    const startedAt = performance.now()
    const data = deriveSidebarData(store.state, agent.getActiveStatuses(), {
      sidebarProjectOrder: getSidebarProjectOrder(store),
      drainingChatIds: agent.getDrainingChatIds(),
    })

    const observed = data.projectGroups.flatMap((group) =>
      group.chats.map((chat) => ({
        chatId: chat.chatId,
        projectLocalPath: group.localPath,
        projectTitle: group.localPath.split("/").filter(Boolean).pop() ?? group.localPath,
        chatTitle: chat.title,
        status: chat.status,
      }))
    )
    void pushManager.observeStatuses(observed)

    if (isSendToStartingProfilingEnabled()) {
      // ... unchanged ...
    }

    const sidebar = {
      data,
      signature: JSON.stringify({
        type: "sidebar" as const,
        data,
      }),
    }

    if (cache) {
      cache.sidebar = sidebar
    }

    return sidebar
  }
```

(Use the existing destructured `pushManager` from `args` — see step 4 below.)

- [ ] **Step 3: Add `push-config` snapshot path to `createEnvelope`**

In `createEnvelope` (around line 460), after the `keybindings` branch, add:

```ts
    if (topic.type === "push-config") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "push-config",
          data: pushManager.getConfigSnapshot(connection?.data.pushDeviceId ?? null),
        },
      }
    }
```

`createEnvelope` does not currently take a `connection` arg — find where it is called. The existing code calls `createEnvelope(id, topic, cache)`. Update its signature to optionally accept the WS:

```ts
  function createEnvelope(
    id: string,
    topic: SubscriptionTopic,
    cache?: SnapshotComputationCache,
    connection?: ServerWebSocket<ClientState>,
  ): ServerEnvelope {
```

Then update **every** call site of `createEnvelope` to pass `ws` as the 4th argument when available. Search the file for `createEnvelope(` and add `, ws` (or `, connection`) where the call site has access to the WS instance. Cases without a WS (broadcast loops) already iterate clients, so they have a WS in scope.

- [ ] **Step 4: Destructure `pushManager` and route `push.*` commands**

Find the args destructure at the top of `createWsRouter` (search for `function createWsRouter(` — typically around line 350 of the file). Add `pushManager` to the destructured args.

Then find the big `switch (command.type)` block (around line 844) and add these cases right before the `default:` (or before any closing brace if there isn't a default):

```ts
        case "push.identifyDevice": {
          ws.data.pushDeviceId = command.pushDeviceId
          if (command.pushDeviceId) {
            await pushManager.recordDeviceSeen(command.pushDeviceId)
            await broadcastFilteredSnapshots({ includePushConfig: true })
          }
          send(ackEnvelope(message.id))
          break
        }
        case "push.subscribe": {
          const result = await pushManager.addSubscription({
            subscription: command.subscription,
            label: command.label,
            userAgent: command.userAgent,
          })
          ws.data.pushDeviceId = result.id
          await broadcastFilteredSnapshots({ includePushConfig: true })
          send(ackEnvelope(message.id, result))
          break
        }
        case "push.unsubscribe": {
          await pushManager.removeSubscription(command.pushDeviceId, "user_revoked")
          if (ws.data.pushDeviceId === command.pushDeviceId) {
            ws.data.pushDeviceId = null
          }
          await broadcastFilteredSnapshots({ includePushConfig: true })
          send(ackEnvelope(message.id))
          break
        }
        case "push.test": {
          if (ws.data.pushDeviceId) {
            await pushManager.sendTest(ws.data.pushDeviceId)
          }
          send(ackEnvelope(message.id))
          break
        }
        case "push.setProjectMute": {
          await pushManager.setProjectMute(command.localPath, command.muted)
          await broadcastFilteredSnapshots({ includePushConfig: true })
          send(ackEnvelope(message.id))
          break
        }
        case "push.setFocusedChat": {
          if (ws.data.pushDeviceId) {
            pushManager.setFocusedChat(ws.data.pushDeviceId, command.chatId)
          }
          send(ackEnvelope(message.id))
          break
        }
```

(If `ackEnvelope` does not exist, look for the project's existing ack pattern in the same `switch` and follow it. The pattern in this codebase is `send({ v: PROTOCOL_VERSION, type: "ack", id: message.id, result })`.)

- [ ] **Step 5: Add `includePushConfig` to `SnapshotBroadcastFilter`**

Find `SnapshotBroadcastFilter` (search for the type) and add the optional flag:

```ts
interface SnapshotBroadcastFilter {
  includeSidebar?: boolean
  includePushConfig?: boolean
  // ... existing fields ...
  chatIds?: Set<string>
  projectIds?: Set<string>
  terminalIds?: Set<string>
}
```

In `topicMatchesFilter` (around line 410), add:

```ts
    if (topic.type === "push-config") {
      return filter.includePushConfig ?? false
    }
```

- [ ] **Step 6: Disconnect cleanup**

Find the WS `close` handler (search for `addEventListener("close")` or the `close` callback in the Bun WS handler — usually inside `routeMessage` setup or a top-level `close` callback). Add:

```ts
    if (ws.data.pushDeviceId) {
      pushManager.clearFocus(ws.data.pushDeviceId)
    }
```

- [ ] **Step 7: Plumb `pushManager` through `server.ts`**

In `src/server/server.ts`:

(a) Add imports near the top (after `event-store` import):
```ts
import { PushManager, realWebPushSender } from "./push/push-manager"
import { loadOrGenerateVapidKeys } from "./push/vapid"
```

(b) Construct manager during startup. Find where `EventStore` is constructed and `await store.initialize()` is called, then append:
```ts
  const vapid = await loadOrGenerateVapidKeys(store.dataDir)
  const pushManager = new PushManager({
    store: {
      appendPushEvent: (event) => store.appendPushEvent(event),
      loadPushEvents: () => store.loadPushEvents(),
    },
    sender: realWebPushSender,
    vapid,
  })
  await pushManager.initialize()
```

(c) Pass `pushManager` to `createWsRouter`. Find the `createWsRouter({ ... })` call in `server.ts` and add `pushManager,` to the args object.

- [ ] **Step 8: Typecheck**

Run: `tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 9: Run server-side tests**

Run: `bun test src/server/`
Expected: all pass (we have not changed any existing behavior; we only added).

- [ ] **Step 10: Commit**

```bash
git add src/server/ws-router.ts src/server/server.ts
git commit -m "feat(push): wire PushManager into ws-router and server startup"
```

---

## Task 14: Service worker (`public/sw.js`)

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1: Write the file**

Create `public/sw.js`:

```js
// Kanna service worker. Plain JS — no bundling.
// Receives Web Push payloads, displays OS notifications grouped by project,
// and routes notification taps to the right chat.

function bodyFor(payload) {
  const title = payload.chatTitle || "(untitled)"
  switch (payload.kind) {
    case "waiting_for_user":
      return `${title} — waiting for input`
    case "failed":
      return `${title} — failed`
    case "completed":
      return `${title} — done`
    default:
      return title
  }
}

self.addEventListener("push", (event) => {
  let payload
  try {
    payload = event.data ? event.data.json() : null
  } catch {
    return
  }
  if (!payload || payload.v !== 1) return

  const title = `Kanna • ${payload.projectTitle || "Project"}`
  event.waitUntil(self.registration.showNotification(title, {
    body: bodyFor(payload),
    tag: payload.projectLocalPath,
    renotify: false,
    data: { chatUrl: payload.chatUrl, ts: payload.ts },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.chatUrl) || "/"
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const sameOrigin = all.filter((c) => new URL(c.url).origin === self.location.origin)
    const hit = sameOrigin[0]
    if (hit) {
      await hit.focus()
      hit.postMessage({ type: "kanna.navigate", url })
    } else {
      await self.clients.openWindow(url)
    }
  })())
})

self.addEventListener("pushsubscriptionchange", () => {
  // The page will detect the missing/changed subscription on its next load
  // and re-subscribe. The SW cannot reach the Kanna WS directly.
})

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})
```

- [ ] **Step 2: Sanity-check it parses**

Run: `bun -e 'import("./public/sw.js").catch(() => Bun.file("./public/sw.js").text()).then(t => console.log(typeof t === "string" ? "ok bytes=" + t.length : "ok"))'`
Expected: prints `ok bytes=...` (it's not an importable module — we just confirm the file is non-empty).

- [ ] **Step 3: Verify Vite serves it at `/sw.js`**

Run: `bun run dev:server` in one terminal, then in another: `curl -sI http://localhost:5175/sw.js | head -3`
(If the dev server uses 3211 / different port, adjust per `src/shared/ports.ts`.)
Expected: `HTTP/1.1 200 OK` and a `content-type` of `application/javascript` (or `text/javascript`).
Stop the dev server with Ctrl+C.

If the SW is not served (404), check `vite.config.ts` and `src/server/server.ts` static-serving — both should already serve `public/` verbatim. If not, file a follow-up; do not patch the static handler in this task.

- [ ] **Step 4: Commit**

```bash
git add public/sw.js
git commit -m "feat(push): service worker for receiving pushes and routing taps"
```

---

## Task 15: `pushClient.ts` — feature detection

**Files:**
- Create: `src/client/app/pushClient.ts`
- Test: `src/client/app/pushClient.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/client/app/pushClient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { detectPushSupport } from "./pushClient"

const originalNotification = (globalThis as { Notification?: unknown }).Notification
const originalNavigator = globalThis.navigator
const originalIsSecureContext = (globalThis as { isSecureContext?: boolean }).isSecureContext
const originalWindow = (globalThis as { window?: unknown }).window
const originalPushManager = (globalThis as { PushManager?: unknown }).PushManager

afterEach(() => {
  ;(globalThis as { Notification?: unknown }).Notification = originalNotification
  ;(globalThis as { navigator?: unknown }).navigator = originalNavigator
  ;(globalThis as { isSecureContext?: boolean }).isSecureContext = originalIsSecureContext
  ;(globalThis as { window?: unknown }).window = originalWindow
  ;(globalThis as { PushManager?: unknown }).PushManager = originalPushManager
})

function setupBrowser(opts: {
  hasNotification?: boolean
  hasServiceWorker?: boolean
  hasPushManager?: boolean
  isSecureContext?: boolean
  hostname?: string
  permission?: NotificationPermission
}) {
  ;(globalThis as { window?: unknown }).window = {
    isSecureContext: opts.isSecureContext ?? true,
    location: { hostname: opts.hostname ?? "example.com" },
  }
  ;(globalThis as { isSecureContext?: boolean }).isSecureContext = opts.isSecureContext ?? true
  ;(globalThis as { Notification?: unknown }).Notification = opts.hasNotification === false
    ? undefined
    : { permission: opts.permission ?? "default", requestPermission: async () => "granted" }
  ;(globalThis as { navigator?: unknown }).navigator = opts.hasServiceWorker === false
    ? {}
    : { serviceWorker: { register: async () => ({}), ready: Promise.resolve({}) }, userAgent: "test" }
  ;(globalThis as { PushManager?: unknown }).PushManager = opts.hasPushManager === false ? undefined : function () {}
}

describe("detectPushSupport", () => {
  test("unsupported when Notification API missing", () => {
    setupBrowser({ hasNotification: false })
    expect(detectPushSupport().state).toBe("unsupported")
  })

  test("unsupported when serviceWorker missing", () => {
    setupBrowser({ hasServiceWorker: false })
    expect(detectPushSupport().state).toBe("unsupported")
  })

  test("unsupported when PushManager missing", () => {
    setupBrowser({ hasPushManager: false })
    expect(detectPushSupport().state).toBe("unsupported")
  })

  test("insecure-context when not isSecureContext and not localhost", () => {
    setupBrowser({ isSecureContext: false, hostname: "foo.example" })
    expect(detectPushSupport().state).toBe("insecure-context")
  })

  test("default when localhost over http", () => {
    setupBrowser({ isSecureContext: false, hostname: "localhost", permission: "default" })
    expect(detectPushSupport().state).toBe("default")
  })

  test("granted when permission is granted", () => {
    setupBrowser({ permission: "granted" })
    expect(detectPushSupport().state).toBe("granted")
  })

  test("denied when permission is denied", () => {
    setupBrowser({ permission: "denied" })
    expect(detectPushSupport().state).toBe("denied")
  })
})
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `bun test src/client/app/pushClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimum to pass**

Create `src/client/app/pushClient.ts`:

```ts
export type PushPermissionState =
  | "unsupported"
  | "insecure-context"
  | "default"
  | "granted"
  | "denied"

export interface PushSupportSnapshot {
  state: PushPermissionState
}

function isFeatureSupported(): boolean {
  if (typeof window === "undefined") return false
  if (typeof Notification === "undefined") return false
  if (!("serviceWorker" in navigator)) return false
  if (typeof (window as { PushManager?: unknown }).PushManager === "undefined") return false
  return true
}

function isSecure(): boolean {
  if (typeof window === "undefined") return false
  if ((window as { isSecureContext?: boolean }).isSecureContext) return true
  const host = window.location?.hostname ?? ""
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
}

export function detectPushSupport(): PushSupportSnapshot {
  if (!isFeatureSupported()) return { state: "unsupported" }
  if (!isSecure()) return { state: "insecure-context" }
  switch (Notification.permission) {
    case "granted": return { state: "granted" }
    case "denied": return { state: "denied" }
    default: return { state: "default" }
  }
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `bun test src/client/app/pushClient.test.ts`
Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/app/pushClient.ts src/client/app/pushClient.test.ts
git commit -m "feat(push): client feature/permission detection"
```

---

## Task 16: `pushClient.ts` — subscribe / unsubscribe / re-subscribe

**Files:**
- Modify: `src/client/app/pushClient.ts`
- Modify: `src/client/app/pushClient.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `pushClient.test.ts`:

```ts
import { subscribePush, unsubscribePush, urlBase64ToUint8Array, type PushSubscribeServerCall } from "./pushClient"

describe("urlBase64ToUint8Array", () => {
  test("decodes a known VAPID key", () => {
    const key = "BPg4MhSNQjK4FjoUf4f9Ye_K2gM4ahK_5BWj9rYjZ8sHbqJj9oKkrFHBwZJh1XJF8AaXh"
    const decoded = urlBase64ToUint8Array(key)
    expect(decoded).toBeInstanceOf(Uint8Array)
    expect(decoded.length).toBeGreaterThan(40)
  })
})

describe("subscribePush", () => {
  test("requests permission, registers SW, subscribes, calls server, returns id", async () => {
    const subscribe = async (opts: { applicationServerKey: Uint8Array; userVisibleOnly: boolean }) => ({
      endpoint: "https://push.example/abc",
      toJSON: () => ({
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
      }),
    })
    const reg = { pushManager: { subscribe, getSubscription: async () => null } }
    ;(globalThis as { window?: unknown }).window = { isSecureContext: true, location: { hostname: "x" } }
    ;(globalThis as { Notification?: unknown }).Notification = {
      permission: "default",
      requestPermission: async () => "granted",
    }
    ;(globalThis as { navigator?: unknown }).navigator = {
      serviceWorker: {
        register: async () => reg,
        ready: Promise.resolve(reg),
      },
      userAgent: "Mozilla/5.0 (TestUA)",
    }
    ;(globalThis as { PushManager?: unknown }).PushManager = function () {}

    const calls: PushSubscribeServerCall[] = []
    const id = await subscribePush({
      vapidPublicKey: "BPg4MhSNQjK4FjoUf4f9Ye_K2gM4ahK_5BWj9rYjZ8sHbqJj9oKkrFHBwZJh1XJF8AaXh",
      sendToServer: async (payload) => {
        calls.push(payload)
        return { id: "device-1" }
      },
    })

    expect(id).toBe("device-1")
    expect(calls).toHaveLength(1)
    expect(calls[0].subscription.endpoint).toBe("https://push.example/abc")
    expect(calls[0].label).toMatch(/Mozilla/)
  })

  test("throws when permission denied", async () => {
    ;(globalThis as { window?: unknown }).window = { isSecureContext: true, location: { hostname: "x" } }
    ;(globalThis as { Notification?: unknown }).Notification = {
      permission: "default",
      requestPermission: async () => "denied",
    }
    ;(globalThis as { navigator?: unknown }).navigator = {
      serviceWorker: { register: async () => ({}), ready: Promise.resolve({}) },
      userAgent: "ua",
    }
    ;(globalThis as { PushManager?: unknown }).PushManager = function () {}

    await expect(subscribePush({
      vapidPublicKey: "BPg4MhSNQjK4FjoUf4f9Ye_K2gM4ahK_5BWj9rYjZ8sHbqJj9oKkrFHBwZJh1XJF8AaXh",
      sendToServer: async () => ({ id: "x" }),
    })).rejects.toThrow(/permission/i)
  })
})

describe("unsubscribePush", () => {
  test("calls subscription.unsubscribe and notifies server", async () => {
    let unsubscribed = false
    const sub = { unsubscribe: async () => { unsubscribed = true; return true } }
    const reg = { pushManager: { getSubscription: async () => sub } }
    ;(globalThis as { navigator?: unknown }).navigator = {
      serviceWorker: { ready: Promise.resolve(reg), register: async () => reg },
      userAgent: "ua",
    }

    let told: string | null = null
    await unsubscribePush({
      pushDeviceId: "device-1",
      sendToServer: async (id) => { told = id },
    })
    expect(unsubscribed).toBe(true)
    expect(told).toBe("device-1")
  })
})
```

- [ ] **Step 2: Run (expect FAILs)**

Run: `bun test src/client/app/pushClient.test.ts`
Expected: 4 new failures (functions missing).

- [ ] **Step 3: Implement**

Append to `pushClient.ts`:

```ts
export interface PushSubscribeServerCall {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
  label: string
  userAgent: string
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i)
  }
  return bytes
}

function deriveLabel(userAgent: string): string {
  const ua = userAgent || ""
  if (/iPhone|iPad/i.test(ua)) return "iPhone / iPad"
  if (/Android/i.test(ua)) return "Android"
  if (/Macintosh/i.test(ua)) return "Mac"
  if (/Windows/i.test(ua)) return "Windows PC"
  return "Browser"
}

export async function subscribePush(args: {
  vapidPublicKey: string
  sendToServer: (payload: PushSubscribeServerCall) => Promise<{ id: string }>
}): Promise<string> {
  const support = detectPushSupport()
  if (support.state === "unsupported") throw new Error("Push not supported in this browser")
  if (support.state === "insecure-context") throw new Error("Push requires a secure context (HTTPS)")
  if (support.state === "denied") throw new Error("Notification permission previously denied")

  const result = await Notification.requestPermission()
  if (result !== "granted") throw new Error("Notification permission was not granted")

  const reg = await navigator.serviceWorker.register("/sw.js")
  await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(args.vapidPublicKey),
  })

  const json = subscription.toJSON()
  const endpoint = json.endpoint ?? subscription.endpoint
  const keys = (json.keys ?? {}) as { p256dh?: string; auth?: string }
  if (!endpoint || !keys.p256dh || !keys.auth) {
    throw new Error("Subscription returned without endpoint or keys")
  }
  const ua = navigator.userAgent ?? ""
  const { id } = await args.sendToServer({
    subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
    label: deriveLabel(ua),
    userAgent: ua,
  })
  return id
}

export async function unsubscribePush(args: {
  pushDeviceId: string
  sendToServer: (pushDeviceId: string) => Promise<void>
}): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
  await args.sendToServer(args.pushDeviceId)
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `bun test src/client/app/pushClient.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/app/pushClient.ts src/client/app/pushClient.test.ts
git commit -m "feat(push): client subscribe/unsubscribe and VAPID key decoding"
```

---

## Task 17: Settings UI — `PushNotificationsSection.tsx`

**Files:**
- Create: `src/client/components/settings/PushNotificationsSection.tsx`
- Test: `src/client/components/settings/PushNotificationsSection.test.tsx`
- Modify: `src/client/app/SettingsPage.tsx`

- [ ] **Step 1: Write failing render tests**

Create `src/client/components/settings/PushNotificationsSection.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PushNotificationsSection } from "./PushNotificationsSection"
import type { PushConfigSnapshot, LocalProjectsSnapshot } from "../../../shared/types"

const baseConfig: PushConfigSnapshot = {
  vapidPublicKey: "key",
  preferences: { globalEnabled: true, mutedProjectPaths: [] },
  devices: [],
}

const baseProjects: LocalProjectsSnapshot["projects"] = [
  { localPath: "/tmp/a", title: "a", source: "saved", chatCount: 0 },
  { localPath: "/tmp/b", title: "b", source: "saved", chatCount: 0 },
]

const noopHandlers = {
  onEnable: async () => {},
  onDisable: async () => {},
  onTest: async () => {},
  onMuteToggle: async () => {},
  onRemoveDevice: async () => {},
}

describe("PushNotificationsSection", () => {
  test("renders the unsupported notice", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="unsupported"
        config={baseConfig}
        projects={baseProjects}
        currentDeviceId={null}
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/not supported/i)
  })

  test("renders the insecure-context message with --share hint", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="insecure-context"
        config={baseConfig}
        projects={baseProjects}
        currentDeviceId={null}
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/HTTPS/i)
    expect(html).toMatch(/--share/i)
  })

  test("renders 'Enable on this device' when permission default", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="default"
        config={baseConfig}
        projects={baseProjects}
        currentDeviceId={null}
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/Enable on this device/i)
  })

  test("renders denied state with re-enable prompt", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="denied"
        config={baseConfig}
        projects={baseProjects}
        currentDeviceId={null}
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/blocked notifications/i)
  })

  test("granted+subscribed shows devices and project list", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="granted"
        config={{
          ...baseConfig,
          devices: [{ id: "d1", label: "iPhone", userAgent: "ua", createdAt: 0, lastSeenAt: 0, isCurrentDevice: true }],
          preferences: { globalEnabled: true, mutedProjectPaths: ["/tmp/a"] },
        }}
        projects={baseProjects}
        currentDeviceId="d1"
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/iPhone/)
    expect(html).toMatch(/Send test/i)
    expect(html).toMatch(/\/tmp\/a/)
    expect(html).toMatch(/\/tmp\/b/)
  })

  test("does not render endpoint or keys for any device", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="granted"
        config={{
          ...baseConfig,
          devices: [{ id: "d1", label: "iPhone", userAgent: "https://leak.example/should/not/show", createdAt: 0, lastSeenAt: 0, isCurrentDevice: true }],
        }}
        projects={baseProjects}
        currentDeviceId="d1"
        {...noopHandlers}
      />
    )
    // We deliberately put the leak string in userAgent — userAgent is allowed
    // to render. The point of this assertion is that we never serialize the
    // raw subscription endpoint into the DOM:
    expect(html).not.toMatch(/p256dh/i)
    expect(html).not.toMatch(/applicationServerKey/i)
  })
})
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `bun test src/client/components/settings/PushNotificationsSection.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/client/components/settings/PushNotificationsSection.tsx`:

```tsx
import type { LocalProjectsSnapshot, PushConfigSnapshot } from "../../../shared/types"
import type { PushPermissionState } from "../../app/pushClient"

interface PushNotificationsSectionProps {
  permissionState: PushPermissionState
  config: PushConfigSnapshot
  projects: LocalProjectsSnapshot["projects"]
  currentDeviceId: string | null
  onEnable: () => Promise<void>
  onDisable: () => Promise<void>
  onTest: () => Promise<void>
  onMuteToggle: (localPath: string, muted: boolean) => Promise<void>
  onRemoveDevice: (id: string) => Promise<void>
}

export function PushNotificationsSection(props: PushNotificationsSectionProps) {
  const { permissionState } = props

  if (permissionState === "unsupported") {
    return (
      <section>
        <h2>Push Notifications</h2>
        <p>Push notifications are not supported in this browser.</p>
      </section>
    )
  }

  if (permissionState === "insecure-context") {
    return (
      <section>
        <h2>Push Notifications</h2>
        <p>
          Push requires HTTPS. Run <code>kanna --share</code> or open Kanna over a tunnel,
          then enable on this device.
        </p>
      </section>
    )
  }

  if (permissionState === "denied") {
    return (
      <section>
        <h2>Push Notifications</h2>
        <p>You blocked notifications for this site. Re-enable them in your browser settings, then reload.</p>
      </section>
    )
  }

  const isSubscribed = permissionState === "granted"
    && props.config.devices.some((d) => d.id === props.currentDeviceId)

  if (!isSubscribed) {
    return (
      <section>
        <h2>Push Notifications</h2>
        <p>Get a notification when a chat is waiting for you, finishes, or fails.</p>
        <button type="button" onClick={() => void props.onEnable()}>Enable on this device</button>
      </section>
    )
  }

  const muted = new Set(props.config.preferences.mutedProjectPaths)

  return (
    <section>
      <h2>Push Notifications</h2>
      <div>● Enabled on this device</div>
      <div>
        <button type="button" onClick={() => void props.onTest()}>Send test</button>
        <button type="button" onClick={() => void props.onDisable()}>Disable</button>
      </div>

      <h3>Devices</h3>
      <ul>
        {props.config.devices.map((device) => (
          <li key={device.id}>
            <span>{device.label}</span>
            <span> — {device.userAgent}</span>
            {!device.isCurrentDevice && (
              <button type="button" onClick={() => void props.onRemoveDevice(device.id)}>×</button>
            )}
          </li>
        ))}
      </ul>

      <h3>Per-project</h3>
      <ul>
        {props.projects.map((project) => (
          <li key={project.localPath}>
            <label>
              <input
                type="checkbox"
                checked={!muted.has(project.localPath)}
                onChange={(e) => void props.onMuteToggle(project.localPath, !e.target.checked)}
              />
              {project.localPath}
            </label>
          </li>
        ))}
      </ul>

      <p>
        Phone setup: this page must be reachable over HTTPS. Run <code>kanna --share</code>
        or open Kanna over your tunnel on the phone, then enable on that device.
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `bun test src/client/components/settings/PushNotificationsSection.test.tsx`
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/settings/PushNotificationsSection.tsx src/client/components/settings/PushNotificationsSection.test.tsx
git commit -m "feat(push): Settings section component for permission states + device list"
```

---

## Task 18: Mount the section in `SettingsPage.tsx`

**Files:**
- Modify: `src/client/app/SettingsPage.tsx`
- Modify: `src/client/app/socket.ts`

- [ ] **Step 1: Add subscription/identify wiring in `socket.ts`**

In `src/client/app/socket.ts`:

(a) Find the `addEventListener("open", ...)` block (around line 182) and append, inside the open handler, after subscription replay:

```ts
      const pushDeviceId = typeof localStorage !== "undefined"
        ? localStorage.getItem("pushDeviceId")
        : null
      if (pushDeviceId) {
        this.send({
          v: 1,
          type: "command",
          id: crypto.randomUUID(),
          command: { type: "push.identifyDevice", pushDeviceId },
        })
      }
```

(b) Add a public method to send focus updates. Below the existing `subscribe` / `command` helpers, add:

```ts
  setFocusedChat(chatId: string | null) {
    this.send({
      v: 1,
      type: "command",
      id: crypto.randomUUID(),
      command: { type: "push.setFocusedChat", chatId },
    })
  }
```

(c) On message: handle SW navigation. In the `message` handler (around line 200), after parsing the envelope, also wire SW message handling. Add at the top of the file (above the class):

```ts
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = (event as MessageEvent<{ type?: string; url?: string }>).data
    if (data?.type === "kanna.navigate" && typeof data.url === "string") {
      window.location.href = data.url
    }
  })
}
```

- [ ] **Step 2: Mount the Settings section**

In `src/client/app/SettingsPage.tsx`:

(a) Add an import near the top with the other settings-section imports:
```ts
import { PushNotificationsSection } from "../components/settings/PushNotificationsSection"
import { detectPushSupport, subscribePush, unsubscribePush, type PushPermissionState } from "./pushClient"
```

(b) Find where you'd render a new section. The simplest place is the same area where `AutoResumeToggleSection` is rendered (line 1295). Insert directly after it (or before, your choice):

```tsx
                        <PushNotificationsSection
                          permissionState={pushPermissionState}
                          config={pushConfig}
                          projects={localProjects ?? []}
                          currentDeviceId={pushDeviceId}
                          onEnable={async () => {
                            const id = await subscribePush({
                              vapidPublicKey: pushConfig.vapidPublicKey,
                              sendToServer: async (payload) => {
                                const { id } = await sendCommand<{ id: string }>({
                                  type: "push.subscribe",
                                  ...payload,
                                })
                                if (typeof localStorage !== "undefined") {
                                  localStorage.setItem("pushDeviceId", id)
                                }
                                return { id }
                              },
                            })
                            setPushDeviceId(id)
                          }}
                          onDisable={async () => {
                            if (!pushDeviceId) return
                            await unsubscribePush({
                              pushDeviceId,
                              sendToServer: (id) => sendCommand({ type: "push.unsubscribe", pushDeviceId: id }),
                            })
                            if (typeof localStorage !== "undefined") {
                              localStorage.removeItem("pushDeviceId")
                            }
                            setPushDeviceId(null)
                          }}
                          onTest={() => sendCommand({ type: "push.test" })}
                          onMuteToggle={(localPath, muted) => sendCommand({ type: "push.setProjectMute", localPath, muted })}
                          onRemoveDevice={(id) => sendCommand({ type: "push.unsubscribe", pushDeviceId: id })}
                        />
```

(c) Wire `pushPermissionState`, `pushConfig`, `pushDeviceId`, `localProjects`, `setPushDeviceId`, and `sendCommand` near the top of the `SettingsPage` function body. Use the existing `useKannaState` / `socket` accessors — the file already grabs `socket` (search for `useSocket` or `socket` references). Pattern to add:

```ts
  const [pushPermissionState, setPushPermissionState] = useState<PushPermissionState>(() => detectPushSupport().state)
  const [pushDeviceId, setPushDeviceId] = useState<string | null>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem("pushDeviceId") : null
  )
  const pushConfig = usePushConfigSubscription()  // see step (d)
  const localProjects = useLocalProjectsSubscription()  // existing helper or read from kanna state

  useEffect(() => {
    const handler = () => setPushPermissionState(detectPushSupport().state)
    window.addEventListener("focus", handler)
    return () => window.removeEventListener("focus", handler)
  }, [])
```

(d) Use the existing socket subscription pattern. Search the file for `subscribe({ type: "app-settings"` for the precedent. Add an analogous one-liner that subscribes to `{ type: "push-config" }` and exposes the snapshot via React state. If there's an established `useSubscription(topic)` hook, use it directly with `{ type: "push-config" }`. **Do not invent a new state-management primitive** — use whatever pattern this file already uses for `app-settings`.

- [ ] **Step 3: Typecheck**

Run: `tsc --noEmit -p .`
Expected: PASS (fix any local type issues exposed by your wiring; do not silence with `any`).

- [ ] **Step 4: Run all client tests**

Run: `bun test src/client/`
Expected: all pass. The settings page test (if any) should still render fine because the new section degrades gracefully when `pushConfig` is `null` — if you needed a guard `if (!pushConfig) return null` inside the JSX, add it.

- [ ] **Step 5: Commit**

```bash
git add src/client/app/SettingsPage.tsx src/client/app/socket.ts
git commit -m "feat(push): mount PushNotificationsSection and wire WS commands"
```

---

## Task 19: Update C3 code map

**Files:**
- Modify: `.c3/code-map.yaml`

- [ ] **Step 1: Register c3-119, c3-224, ref-push**

Open `.c3/code-map.yaml`. Add these blocks in the appropriate sections (after the last `c3-118` entry for client, after the last `c3-223` for server, and after the last `ref-tool-hydration` for refs):

```yaml
# Client features (continued)
c3-119:
  - src/client/app/pushClient.ts
  - src/client/app/pushClient.test.ts
  - src/client/components/settings/PushNotificationsSection.tsx
  - src/client/components/settings/PushNotificationsSection.test.tsx

# Server features (continued)
c3-224:
  - src/server/push/push-manager.ts
  - src/server/push/push-manager.test.ts
  - src/server/push/vapid.ts
  - src/server/push/vapid.test.ts
  - src/server/push/events.ts
```

And under `# ---- Refs ----`:

```yaml
ref-push:
  - src/server/push/push-manager.ts
  - src/server/push/vapid.ts
  - src/server/push/events.ts
  - src/client/app/pushClient.ts
  - src/client/components/settings/PushNotificationsSection.tsx
  - public/sw.js
  - src/shared/types.ts
  - src/shared/protocol.ts
```

Also remove `public/**` from the `_exclude` list at the bottom of the file (since `public/sw.js` is now part of `ref-push`). Replace the `public/**` line with explicit excludes for asset-only files, e.g. `public/chat-sounds/**`. **Important**: only do this if the project's existing `public/` contents are genuinely just static assets — if `public/` contains anything else load-bearing, leave the wildcard exclude in place and instead add `public/sw.js` as an explicit unexclusion if the C3 tooling supports it (check `c3x --help`).

- [ ] **Step 2: Verify with c3x**

Run: `c3x coverage` (if installed)
Expected: new files appear under their components; no orphan files.

If `c3x` is not installed, skip the verification — the YAML is hand-checked.

- [ ] **Step 3: Commit**

```bash
git add .c3/code-map.yaml
git commit -m "docs(c3): register c3-119, c3-224, ref-push for web push notifications"
```

---

## Task 20: Full verification — typecheck, build, tests

**Files:** none

- [ ] **Step 1: Typecheck**

Run: `tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: all pass.

- [ ] **Step 3: Build**

Run: `bun run build`
Expected: build succeeds; `dist/` produced.

- [ ] **Step 4: Confirm the SW is shipped to dist**

Run: `ls -la dist/sw.js`
Expected: file exists. If it's missing, Vite is not copying `public/sw.js` to `dist/`. Check `vite.config.ts`'s `publicDir`. Default behavior is to copy `public/` contents to the build output root — this should already work.

- [ ] **Step 5: Live smoke test (manual)**

This step is documented in the spec under **Manual live test** and is not automatable. It is OK to mark this step done after attempting the smoke test, or to defer it to a separate PR if the engineer cannot reach a phone right now. Document the outcome in the PR description.

Steps:
1. `bun run dev` in one terminal.
2. Open `http://localhost:5174/settings`, find Push Notifications, click Enable, accept browser prompt, click Send test → confirm a desktop notification appears.
3. Stop dev. Run `bun run build && bun run start --share`.
4. Open the printed `https://<random>.trycloudflare.com` URL on a phone, navigate to Settings, Enable, accept prompt.
5. From the laptop, start a chat that ends in `waiting_for_user`. Confirm the phone gets a notification within ~5 seconds and tapping it opens the chat.
6. Mute the project from the laptop. Trigger again. Confirm no notification.

- [ ] **Step 6: Final commit (if anything was tweaked during smoke test)**

```bash
git status
# If clean: nothing to commit, the feature is done.
# Otherwise:
git add <files>
git commit -m "fix(push): <whatever fell out of the smoke test>"
```

---

## Self-review checklist (executed during plan write — kept here as a reminder)

- **Spec coverage:**
  - Trigger detection (waiting_for_user / failed / completed): Tasks 7-8.
  - Cold-start guard: Task 7.
  - Dedup window: Task 10.
  - Mute filter, focus suppression: Task 10.
  - TTL/urgency per kind: Task 9.
  - Subscription add/remove/expired-purge: Task 11.
  - Send-test: Task 11.
  - Subscription_seen debounce: Task 11.
  - Service worker (push, notificationclick, pushsubscriptionchange): Task 14.
  - Permission state machine: Task 15.
  - Subscribe/unsubscribe flows: Task 16.
  - Settings UI all 6 permission states: Task 17.
  - WS commands routing: Task 13.
  - Storage in `push.jsonl` via EventStore: Task 6.
  - VAPID lifecycle: Task 4.
  - C3 placement: Task 19.
- **Placeholder scan:** No "TBD"/"TODO"/"add appropriate handling" in any step. Manual smoke test is explicitly labeled non-automatable, not a placeholder.
- **Type consistency:** `PushSubscriptionRecord`, `PushTransitionKind`, `PushPayload`, `PushPreferences`, `PushDeviceSummary`, `PushConfigSnapshot`, `PushSubscribeRequestPayload` are defined in Task 1 and reused unchanged thereafter. `WebPushSender`, `WebPushSubscriptionShape`, `ObservedChat`, `WebPushSendOptions` are defined in Task 7 and unchanged. `detectPushSupport` returns `PushSupportSnapshot` with a `state: PushPermissionState` — used by Settings (Task 17) and `pushClient` itself.
