# Kanban Boards for Kanna — Design Brainstorm

Status: **draft for review** · Branch: `feat/kanban-boards` · Date: 2026-08-10

Goal: every Kanna project can own **N user-defined boards**, backed by a **local
SQLite database**, kept in **two-way sync** with external trackers through a
**pluggable provider port** (GitHub first), and driveable **by agents** through
MCP tools.

---

## 1. Decisions taken

| # | Decision | Consequence |
|---|---|---|
| D1 | **`bun:sqlite`** is the board store, not the JSONL event log | New persistence engine → needs an ADR that scopes an override of `ref-event-sourcing`; `new Database` only inside a `.adapter.ts` |
| D2 | Columns are **user-defined workflow stages** (backlog → todo → progress → test → qa → deployment) | No hardcoded status enum anywhere; every remote mapping is data |
| D3 | **Agents move cards** via `mcp__kanna__board_*` tools | Board becomes the agent's work queue; needs attribution + a push guard |
| D4 | **Two-way sync behind a provider port**, more adapters later | `BoardSyncProvider` interface; GitHub is adapter #1 |
| D5 | Credentials from the **`gh` CLI token**, PAT fallback | No new auth UI; `gh` absent → clear error + settings fallback |
| D6 | **Last-writer-wins per field + conflict log** | Needs per-field watermarks, never silently loses work |
| D7 | **Full template system** | Board = instantiated template (columns + card field schema + mapping defaults) |

### D1 is the one that needs justification

Kanna persists everything else as append-only JSONL replayed into in-memory read
models (`ref-event-sourcing`, `ref-local-first-data`). Boards break that pattern
deliberately, because **two-way sync is a relational, queryable workload**:

- *"which cards changed since watermark X"* is an indexed range scan, not a log replay;
- sync needs **per-field watermarks**, an **outbox**, and a **conflict log** joined by external ref;
- imported issue volume (a 5k-issue repo) wants indexes and paging, not a full in-memory projection;
- a **transactional outbox** (card write + push intent in one `BEGIN…COMMIT`) is the root-cause fix for lost updates, and it needs real transactions.

`ref-local-first-data` is **not** overridden — the DB file lives at
`~/.kanna/data/boards.db`, same directory, same local-first posture.

---

## 2. Where it sits in the C3 model

```mermaid
flowchart TB
  subgraph shared["c3-3 Shared"]
    T["c3-301 types<br/>+ boards/ domain types"]
    P["c3-302 protocol<br/>+ board WS envelopes"]
    RK["boards/rank.ts<br/>fractional index, pure"]
  end

  subgraph server["c3-2 Server"]
    BS["NEW c3-232 board-store<br/>port + pure logic"]
    BSA["board-store.adapter.ts<br/>bun:sqlite + migrations"]
    BR["NEW c3-233 board-registry<br/>snapshot + subscribe"]
    SY["NEW c3-234 board-sync<br/>pull / push / conflict"]
    GH["github.adapter.ts<br/>+ github-cli.adapter.ts"]
    WS["c3-208 ws-router"]
    MCP["c3-226 kanna-mcp-host<br/>+ board_* tools"]
  end

  subgraph client["c3-1 Client"]
    BP["NEW c3-119 board-page"]
    KB["KannaBoard wrapper<br/>isolates react-kanban-kit"]
    ST["c3-102 boardsStore"]
    SB["c3-111 sidebar<br/>project to boards"]
  end

  T --> BS
  T --> BP
  RK --> BS
  RK --> KB
  BS --> BSA
  BS --> BR
  BS --> SY
  SY --> GH
  BR --> WS
  BS --> WS
  BS --> MCP
  WS <--> ST
  P --> WS
  P --> ST
  ST --> BP
  BP --> KB
  SB --> BP
```

**New facts to author** (one c3 change-unit, same PR as the code): server
components `board-store`, `board-registry`, `board-sync`; client component
`board-page`; refs `ref-relational-board-store` and `ref-sync-provider-port`;
plus the ADR carrying the D1 override.

---

## 3. Data model

A board is owned by **either** a project or a Stack (`owner_kind` + `owner_id`). A card
therefore carries its **own** `project_id` — on a project board it is simply the owner, but
on a Stack board it is the only thing that can answer *"which checkout does Start work
spawn a chat in?"*.

