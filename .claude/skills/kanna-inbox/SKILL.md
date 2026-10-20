---
name: kanna-inbox
description: The inbound side of Kanna — the in-process service bus and EventStore tap, the embedded or external NATS JetStream mirror, the Inbox (threads, handler chats, inbox_report, needs_you), MCP sources (subscribe and poll), and inbound webhooks (/hooks/<id>, secrets, delivery modes). Use whenever a task touches src/server/service-bus/**, src/server/inbox/**, src/server/inbound/**, src/server/mcp-sources/**, src/server/webhooks/**, nats-server, a webhook that returns 404/401, or an inbox thread that never escalated.
---

# Kanna service bus, Inbox, MCP sources, webhooks

Moved verbatim from the root `CLAUDE.md`.

## Service bus — every durable fact is published once, after it is on disk

`src/server/service-bus/` (component `c3-246`, ADR
`adr-20261020-service-bus-event-store-tap`) is an in-process bus that every
durable fact the server records is published on. It exists so the Inbox, the
notification layer and an optional NATS mirror read ONE stream instead of each
tapping the EventStore and the registries separately. The JSONL EventStore
stays the store of record; the bus persists nothing.

- **One tap, two seams.** `EventStore.tap` (`EventStoreTap`) is called in
  `applyEvent` right after `applyStoreEvent` — the only place every durable
  fact passes AFTER its disk write, chat-task and subagent events included —
  and in `appendMessage` right after the transcript write, because transcript
  entries bypass `commit`. Do not wire the bus into `emitStateChange` (a UI
  broadcast signal with no payload, ~40 call sites) or the registries'
  `subscribe()` sets (no event, and several are single-slot).
- **The slot is set AFTER `store.initialize()` resolves** (`createStoreBus`,
  called from `server.ts`), so boot replay publishes nothing. Setting it earlier replays the whole history
  into every subscriber on each restart; `event-store-tap.test.ts` pins it.
- **`publish` is synchronous and never throws.** The in-memory bus
  (`in-memory-service-bus.ts`) guards every subscriber and mirror call: a
  failure is logged, counted (`kanna_bus_handler_errors_total`) and never
  reaches the EventStore write that triggered it.
- **`STORE_EVENT_SUBJECT` decides every kind, and `null` means never.** It is
  `satisfies Record<StoreEventKind, string | null>`, so a new event kind is a
  compile error until someone decides its subject. `session_token_set`,
  `pending_fork_session_token_set`, `subagent_message_delta`,
  `subagent_entry_appended`, `chat_read_state_set`, `chat_source_hash_set`,
  `chat_compact_failures_set` and `sidebar_project_order_set` are `null` —
  secrets and per-token noise stay inside the process. Transcript entries go
  out only for the kinds in `TRANSCRIPT_BUS_KINDS`; assistant text, tool
  calls and results never do.
- **Subjects are `kanna.<domain>.<event>`** (`busSubject`), matched with
  NATS semantics (`*` one token, `>` one or more trailing tokens —
  `subjectMatches`). `idempotencyKey` is deterministic
  (`store:<kind>:<entity>:<timestamp>`, `transcript:<chatId>:<entryId>`) so a
  mirror can dedupe; it is the planned JetStream `Nats-Msg-Id`.
- **`event-store.ts` is at the 700-line budget.** The tap cost three lines,
  paid for by three removed blank lines. A second call site or a new import
  line there fails `check:arch`; put new bus logic in `src/server/service-bus/`.

### Embedded NATS mirror

`bus.addMirror` carries one optional mirror: a NATS JetStream stream, either a
`nats-server` Kanna manages or one the user runs. **The JSONL EventStore stays
the store of record and Kanna boots and works with NATS absent.** Settings →
Service bus (`settings.serviceBus`, `src/server/service-bus-settings.ts`,
`src/shared/service-bus/jetstream-config.ts`, user doc
`wiki/src/content/docs/guides/user/service-bus.md`).

- **Never block, never throw.** `NatsMirror.sink.publish` only pushes onto a
  bounded queue (`nats-mirror-queue.ts`, 2000, drop-oldest, counted by
  `kanna.bus.mirror_dropped`); a separate pump publishes with `msgID =
  idempotencyKey` and a 5 s timeout, retries a failed message once at the head
  and then drops it. The pump does not run while the link is down, so an outage
  fills the queue instead of failing appends. Every public method catches; the
  warning is throttled to once per 30 s. The in-memory bus already guards each
  mirror call, this is the second wall.
- **Embedded = a supervised child process, not a library.** No JS or WASM
  nats-server exists, so `nats-server-install.adapter.ts` downloads the pinned
  `NATS_SERVER_VERSION` (2.15.1) from the official GitHub release on first
  enable, fetches `SHA256SUMS`, refuses the archive on a mismatch, extracts the
  one binary with the minimal reader in `tar-gz.ts` and renames it into
  `<dataDir>/nats/bin/nats-server-v<ver>` atomically (same posture as the
  beacon self-updater; `parseSha256Sums` and `releaseAssetUrl` now live once in
  `src/shared/release-sums.ts`). `KANNA_NATS_RELEASE_BASE` is a machine-local
  test override read inside that adapter only. macOS and Linux are supported;
  Windows needs a zip reader and answers "use external mode".
- **The token lives in two places and never in argv.** `settings.json` holds it
  (mode 0644, like `customProviders.apiKey`; the snapshot carries only
  `tokenHint`, reachable raw only through `getServiceBusCredential()`), and
  `nats-server-process.adapter.ts` writes it into `<dataDir>/nats/server.conf`
  at 0600 (temp file, chmod, rename) for `nats-server -c`. A patch with no token
  or an empty one keeps it, `null` clears it. Embedded mode generates one on
  first start. The child gets a minimal env, not Kanna's.
- **Supervision.** Ready is the `Server is ready` line on stderr (a `log_file`
  would move it out of stderr, so none is configured). The port is picked once
  and reused across restarts so the client's own reconnect finds it. An
  unexpected exit restarts with 1 s doubling to 60 s (reset after a 60 s run),
  counted by `kanna.nats_server.restarts`. `stop` is SIGTERM, then SIGKILL after
  5 s. A stale pid file is reaped only if the pid is still a `nats-server`.
- **Reconcile is create-or-update on every connect** (`jetstream-reconcile.ts`).
  A missing stream is added; a drifted one is updated in place for subjects,
  max age, bytes, messages, discard and duplicate window. **`retention`,
  `storage` and `replicas` cannot change on a live stream, so the status goes to
  `error` naming the field and the stream is left alone: Kanna never deletes a
  stream.** Consumers are created or updated, and a consumer is deleted only if
  it carries `metadata["kanna-managed"] === "true"` and is no longer configured;
  consumers someone else created are never touched. An ack or deliver policy
  change is reported, not applied, because the server forbids it.
- **The stream prefix is configurable, the envelope subject is not.**
  `subjectWithPrefix` swaps the leading `kanna` token for `stream.subjectPrefix`
  at publish time; the envelope JSON keeps the original subject.
- **One owner of status.** `service-bus-boot.ts` composes the phase it owns
  (installing, starting, restarting, failed) over the mirror's own state
  (connecting, connected, reconnecting, error) and pushes it on the
  `service-bus` topic. Settings changes serialise through one promise chain: a
  change to `enabled|mode|url|token|embedded` restarts, one to `stream` or
  `consumers` only reconciles. `serviceBus.resetStore` stops the child, deletes
  `<dataDir>/nats/store` and starts again.
- **`server.ts` stays under 700 lines** because the bus is built by
  `createStoreBus` (it also sets the EventStore tap) and carries the mirror's
  lifecycle itself. Add new bus wiring to `service-bus-boot.ts`, not to
  `server.ts`.
- **The connect loop is Kanna's, not the client's.** `waitOnFirstConnect` would
  hide a dead server behind an uncancellable promise, so the first connect is
  retried here (2 s doubling to 30 s) and the failure is visible as `error`.
  Later outages use the client's own reconnect (`maxReconnectAttempts: -1`).

## Inbox — inbound threads, one handler chat per thread, draft-only agent

`src/server/inbox/` + `src/server/inbound/` (component `c3-247`) turn every
inbound message — a webhook delivery or an MCP source message — into an **inbox thread** the user reads and answers in one place, and
keep every other bus envelope as a browsable **activity item**. The user chose
"agent pre-handles, then tells me", so the shape below is a product decision,
not an implementation detail.

- **`deliverInbound` is the ONE delivery path.** `deliverWebhook` is a thin
  caller that maps a hook to an `InboundDelivery`. It publishes the inbound
  envelope, upserts the thread keyed by `(source, threadKey)` (`threadKeyPath`
  on the source, else the delivery id), resolves the handler chat, appends the
  card, queues the handler prompt and marks the thread pending. The
  `webhook_delivery` card and the `webhook-<hookId>-<deliveryId>` schedule id
  are unchanged and pinned by `webhook-delivery.test.ts`; an MCP delivery
  appends an `inbound_delivery` card, absent from `shareableEntries` on purpose.
- **One chat per thread.** `spawn` creates the chat on the thread's first
  message, renames it `<source> · <sender>` and binds it
  (`inbox_thread_chat_bound`); later messages in that thread reuse it, so the
  agent keeps the conversation context. `inline` binds the fixed chat;
  `notify` binds nothing and escalates straight to `needs_you`.
- **The agent only drafts.** The queued prompt ends with
  `renderHandlerInstruction`, which tells the model to call
  `mcp__kanna__inbox_report({ thread_id, verdict, summary, draft_reply? })` and
  NEVER to send anything to the sender. `InboxRegistry.report` accepts a report
  only from the thread's bound chat; `buildInboxToolList` registers the tool for
  main chats (`depth === 0`) only. Codex handler chats get no Kanna MCP tools
  and therefore always hit the fallback.
- **A reportless turn is not silence.** `markPending` runs BEFORE
  `enqueueMessage` (a fast handler could otherwise report first and the later
  mark would re-arm the fallback); on `kanna.turn.finished|failed` for a
  thread's chat while it is still pending, the registry escalates to
  `needs_you` with an empty summary. Known gap: the fallback keys on the chat,
  not the turn, so a second message landing while the first turn runs can
  escalate early; a later report corrects the state.
- **Only `needs_you` is a notification.** `onNeedsYou` fires once when a thread
  enters that state — by report, by notify-mode escalation or by the fallback —
  and is the only signal the toast/badge/push layer consumes. `fyi` is visible
  but quiet; `handled` lives in Activity only.
- **Reply and instruct go through the thread chat.** `inbox.reply` enqueues
  "send exactly this text through your source tool, then confirm" (the source's
  `replyHint` with `{{path}}` substituted from the latest payload, the reply
  fenced, the original re-fenced under the untrusted notice) under
  `inbox-reply-<threadId>-<replyCount+1>` and marks the thread `replied`;
  `inbox.instruct` enqueues the instruction plus the handler instruction so the
  agent reports a fresh draft, under `inbox-instruct-<threadId>-<ts>`. Kanna
  never calls a source tool itself in v1.
- **`inbox.jsonl` is a peripheral log, not a StoreEvent log.** The registry
  projects it at boot (`inbox-projection.ts` is pure), caps live records at
  `INBOX_MAX_ITEMS` (2000) while never dropping an unread thread younger than
  seven days, and rewrites the file only at boot when it holds more than twice
  the live records. A StoreEvent log was rejected because it touches five
  files that already drift (`chat-tasks.jsonl` is truncated and snapshotted
  but not replayed — a filed follow-up).
- **Activity items are every internal envelope** except `kanna.inbox.>` (no
  feedback loop). `attention` — and therefore unread — is `kanna.turn.failed`,
  `kanna.toolRequest.put`, a failed `kanna.cron.runOutcome`,
  `kanna.subagent.failed` and a failed `kanna.loop.runOutcome`; everything else
  lands already read so the badge means "needs a look".
- **The page is a workspace tab, and `needs_you` is the only interrupt**
  (`src/client/app/Inbox*.tsx`, `stores/inboxStore.ts`, client fact
  `c3-126`). `/inbox` and `/inbox/:threadId` are page-kind `inbox`
  (`adr-20261013-pages-as-workspace-tabs`): the thread id rides the tab path
  and reaches `InboxPage` as a prop, never through `useParams`. Opening a
  thread sends `inbox.markRead`; Send / Instruct / Archive / Mark all read /
  Load older go through `runPendingAction` and render pending. The Inbox tab
  shows threads in `new | needs_you | fyi` plus attention items; filters apply
  to the Activity tab only. `useInboxToasts` diffs the needs-you thread ids per
  snapshot (not per render) and shows at most three sonner toasts plus one
  overflow toast when not on `/inbox` — sonner is imported dynamically inside
  the port so it stays out of the entry bundle. The sidebar badge and the
  window title count read `selectInboxUnreadCount`. Push: `PushTransitionKind`
  gained `"inbox"`, `PushManager.notifyInbox` ignores chat focus and dedupes
  on `inbox:<threadId>:<lastMessageAt>`, `public/sw.js` tags on `threadId`
  with a `chatId` fallback, and `wireInboxPush` (`inbox-boot.ts`) honours the
  source handler's `pushEnabled`. Day labels come from the store's
  `snapshotAt`, because `Date.now()` in render fails the purity lint — a
  "Today" label can go stale across midnight until the next snapshot.

## MCP sources — Kanna as a long-lived MCP client that feeds the Inbox

`src/server/mcp-sources/` + `src/shared/mcp-sources/` turn a configured custom
MCP server into an inbound source. The user chose "Kanna connects itself", so a
source is a *client* the server holds open, not a tool the model calls. Every
item it ingests goes through `deliverInbound` exactly like a webhook delivery
(`source.kind: "mcp"`), and `inbox-boot.ts` resolves the reply handler for
`thread.sourceKind === "mcp"` through `inboxHandlerResolver`, so `inbox.reply`
and `inbox.instruct` need nothing new.

- **Two modes, one runner.** `subscribe` opens MCP revision 2026-07-28
  `subscriptions/listen` with `resourceSubscriptions: [uri…]` and reads each
  resource on `notifications/resources/updated`; the body handed to the handler
  is `{ uri, contents }` so `threadKeyPath` can address either. `poll` calls a
  list tool every `intervalMs` (5 s to 1 h) with the persisted cursor under
  `cursorArg`, takes the array at `itemsPath`, keys each item by `itemKeyPath`
  (else a hash of the item) and stores the value at `cursorPath` afterwards.
  Polls never overlap: the loop is `call → sleep → call`, never a timer that
  re-arms while a call is in flight.
- **The legacy fallback is in the adapter, not the runner.** `openListening`
  (`mcp-source-client.adapter.ts`) tries `listen()`; only the typed
  `SdkErrorCode.MethodNotSupportedByProtocolVersion` error — a 2025-era server —
  falls back to `subscribeResource` per URI with `honoredUris = uris` and
  `closed` taken from the transport. Any other failure is a real failure and
  must not be mistaken for "old server". The runner sees one `McpSourceListening`
  and treats an empty `honoredUris` as `error: "server honored no subscriptions"`.
- **Reconnect policy.** `remote` close backs off 1 s doubling to 60 s with
  jitter, `graceful` reconnects after 30 s, `local` ends the loop. A poll error
  backs off to at most 5x the interval. A 401-shaped error drops the
  connection and reconnects once at once (the bearer is re-resolved on every
  open, which refreshes an OAuth token); a second 401 backs off.
- **Dedupe and the cursor are runtime state, not settings.**
  `<dataDir>/mcp-source-cursors.json` holds `{ [sourceId]: { cursor, recentKeys } }`
  (newest 256 keys, temp file + rename) behind `McpSourceCursorStorePort`. A
  failed delivery records neither its key nor the cursor, so the item is retried
  by the next poll. Deleting a source prunes its entry. The first poll of a
  source with no cursor delivers whatever the tool returns, so a `spawn` source
  pointed at a busy account creates one chat per thread at once.
- **Configuration is `settings.mcpSources`,** a CRUD branch exactly like
  `customModels` (`create`, `update`, `delete`) plus `setEnabled`, normalised by
  `mcp-sources-settings.ts`, which drops invalid entries with a warning. The
  `serverId` is checked against `customMcpServers` only when a source is created
  or edited; deleting a server leaves its sources in place and the runner reports
  `MCP server not found`. `app-settings.ts` is pinned at its 1900-line ceiling,
  so everything but the glue lives in that module.
- **The runner reconciles; it does not watch.** `McpSourceRunner.reconcile`
  restarts a source only when its `updatedAt` or its server's `updatedAt` or
  `enabled` changes, so an OAuth token refresh (which does not touch
  `updatedAt`) never restarts a connection. `startMcpSources` calls it on every
  `appSettings.onChange`, and `router.dispose()` awaits `stop()`.
- **A stdio server started here is a separate process** from the one a chat's
  session starts, with its own state. Prefer `http` or `sse`; the form says so.
  `ws` is not offered, because `@modelcontextprotocol/client` 2.x ships no
  WebSocket transport.
- **`@modelcontextprotocol/client` is a production dependency now** (it was a dev
  dependency used only by tests). It is imported only by
  `mcp-source-client.adapter.ts`. The existing validator and OAuth code stay on
  `@modelcontextprotocol/sdk` 1.x.
- **`resolveMcpBearer` moved to `src/server/mcp-bearer.ts`** so the runner does
  not import `ws-router-settings.ts`; `resolveMcpTestBearer` is still exported
  from the old place for the dataset service and the router.
- **The Zalo preset** (`MCP_SOURCE_PRESETS.zalo`) is data, not code: tool
  `zalo_get_messages`, `since` / `cursor` / `messages` / `messageId`, thread key
  `threadId`, sender `senderName`, 15 s, `spawn`. The user picks the server and
  project in the form. Settings → MCP sources shows the live state per source
  from the `mcp-sources` topic (`McpSourcesSnapshot`), pushed on every status
  change and deduplicated by snapshot signature like the other global topics.

## Inbound Webhooks (KANNA_WEBHOOKS)

An external system POSTs to `/hooks/<id>`; the hook's mode (`notify` card only,
`inline` card plus a queued prompt, `spawn` new chat plus card plus prompt)
decides what Kanna does. Code: `src/server/webhooks/`, `src/shared/webhooks/`;
facts `c3-243` and `c3-125`; decision `adr-20261015-inbound-webhooks`. User
doc: `wiki/src/content/docs/guides/user/webhooks.md`.

**Four invariants, each of which fails silently if broken:**

- **Raw secrets live in `<dataDir>/webhooks.json` at mode 0600, and nowhere
  else.** HMAC needs the raw secret, so it cannot be hashed, and `settings.json`
  is written with no file mode. `writeFile`'s `mode` applies only when the file
  is CREATED, so the store writes a temp file at 0600, `chmod`s it, and renames
  it over the target. `WebhookSummary` carries a 4-character `secretHint` and
  never the secret; `create` and `rotateSecret` return it once, in the ack.
- **The route is dispatched BEFORE the session auth gate**
  (`http-dispatcher.ts`, next to `/api/share/`). The hook secret is the
  credential; a session cookie means nothing here. Moving the route below the
  gate makes every real caller get 401 while every unit test stays green.
- **Unknown, disabled and `KANNA_WEBHOOKS=disabled` all answer the same 404**,
  so a caller cannot probe which ids exist. Auth failures are 401 only for a
  hook that exists and is enabled.
- **A webhook card is private.** `webhook_delivery` is deliberately absent from
  `shareableEntries`, and the four `webhooks.*` commands are `unavailable` in
  the remote-MCP command catalog so a remote client cannot mint or read a
  credential. A new transcript kind stays out of shares until someone adds it.

**Delivery** goes through narrow `Pick<EventStore, ...>` and
`Pick<AgentCoordinator, ...>` params (no new `*Deps` bundle; `deps-bundles` is an
exact ratchet). `inline` and `spawn` enqueue with
`autoContinue.scheduleId = webhook-<hookId>-<deliveryId>`, which is what makes
queue replay idempotent through `isPromptAlreadyAppended`. The body is capped at
256 KiB (the global 128 MiB cap is far too large for an unauthenticated route),
a delivery id from `X-GitHub-Delivery` / `Idempotency-Key` / `X-Request-Id`
dedupes retries (a failed delivery releases its id so a retry can succeed), and
each hook has a 20-per-minute token bucket so a looping caller cannot spawn
unbounded chats. The JSON body reaches the model fenced, capped at 16000
characters, under a line stating it is untrusted external data; the fence is
lengthened past any backtick run inside the body.

**A hook's optional `provider` + `model` ride the queued message, never the
chat.** They are a pair (set or cleared together), validated on create and
update against `providerCatalogOf` — the same catalog the chat snapshot serves —
so an unknown model is refused instead of `normalizeServerModel` silently
running the default. Delivery must not call `setChatModel`: an `inline` hook
would otherwise permanently change the model the user picked for that chat.
`parseStoredWebhook` and the WS sanitizers whitelist fields, so a new hook field
is dropped on reload or on the wire until it is added to both.

**Hook urls are reachable wherever Kanna is.** Localhost by default;
`--remote`, `--share` and tunnels make them public, and then the secret is the
only barrier. The client reads `webhooks` through the global subscription and
never persists a revealed secret.
