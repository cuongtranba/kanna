# Beacon file transfer — design

Status: approved for implementation (2026-10-09). Branch `feat/beacon-file-transfer`.

## Problem

Moving a file between Kanna and a paired beacon machine had no supported path.
`beacon_fetch` returns 256 KiB of base64 per call straight into the model's
context (a 56.8 MB workbook = ~228 calls), and nothing writes a file onto the
beacon. In chat `da6b9ca1` the agent improvised: it read the Kanna login password
out of the server's process argv, logged in, and planted the full-access session
cookie in scripts on the remote machine to use the cookie-gated tus and file
routes. That cost ~25 minutes and is a credential leak.

## Goal

Two MCP tools that copy one file between the chat's project and a beacon,
**streamed end to end**, **never through the model's context**, **never through
the beacon WebSocket**, **not bounded by `perCallTimeoutMs`**, authorized by a
**one-file, short-lived ticket** instead of the session cookie.

Non-goals: directories, sync, `beacon_fetch` changes, a progress UI.

## Vocabulary

Tool names are from Kanna's side; wire ops are from the beacon's side.

| Tool | Wire op | Bytes flow | Beacon-side scope |
| --- | --- | --- | --- |
| `beacon_pull` | `upload` | beacon → Kanna | `readRoots` (it reads) |
| `beacon_push` | `download` | Kanna → beacon | `writeRoots` (it writes) |

## Hard invariants (reviewers check these)

1. **Streaming.** No code path holds a whole file in memory, on either side.
   Banned on file content: `readFile`, `Bun.file().bytes()/arrayBuffer()/text()`,
   `Response.arrayBuffer()`, `io.ReadAll`, `os.ReadFile`, `persistProjectUpload`.
   Memory per transfer is bounded by a fixed buffer, independent of file size.
2. **Never through the model.** Tool results carry only path, bytes, sha256.
3. **Never through the WebSocket.** The WS carries only the request and result
   frames; bytes go over HTTP.
4. **Not bounded by `perCallTimeoutMs` or `outputByteCap`.** Transfers are bounded
   by an idle timeout (no bytes moved for `TRANSFER_IDLE_TIMEOUT_MS`), not by a
   total duration. The fixed 600 s `BEACON_REQUEST_TIMEOUT_MS` does not apply.
5. **Atomic replace.** The destination is written to a sibling part file and
   renamed into place only after size and sha256 verify. A failed or cancelled
   transfer never leaves a truncated destination, and deletes its part file.
6. **No self-widening.** `writeRoots` stays outside `set-scope` (unchanged):
   a beacon cannot grant itself write access.

## Constants (`src/shared/beacon-transfer.ts`, mirrored in Go)

| Name | Value |
| --- | --- |
| `TRANSFER_PROTOCOL` | `3` (also the new `BEACON_PROTOCOL_VERSION`; `MIN_BEACON_PROTOCOL` stays 1) |
| `TRANSFER_CHUNK_BYTES` | 8 MiB — one HTTP request per chunk (stays under Bun's 128 MiB body cap and Cloudflare's 100 MB request cap) |
| `TRANSFER_MAX_CHUNK_BYTES` | 16 MiB — server rejects a larger PUT with 413 |
| `TRANSFER_IDLE_TIMEOUT_MS` | 120 000 |
| `TRANSFER_CHUNK_ATTEMPTS` | 5 (per chunk, exponential backoff 1 s → 16 s) |
| `TRANSFER_PART_SUFFIX` | `.kanna-part` |

Chunk size must be injectable in both beacon implementations and the server
handler so tests can use a few KiB.

## Wire protocol (version 3)

`BEACON_PROTOCOL_VERSION` → 3 in TS and Go. New request ops:

```json
{ "op": "upload",   "path": "F:\\a\\b.xlsx", "ticket": "<token>" }
{ "op": "download", "path": "F:\\a\\b.xlsx", "ticket": "<token>",
  "size": 3298596, "sha256": "<64 lowercase hex>", "overwrite": false }
```

Result frame `result` for both: `{ "path": "<beacon realpath>", "bytes": n, "sha256": "<hex>" }`.
Failures use the existing `error` frame.

Parsers reject a missing/empty `ticket`, a non-integer or negative `size`, a
`sha256` that is not 64 lowercase hex, and a non-boolean `overwrite`.
Add valid and invalid fixtures for both ops to
`apps/beacon-win7/testdata/conformance/frames.json` (shared by both suites).

