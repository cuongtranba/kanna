# Beacon — a user-authorized companion daemon — Design

**Status:** Draft for review
**Date:** 2026-10-08
**Author:** Brainstorm session (cuongtranba)

## Goal

Let a user pair one or more machines they own with their Kanna server, so the
agent can read files, write files, and run OS scripts **on that machine** —
without the user manually uploading files through the browser. This is the
missing half of accessing Kanna over a Cloudflare tunnel: today the agent's
`Bash`/`Read`/`Write` act on the Kanna **host**, but the user's real files live
on the laptop they are browsing from.

A **beacon** is a small companion daemon the user installs on their own
machine. It dials **out** to the Kanna server over an authenticated channel and
executes scoped, approved requests. Kanna drives it with explicit `beacon_*`
MCP tools.

## Framing — this is delegation, not remote control

"Beacon" and the phrase "control the user computer" are C2/RAT vocabulary, and
the feature must not be designed as one. What this actually is: a
**user-authorized companion daemon** in the same category as Tailscale, an SSH
server with `authorized_keys`, a self-hosted CI runner, or VS Code Remote. The
beacon runs with the privileges of the user who installed it and acts only on
that user's explicit, revocable authorization on that user's own machine. It is
delegation of the user's own authority, never escalation.

Everything that makes this legitimate rather than malware is in the design, so
these are **core requirements, not polish**:

1. **User-initiated pairing only**, from an authenticated Settings session —
   and **only on an install with a Kanna password set**. Without one, `/ws` is
   unauthenticated (`http-dispatcher.ts:68` gates it inside `if (auth)`), so
   anyone holding the tunnel URL could drive the agent and through it the
   user's machine. Pairing refuses, and `/beacon` rejects every connection,
   while `auth` is null.
2. **Asymmetric-key authentication** — the beacon's private key never leaves its
   host; Kanna stores only the public key.
3. **Default-deny capability scope per beacon** — exec off, no read roots, no
   write roots until the user grants them.
4. **Consent on sensitive actions**, through Kanna's existing durable approval
   protocol.
5. **Full audit trail** and **one-click revoke**.

The name is kept as "beacon" per the brief, but the document treats "beacon" as
"the user's own paired machine," never as an implant.

## Non-goals (this phase)

- Transparent rerouting of the existing `read`/`write`/`bash` shims onto a bound
  beacon. Phase 1 ships explicit `beacon_*` tools only; "where did this run" must
  be explicit before it is ever implicit.
- Kanna reaching a beacon it did not pair, or a beacon connecting to a Kanna it
  did not pair.
- Any inbound listening socket on the beacon host. The beacon dials out; it
  opens no ports.
- OS keychain integration for the beacon's private key (Phase 2; Phase 1 stores
  it in a `0600` file on the beacon host).
- Multi-user / team ownership of a beacon. A beacon belongs to the Kanna install
  that paired it.

## Why dial-out, not dial-in

The user reaches Kanna over a tunnel precisely because their laptop is behind
NAT with no public address. A dial-**in** beacon would need an inbound port on
the laptop — the exact listening-service posture we must avoid. A dial-**out**
beacon needs no open ports, traverses NAT for free, and makes Kanna the
rendezvous point it already is. It is both easier and safer.

## Architecture at a glance

```
┌────────────┐     signed-challenge WS      ┌──────────────┐
│  Beacon    │ ───────────────────────────▶ │ Kanna server │
│ (user host)│   /beacon endpoint (dial-out)│              │
│            │                              │  BeaconRegistry
│ Ed25519 key│ ◀─── scoped RPC requests ─── │  (live status)
│ shell adptr│ ──── streamed results ─────▶ │              │
└────────────┘                              │  beacon_* MCP │
                                            │  tools ───────┼──▶ agent
                                            │  durable      │
                                            │  approval gate│
                                            └──────────────┘
```

- The **beacon binary** is Bun-compiled (`bun build --compile`, cross-targeted
  to win/mac/linux). It shares `src/shared` contracts and types with Kanna — one
  language, one toolchain, one protocol definition.
- The beacon **dials out** to a dedicated Kanna endpoint and authenticates by
  signing a server challenge with its private key.