```mermaid
erDiagram
  PROJECT ||--o{ BOARD : owns
  STACK ||--o{ BOARD : owns
  PROJECT ||--o{ CARD : "hosts work for"
  BOARD ||--o{ BOARD_COLUMN : has
  BOARD ||--o{ CARD : contains
  BOARD_COLUMN ||--o{ CARD : holds
  BOARD }o--|| BOARD_TEMPLATE : "instantiated from"
  CARD ||--o{ CARD_LINK : references
  CARD ||--o{ CARD_COMMENT : has
  BOARD ||--o{ SYNC_BINDING : "bound to"
  SYNC_BINDING ||--o{ COLUMN_MAPPING : maps
  SYNC_BINDING ||--o{ SYNC_LINK : tracks
  CARD ||--o| SYNC_LINK : "mirrors remote"
  SYNC_LINK ||--o{ SYNC_CONFLICT : logs
  CARD ||--o{ SYNC_OUTBOX : queues

  BOARD {
    text id PK
    text owner_kind "project or stack"
    text owner_id FK
    text title
    text template_id FK
    json card_fields "FieldDef[] schema"
    int  created_at
    int  updated_at
    int  archived_at "nullable"
  }
  BOARD_COLUMN {
    text id PK
    text board_id FK
    text title
    text rank "fractional order"
    text semantic "start active done nullable"
    text color_token "design token name not hex"
    int  wip_limit "nullable"
  }
  CARD {
    text id PK
    text board_id FK
    text column_id FK
    text project_id "which checkout Start work uses"
    text title
    text rank "fractional order in column"
    json content "values keyed by FieldDef id"
    text updated_by "user or agent chatId"
    int  created_at
    int  updated_at
    int  archived_at "nullable"
  }
  CARD_LINK {
    text card_id FK
    text kind "chat worktree pr card"
    text target_id
  }
  SYNC_BINDING {
    text id PK
    text board_id FK
    text provider_id "github"
    json source_ref "owner repo or projectV2 id"
    text direction "pull push both"
    int  allow_agent_push "0 default"
    text cursor "provider paging or since"
    int  last_pulled_at
  }
  COLUMN_MAPPING {
    text binding_id FK
    text column_id FK
    text remote_kind "state label projectField"
    text remote_value
  }
  SYNC_LINK {
    text card_id FK
    text binding_id FK
    text external_id
    text external_url
    json field_watermarks "field to remote updatedAt"
    int  last_synced_at
  }
  SYNC_OUTBOX {
    text id PK
    text card_id FK
    text binding_id FK
    text op "create update move close"
    json payload
    text origin "user or agent"
    int  attempts
    int  next_attempt_at
    text last_error "nullable"
  }
  SYNC_CONFLICT {
    text id PK
    text card_id FK
    text field
    json local_value
    json remote_value
    text resolved_as "local remote"
    int  detected_at
  }
  BOARD_TEMPLATE {
    text id PK
    text name
    int  builtin
    json definition "columns cardFields mappingDefaults"
  }
```

### Ordering: fractional indexing, not integers

`rank TEXT` holds a base62 fractional key. A drag emits
`{cardId, fromColumnId, toColumnId, taskAbove, taskBelow}` — exactly the inputs
`rankBetween(above, below)` needs, so **a move is one `UPDATE` of one row**, not a
renumber of the column. Pure and unit-testable in
`src/shared/boards/rank.ts`; a rebalance pass runs when a key exceeds a length
threshold.

### Colors are token names, not hex

`color_token` stores `"chart-1"`, resolved client-side to `var(--color-chart-1)`.
The design lint bans raw hex in source, and storing hex would push an
un-themeable value into the DB — token names stay correct in light and dark.

---

## 4. Layering — the side-effect seal

`bun:sqlite`, `new Database`, and `Bun.spawn` are ESLint **errors** across
`src/server/**` production code. Everything therefore funnels through ports:

```mermaid
flowchart LR
  subgraph pure["Pure - no IO, lintable everywhere"]
    D["shared/boards/types.ts"]
    R["shared/boards/rank.ts"]
    C["board-sync/reconcile.ts<br/>LWW + conflict decision"]
    TPL["board-template.ts<br/>instantiate + validate"]
  end

  subgraph ports["Ports - interfaces only"]
    BSP["BoardStore"]
    SP["BoardSyncProvider"]
    AP["GitHubAuth"]
  end

  subgraph adapters["*.adapter.ts - the only IO"]
    SQL["board-store.adapter.ts<br/>bun:sqlite + migrations"]
    GHA["github.adapter.ts<br/>REST + GraphQL fetch"]
    CLI["github-cli.adapter.ts<br/>gh auth token spawn"]
  end

  D --> BSP
  R --> BSP
  C --> SP
  TPL --> BSP
  BSP --> SQL
  SP --> GHA
  AP --> CLI
  GHA --> AP
```

