# Web Push Notifications for Session State Changes

**Status:** Draft
**Date:** 2026-04-30
**Owner:** cuong.tran
**Spec:** design only — implementation plan to follow

## Goal

Deliver browser push notifications — including to phones with the Kanna tab
closed and the screen locked — whenever a chat enters a state that needs the
user's attention. Notifications must be grouped by project at the OS level and
must respect a per-project mute setting.

Trigger states: `waiting_for_user`, `failed`, and `running → idle` (turn
completed). Non-attention transitions (`idle → starting`, `starting →
running`, mid-flight progress) are intentionally **not** notified — they would
produce 3+ pings per turn and lead users to disable the feature.

## Non-goals

- Native mobile app or PWA install flow beyond what a normal browser already
  provides.
- Third-party push relays (Pushover, ntfy, Telegram, Slack). Kanna stays
  local-first; the server talks directly to FCM/Mozilla/Apple push endpoints
  via `web-push`.
- New tunneling / networking features. Push requires HTTPS, but Kanna already
  ships `--share`, `--cloudflared <token>`, and supports Tailscale / named
  hosts. The spec **assumes** the user has chosen one and documents this as a
  prerequisite.
- Notifying for non-attention progress events. Out of scope for v1.

## User-facing behavior

1. The user opens Settings → **Push Notifications** on any browser (phone or
   laptop), grants permission, and that browser becomes a subscribed device.
2. Multiple devices can subscribe; the server fans out each notification to
   every subscribed device.
3. When a chat's status transitions, every subscribed device whose
   currently-focused chat is **not** the firing chat receives a notification.
   A device with no live tab still receives the notification via the OS push
   channel.
4. Notification content: `Kanna • <project>` as title, `<chat title> —
   <state>` as body. The OS groups notifications from the same project using
   the `tag` field.
5. Tapping the notification focuses an existing Kanna tab and routes it to
   the chat, or opens a new tab at the chat URL.
6. Per-project mute lives in Settings; muted projects are skipped at fan-out
   time.

## Architecture

```
Browser (phone or laptop)              Kanna Server (Bun)                Push Service
┌──────────────────────┐              ┌────────────────────────┐        (FCM / Mozilla / Apple)
│ Service Worker       │              │ PushManager            │              │
│  - shows OS notif    │  push.*      │  - VAPID keys          │              │
│  - notificationclick │  WS msgs     │  - subscription store  │  web-push    │
│       └─ open chat   │ ◄──────────► │  - mute prefs          │ ───────────► │
│                      │              │  - status watcher      │              │
│ App tab (React)      │              │       ↑                │              │
│  - Settings UI       │              │  EventStore / read-    │              │
│  - registers SW      │              │  models (status delta) │              │
└──────────────────────┘              └────────────────────────┘              ▼
                                                                       Phone/Laptop OS
                                                                      (notification bar)
```

### Constraints (carried from project-level)

- Event sourcing for state mutations (`ref-event-sourcing`). New `push.jsonl`
  log; no in-place mutation.
- CQRS: read-models derive view state; PushManager subscribes to the same
  derivation pass that drives `SidebarData`.
- Local-first: VAPID keys, subscription records, and prefs all live under
  `~/.kanna/data/`.
- Strong typing (`ref-strong-typing`): no `any` at boundaries; all push
  shapes declared in `src/shared/types.ts`.
- Provider-agnostic: status semantics use the existing `KannaStatus` union
  and apply equally to Claude and Codex.

### C3 placement

- New server component **c3-224** for `src/server/push-manager.ts` and
  `src/server/vapid.ts`.
- New client component **c3-119** for `src/client/app/pushClient.ts` and
  `src/client/components/settings/PushNotificationsSection.tsx`.
- New ref **ref-push** spanning the SW (`public/sw.js`), shared types, and
  both new components.
- Update `.c3/code-map.yaml` to register the new IDs and globs.

## Components & files

### New