- Kanna tracks every connected beacon in a **`BeaconRegistry`**, pushes live
  status to the client, and exposes `beacon_*` MCP tools gated by the durable
  approval protocol and each beacon's capability scope.

## Decisions

| # | Decision |
| --- | --- |
| 1 | Beacon is a **Bun-compiled binary** sharing `src/shared` contracts. |
| 2 | The agent reaches a beacon through **explicit `beacon_*` MCP tools**, not transparent shim rerouting. |
| 3 | Beacons authenticate by **signing a server challenge** (Ed25519); the private key never leaves the beacon host. |
| 4 | Beacons connect to a **dedicated inbound endpoint**, not the cookie-gated client `/ws`. |
| 5 | Capability scope is **default-deny** per beacon and enforced **twice** — on the Kanna side (fail fast) and on the beacon side (final authority). |
| 6 | Every `beacon_*` call is gated by the **durable approval protocol**, with a per-beacon allowlist pre-authorizing known-safe verbs. |
| 7 | Beacon registry entries live in the **settings collection**, mirroring `customMcpServers`; live connection state lives in an **in-memory registry** pushed over a new WS topic. |
| 8 | Scope is configured **per beacon only** — no per-chat or per-project narrowing in either phase. |
| 9 | The audit trail is the **chat transcript**: each `beacon_*` call, its approval, and its result. No separate activity view or read-model. |
| 11 | Beacons work **only when a Kanna password is set**; with `auth` null, pairing refuses and `/beacon` rejects every connection. |
| 10 | The daemon ships as a **standalone Bun binary** per target, published as **GitHub release assets** with checksums; the handshake carries a **protocol version** because binary and server release separately. |

---

## 1. Pairing and authentication

### Pairing (one-time, user-initiated)

1. In Settings → **Beacons**, the user clicks **Pair a machine**. Kanna mints a
   short-lived, single-use **pairing code** (random, ~8–10 chars, TTL ~5 min)
   and shows it with the beacon connect URL.
2. On the target machine the user runs `kanna-beacon pair <kanna-url> <code>`.
3. The beacon generates an **Ed25519 keypair** locally, stores the private key
   in a `0600` file, and sends `{pairingCode, publicKey, machineLabel, os}` to
   the pairing endpoint.
4. Kanna verifies the code (valid, unexpired, unused), consumes it, and persists
   a beacon entry: `{id, label, publicKey, os, scope: DEFAULT_DENY, enabled,
   createdAt}`. The pairing code is discarded immediately.

The pairing code is the only secret on the wire, it is short-lived and
single-use, and it is only ever shown inside an authenticated Settings session.

### Connection auth (every reconnect)

1. The beacon dials the dedicated endpoint and sends its `beaconId`.
2. Kanna replies with a random **challenge nonce**.
3. The beacon signs the nonce with its private key and returns the signature.
4. Kanna verifies the signature against the stored public key. On success the
   socket is bound to that `beaconId`; on failure it is closed.

No long-lived bearer token is ever issued to the beacon, so there is nothing on
the beacon host to exfiltrate beyond the private key itself (which `0600` and,
in Phase 2, the OS keychain protect). Deleting the beacon entry removes the
public key, so every future challenge fails — **revocation is immediate**.

### Many beacons

Each pairing produces an independent identity (its own keypair and scope). A
Kanna install pairs as many beacons as the user wants; the agent names the one
it wants by id/label in each `beacon_*` call.

---

## 2. Capability scope (default-deny)

Each beacon entry carries a scope, enforced on **both** sides:

```ts
type BeaconScope = {
  exec: boolean                 // default false
  execAllowlist: string[]       // verbs auto-approved, like bash.autoAllowVerbs
  readRoots: string[]           // default []  — empty means no read
  writeRoots: string[]          // default []  — empty means no write
  perCallTimeoutMs: number      // default e.g. 30_000
  outputByteCap: number         // default e.g. 1_000_000
  maxConcurrent: number         // default e.g. 2
}
```

- **Kanna side (fail fast).** Before a `beacon_*` call leaves the server, it is
  checked against scope — mirroring `permission-gate.ts` (`pathInsideAllowedRoots`,
  the read/write root checks, the bash verb allowlist). A call outside scope is
  denied without ever reaching the beacon.
