---
id: adr-20261008-beacon-companion-daemon
c3-seal: feff153d4d821d9a91bceac7ecc313979225178b602bff2937792f013dd997e8
title: beacon-companion-daemon
type: adr
goal: |-
    Let a user pair one or more machines they own with their Kanna server so the
    agent can read files, write files, and run OS scripts on that machine, replacing
    the manual browser upload step when Kanna is reached over a Cloudflare tunnel. A
    beacon is a Bun-compiled companion daemon the user installs on their own host; it
    dials out to Kanna, authenticates by signing a server challenge, and executes
    scoped, approved requests. Authorization, default-deny scoping, consent, and
    audit are core requirements, not polish, because they are what separates a
    user-authorized companion daemon from a remote-access implant.
status: proposed
date: "2026-10-08"
---

## Goal

Let a user pair one or more machines they own with their Kanna server so the
agent can read files, write files, and run OS scripts on that machine, replacing
the manual browser upload step when Kanna is reached over a Cloudflare tunnel. A
beacon is a Bun-compiled companion daemon the user installs on their own host; it
dials out to Kanna, authenticates by signing a server challenge, and executes
scoped, approved requests. Authorization, default-deny scoping, consent, and
audit are core requirements, not polish, because they are what separates a
user-authorized companion daemon from a remote-access implant.

## Context

When Kanna is reached over a tunnel from a phone or browser, the agent's native
`Bash`/`Read`/`Write` act on the Kanna host, not on the user's laptop, so the
user must manually upload every file. A companion daemon on the laptop closes
that gap. The laptop is behind NAT, so the daemon dials out and opens no inbound
port, making Kanna the rendezvous it already is. The feature sits on seams Kanna
already has: the eight `mcp__kanna__*` shims and their tool-group factory pattern
(`buildBoardToolList`, `buildPluginToolList`), the durable approval protocol
(`toolCallback.submit` via `gatedToolCall`), the `customMcpServers` settings
collection and its generic `CollectionCrud`, and the global `cron-jobs` live
topic. The research also found facts this design must respect rather than
inherit: `settings.json` is `0644` today despite docs claiming `0600`; server
path-deny checks are lexical, not realpath; the durable approval path has no
timeout (`NEVER_EXPIRES`); only `mcp__kanna__bash` gets verb-allowlist logic in
the permission gate; and `/ws` is unauthenticated on an install with no password,
because its cookie check sits inside `if (auth)`.

## Decision