**Rule of thumb:** reconciliation logic (who wins, what changed, what to enqueue)
is a **pure function over two snapshots**; the adapter only fetches and writes.
That is what makes conflict resolution testable without a network or a DB.

### The provider port

```ts
export interface BoardSyncProvider {
  readonly id: string                               // "github"
  readonly capabilities: {
    push: boolean
    remoteKinds: readonly RemoteKind[]              // "state" | "label" | "projectField"
    fields: readonly RemoteFieldDescriptor[]
  }
  discoverSources(auth: ProviderAuth): Promise<readonly RemoteSource[]>
  pull(input: PullInput): Promise<PullResult>       // { items, cursor, rateLimit }
  push(input: PushInput): Promise<readonly PushOutcome[]>
}
```

Adapter #1 is GitHub, split in two so Issues and Projects v2 evolve
independently: `github-issues.adapter.ts` (REST, `since` cursor) and
`github-projectv2.adapter.ts` (GraphQL, status field options → columns).
GitLab / Jira / Linear later implement the same three methods.

---

## 5. Flow: a human drags a card

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant K as KannaBoard wrapper
  participant S as boardsStore
  participant W as ws-router
  participant B as board-store
  participant DB as boards.db
  participant R as board-registry

  U->>K: drag card to "qa"
  K->>S: onCardMove(move)
  S->>S: optimistic dropHandler(move)
  Note over S: UI updates instantly
  S->>W: card.move with cardId, toColumnId, above, below
  W->>B: moveCard(...)
  B->>B: rankBetween(above.rank, below.rank)
  B->>DB: BEGIN
  DB-->>B: ok
  B->>DB: UPDATE card SET column_id, rank, updated_by
  B->>DB: INSERT sync_outbox (op=move) if bound
  B->>DB: COMMIT
  B->>R: notify(boardId)
  R-->>W: boardUpdated snapshot
  W-->>S: broadcast
  S->>S: reconcile authoritative state
  K-->>U: settled
```

The card write and the push intent land in **one transaction** — the outbox row
cannot be lost if the process dies before the network call.

---

## 6. Flow: two-way sync

```mermaid
sequenceDiagram
  autonumber
  participant T as sync scheduler
  participant SY as board-sync
  participant P as github.adapter
  participant GH as GitHub API
  participant RC as reconcile - pure
  participant DB as boards.db

  rect rgb(240,244,248)
  Note over T,DB: PULL
  T->>SY: pull(binding)
  SY->>P: pull with cursor and since
  P->>GH: GET issues since=cursor
  GH-->>P: items + rateLimit
  P-->>SY: PullResult
  loop each remote item
    SY->>DB: SELECT sync_link by external_id
    SY->>RC: decide(local, remote, watermarks)
    alt new remote item
      RC-->>SY: CREATE
      SY->>DB: INSERT card + sync_link
    else remote newer
      RC-->>SY: TAKE_REMOTE per field
      SY->>DB: UPDATE card + watermarks
    else both changed
      RC-->>SY: LWW + conflict
      SY->>DB: UPDATE card + INSERT sync_conflict
    else local newer
      RC-->>SY: KEEP_LOCAL
      SY->>DB: INSERT sync_outbox
    end
  end
  SY->>DB: UPDATE binding.cursor
  end

  rect rgb(244,240,248)
  Note over T,DB: PUSH - drain outbox
  T->>SY: drainOutbox(binding)
  SY->>DB: SELECT outbox WHERE next_attempt_at lte now
  SY->>SY: guard: origin=agent AND allow_agent_push=0
  SY->>P: push(changes)
  P->>GH: PATCH issue / set project field
  alt success
    GH-->>P: remote updated_at
    P-->>SY: PushOutcome ok
    SY->>DB: DELETE outbox, UPDATE watermarks
    Note over SY,DB: watermark = OUR write<br/>so next pull is not an echo
  else rate limited or error
    GH-->>P: 403 / 5xx
    SY->>DB: UPDATE attempts, next_attempt_at backoff
  end
  end