- **Beacon side (final authority).** The beacon re-checks every request against
  its own copy of the scope and its real filesystem. The beacon is the last word
  on its own machine; a compromised server still cannot exceed the granted scope.
  Phase-2 path checks on the beacon use **realpath**, closing the lexical-symlink
  gap the research found in the server shims (see §8).

The default scope grants nothing: `exec: false`, empty roots. The user widens it
deliberately in the Beacons UI.

Scope belongs to the beacon and has **one owner**: the `customBeacons` settings
entry. Every chat that can reach Kanna's MCP tools sees the same grant. Per-chat
or per-project narrowing was considered and left out — it would add a second
source of scope state and its own UI for a need nobody has hit yet. Because
`BeaconScope` is a plain object on the entry, a narrowing layer can be added
later without migrating stored grants.

---

## 3. The `beacon_*` MCP tool group

A new tool-group module `src/server/kanna-mcp-beacon.ts` exports
`buildBeaconToolList(deps, tool)`, following `buildBoardToolList`
(`kanna-mcp-boards.ts:50`) and `buildPluginToolList` (`kanna-mcp-plugins.ts:119`).
It registers **only** when `beaconRegistry && chatId` are present, and its
results use `ok()` / `fail()` (`kanna-mcp-tool.ts:9–15`) — the
`mcp-inline-tool-results` budget pins inline result literals at 0.

Phase-1 tools:

| Tool | Purpose | Gate |
| --- | --- | --- |
| `beacon_list` | List paired beacons, their online/offline state, OS, and granted scope. | none (read-only metadata) |
| `beacon_read` | Read a file from a beacon within `readRoots`. | scope + approval |
| `beacon_exec` | Run a script/command on a beacon (per-OS shell). | scope + approval; allowlisted verbs auto-approve |
| `beacon_stat` / `beacon_glob` | Stat / list paths within `readRoots`. | scope + approval |

Deferred to Phase 2: `beacon_write`, streaming attach, transparent shim
rerouting.

Each gated tool calls `toolCallback.submit` through `gatedToolCall`
(`kanna-mcp-tools/tool-callback-shim.ts:29`), so a `beacon_*` call follows the
**exact same durable approval path** as the existing shims. The approval payload
is not used for execution; on `allow` the server forwards the already-validated
request to the beacon over the live socket. New tool-name constants go in
`src/shared/tools.ts`.

**Approval vs allowlist — both need new code.** Today only `mcp__kanna__bash`
gets verb logic (`permission-gate.ts:186`), and the read-root check covers only
`READ_PATH_TOOLS` (`:100`); every other name falls through to the chat's
`defaultAction`, which is `ask` (`:254`). So the gate gains a **beacon branch**
that resolves the beacon's scope and: denies anything outside `readRoots` or
with `exec: false`; auto-allows a `beacon_exec` whose verb is in
`execAllowlist`; and asks for everything else. This gives the user both a
standing grant for routine commands and a consent prompt for everything novel.

**The consent card must name the machine.** The generic pending card
(`PendingToolRequestMessage.tsx`, `GenericPending`) previews only `command`,
`path`, `url`, `pattern` or `query` — a user approving `beacon_exec` could not
tell which machine it targets. Beacon calls get a dedicated pending card showing
the beacon label, OS and online state beside the command or path, and
`normalizeToolCall` gains `beacon_*` cases so the transcript renders them as
beacon calls rather than `unknown_tool`.

---

## 4. Inbound transport — a dedicated endpoint

The research is decisive here: `/ws` is the **only** inbound WebSocket, it is
cookie-gated when a password is set (`http-dispatcher.ts:68–92`), Bun allows
**one** `websocket` handler set per server (`server.ts:658–662`), and the router
assumes `ws.data` is a `ClientState` with `subscriptions`
(`ws-router-utils.ts:15`).

A beacon authenticates by key signature, not a session cookie, and speaks a
different protocol than the client. Overloading `/ws` would mean a discriminant
smuggled into `ws.data` and a branch in every shared handler. Instead:

