# Kanna beacon for Windows 7 (Go 1.20)

A port of the Bun beacon (`src/beacon/**`) for Windows 7 and 8.1, where Bun
(Windows 10 1809+) and WebView2 cannot run. It speaks protocol 3 exactly as the
Bun beacon does. The Bun beacon stays the primary
implementation: this module follows it, never the other way round.

## Toolchain

Go **1.20.14**, the last Go whose runtime supports Windows 7. `go.mod` says
`go 1.20` with no `toolchain` line, and every dependency must itself declare
`go 1.20` or older; Go 1.20 does not enforce that, so CI checks it with
`go list -m -f '{{.Path}} {{.GoVersion}}' all`. In particular
`golang.org/x/sys` must stay at or below a version whose `go.mod` says
`go 1.18` (v0.30.0 or lower); it is pinned at v0.15.0 because `fyne.io/systray`
v1.12.2 requires that.

Install the toolchain beside your system Go and use it explicitly:

```sh
go install golang.org/dl/go1.20.14@latest && go1.20.14 download
export GOTOOLCHAIN=local
```

## Build and test

```sh
cd apps/beacon-win7
go1.20.14 vet ./...
go1.20.14 test ./...

# Windows binaries (both architectures, both commands)
for arch in amd64 386; do
  GOOS=windows GOARCH=$arch CGO_ENABLED=0 go1.20.14 build -trimpath -o bin/kanna-beacon-$arch.exe ./cmd/kanna-beacon
  GOOS=windows GOARCH=$arch CGO_ENABLED=0 go1.20.14 build -trimpath -ldflags -H=windowsgui -o bin/kanna-beacon-tray-$arch.exe ./cmd/kanna-beacon-tray
done
go1.20.14 run ./cmd/peimports -allow kernel32.dll bin/*.exe
```

The release stamps the version with
`-ldflags "-X github.com/cuongtranba/kanna/apps/beacon-win7/internal/version.Version=<package.json version>"`;
an unstamped build reports `0.0.0-dev`, which Kanna shows as out of date.

The module builds and tests on macOS and Linux too. Only `internal/winsys`,
the Windows realpath and process flags, and the tray's `main` are
Windows-specific; each has a non-Windows counterpart. A darwin build of
`cmd/kanna-beacon` pairs with and serves a real Kanna, which is the quickest
end-to-end check.

`cmd/peimports` reads a PE file's static import table. A Go 1.20 binary
imports only `kernel32.dll` and loads every other API lazily, so a second DLL
in that table is a load-time dependency that may not exist on Windows 7.

## Layout

| Package | Mirrors |
| --- | --- |
| `internal/protocol` | `src/shared/beacon-protocol.ts`, `isPathInsideRoots` from `src/shared/beacon-scope.ts` |
| `internal/keystore` | `src/beacon/key-store.adapter.ts` |
| `internal/state` | `src/beacon/state-store.adapter.ts` and the home rule in `entry.adapter.ts` |
| `internal/pairing` | `src/beacon/pair-client.adapter.ts`, `src/shared/beacon-pair-link.ts` |
| `internal/fsops` | `src/beacon/fs.adapter.ts` |
| `internal/transfer` | `src/beacon/transfer.adapter.ts` |
| `internal/shell` | `src/beacon/shell.adapter.ts` |
| `internal/session` | `src/beacon/session.ts` |
| `internal/transport` | `src/beacon/transport.adapter.ts`, plus TLS roots |
| `internal/runner` | `src/beacon/runner.ts` (no pause) |
| `internal/cli` | `src/beacon/main.ts` |
| `internal/tray` | status words and link handling for the tray |
| `internal/winsys` | the Windows half of `src/beacon/desktop/desktop-os.ts` |
| `internal/utf8lossy` | Node's `Buffer#toString("utf8")` replacement rules |
| `cmd/kanna-beacon` | `src/beacon/entry.adapter.ts` |
| `cmd/kanna-beacon-tray` | the tray half of the Electrobun app |
| `cmd/peimports` | CI check of the PE import table |

## File transfer (`upload` and `download`)

Protocol 3 adds two request ops that copy one file between this machine and
Kanna (`docs/superpowers/specs/2026-10-09-beacon-file-transfer-design.md`). The
bytes travel over HTTP to the paired Kanna URL, authorized by the request's
one-file `ticket` as a bearer token; the WebSocket carries only the request and
the `{path, bytes, sha256}` result.