```

Two subtleties that are easy to get wrong and are designed in here:

- **Echo suppression.** After a successful push we store the resulting *remote*
  `updated_at` into the watermark. Without it, the next pull reads our own write
  as a remote change and ping-pongs forever.
- **Agent push guard.** An agent moving a card to `deployment` must not silently
  close a real GitHub issue. Agent-origin outbox rows are held unless the binding
  sets `allow_agent_push = 1` (default off); held rows surface in the UI.

### Card sync lifecycle

```mermaid
stateDiagram-v2
  [*] --> LocalOnly
  LocalOnly --> Synced: bound and pushed
  LocalOnly --> Synced: imported from remote
  Synced --> DirtyLocal: local edit
  DirtyLocal --> Synced: push ok
  DirtyLocal --> Conflicted: remote also changed
  Synced --> Conflicted: divergent pull
  Conflicted --> Synced: LWW applied and logged
  DirtyLocal --> Held: agent origin, push not allowed
  Held --> DirtyLocal: user approves
  Synced --> Orphaned: remote deleted
  Orphaned --> LocalOnly: unlink
  Orphaned --> [*]: archive
```

---

## 7. Flow: an agent moves a card

```mermaid
sequenceDiagram
  autonumber
  participant A as Claude agent
  participant M as kanna-mcp-host
  participant B as board-store
  participant R as board-registry
  participant UI as board page

  A->>M: board_get with board_id, column_id, limit
  M->>B: bounded page read
  B-->>M: columns + counts + window
  Note over M,A: never dumps N cards -<br/>counts plus a window,<br/>like query_tracking_file
  M-->>A: card list
  A->>M: card_move with card_id, to_column_id
  M->>M: scope check - card in THIS chat's project
  M->>B: moveCard(updated_by = "agent:chatId")
  B-->>M: ok
  B->>R: notify
  R-->>UI: live column change
  M-->>A: moved
```

**MCP surface** (registered when a `chatId` is present, scoped to that chat's
project): `board_list`, `board_get`, `card_create`, `card_move`, `card_update`,
`card_comment`, `card_link_chat`.

Two guardrails carried over from the loop tooling, for the same reasons:

1. **Context bounding.** `board_get` returns counts plus a bounded window, never
   the whole board — the same discipline `query_tracking_file` enforces, so a
   5k-card board cannot blow up a turn.
2. **Project scoping.** Every id is resolved against the chat's project before
   any write, the way `confinePathToDir` scopes the tracking-doc tools.

---

## 7b. "Start work" — card becomes an isolated agent session

One card, one worktree, one branch, one chat. This is what makes the parallel case real:
three agents on three cards cannot touch each other's files.

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant D as Card drawer
  participant B as board-store
  participant WT as worktree-store
  participant AG as agent-coordinator

  U->>D: Start work
  D->>B: resolve card.project_id
  Note over D,B: on a Stack board this is<br/>the only project signal there is
  B-->>D: project + localPath
  D->>WT: create worktree + branch from card
  WT-->>D: worktreePath
  D->>B: INSERT card_link kind=worktree
  D->>AG: create chat, cwd = worktreePath
  Note over D,AG: first prompt seeded from the card -<br/>title, body, acceptance criteria, external link
  AG-->>D: chatId
  D->>B: INSERT card_link kind=chat
  D->>B: move card to column semantic=active
  Note over D,B: no active column defined -<br/>move nothing, say so. Never guess
```

**Branch naming** derives from the card: `card/<external-ref-or-short-id>-<slugged-title>`,
so `#412 Fix: login redirect loop` → `card/412-fix-login-redirect-loop`.

**Cleanup is asked, never automatic.** When a card enters a column marked
`semantic: done`, Kanna asks once: merge the branch, or discard the worktree. It never
deletes an unmerged worktree — losing an agent's work to a column drag is not a
recoverable mistake. A declined prompt leaves the worktree alone and does not ask again
for that card.

**Re-entry.** A card that already has a live worktree shows `Open chat` instead of
`Start work`; a card with a worktree but no live chat shows `Resume` and reuses the
existing worktree rather than creating a second one.

## 8. Templates

A board is an **instantiated template**. `definition_json` carries:

```ts
type BoardTemplateDefinition = {
  columns: readonly { title: string; semantic?: ColumnSemantic; colorToken: string; wipLimit?: number }[]
  cardFields: readonly FieldDef[]        // text | longtext | select | multiselect | number | date | url | label | chat_link
  mappingDefaults?: readonly { columnTitle: string; remoteKind: RemoteKind; remoteValue: string }[]
}
```

Seeded built-ins (migration-inserted, `builtin = 1`, not user-deletable):
**Dev Pipeline** (backlog → todo → in progress → test → qa → deployment),
**Scrum**, **Bug Triage**, **GitHub Issues**. Any board can be saved as a new
template; instantiation is a pure function so it is testable without a DB.

---

## 9. Client

- **Route** `project → Boards`, reachable from the sidebar (c3-111); board list + board view.
- **`<KannaBoard>` wrapper** is the only file importing `react-kanban-kit`. Every visual element is supplied by us through the library's render props (`renderColumnHeader`, `renderColumnWrapper`, `renderListFooter`, `renderColumnAdder`, `renderSkeletonCard`, `configMap.card.render`) using token classes — the library provides layout, DnD, and virtualization, nothing visible.
- **Design gate:** no raw hex, no `backdrop-blur`, project `Tooltip` instead of native `title`, `tabular-nums` on counts and ages. Column dots carry no pulse/glow.
- **Store rules:** `boardsStore` selectors return stable refs (module-level `EMPTY`), state transitions are **named store actions** — no inline updaters in JSX (`no-jsx-inline-state-updater`, `no-jsx-inline-state-logic`), no inline functions passed to custom hooks (`no-unstable-hook-fn-arg`).
- **Scale:** `virtualization` + `loadMore(columnId)` wired to a paged `board.cards.page` command; `totalChildrenCount` comes from a `COUNT(*)`, so a 5k-issue import renders as skeletons and pages in.

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **`react-kanban-kit` is `0.0.2-beta.7`** — pre-1.0, and ships `husky` / `vite-plugin-dts` in `dependencies` (packaging bug); CSS is injected by JS | High | Pin the exact version; confine it to `<KannaBoard>`. Its engine is `@atlaskit/pragmatic-drag-and-drop` (stable, Atlassian-maintained) — the fallback is to drop to that directly behind the same wrapper, without touching server, store, or sync |
| SQLite is a **new persistence precedent** | Medium | ADR scoping the `ref-event-sourcing` override to boards only; `boards.db` stays under `~/.kanna/data` |
| `gh` CLI not installed | Medium | Detect at bind time; fall back to a PAT in settings (0600, like `customMcpServers`); never fail silently |
| GitHub rate limits on large repos | Medium | Honour `x-ratelimit-remaining`, backoff in the outbox, `since` cursor so pulls are incremental |
| **Agent closes a real issue** | High | `allow_agent_push` defaults to `0`; agent-origin pushes are held and surfaced |
| Sync echo loops | High | Post-push watermark = the remote `updated_at` we caused |
| Board-vs-chat scope confusion for agents | Medium | Project-scoped id resolution on every MCP write |

---

## 11. Delivery phases

```mermaid
flowchart LR
  P0["P0 schema + store<br/>port, adapter, migrations, rank"] --> P1["P1 WS commands<br/>registry + broadcast"]
  P1 --> P2["P2 board page<br/>KannaBoard + DnD"]
  P2 --> P3["P3 templates<br/>builtins + save-as"]
  P1 --> P4["P4 provider port<br/>GitHub pull - one way"]
  P4 --> P5["P5 outbox + push<br/>two-way + conflicts"]
  P2 --> P6["P6 MCP board tools<br/>agent moves"]
  P5 --> P7["P7 c3 change-unit<br/>ADR + facts + docs"]
  P6 --> P7
  P3 --> P7
```

Each phase is independently shippable and independently verifiable. P0–P3 give a
working local board with zero network. P4 is useful on its own (import). P5 is
the risky half of sync, isolated behind the port. P6 is additive.

---

## 12. Open questions

1. **Board placement in the UI** — a dedicated project route, or also a pane in the pane-layout (c3-104) so a board can sit beside a chat?
2. **Sync trigger** — on board open + manual refresh, or a background interval per binding?
3. **Chat linkage direction** — should opening a card be able to *spawn* a chat with the card as context, or only link existing chats?
4. **Cross-project boards** — a board is project-scoped here. Does a Stack (multi-project) need one board spanning its projects?
