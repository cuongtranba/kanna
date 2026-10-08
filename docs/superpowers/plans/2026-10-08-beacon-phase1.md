# Beacon Phase 1 — Implementation Plan

> Design: `docs/superpowers/specs/2026-10-08-beacon-companion-daemon-design.md`.
> ADR: `adr-20261008-beacon-companion-daemon`. Progress: `PROGRESS-beacon.md`.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user with a password-protected Kanna pairs a machine they own, grants
it a default-deny scope, and the agent reads files and runs approved commands on
that machine through explicit `beacon_*` tools — with every call visible in the
transcript and revocable in one click.

**Architecture:** A standalone `kanna-beacon` binary (`src/beacon/`, `bun build
--compile`) dials out to a new `/beacon` websocket on the Kanna server and
authenticates by signing a challenge with an Ed25519 key it generated at pairing.
Kanna keeps paired identities and scope in a `customBeacons` settings collection
and live connection state in an in-memory `BeaconRegistry` pushed over a global
`beacons` topic. `beacon_*` MCP tools forward validated requests through the
durable approval gate, which gains a beacon branch.

**Tech stack:** Bun + TypeScript, `node:crypto` Ed25519, Bun `WebSocket`, the
existing settings collection, ws-router topics, and durable tool callbacks.

## Global constraints

- Base: `origin/main`. One branch and worktree per milestone; PRs target
  `cuongtranba/kanna` (`gh pr create --repo cuongtranba/kanna --base main`).
- Gates before every push: `bun run check`, `bun run test`, `bun run lint:usestate`,
  `bun run check:arch`, `bunx ast-grep test`, `bun run lint:comments`. Never bare
  `bun test` or `tsc`.
- **No pin is raised.** Every `PATTERN_BUDGETS` population is at its pin and
  `server.ts` is 697 of 700 lines; new behaviour goes in new modules (design §9).
- Side-effect seal: IO only in `*.adapter.ts`, in `src/server` and `src/beacon`
  alike. No comments, no `unknown`/`any`/casts, `JsonValue` at JSON boundaries.
- Tests exercise public seams with real or in-memory fakes — no `mock.module`,
  `vi.fn`, or sleeps. Only promises listed under each milestone get a test.
- `.c3/` edits are re-sealed (`c3x repair`, then `c3x check`) and `git status .c3/`
  is reviewed after every c3x write.
- Commit messages must pass `bun run check:commits` (no body line starting `word(`).

## Verify command (end of Phase 1)

```
bun run check && bun run test && bun run lint:usestate && bun run check:arch && bunx ast-grep test
```

---

## M0 — Design PR (this branch, `docs/beacon-design`)

- [x] Design doc and ADR updated with the resolved questions and research.
- [ ] `c3x repair` seals the ADR; `c3x check` reports no errors.
- [ ] Commit, push, open the PR for review. No code.

## M1 — Shared protocol and scope rules (pure)

**Files:** create `src/shared/beacon-protocol.ts`, `src/shared/beacon-scope.ts`,
and their tests.

- [ ] `beacon-protocol.ts`: the versioned envelope (`hello`, `incompatible`,
  `challenge`, `auth`, `ready`, `ping`/`pong`, `request`, `stdout`/`stderr`,
  `exit`, `result`, `error`), `BEACON_PROTOCOL_VERSION`, `MIN_BEACON_PROTOCOL`,
  and a parser from `JsonValue` that rejects any malformed frame.
- [ ] `beacon-scope.ts`: `BeaconScope`, `DEFAULT_BEACON_SCOPE` (grants nothing),
  and `evaluateBeaconRequest(scope, request)` returning `deny | allow | ask`.
  Path containment here is lexical; the beacon re-checks with realpath (M4).
- [ ] Tests: the scope evaluator's verdict table (outside roots, exec off,
  allowlisted verb, unlisted verb, `..` traversal), and the parser refusing an
  unknown `kind` and a frame from an unsupported protocol version.

## M2 — Settings collection and pairing (server)

**Files:** create `src/server/beacon-settings.ts`, `src/server/beacon-pairing.ts`;
edit `src/shared/app-settings-types.ts`, `src/server/app-settings.ts` (wiring
only), `src/server/ws-router-defaults.ts`, `src/client/stores/appSettingsStore.ts`,
`src/shared/protocol.ts`, `src/server/ws-router-settings.ts`.

- [ ] `customBeacons: BeaconConfig[]` state and the
  `update | delete | setEnabled | setScope` patch, through a `BEACON_CRUD`
  modeled on `MCP_CRUD`. No client `create`.
- [ ] Normalize and validate in `beacon-settings.ts`; validation failures throw
  the existing typed validation exception (keeps `settings-bound-throws` at 13).
- [ ] `beacon-pairing.ts`: mint a single-use code (TTL 5 min, held in memory),
  and redeem it with `{code, publicKey, label, os}` into a new settings entry
  with `DEFAULT_BEACON_SCOPE`. Both refuse while `auth` is null.
- [ ] Typed command `beacons.mintPairingCode` registered through the existing
  handler table (no `case` arm), and an HTTP `POST /beacon/pair` route for the
  daemon to redeem the code.
- [ ] Tests: a code redeems once and never again; an expired code is refused;
  pairing is refused with no password; the snapshot never exposes anything but
  the public key.

## M3 — `/beacon` transport and live registry (server)

**Files:** create `src/server/beacon-registry.ts`,
`src/server/beacon-socket.ts` (handshake state machine),
`src/server/beacon-crypto.adapter.ts`; edit `src/server/http-dispatcher.ts`,
`src/server/server.ts` (kind dispatch only), `src/server/ws-router-utils.ts`
(`kind` on `ClientState`), `src/shared/protocol.ts`,
`src/server/ws-router-envelope.ts`, `src/server/ws-router-broadcast.ts`.