- `upload` (Kanna's `beacon_pull`) reads a file inside `readRoots`, hashes it,
  asks Kanna where to resume, `PUT`s 8 MiB chunks, then `POST`s the size and
  sha256 for Kanna to verify.
- `download` (Kanna's `beacon_push`) writes inside `writeRoots`. It fetches
  `Range` chunks into `<path>.kanna-part`, checks size and sha256 against the
  request, and only then renames the part over the destination. `overwrite:
  false` refuses an existing file; any failure deletes the part.

Transfers run through the normal request queue, so they count toward
`maxConcurrent`, but they ignore `perCallTimeoutMs` and `outputByteCap`: each
chunk request has its own 10 minute deadline and a chunk is retried up to five
times with a 1 s to 16 s backoff. A dropped connection cancels the transfer.
Memory use is a fixed 256 KiB copy buffer regardless of file size.

A beacon refuses to write outside `writeRoots` (empty by default), and
`set-scope` cannot change `writeRoots`, so a beacon cannot grant itself write
access. On Windows the destination must not be open in
another program (Excel locks a workbook it has open): the rename then fails and
the transfer reports that.

## Conformance fixtures

`testdata/conformance/` is read by this module's tests **and** by
`src/shared/beacon-conformance.test.ts`:

- `frames.json` — frames with the verdict `parseBeaconFrame` gives them, and
  for valid ones the parsed result (unknown keys dropped,
  `trustedScriptHashes` defaulted).
- `paths.json` — `isPathInsideRoots` cases.
- `signature.json` — a synthetic Ed25519 key (seed `00..1f`), a nonce, and the
  SPKI and signature both implementations must produce. The server's
  `verifyBeaconSignature` must accept it.

A change to `src/shared/beacon-protocol.ts` or `beacon-scope.ts` updates these
fixtures and this port in the same pull request.

## TLS

`internal/transport/cacert.pem` is curl's extract of the Mozilla CA store,
"Certificate data from Mozilla as of: Fri Sep 25 03:12:01 2026 GMT", fetched
from https://curl.se/ca/cacert.pem on 2026-10-09. A server chain is verified
against the Windows store first; when Windows rejects it (an un-updated
Windows 7 lacks ISRG Root X1, or chains to the expired DST Root CA X3), it is
verified again against this bundle. Both passes check the full chain, validity
dates and host name. Refresh the file by downloading it again and updating the
date above.

## The tray

The tray takes the place of the Electrobun window on Windows 7:

- A status line, **Start at login** (`HKCU\...\CurrentVersion\Run`, value
  `Kanna Beacon (Windows 7)`), **Open beacon folder**, **Unpair this machine**
  (sends `unpair`, waits up to 5 s for Kanna, then erases the key and state),
  and **Quit**.
- On start it registers `HKCU\Software\Classes\kanna-beacon` to run itself with
  the link, unless another program (the Electrobun app) already owns the
  scheme, which it leaves alone.
- Launched with a `kanna-beacon://pair?...` argument it pairs, then, if a tray
  is already running (named mutex `Local\KannaBeaconWin7Tray`), signals it to
  reload through the named event `Local\KannaBeaconWin7TrayReload` and exits;
  otherwise it becomes the tray. There is no pairing window.
- **Pair from copied text...** reads the clipboard and pairs from anything
  `pairing.FindInText` recognises in it: a `kanna-beacon://pair` link, a
  `kanna-beacon pair <url> <code>` command, or one Kanna address next to one
  code, with words around them. It exists for the case where one person runs
  Kanna and sends the pairing command to the person at the Windows 7 computer,
  where a custom-scheme link in a chat app is usually not clickable. A
  loopback address is refused, because it names the sender's computer.

## Where it differs from the Bun beacon

- **Pairing code.** `kanna-beacon pair` normalises the code (whitespace and `-`
  removed, upper-cased) before sending it; the Bun CLI sends it verbatim.
- **No-argument hint.** Run with no arguments, the CLI points at the Windows 7
  tray exe rather than the Electrobun app, which cannot start on Windows 7.
- **Command lookup.** `exec` resolves a bare command name with Go's
  `exec.LookPath`, which on Windows honours `PATHEXT` (`.com`, `.exe`, `.bat`,
  `.cmd`, …); Bun's spawn finds only `.com` and `.exe`. Go also refuses to run a
  program found through a relative `PATH` entry such as `.`.
- **Error text** that comes from the platform rather than the beacon differs:
  a spawn failure reads `exec: "x": executable file not found in %PATH%`, a
  network failure while pairing carries Go's wording, an invalid grep pattern
  carries regexp2's, and other filesystem errors use Go's `open <path>: ...`
  form instead of Node's `ENOENT: ..., open '<path>'`. The messages the beacon
  writes itself (`path is outside the permitted read roots: ...`,
  `no such file or directory: ...`, `exec not permitted`, the CLI's lines) are
  identical.
- **Regular expressions** are ECMAScript syntax through `regexp2`, matched over
  Unicode code points; JavaScript without the `u` flag matches UTF-16 code
  units, so `.` against an astral character can differ.
- **Grep line text** is cut at 400 UTF-16 code units like the Bun beacon, but a
  surrogate pair straddling the cut is dropped whole rather than split.
- **Directory order** in `glob` and `grep` results is sorted by name; the Bun
  beacon reports the operating system's order.
- **URL validation** in pairing links uses Go's `net/url`, which rejects some
  unusual spellings the WHATWG parser repairs (`http:host` without slashes).
- **Dead links.** The transport closes a connection that has received nothing
  for 60 s; the server pings every 15 s, so this only replaces a link that died
  without a close.
- **No pause** in the runner or tray, and no activity record.