**Version gate.** `beacon-registry.ts` `dispatch` fails `upload`/`download`
immediately for a beacon whose recorded `protocolVersion < TRANSFER_PROTOCOL`,
with a message telling the user to update the beacon. (Without the gate an old
beacon silently drops the unknown op and the call hangs.)

## HTTP endpoint (beacon → Kanna)

Base URL = the beacon's stored `kannaUrl` (http/https; the same value the WS URL
is derived from). Every request carries `Authorization: Bearer <ticket>` and
`User-Agent: kanna-beacon/<version>`. No cookie, no origin check. Routed in
`http-dispatcher.ts` beside `/beacon/pair`, after the auth block, with the same
`!auth → 403` rule (beacons require a password).

| Method + path | Direction | Behaviour |
| --- | --- | --- |
| `GET /beacon/transfer` (no `Range`) | upload | `200 {"direction":"upload","received":n}` — resume point |
| `PUT /beacon/transfer?offset=n` | upload | Body ≤ `TRANSFER_MAX_CHUNK_BYTES`, `Content-Length` required. `offset ≠ received` → `409 {"received":n}`. Streams the body into the part file at `offset`, piece by piece; on a body error truncates the part back to `offset`. `200 {"received":n}` |
| `POST /beacon/transfer/complete` | upload | Body `{"bytes":n,"sha256":"…"}`. Server stream-hashes its part file; both must match or `422` (ticket fails). Then renames the part onto the destination. `200 {"path":"<workspace-relative>","bytes":n,"sha256":"…"}` |
| `GET /beacon/transfer` + `Range: bytes=a-b` | download | `206` streamed from the Kanna file (reuse `buildFileResponse` / `http-file-response.ts`) |

Any request with an unknown, expired, revoked, completed or wrong-direction
ticket → `401`. The beacon treats 401/403/404/410/413/422 as fatal (no retry),
409 as "resume from `received`", and 5xx / network errors as retryable.

Every byte read from a PUT body and every byte written into a download response
**touches** the ticket's `lastActivityAt` (wrap the response stream in a counting
stream), so a slow link that is still moving bytes never idles out.

## Ticket store (server)

Pure, in-memory module, clock and token source injected (precedent:
`beacon-pairing.ts`). Token = 32 random bytes, base64url. A ticket is bound to
`{beaconId, chatId, direction, kannaPath (absolute, resolved), workspacePath,
beaconPath, size?, sha256?, overwrite}` and has state `active | completed |
failed`. `mint`, `lookup(token, direction)`, `touch`, `complete`, `fail`,
`revoke`, and an idle sweep. A ticket is revoked when the transfer settles, the
tool call is cancelled, the beacon disconnects, or it idles past
`TRANSFER_IDLE_TIMEOUT_MS`. HTTP IO (streaming the body to disk, hashing,
rename) lives in a `*.adapter.ts`; the store is pure.

## MCP tools (`kanna-mcp-beacon.ts`)

Registered only when the chat has a project root (add `projectRoot` to
`BeaconToolContext`, passed from `kanna-mcp.ts` where `localPath` is known).
Both go through the existing consent path (`authorize` → `toolCallback.submit`)
and must be added to `BEACON_TOOL_OPS` (`beacon_pull → upload`,
`beacon_push → download`); otherwise the permission gate falls through to the
chat default.

- `beacon_pull({ beaconId, path, dest?, overwrite? })` — copy beacon file `path`
  into the project. `dest` is workspace-relative; default
  `.kanna/uploads/<basename>`, made unique (`name (1).ext`) when taken. An
  explicit `dest` that exists without `overwrite: true` is refused before
  dispatch. Containment: realpath of the nearest existing ancestor must be
  inside the project root. Size limit: `uploads.maxFileSizeMb`.
- `beacon_push({ beaconId, source, path, overwrite? })` — copy project file
  `source` (workspace-relative, realpath-contained, regular file) to absolute
  beacon `path`. The server stream-hashes `source` before dispatch and sends
  `size` + `sha256` so the beacon verifies before it renames.

Wait semantics: the tool awaits the beacon's `result` with no fixed deadline. It
fails when the ticket idles out, the beacon disconnects (registry already fails
pending on disconnect), or the call is cancelled — each of which also revokes
the ticket, so the beacon's next HTTP request gets 401 and it aborts.