| File | Purpose |
|---|---|
| `src/server/push-manager.ts` | VAPID lifecycle, subscription store API, status-transition watcher, fan-out via `web-push`, project-mute API. Single owner of all push state. |
| `src/server/push-manager.test.ts` | Unit tests for transition detection, fan-out filtering, expired-subscription cleanup, payload shape, urgency/TTL per kind. |
| `src/server/vapid.ts` | Load-or-generate VAPID keypair from `~/.kanna/data/vapid.json`. |
| `src/server/vapid.test.ts` | Generates on first load; reuses on second. |
| `public/sw.js` | Service worker. Plain JS, copied verbatim by Vite. Handles `push` and `notificationclick`. |
| `src/client/app/pushClient.ts` | Browser-side: feature detection, SW registration, subscribe/unsubscribe, send subscription to server. |
| `src/client/app/pushClient.test.ts` | Mocks `navigator.serviceWorker` + `PushManager`; asserts subscribe/unsubscribe lifecycle and error paths. |
| `src/client/components/settings/PushNotificationsSection.tsx` | Settings UI: permission state machine, devices list, per-project mute checkboxes, send-test button. |
| `src/client/components/settings/PushNotificationsSection.test.tsx` | Renders each permission state; exercises toggle flows. |

### Modified

| File | Change |
|---|---|
| `src/shared/protocol.ts` | Add WS messages: `push.subscribe`, `push.unsubscribe`, `push.test`, `push.set-project-mute`, `push.set-focused-chat`, `push.config` (server→client snapshot). |
| `src/shared/types.ts` | Add `PushSubscriptionRecord`, `PushTransitionKind`, `PushPayload`, `PushPreferences`, `PushDeviceSummary`. |
| `src/server/ws-router.ts` | Route `push.*` commands to PushManager. |
| `src/server/read-models.ts` | After computing per-chat status, call `pushManager.observeStatuses(snapshot)`. Pure addition. |
| `src/server/server.ts` | Construct PushManager at startup; expose `/api/push/vapid-public-key` (optional convenience; the same key is also broadcast in `push.config`). |
| `src/server/event-store.ts` | Recognize `push.jsonl` for replay and compaction. |
| `src/client/app/socket.ts` | Wire up new WS messages; expose subscription/permission state to the React tree. |
| `src/client/app/SettingsPage.tsx` | Mount `PushNotificationsSection`. |
| `package.json` | Add `web-push` dependency (server-only). |
| `.c3/code-map.yaml` | Register c3-224, c3-119, ref-push. |

## Storage

All under `~/.kanna/data/`.

| File | Format | Notes |
|---|---|---|
| `vapid.json` | `{ publicKey, privateKey, subject }` | Generated on first start. `subject` defaults to a fixed `mailto:`; user-overridable later if needed. |
| `push.jsonl` | Append-only events (see below) | Replayed on startup; folded into `snapshot.json` during compaction (≥2 MB). |

### Event types in `push.jsonl`

```ts
type PushEvent =
  | { kind: "subscription_added"; ts: number; id: string; record: PushSubscriptionRecord }
  | { kind: "subscription_removed"; ts: number; id: string; reason: "user_revoked" | "expired" | "replaced" }
  | { kind: "subscription_seen"; ts: number; id: string }   // debounced; ≤ 1/hour/device
  | { kind: "project_mute_set"; ts: number; localPath: string; muted: boolean }
```

`subscription_seen` is debounced server-side (one write per device per hour
maximum) so a busy session does not flood the log.

### Shapes (in `src/shared/types.ts`)

```ts
export interface PushSubscriptionRecord {
  id: string                       // uuid; primary key
  endpoint: string                 // PushSubscription.endpoint
  keys: { p256dh: string; auth: string }
  label: string                    // user-editable; defaults to UA-derived "Chrome on iPhone"
  userAgent: string                // raw UA at registration time, for debugging
  createdAt: number
  lastSeenAt: number
}

export type PushTransitionKind = "waiting_for_user" | "failed" | "completed"

export interface PushPayload {
  v: 1
  kind: PushTransitionKind
  projectLocalPath: string         // also used as notification `tag` for OS grouping
  projectTitle: string
  chatId: string
  chatTitle: string                // truncated to 80 chars before send
  chatUrl: string                  // relative path; SW resolves against its origin
  ts: number
}

export interface PushPreferences {
  globalEnabled: boolean
  mutedProjectPaths: string[]
}

export interface PushDeviceSummary {
  id: string
  label: string
  createdAt: number
  lastSeenAt: number
  isCurrentDevice: boolean
}
```

### In-memory state inside PushManager

Rebuilt on startup from `push.jsonl` + `snapshot.json`:

- `subscriptions: Map<string, PushSubscriptionRecord>` — keyed by id.
- `mutedProjects: Set<string>` — localPaths.
- `lastStatusByChat: Map<string, KannaStatus>` — for transition detection.
- `focusedByDevice: Map<string, string | null>` — deviceId → focused chatId.
  In-memory only; cleared on disconnect.
- `dedupKeyToTs: Map<string, number>` — key = `${chatId}:${kind}`; used for
  the 2s dedup window (see fan-out).
- `seeded: boolean` — flips true after the first `observeStatuses` call.

Each WS connection identifies its owning device with a `pushDeviceId` carried
in `localStorage`, sent on every connect. A connection without a registered
device is a no-op for focus tracking.

### Privacy

- `endpoint`, `p256dh`, `auth` are bearer credentials for the push service.
  Never sent to other clients. Settings UI exposes only `PushDeviceSummary`.
- `vapid.json.privateKey` is sensitive; same on-disk permissions as other
  `~/.kanna/data/` files; never logged.
- Notification body shows the chat title (per the chosen content option). The
  user can mute a noisy project; the spec does not currently expose a
  "redact title" mode but leaves the door open for one.

## Trigger detector & fan-out

### Hook into read-models

`src/server/read-models.ts` already derives status per chat on every relevant
event. After each derivation, it calls a single new method:

```ts
pushManager.observeStatuses(snapshot: ReadonlyArray<{
  chatId: string
  projectLocalPath: string
  projectTitle: string
  chatTitle: string
  status: KannaStatus
  hasFailureMessage?: boolean    // optional, for richer "failed" payloads
}>)
```

PushManager is a pure consumer; read-models stay the source of truth.

### Transition detection

For each chat in the snapshot:

1. `prev = lastStatusByChat.get(chatId)`.
2. Fired transitions:
   - `prev !== "waiting_for_user" && next === "waiting_for_user"` → fire `waiting_for_user`.
   - `prev !== "failed" && next === "failed"` → fire `failed`.
   - `prev === "running" && next === "idle"` → fire `completed`.
3. `lastStatusByChat.set(chatId, next)`.

### Cold-start guard

The first `observeStatuses` call after startup **only seeds**
`lastStatusByChat` and fires nothing. Sets `seeded = true`. This prevents the
JSONL replay from producing a wall of stale "completed" notifications on
restart.

### Per-chat dedup window

For each fired transition, key = `${chatId}:${kind}`. If
`dedupKeyToTs.get(key)` is within the last 2 seconds, drop. Otherwise stamp
and proceed. Guards against rapid-flip churn from the agent's micro-state
changes (e.g., a tool retry quickly toggling `running ↔ idle`).

### Fan-out flow

```
observeStatuses(snapshot)
  ├─ for each chat: detect transition → if any → buildPayload()
  └─ for each payload:
       └─ for each subscription in store:
            ├─ skip if globalEnabled === false
            ├─ skip if mutedProjects.has(payload.projectLocalPath)
            ├─ skip if focusedByDevice.get(sub.id) === payload.chatId
            └─ webPush.sendNotification(sub, JSON.stringify(payload), { TTL, urgency })
                 ├─ on 410 / 404 → emit subscription_removed (reason: "expired"); drop from map
                 ├─ on 403, or 400 with InvalidRegistration → same as expired
                 └─ on 5xx / network → log; do NOT remove (transient)
```

### TTL & urgency per kind

| Kind | TTL | Urgency | Rationale |
|---|---|---|---|
| `waiting_for_user` | 60s | `normal` | "Still waiting" an hour later is noise. |
| `failed` | 60s | `high` | Surface fast; may bypass some battery savers. |
| `completed` | 60s | `low` | User isn't blocked; phone can batch. |

### Payload size

Web Push enforces ~4 KB. Truncate `chatTitle` to 80 chars before send.
Project titles are short.

### Focus reporting from clients

The active client tab sends `push.set-focused-chat { chatId | null }` on:

- Active chat route change.
- `visibilitychange` becoming hidden → send `null`.
- `window` `blur` → send `null`.

Server stores `focusedByDevice.set(deviceId, chatId | null)`. On WS
disconnect, the entry is cleared. If a device is registered but has no live
WS, suppression check returns false → notifications are sent (correct for a
phone whose tab is closed).

## UX, permission states, errors

### Settings UI (`PushNotificationsSection.tsx`)