A beacon is a Bun-compiled binary sharing `src/shared` contracts. It is paired
once from an authenticated Settings session via a short-lived single-use code,
generates an Ed25519 keypair whose private half never leaves its host, and
registers only its public key with Kanna. Each reconnect authenticates by signing
a server challenge, so no long-lived bearer exists to exfiltrate and deleting the
entry revokes the key immediately. Beacons connect to a dedicated `/beacon`
endpoint with its own `ws.data` discriminant and signed-challenge auth, not the
cookie-gated client `/ws`, because Bun allows one websocket handler set per server
and the client router assumes `ws.data.subscriptions`. The agent reaches a beacon
through explicit `beacon_*` MCP tools in a new `kanna-mcp-beacon.ts` group
(`beacon_list`, `beacon_read`, `beacon_grep`, `beacon_fetch`, `beacon_exec`,
`beacon_script`, `beacon_stat`/`beacon_glob` in phase one), each gated by the
durable approval protocol with a per-beacon verb allowlist for pre-authorized
commands. Large files are handled three ways the model routes between — a
windowed `beacon_read`, an on-machine `beacon_grep`, and a chunked `beacon_fetch`
into the chat workspace — so a whole multi-gigabyte file is never shipped blindly.
`beacon_script` runs a full PowerShell or shell script in the user's login
session. The authorization model is one-time informed consent, not a prompt per
script: the installer's final step asks once, in plain words naming the
consequence, and agreeing turns on the per-beacon `autoRunScripts` flag so
`beacon_script` and `beacon_exec` then run with no further prompt on that
machine. This is the shape of adding an SSH key or enabling Tailscale — authorize
once, revocable in one click, with the transcript still recording every run.
Two bounds keep it real authorization: a Kanna password is required (auto-run
means anyone who can sign in can run scripts there), and the flag is per beacon.
When the flag is unset the default is to ask, so a beacon paired through the bare
CLI (no consent screen) is safe until the user turns auto-run on; the installer
is what turns it on. Capability scope is default-deny (exec off, empty
read and write roots) and enforced twice: on the Kanna side to fail fast,
mirroring `permission-gate.ts`, and on the beacon side as the final authority over
its own filesystem, using realpath. Paired-beacon entries live in a new
`customBeacons` settings collection through the generic `CollectionCrud` and ride
the existing `settings.writeAppSettingsPatch` RPC; live connection state lives in
an in-memory `BeaconRegistry` pushed over a new global `beacons` WS topic modeled
on `cron-jobs`, so online/offline is never written to `settings.json`. Beacons
work only on an install with a Kanna password set: with `auth` null, pairing
refuses and `/beacon` rejects every connection. The permission gate gains a
beacon branch for scope and the exec allowlist, and a beacon approval gets its
own card naming the target machine. Scope is
configured per beacon only; there is no per-chat or per-project narrowing. The
audit trail is the chat transcript itself: each `beacon_*` call is a tool call
with its durable approval record and result, so no separate activity view or
read-model is built. The wire is a single versioned protocol module in
`src/shared`, with streamed exec output, a heartbeat for last-seen, and a per-OS
shell adapter. The daemon ships as a standalone `bun build --compile` binary per
target, published as GitHub release assets with checksums, so the target machine
needs no Node or Bun. For a non-technical user the binary is wrapped in a
graphical installer (`.pkg`, `.exe`) and a tray/menu-bar app: pairing is a
6-digit code typed into a small window, then the beacon runs in the background on
login with pause and unpair in the tray. Phase 1 installers are unsigned, so the
Settings download screen carries an in-product first-run bypass guide and a
checksum; signing and notarization are Phase 2. Because the binary and the server
release separately, the handshake carries a protocol version and the server
refuses an incompatible one with an upgrade message rather than misreading the
wire.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-226 kanna-mcp-host | component | Gains the beacon\_\* tool group in its own `kanna-mcp-beacon.ts`, registered beside `buildBoardToolList`, gated on a beacon registry plus `chatId`; a main chat always gets it, a subagent only when its config allows the group (default off), via `args.delegationContext.depth`; results via `ok()`/`fail()`; `kanna-mcp.ts` and `tool-callback.ts` currently resolve to no component, so this change binds them | `src/server/kanna-mcp.ts:1017`, `src/server/kanna-mcp-tool.ts:9` | rule-mcp-name-reserved: new tool names are constants in `src/shared/tools.ts`; mcp-inline-tool-results budget stays 0 |
| permission gate | component | New beacon branch: deny outside `readRoots` or with exec off, auto-allow allowlisted exec verbs, ask otherwise; today only mcp\_\_kanna\_\_bash has verb logic | `src/server/permission-gate.ts:186`, `src/server/permission-gate.ts:254` | per-call timeout lives in beacon scope, since the approval path never times out (NEVER\_EXPIRES) |
| c3-202 http-ws-server | component | New `customBeacons` collection through the generic `CollectionCrud`, with normalize and validate in a new `beacon-settings.ts`; new `/beacon` upgrade branch in `http-dispatcher.ts` refused while `auth` is null; `server.ts` websocket handlers dispatch on a `ws.data` kind | `src/server/app-settings.ts:1341`, `src/server/http-dispatcher.ts:83`, `src/server/server.ts:658` | ref-event-sourcing: registry entries persist through the settings collection, never a sidecar; `server.ts` is 3 lines under the module threshold |
| c3-208 ws-router and c3-302 protocol | component | New global `beacons` topic in `SubscriptionTopic` and `ServerSnapshot` beside `cron-jobs`, envelope branch and push on registry change, one typed `beacons.mintPairingCode` command | `src/shared/protocol.ts:64`, `src/server/ws-router-envelope.ts:401` | ref-ws-subscription: snapshot pushed on change, dedupe by signature; ws-router-dispatch-arms stays 0 |
| beacon daemon and adapters | component | New `src/beacon/` entry compiled with `bun build --compile`; socket, crypto, filesystem and shell IO in \*.adapter.ts; a new seal block for src/beacon/\*\*, and `node:net`, `node:tls`, `ws` added to the existing seals | `eslint.config.js:437`, `src/server/push/vapid.adapter.ts:38` | ref-side-effect-adapter: every socket and subprocess call in an adapter |
| c3-116 settings-page | component | New `BeaconsSection.tsx` with pairing, scope editor and live status, a dedicated beacon approval card, and a `beaconsStore` with stable selectors | `src/client/app/McpServersSection.tsx:554`, `src/client/app/SettingsPage.tsx:2168` | rule-zustand-store: stable `EMPTY` selectors; no inline tint pairs |
| release workflow | workflow | A sibling job to `publish` cross-compiles the binaries, builds the installers and tray app, and attaches them with `SHA256SUMS` to the release | `.github/workflows/release-please.yml:55` | the job has its own `contents: write`; a binary failure must not block the npm publish |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Dial-in beacon that listens on the user's machine | Requires an inbound port on a NAT'd laptop — the exact listening-service posture to avoid; dial-out needs no open port and makes Kanna the rendezvous |
| Reuse the client `/ws` endpoint for beacons | `/ws` is cookie-gated, Bun allows one websocket handler set per server, and the client router assumes `ws.data.subscriptions`; a beacon authenticates by key signature and speaks a different protocol, so a dedicated endpoint is cleaner than a discriminant in every shared handler |
| Transparent rerouting of the existing read/write/bash shims onto a bound beacon | "Where did this run" must be explicit before it is implicit; phase one ships explicit beacon\_\* tools and defers rerouting until the model is trusted |
| Long-lived bearer token issued to the beacon | A persisted bearer is an exfiltration target; a per-connection signed challenge leaves nothing on the host but the private key, and revocation is immediate on key deletion |
| Persist online/offline in `settings.json` like the MCP test result | Transient liveness does not belong on disk; an in-memory registry pushed over a topic keeps durable scope and live state in separate stores |
| Go binary for the daemon | A Bun binary shares `src/shared` contracts and the one toolchain, so the protocol cannot silently drift; a Go binary would mirror the contract by hand |
| Ship the daemon as a `kanna beacon` subcommand of the npm CLI | Keeps one artifact and one version, but requires Node or Bun on every target machine; a standalone binary installs on any machine, and the version skew it introduces is handled by a handshake version check |
| Per-chat or per-project scope narrowing | A second owner of scope state plus extra UI, for a need not yet observed; per-beacon scope is the single owner and can be added to later without migrating it |
| Dedicated beacon activity view | The transcript already records every beacon\_\* call, its approval, and its result; a cross-chat view would need its own read-model and is deferred until there is evidence it is needed |
| Command-line-only install | The target user is non-technical; a terminal pair command excludes them. A graphical installer, a typed 6-digit code, and a tray app are the supported path, with the CLI kept underneath for advanced users |
| Embed the pairing secret in the downloaded installer | A one-time secret in a downloaded file rides the browser cache, Downloads, and any sync; a 6-digit code read off one screen and typed into another never lands in a file, and is single-use with a 5-minute expiry |
| Ship a whole file for a large-file read | A beacon serves the user's whole disk; a windowed read, an on-machine grep, and a chunked resumable fetch each answer a different question without moving gigabytes, and the model routes between them |
| Prompt on every script | Nags a user who already decided to trust this machine; the resolution is one informed consent at install, after which auto-run skips the prompt |
| Silently auto-run with no consent at all | Collapses the security boundary to the Kanna password with nothing the user agreed to — the defining behaviour of a remote-access trojan; the installer makes the one-time consent explicit and revocable, and requires a password before pairing |

## Verification

| Check | Result |
| --- | --- |
| `bun run check` (typecheck, lint, build, bundle) | pending — not yet implemented |
| `bun run test` | pending — not yet implemented |
| Side-effect seal extended to `node:net`/`node:tls`/`ws` and all beacon IO in \*.adapter.ts | pending |
| Default-deny scope enforced on both Kanna and beacon, beacon side using realpath | pending |
| `c3x check` after sealing this ADR and adding component facts | pending |