Result text (via `ok()`/`fail()`): e.g.
`Pulled F:\…\DLBC-Khoa-HÓA SINH-09.xlsx from TCKTPHUONG4032 into .kanna/uploads/DLBC-Khoa-HÓA SINH-09.xlsx — 59,563,520 bytes, sha256 ab12… (verified on both sides).`

Tool descriptions must tell the model: use these for any file larger than a few
KB or any binary; never move files with `beacon_script` + credentials; push
needs a write folder configured on the beacon.

## Scope (`beacon-scope.ts`)

- `upload` → same as a read of `path` (deny outside `readRoots`; `allow` when
  `autoRunScripts`, else `ask`).
- `download` → new write rule: deny unless `path` is inside `writeRoots`;
  `allow` when `autoRunScripts`, else `ask`.

## Beacon behaviour (TS daemon `src/beacon/**` and Go `apps/beacon-win7/**`)

Same behaviour in both. New transfer port (TS: `BeaconTransferPort` in
`ports.ts`, implementation `src/beacon/transfer.adapter.ts`, injected in
`runner.ts` with `kannaUrl` and live `readRoots`/`writeRoots` getters; Go: new
package `internal/transfer`, wired from `session` with the state's `KannaURL`).
Transfers run through the existing request queue (they count toward
`maxConcurrent`) but do **not** use `perCallTimeoutMs` or `outputByteCap`.

**upload:** realpath-contain `path` in `readRoots` (existing containment); must be
a regular file. Stream-hash it (sha256, fixed buffer). `GET` the resume point.
For each chunk from `received`: `PUT ?offset=` with a section/slice of the file as
the streaming body (Go `io.NewSectionReader` with explicit `ContentLength`; Bun
`Bun.file(p).slice(a, b)` or a ranged read stream). Retry per the table. Then
`POST complete` with `{bytes, sha256}`. Return the result.

**download:** write-containment: realpath of the nearest existing ancestor of
`path` must be inside `writeRoots`; `path` must not be a directory. If `path`
exists and `overwrite` is false → error. Create/truncate `path + .kanna-part`.
For each chunk: `GET` with `Range`, stream the body into the part at the offset
(`io.Copy` / stream piping, fixed buffer); on a retry truncate back to the chunk
start. After the last chunk: verify size, stream-hash the part, compare with the
request's `sha256`. Mismatch → delete part, error. Match → rename part onto
`path` (replacing when `overwrite`). Any failure deletes the part.

HTTP client: per-request timeout (10 min) via context/AbortSignal, **no
whole-transfer timeout**. Go: do NOT reuse `transport.HTTPClient` (its 60 s
`Timeout` covers the body); build a client from `transport.TLSConfig(serverName)`
+ `http.ProxyFromEnvironment`, no `Timeout`. Go 1.20, stdlib only, Windows 7.

## Settings UI

`BeaconsSection.tsx`: add a `ScopeList` "Folders the agent may write to" bound to
`writeRoots`, under the read-folders list, with copy explaining it is what
`beacon_push` may write into.

## Tests (promises, not lines)

- Server, real `startKannaServer({port:0})` + `fetch`: a chunked upload that
  resumes after a 409; complete with a wrong sha256 → 422 and no destination
  file; a revoked ticket → 401; a ranged download streams the right bytes.
- End to end, real server + real TS `transfer.adapter.ts` + real files, small
  injected chunk size: pull and push a multi-chunk file, sha256 verified;
  push with `overwrite:false` onto an existing file is refused and leaves it
  untouched.
- Scope: verdicts for `upload`/`download` (inside/outside roots, autoRun).
- Registry: transfer op to a protocol-2 beacon fails immediately.
- Conformance fixtures for the two ops (both suites).
- Go `internal/transfer` against `httptest`: resume on 409, 401 aborts and
  deletes the part, sha256 mismatch leaves no destination, overwrite refusal.

## Docs

`wiki/src/content/docs/guides/user/beacons.md` (write folders + moving files),
`c3-241` contract table, an ADR `adr-20261009-beacon-file-transfer` (via
`c3x add adr`), eval bindings for new files, `PROGRESS-beacon.md`, and a short
CLAUDE.md section.
