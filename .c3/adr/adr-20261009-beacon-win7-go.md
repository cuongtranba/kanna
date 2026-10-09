---
id: adr-20261009-beacon-win7-go
c3-seal: 61d940d95b5c7a8684494ea0d9b94b1eac146c19bb12eba3000244089ac9dc33
title: beacon-win7-go
type: adr
goal: Ship a second beacon implementation, written in Go 1.20 under apps/beacon-win7, so Windows 7 machines can be paired with Kanna. It provides a console CLI with the same commands, messages and exit codes as src/beacon/main.ts, and a native Win32 tray. It speaks beacon protocol 2 unchanged, so the server, the wire contract (c3-302) and the Bun beacon stay exactly as they are.
status: done
date: "2026-10-09"
---

## Goal

Ship a second beacon implementation, written in Go 1.20 under apps/beacon-win7, so Windows 7 machines can be paired with Kanna. It provides a console CLI with the same commands, messages and exit codes as src/beacon/main.ts, and a native Win32 tray. It speaks beacon protocol 2 unchanged, so the server, the wire contract (c3-302) and the Bun beacon stay exactly as they are.

## Context

The Bun beacon and the Electrobun desktop app cannot start on Windows 7: the installer fails at load time with "The procedure entry point NtAlertThreadByThreadId could not be located in the dynamic link library ntdll.dll". Bun requires Windows 10 1809 or later, and the desktop window uses WebView2, whose last Windows 7 release is 109 (January 2023). No build flag or packaging change can fix a load-time import failure. adr-20261008-beacon-companion-daemon rejected a Go daemon because it would mirror the contract by hand, and adr-20261008-beacon-desktop-app kept one implementation. Both decisions still hold everywhere Bun runs; Windows 7 is the one target where the Bun runtime is not an option.

## Decision

Build a Go port pinned to the official Go 1.20.14 toolchain, the last Go release that runs on Windows 7, for both amd64 and 386. Every dependency must declare go 1.20 or lower. The CLI reproduces the Bun CLI byte for byte. The tray uses fyne.io/systray (Shell_NotifyIcon, no web view) and pairs from a kanna-beacon link or the CLI. Hand mirroring, the reason Go was rejected before, is bounded by shared conformance fixtures in apps/beacon-win7/testdata/conformance: frame verdicts, path containment cases and a deterministic Ed25519 signature, asserted by both the Go suite and src/shared/beacon-conformance.test.ts, so a contract change that skips the Go port fails CI. The release publishes four extra assets plus SHA256SUMS-win7 from a separate job that never blocks the npm publish. The Bun beacon remains the primary implementation; the Go port exists only for Windows 7 and 8.1. Accepted risk: Go 1.20 receives no security fixes. It is contained because the beacon only dials out to the user's own Kanna server, and an embedded Mozilla root bundle is used only when the Windows 7 store does not know a server's root.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - named only to complete the top-down descent; the system is unchanged | N.A - ancestor only | N.A - ancestor only |
| c3-2 | container | N.A - named only to complete the top-down descent; the server container is unchanged | N.A - ancestor only | N.A - ancestor only |
| c3-241 | component | Gains a second runtime: a Go 1.20 build for Windows 7 beside the Bun-compiled binary | c3-241#n13007@v1:sha256:dd9098110d7c68fa0498c29a8f1f9592b056e8d841186bd6936cd8e6a45c2d04 | ref-side-effect-adapter: the Go port keeps IO in its own packages behind interfaces the session sees |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-side-effect-adapter | c3-241 keeps every socket, filesystem and subprocess call out of the session loop; the Go port must keep the same seam even though no ESLint rule reaches Go code | ref-side-effect-adapter#n13807@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee | comply: session and runner depend only on interfaces, and the fs, shell, transport, keystore and state packages own the IO |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Rust on the x86_64-win7-windows-msvc target | It is a tier-3 target that needs a pinned nightly and build-std in the release job; the user chose Go |
| C# on .NET Framework 4.8 | TLS goes through the Windows 7 system stack, which manages TLS 1.2 only after updates, so a stock machine may not connect |
| Keep Windows 7 unsupported | The user has Windows 7 machines that must be paired |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The Go port drifts from protocol changes | Shared conformance fixtures read by both suites, and a CLAUDE.md rule that a protocol change updates the Go port in the same PR | bun run test src/shared/beacon-conformance.test.ts and go test ./... in the beacon-win7 CI job |
| A dependency or toolchain bump silently drops Windows 7 | Go pinned to 1.20.14 in CI and release; a PE import check fails on any DLL outside the allowlist | beacon-win7 job in .github/workflows/test.yml |
| An unpatched Go 1.20 network stack | Outbound connections only to the configured Kanna server; full chain and hostname verification on both root sets | Module README and the wiki Windows 7 section state the trade-off |

## Verification

| Check | Result |
| --- | --- |
| go vet ./... and go test ./... in apps/beacon-win7 with Go 1.20.14 | pass |
| GOOS=windows GOARCH=amd64 and 386 builds of both commands, with the PE import check | pass |
| bun run test src/shared/beacon-conformance.test.ts scripts/release-please-workflow.test.ts | pass |
| A Windows 7 machine pairs from the tray and serves a read and a PowerShell script | run by the user after release; macOS smoke of the Go CLI against a real server passed |