Sits as a card on the Settings page. Three visual states driven by current
permission and registration.

**Initial / not-yet-enabled:**

```
┌─ Push Notifications ─────────────────────────────────┐
│  [ Enable on this device ]                           │
│  When enabled, you'll get a browser notification     │
│  when a chat is waiting for you, finishes, or fails. │
└──────────────────────────────────────────────────────┘
```

**Enabled, with one or more devices registered:**

```
┌─ Push Notifications ─────────────────────────────────┐
│  ● Enabled on this device       [ Send test ] [ Disable ]
│                                                      │
│  Devices                                             │
│   • iPhone — Safari       last seen 2m ago    [ × ] │
│   • This Mac — Chrome     last seen now              │
│                                                      │
│  Per-project                                         │
│   ☑ kanna                                            │
│   ☐ side-project          (muted)                    │
│   ☑ work-monorepo                                    │
│                                                      │
│  Phone setup                                         │
│   This page must be open over HTTPS for your phone   │
│   to subscribe. Use `kanna --share` or your named    │
│   tunnel, then open the public URL on your phone.    │
└──────────────────────────────────────────────────────┘
```

Per-project list comes from the existing project list. Checkboxes write
`push.set-project-mute { localPath, muted }`.

### Permission state machine (client)

| State | Detection | UI |
|---|---|---|
| `unsupported` | `!("Notification" in window) \|\| !("serviceWorker" in navigator) \|\| !("PushManager" in window)` | "Push isn't supported in this browser." Disabled. |
| `insecure-context` | `!isSecureContext` and host !== `localhost` | "Push requires HTTPS. Run `kanna --share` or open over a tunnel." Disabled. |
| `default` | `Notification.permission === "default"` | "Enable on this device" button → triggers permission prompt + subscribe flow. |
| `denied` | `Notification.permission === "denied"` | "You blocked notifications. Re-enable in browser settings, then reload." Disabled. |
| `granted, subscribed` | permission granted, server confirms record | Full panel above. |
| `granted, not subscribed` | permission granted, no record / endpoint changed | "Re-enable on this device" button (re-subscribes silently). |

### Subscribe flow (client → server)

```
1. User clicks "Enable on this device".
2. await Notification.requestPermission() must return "granted".
3. const reg = await navigator.serviceWorker.register("/sw.js").
4. await navigator.serviceWorker.ready.
5. const sub = await reg.pushManager.subscribe({
     userVisibleOnly: true,
     applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
   }).
6. ws.send({ type: "push.subscribe", payload: serialize(sub),
              label: deriveLabel(navigator.userAgent) }).
7. Server replies with { id }; client stores it in localStorage as
   `pushDeviceId`.
```

### Unsubscribe flow

Client calls `subscription.unsubscribe()` and sends `push.unsubscribe { id }`.
Server appends `subscription_removed (reason: "user_revoked")`. Local
`pushDeviceId` is cleared.

### Send-test flow

Client sends `push.test`. Server fires a synthetic payload (`kind:
"completed"`, project title `"Kanna"`, chat title `"Test notification"`,
chatUrl `/`) only to the calling device. Useful for sanity-checking the whole
pipe.

### Service worker (`public/sw.js`)

Plain JS, no bundling. Two handlers:

```js
self.addEventListener("push", (event) => {
  const payload = event.data?.json()
  if (!payload || payload.v !== 1) return
  const title = `Kanna • ${payload.projectTitle}`
  const body = bodyFor(payload)        // "Chat title — waiting for input" etc.
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: payload.projectLocalPath,
    renotify: false,
    data: { chatUrl: payload.chatUrl, ts: payload.ts },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.chatUrl ?? "/"
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true })
    const sameOrigin = all.filter(c => new URL(c.url).origin === self.location.origin)
    const hit = sameOrigin[0]
    if (hit) {
      await hit.focus()
      hit.postMessage({ type: "kanna.navigate", url })
    } else {
      await clients.openWindow(url)
    }
  })())
})

self.addEventListener("pushsubscriptionchange", (event) => {
  // Re-subscribe with the same VAPID key; the page will sync the new endpoint
  // to the server next time it opens. SW cannot reach Kanna's WS directly.
})
```

App listens for `message` events from the SW and routes accordingly. Falls
back to `location.href = url` if no message handler is registered.

### Auth interaction