- [ ] `/beacon` upgrade branch before `/ws`, rejected while `auth` is null,
  upgrading with `{kind: "beacon"}` data.
- [ ] Handshake: `hello` → version check → `challenge` (32 random bytes) →
  verify the Ed25519 signature against the stored public key → `ready{scope}`.
  A disabled or deleted entry fails verification, so revoke is immediate; a
  scope change or delete closes the live socket.
- [ ] `BeaconRegistry` holds online state, `lastSeenAt`, `rtt`, `beaconVersion`,
  the socket handle, and in-flight request correlation; a missed heartbeat
  marks it offline.
- [ ] Global `beacons` topic beside `cron-jobs`, pushed on registry change.
- [ ] Tests against a real `startKannaServer` and a real `WebSocket` client
  (none exist yet; this adds the first): a correct signature reaches `ready`;
  a wrong key, a revoked entry, and an old protocol version are each refused;
  no connection is accepted on a passwordless install.

## M4 — The daemon (`src/beacon/`)

**Files:** create `src/beacon/main.ts` (CLI: `pair`, `run`), `src/beacon/session.ts`
(handshake + request loop), `src/beacon/key-store.adapter.ts` (0600 key file,
precedent `vapid.adapter.ts:38`), `src/beacon/fs.adapter.ts` (realpath-checked
read/stat/glob), `src/beacon/shell.adapter.ts` (PowerShell on Windows,
`/bin/sh` elsewhere; timeout, output cap, concurrency cap); edit
`eslint.config.js` (seal block for `src/beacon/**`, plus `node:net`, `node:tls`,
`ws` in the existing seals).

- [ ] Reconnect with backoff; print `incompatible` as an upgrade instruction and
  exit instead of retrying.
- [ ] Every request is re-checked against the beacon's copy of scope using
  **realpath**; the beacon is the final authority.
- [ ] Tests: a symlink inside a read root that points outside is refused; exec
  stops at the per-call timeout and the output cap; an end-to-end run against a
  real server (pair → connect → read a file → run an allowlisted command).
- [ ] Verify `node:crypto` Ed25519 under the CI Bun (1.3.11) and inside a
  `bun build --compile` binary — both are unverified today.

## M5 — Agent tools and approval

**Files:** create `src/server/kanna-mcp-beacon.ts`; edit `src/server/kanna-mcp.ts`
(one spread line), `src/server/permission-gate.ts` (beacon branch),
`src/shared/tools.ts` (names + `normalizeToolCall` cases), the
`server.ts → agent-coordinator → claude-session-spawner → claude-session-start`
threading (as `boardRegistry` does), and the client pending card.

- [ ] `beacon_list`, `beacon_read`, `beacon_stat`, `beacon_glob`, `beacon_exec`,
  each naming the beacon id and label in its input and result so the transcript
  is the audit trail.
- [ ] Permission-gate beacon branch built on `evaluateBeaconRequest`.
- [ ] Dedicated approval card showing beacon label, OS, online state, and the
  command or path.
- [ ] Decide and record whether subagent sessions get beacon tools (boards do
  not today); default to main chats only.
- [ ] Tests: through the gate's public `evaluate`, an allowlisted exec
  auto-allows, an unlisted one asks, and an out-of-root read is denied without
  reaching the beacon; an offline beacon returns a clear error.

## M6 — Settings UI

**Files:** create `src/client/app/BeaconsSection.tsx`,
`src/client/stores/beaconsStore.ts`; edit `src/client/app/SettingsPage.tsx`
(nav entry, mount, `:2168` exclusion id only).

- [ ] Pair-a-machine flow: pending state while minting, the code with its
  expiry, the release download link, and the exact `kanna-beacon pair` line;
  a clear message when no password is set.
- [ ] Per-beacon row: online dot plus label (never colour alone), last seen with
  `tabular-nums`, `beaconVersion` with "update available", scope editor, revoke
  with confirmation, all through `runPendingAction`.
- [ ] Gates: `bun run lint:usestate`, `bunx ast-grep test`, and a
  `renderForLoopCheck` test for the section; check it in the browser.

## M7 — Release binaries

**Files:** edit `.github/workflows/release-please.yml`; create
`scripts/build-beacon.ts`.

- [ ] Sibling job to `publish`: `needs: release-please`, the same `if`, its own
  `permissions: contents: write`, tag from `inputs.tag ||
  needs.release-please.outputs.tag_name`.
- [ ] Cross-compile `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`,
  `windows-x64`; write `SHA256SUMS`; upload with `gh release upload`.
- [ ] A workflow test pins the job's trigger and permissions, the way
  `perf-alert-workflow.test.ts` does.

## M8 — Architecture facts and docs

- [ ] Bind the new files in `.c3/eval/*.yaml` and `.c3/code-map.yaml`; give
  `kanna-mcp.ts`, `kanna-mcp-beacon.ts` and `tool-callback.ts` an owner (c3-226);
  set the ADR to `accepted`.
- [ ] Wiki guide: install, pair, grant scope, revoke, clearing macOS quarantine.
- [ ] Correct CLAUDE.md's false `0600` claim about `settings.json`.

## Risks to watch

- `server.ts` has 3 lines of headroom; if the kind dispatch does not fit, move
  the websocket handler object into its own module rather than listing the file.
- A beacon request waiting on approval never times out on the server
  (`NEVER_EXPIRES`); the beacon's per-call timeout starts only on dispatch, so
  the agent's turn can wait on the user indefinitely — same as other approvals.
- Phase 1 binaries are unsigned; macOS Gatekeeper will block them until the
  quarantine attribute is cleared.