- Add a **dedicated beacon endpoint** (`/beacon`) with its **own** `ws.data`
  discriminant and its own message handler, branched in `http-dispatcher.ts`
  **before** the `/ws` block. Its auth is the signed-challenge handshake (§1),
  not `isAuthenticated`.
- Because Bun takes one handler set, the `websocket` handlers in `server.ts`
  dispatch on a `kind` discriminant in `ws.data`: `ClientState` gains
  `kind: "client"`, the beacon socket carries `kind: "beacon"`. The beacon
  handlers live in their own module so `server.ts` (697 lines, 3 under the
  700-line `module_unlisted` threshold) grows by the dispatch only.
- All socket I/O, the challenge crypto, and signature verification live in a
  `beacon-transport.adapter.ts` (and a `beacon-crypto.adapter.ts`), because the
  side-effect seal bans `Bun.listen`/`Bun.connect` (the `Bun` global) outside
  `*.adapter.ts`. **Note the gap** the research found: `node:net`, `node:tls`,
  and the `ws` npm package are **not** in the banned-imports list, so a raw
  socket would pass lint — we still put it in an adapter by convention, and
  add those modules to the seal in the same PR. (`ws` is not a dependency and is
  not needed: the beacon uses Bun's global `WebSocket` client.)

The pairing handshake itself can be a plain authenticated HTTP POST
(`/beacon/pair`) inside the Settings session, rather than a socket, since it
happens once.

---

## 5. Live status in Settings

The PTY-instances topic this section first cited was deleted with the PTY
driver. Beacons are install-wide, not per chat, so the model is the **global
`cron-jobs` topic** (snapshot pushed on change), with `workflow-registry.ts` as
the registry shape:

- **Server registry** `BeaconRegistry` (`beacon-registry.ts`), modeled on
  `workflow-registry.ts`: `connect`/`heartbeat`/`disconnect`, `snapshot()`, and
  `subscribe()`. It holds **live** connection state (online, `lastSeenAt`, `rtt`,
  `beaconVersion`), keyed by `beaconId`, plus the live socket handle used to
  forward requests. Liveness comes from a **heartbeat** on the beacon socket.
- **Transport**: new topic `{type:"beacons"}` in `SubscriptionTopic` and
  `ServerSnapshot` (`protocol.ts`, beside `cron-jobs` at `:64` / `:440`); an
  envelope branch in `ws-router-envelope.ts` (beside `cron-jobs` at `:401`); a
  push on registry change in `ws-router-broadcast.ts` (beside `:180`).
- **Client store** `beaconsStore.ts` with a module-level `EMPTY` and stable
  selectors. Live last-seen renders through `useNow(1_000)` + `formatAge`
  (`BackgroundTasksSection.tsx` is the precedent), with `tabular-nums`.

**Two distinct states, two distinct stores:**

- **Registry entry** (settings, durable): the paired identity — public key,
  label, OS, **scope**, `enabled`. Mirrors `customMcpServers`.
- **Live state** (registry, in-memory): online/offline, last-seen, RTT. Mirrors
  the `cron-jobs` global topic.

This avoids the `customMcpServers` wrinkle where the transient test result is
persisted to disk; a beacon's online/offline must **not** be written to
`settings.json`.

---

## 6. Settings CRUD — mirror `customMcpServers`

The paired-beacon list is a settings collection that reuses the generic CRUD
machinery exactly as custom MCP servers do:

- **State**: `customBeacons: BeaconConfig[]` in `app-settings-types.ts` (beside
  `customMcpServers` at `:296`).
- **Patch**: `AppSettingsPatch.customBeacons` with
  `update | delete | setEnabled | setScope` (mirror `:360`). There is no
  `create` from the client: an entry is created only by a successful pairing,
  server-side.
- **Reducer**: a `BEACON_CRUD` through the generic `CollectionCrud` +
  `applyCollectionPatch` (`app-settings.ts:1341`, `MCP_CRUD` at `:1421` is the
  model). `app-settings.ts` has 62 lines of budget headroom (ceiling 1900,
  current 1838) and `settings-bound-throws` is pinned at its count, so
  normalization and validation live in a new `beacon-settings.ts` and
  `app-settings.ts` gains only the wiring.
- **Validation**: a name/label regex and a reserved-name check, mirroring
  `validateMcpName` and `MCP_RESERVED_NAMES`.
- **WS RPC**: writes ride the existing `settings.writeAppSettingsPatch`
  (`protocol.ts:167`, `ws-router-settings.ts:188`) — **no new write endpoint**.
  No Test button: "online" already comes from the live registry. Minting a
  pairing code is one new command, `beacons.mintPairingCode`, whose result is
  typed (the `untyped-command-results` budget is pinned).
- **UI**: a **Beacons** section mirroring `McpServersSection` + `McpServerRow`
  (CRUD, per-row status pill, confirm-on-delete via `dom.confirmDialog`, pending
  state via `runPendingAction` / `<Button pending>`). Status pills must derive
  classes from `STATUS_PILL_CLASS` / `statusToneClass` or an entry added to
  `TONE_PAIRINGS` — inline tint pairs fail `rules/no-inline-tint-pairing.yml`.
  The one online/offline precedent (`KannaSidebar.tsx:601`) has no last-seen, so
  the beacon pill is new ground; use `bg-success`/`bg-warning` dots as it does.

---

## 7. Protocol (`src/shared/beacon-protocol.ts`)

A single versioned definition imported by both Kanna and the beacon binary:

- **Envelope**: `{v, id, kind, ...}` request/response, correlated by `id`.
- **Handshake**: `hello{beaconId, protocolVersion, beaconVersion}` →
  `challenge{nonce}` → `auth{signature}` → `ready{scope}`. The server refuses an
  unsupported `protocolVersion` with `incompatible{minSupported, downloadUrl}`
  **before** issuing a challenge, and the beacon prints that as an upgrade
  instruction rather than retrying.
- **Requests**: `exec{cmd, args, cwd?}`, `read{path}`, `stat{path}`,
  `glob{path}`, (Phase 2: `write{path, contents}`).
- **Streaming**: `exec` streams `stdout`/`stderr` chunks then an `exit{code}`,
  so long-running commands surface output incrementally (reuse the
  background-task-output streaming shape).
- **Heartbeat**: periodic `ping`/`pong` drives `lastSeenAt` and detects drops.
- **Per-OS shell adapter** on the beacon: PowerShell on Windows, `bash`/`sh` on
  Linux/macOS, selected from the handshake `os`.

Because the protocol is shared source, a Kanna change and a beacon change cannot
silently disagree about the wire.

---

## 8. Security findings carried from research

- **`settings.json` is `0644` today, not `0600`** as CLAUDE.md and the custom-MCP
  design claim. Beacon registry entries hold **public** keys and scope (not
  secrets), so `0644` is acceptable for them — but this design must not repeat
  the `0600` claim. The beacon's **private** key is `0600` on the **beacon** host.
- **Server path checks are lexical** (`permission-gate.ts`), so a symlink inside
  an allowed root that points outside it would pass. The beacon's own path checks
  **must use realpath** so the final authority is sound even though the server's
  fail-fast check is lexical.
- **The durable approval path has no timeout** (`NEVER_EXPIRES`), contradicting
  CLAUDE.md's `tickTimeouts` description. A `beacon_exec` awaiting approval would
  therefore block indefinitely; the **per-call timeout lives in scope** and is
  enforced by the beacon, not by the approval layer.
- **Audit is the transcript.** Every `beacon_*` call already lands in the chat's
  event-sourced transcript as a `tool_call`, its durable approval record, and a
  `tool_result`. The tool's input and result therefore must name the **beacon id
  and label**, the resolved path or command, and the exit code, so the
  transcript alone answers "what ran where, and who approved it". No separate
  activity log, read-model, or view is built. The beacon also writes nothing
  about requests to disk on its host, so no second, unreviewed copy exists.

---

## 9. Architecture-budget awareness

Measured on `origin/main` 146233f4. Every `PATTERN_BUDGETS` population is at its
pin, so each new thing must avoid the counted shape rather than raise a pin.

| Module / pattern | Now | Limit | Consequence |
| --- | --- | --- | --- |
| `server.ts` | 697 | 700 (unlisted) | Registry construction and the beacon socket handlers live in a new module; `server.ts` gains only the `kind` dispatch. |
| `app-settings.ts` | 1838 | 1900 | Beacon normalize/validate in `beacon-settings.ts`; only wiring here. |
| `kanna-mcp.ts` | 1105 | 1326 | Tools in `kanna-mcp-beacon.ts`; one spread line here. |
| `SettingsPage.tsx` | 2274 | 2300 | `BeaconsSection.tsx` owns the UI; the page gains a nav entry, a mount, and the changelog-exclusion id (`:2168`). |
| `useAppGlobalState.ts` | 1366 | 1421 | Live status through a dedicated store, not this hook. |
| `deps-bundles` | 83 | 83 | No new `*Deps` interface or inline `deps: {` parameter in `src/server/`; pass the registry and settings as named parameters. |
| `ws-router-dispatch-arms` | 0 | 0 | The new command registers through the existing handler table, never a `case` arm. |
| `untyped-command-results` | 60 | 60 | The client calls the new command through a typed result. |
| `settings-bound-throws` | 13 | 13 | Validation errors use a typed exception, not `throw new Error(`. |

New IO (`beacon-transport.adapter.ts`, `beacon-crypto.adapter.ts`, and the
daemon's own adapters) stays in `*.adapter.ts`; add `node:net`/`node:tls`/`ws` to
the side-effect seal, and give `src/beacon/**` its own seal block — today no seal
block covers a new top-level `src/` directory.

---

## 10. Distribution and versioning

- **Artifact.** `kanna-beacon` is built with `bun build --compile` from an entry
  under `src/beacon/`, one binary per target: `darwin-arm64`, `darwin-x64`,
  `linux-x64`, `linux-arm64`, `windows-x64`. The target machine needs no Node or
  Bun.
- **Channel.** The binaries and a `SHA256SUMS` file are attached as **GitHub
  release assets** on `cuongtranba/kanna`, by a job in the existing release
  workflow that runs after release-please cuts the tag. The beacon is versioned
  with the Kanna release that built it.
- **Install path shown to the user.** Settings → Beacons → **Pair a machine**
  shows the download link for the latest release and the exact
  `kanna-beacon pair <url> <code>` line, so pairing needs no other docs.
- **Version skew is expected, not an error.** Server and binary upgrade
  independently, so the wire carries `protocolVersion` (an integer bumped only on
  a breaking wire change) separately from `beaconVersion` (informational,
  displayed in Settings). The server keeps a `MIN_BEACON_PROTOCOL` constant in
  `src/shared/beacon-protocol.ts` and answers an older beacon with `incompatible`
  (§7). Settings shows "update available" when `beaconVersion` is behind the
  server's own version.
- **Code signing** (macOS notarization, Windows Authenticode) is **Phase 2**.
  Phase 1 binaries are unsigned; the checksum file is the integrity check, and
  the docs say how to clear the macOS quarantine attribute.
- **Self-update** is out of scope. The user downloads a new binary.

---

## 11. Phasing

**Phase 1 — a beacon you can read and run on, safely.**
Pairing + signed-challenge connect with a protocol-version check; `BeaconRegistry`
+ live status topic + Settings Beacons section; `beacon_list` / `beacon_read` /
`beacon_exec` (allowlist + approval) through the durable gate; default-deny
per-beacon scope with a UI to widen it; transcript audit; one-click revoke;
shared protocol module; per-OS shell adapter; realpath enforcement on the beacon;
the compiled binaries published as release assets.

**Phase 2 — richer and more transparent.**
`beacon_write`; streaming attach UI; OS-keychain private-key storage; signed
and notarized binaries; richer scope editor; optional transparent rerouting of
the `read`/`write`/`bash` shims onto a bound beacon once the explicit tools are
trusted.

---

## Resolved questions (2026-10-08)

| Question | Answer |
| --- | --- |
| Scope granularity | Per beacon only. No per-chat or per-project narrowing (§2). |
| Audit visibility | The chat transcript is the audit trail; no dedicated view (§8). |
| Binary distribution | A standalone Bun binary per target, published as GitHub release assets with checksums; the handshake checks protocol version (§10). |