When `--password` is set, the server already requires auth on `/ws` and API
routes. Two extra rules:

- `/sw.js` is served unauthenticated (mirrors `/health`); the SW carries no
  secrets.
- `/api/push/*` and the `push.*` WS commands require the same auth as
  everything else.
- Push **delivery** does not depend on the WS — the push service holds the
  bearer credentials. A phone with an expired password cookie still receives
  notifications; only subscription management and focus reporting pause until
  the WS reconnects.

### Error & edge cases

| Case | Expected behavior |
|---|---|
| Server restart mid-session | Cold-start guard suppresses replay; subsequent transitions fire normally. |
| `vapid.json` deleted | On next start, regenerate; existing subscriptions 401/403 on send and self-purge. UI prompts each device to re-enable. |
| Phone goes offline | Push service holds the message up to TTL (60s), then drops. |
| Browser rotates push endpoint | Old endpoint 410s on next send; PushManager removes. SW `pushsubscriptionchange` re-subscribes; the page syncs the new record next time it opens. |
| User enables on a `--share` URL that later changes | Endpoint is unaffected (push services use their own URLs). Notifications keep flowing. Tap-to-open still requires the phone to reach a current Kanna URL. |
| Two tabs on the same device | Both register the same SW; `pushManager.subscribe()` returns the existing subscription. Server dedupes by `endpoint` and updates `lastSeenAt`. |
| Many chats fire in the same project at once | OS groups by `tag`; the user sees a single stack. |
| Chat fires the same kind twice within 2s | Second drop suppressed by dedup window. |

## Test strategy

### Server (`bun test`)

- `vapid.test.ts` — generate-or-load round trip.
- `push-manager.test.ts` —
  - cold-start seeding fires nothing on first call;
  - each transition kind fires exactly once;
  - dedup window suppresses duplicates within 2s;
  - mute filters by exact `projectLocalPath`;
  - focus suppression filters by `(deviceId, chatId)` pair only;
  - 410 response purges the subscription and writes `subscription_removed`;
  - 5xx response leaves the subscription intact;
  - TTL/urgency are set per kind;
  - test-push targets only the caller's subscription.
- `read-models.test.ts` — extend with mocked manager; assert
  `observeStatuses` is called with the right shape.
- `event-store.test.ts` — extend with `push.jsonl` replay + compaction.
- `ws-router.test.ts` — extend with new `push.*` command routing.

### Client (`bun test`)

- `pushClient.test.ts` —
  - feature-detection branches (unsupported, insecure-context, default,
    granted, denied);
  - subscribe success path;
  - permission-denied path;
  - unsubscribe path;
  - `pushsubscriptionchange` re-subscription path.
- `PushNotificationsSection.test.tsx` —
  - renders each permission state;
  - toggle wiring sends the right WS messages;
  - mute checkboxes;
  - send-test;
  - device list redaction (no `endpoint` / `keys` reach the UI).
- `socket.test.ts` — extend with `push.config` snapshot handling.

### Manual live test (in spec; not automated)

1. Enable in Settings on the laptop.
2. Run `kanna --share`.
3. Open the public URL on a phone; enable in Settings there too.
4. Start a long Bash command in a chat that ends with `waiting_for_user`.
5. Confirm: phone notification arrives within seconds; tapping opens the
   chat; the laptop tab (which is focused on that chat) does **not** show a
   redundant notification.
6. Mute the project in Settings; trigger again; confirm no notification fires
   on either device.

## Open questions / future work

- Surface a "Notify on session start" option later, gated by user feedback.
  V1 is attention-only by design.
- "Hide chat titles" privacy toggle, if real users ask. The spec defaults to
  showing titles per the explicit choice in brainstorming.
- Per-device per-event toggles (e.g., phone gets only failures, laptop gets
  everything). Not in v1.
- Push delivery analytics (counts, dropped, expired). Not in v1; logs are
  enough for self-host debugging.

## Dependencies & prerequisites

- New runtime dep: `web-push` (server-only).
- HTTPS reachability for any browser that wants to subscribe. Documented in
  Settings UI; not enforced beyond the existing `--share` / `--cloudflared` /
  `--host` flows.
- The existing Settings page (`SettingsPage.tsx`), event-store
  (`event-store.ts`), and read-models (`read-models.ts`) are integration
  points; no breaking changes to any of them.
