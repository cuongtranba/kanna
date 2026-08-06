# Session tabs — wiring the model into the app

## Goal

One tab per open chat. N open chats = N tabs. Keyboard switching. Two chat
tabs render two **different live transcripts** side by side.

## Root cause of "always exactly one tab"

`PaneTabTarget`'s chat variant is `{ kind: "chat" }` — it carries **no
chatId**. `buildTabId` maps it to the constant `"chat"`, and `chat` is in
`SINGLETON_KINDS`. So opening a second chat resolves to the same tab id and
just focuses the existing tab. Which chat is displayed comes from the route,
not the tab.

`tabTarget.ts` states the reason outright:

> `chat` is a singleton for a hard reason, not a stylistic one: every
> transcript prop originates from a single `useOutletContext<KannaState>()`,
> so a second live transcript has no context to read from.

**That blocker is already gone.** PRs #624 + #625 (plan chunks 0.1–0.9) exist
precisely to remove it:

- `useKannaState(activeChatId)` is parameterized by chatId, and its own comment
  says it is designed for "multiple useKannaState instances mount (one per open
  chat tab)".
- `chatStateStore` is keyed by chatId (snapshot, history, ready, resync nonce).
- `AppGlobalProvider` owns the socket + global subscriptions, so N instances do
  not open N sockets.
- `ChatTabScopedStore` gives each tab its own composer / scroll / input height.

What remains is to let a chat tab **address** a chat, and to source its state
from its own `useKannaState` rather than the single route-level one.

## Current vs target

```mermaid
graph TB
  subgraph CURRENT["CURRENT — one transcript, route-owned"]
    A1["App.tsx<br/>useKannaState(params.chatId)"] -->|Outlet context| B1["ChatPage"]
    B1 --> C1["PaneShell"]
    C1 --> D1["registry.chat()<br/><i>ignores target</i>"]
    D1 --> E1["ChatTabRoot"]
    E1 --> F1["ChatTabContent<br/>useOutletContext&lt;KannaState&gt;"]
    F1 -.->|reads| A1
    style D1 fill:#4a2c2c,color:#fff
    style F1 fill:#4a2c2c,color:#fff
  end

  subgraph TARGET["TARGET — one transcript per tab"]
    A2["App.tsx<br/>useKannaState(route chatId)"] -->|Outlet context<br/>Settings/Workflows only| B2["ChatPage"]
    B2 --> C2["PaneShell"]
    C2 --> D2["registry.chat(target)<br/><b>target.chatId</b>"]
    D2 --> E2["ChatTabRoot chatId=A<br/><b>useKannaState(A)</b>"]
    D2 --> E3["ChatTabRoot chatId=B<br/><b>useKannaState(B)</b>"]
    E2 --> F2["ChatTabContent<br/>useChatTabState()"]
    E3 --> F3["ChatTabContent<br/>useChatTabState()"]
    style D2 fill:#2c4a32,color:#fff
    style E2 fill:#2c4a32,color:#fff
    style E3 fill:#2c4a32,color:#fff
  end

  CURRENT ==>|this plan| TARGET
```

### Tab identity change

```mermaid
graph LR
  subgraph BEFORE
    T1["{ kind: 'chat' }"] --> ID1["buildTabId → 'chat'"]
    ID1 --> S1["SINGLETON_KINDS<br/>has 'chat'"]
    S1 --> R1["2nd open focuses<br/>the SAME tab"]
    style R1 fill:#4a2c2c,color:#fff
  end
  subgraph AFTER
    T2["{ kind: 'chat',<br/>chatId: 'abc' }"] --> ID2["buildTabId →<br/>'chat_3_abc'"]
    ID2 --> S2["singleton: only<br/>'changes'"]
    S2 --> R2["2nd open creates<br/>a NEW tab"]
    style R2 fill:#2c4a32,color:#fff
  end
```

### Opening a chat

```mermaid
sequenceDiagram
  participant U as User
  participant SB as Sidebar
  participant NAV as chatNavigator
  participant PL as paneLayoutStore
  participant PS as PaneShell
  U->>SB: click chat B (chat A already open)
  SB->>NAV: openChat(B)
  NAV->>PL: openTab({kind:'chat', chatId:B})
  Note over PL: buildTabId = chat_1_B<br/>≠ chat_1_A → NEW tab
  PL->>PL: focus the new tab
  PL-->>PS: layout: pane has 2 tabs
  PS->>PS: registry.chat({chatId:A}) + ({chatId:B})
  Note over PS: two ChatTabRoots,<br/>useKannaState(A) and (B)
  NAV->>NAV: navigate(/chat/B) — URL follows focus
```

## Stages

Each stage ends green (`bun run lint`, `bun run typecheck`, `bunx ast-grep test`,
targeted tests). Browser check at C and at the end.

**A — tab identity (pure).**
`PaneTabTarget` chat gains `chatId`. `buildTabId` → `chat_${part(chatId)}`.
`normalizeTabTarget` validates/drops a chat tab with no chatId. `tabTargetsEqual`
compares chatId. Drop `chat` from `SINGLETON_KINDS`. `describeTab` labels a chat
tab from its title and makes it closable when it is not the last one.
Migration: a persisted `{kind:"chat"}` maps to the layout's chat or is dropped.

**B — per-tab state.**
`ChatTabRoot({chatId})` calls `useKannaState(chatId)` and provides it through a
new `ChatTabStateContext`. `ChatTabContent` reads `useChatTabState()` instead of
`useOutletContext`. Other pages keep the outlet context untouched.

**C — wiring.**
Opening a chat opens/focuses its tab. Closing a tab drops it. Focus ↔ URL stay
in sync. Browser: 2 chats → 2 tabs, split → two live transcripts.

**D — keyboard.** Verify `nextPaneTab`/`closePaneTab` cycle chat tabs; fix if not.

**E — oracle.** Replace the synthetic tests with ones that mount the real
`App`/`ChatPage` and assert tab COUNT grows on a second chat, and that two tabs
render two different transcripts. The oracle must fail if the app stops calling
the primitives.

**F — remove the duplicate.** `lib/paneTree/sessionPanes.ts` is a second, flat
pane model added by an earlier chunk and called from zero production code; the
real engine is `tree.ts`/`operations.ts`. Delete it with its tests.

## Why the previous oracle passed while the feature did not

Its tests called `openPane`/`nextPane` directly and hand-mounted two
`ChatTabRoot`s. That proves the primitives work; it cannot prove the app calls
them. Test (a) mounted a synthetic consumer through a router, not the real
`ChatPage`. Stage E fixes this by asserting on the rendered app.
