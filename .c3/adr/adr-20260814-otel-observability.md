---
id: adr-20260814-otel-observability
c3-seal: fce5f6e8b231b6320d635e530f634d32d61a3888155772eaf55d54a4de14c915
title: otel-observability
type: adr
goal: 'Give the server memory and turn/subagent-lifecycle observability where none existed. Add `src/server/observability.ts` (a pure, dependency-free facade over `@opentelemetry/api` — `withSpan`, `addCounter`, `recordUpDown`) that domain code instruments unconditionally, and `src/server/otel.adapter.ts` (the ONLY file allowed to import the OTel SDK/exporters or touch memory/process IO) that wires three independently-switched concerns: OTLP trace+metric export (`KANNA_OTEL=enabled`), a periodic memory log line (`KANNA_MEMLOG_MS`), and an on-demand `SIGUSR2` heap snapshot (`KANNA_HEAP_SNAPSHOT`).'
status: proposed
date: "2026-08-14"
---

# otel-observability

## Goal

Give the server memory and turn/subagent-lifecycle observability where none existed. Add `src/server/observability.ts` (a pure, dependency-free facade over `@opentelemetry/api` — `withSpan`, `addCounter`, `recordUpDown`) that domain code instruments unconditionally, and `src/server/otel.adapter.ts` (the ONLY file allowed to import the OTel SDK/exporters or touch memory/process IO) that wires three independently-switched concerns: OTLP trace+metric export (`KANNA_OTEL=enabled`), a periodic memory log line (`KANNA_MEMLOG_MS`), and an on-demand `SIGUSR2` heap snapshot (`KANNA_HEAP_SNAPSHOT`).

## Context

Three pm2 OOM kills (1.06 GB, 1.11 GB, 2.43 GB — the third is one of the two incidents `adr-20260814-armed-loop-wake-recovery` forensically reconstructs) could not be diagnosed after the fact. `grep -rE "generateHeapSnapshot|SIGUSR|heapStats|memoryUsage" src/` against the pre-change tree returns zero results outside the new files this ADR adds — the server had no memory instrumentation of any kind, and no request/turn-level tracing to see what a process was doing in its final minute. The only forensic record for each OOM was `pm2.log` restart timestamps and manual JSONL transcript archaeology (the technique `adr-20260814-armed-loop-wake-recovery`'s Context section had to use by hand).

No existing C3 component owns this concern — `code-map.yaml` has no entry for `observability.ts` or `otel.adapter.ts`, and neither file fits an existing component's Purpose (agent-coordinator drives turns; http-ws-server serves HTTP/WS; none owns cross-cutting process diagnostics). This ADR is honest about that gap rather than forcing the new files under a component that does not fit: it names the container c3-2 (server) as the affected topology for the new files themselves, and separately names each existing component whose files gained instrumentation call sites.

## Decision

`src/server/observability.ts` imports only `@opentelemetry/api`. `withSpan(name, attributes, fn)` runs `fn` inside an active span (parented via the API's own context propagation — AsyncLocalStorage under a registered SDK), records + rethrows a thrown error on the span without altering control flow, and always ends the span in a `finally`. `addCounter`/`recordUpDown` cache their instrument handles by name and delegate to the API's meter. With no SDK registered (the default, and every test run) every one of these resolves to the `@opentelemetry/api` package's own no-op implementations — instrumented code paths cost nothing when disabled and need no test doubles, because there is nothing provider-specific to fake.

`src/server/otel.adapter.ts` is the one file the side-effect lint's `.adapter.ts` exemption covers for this concern, and it is used for exactly that reason (`node:fs`, `Bun.generateHeapSnapshot`, `process.on`/`process.memoryUsage`, and the OTel SDK packages all live here, nowhere else). `initObservability({dataDir})`, called once from `server.ts` boot and never throwing (a broken collector endpoint must not take the server down), gates three independent concerns:

1. **Traces + metrics** (`KANNA_OTEL=enabled`): a `NodeTracerProvider` with `BatchSpanProcessor(OTLPTraceExporter())`, registered globally, plus a `MeterProvider` with `PeriodicExportingMetricReader(OTLPMetricExporter())` (`KANNA_OTEL_METRIC_INTERVAL_MS`, default 15000) and a batch of observable memory gauges. Endpoint via the standard `OTEL_EXPORTER_OTLP_ENDPOINT`; service name via `KANNA_OTEL_SERVICE_NAME` (default `"kanna"`). Off by default because it opens sockets, which the local-first posture this repo already commits to (`ref-local-first-data`) requires be opt-in.
2. **Memory log** (`KANNA_MEMLOG_MS`, default 60000, `0` disables): one `[kanna/mem] rss=… heapUsed=… heapTotal=… external=…` line per interval — the missing correlation record for the next OOM kill.
3. **Heap snapshot on `SIGUSR2`** (`KANNA_HEAP_SNAPSHOT=disabled` opts out): `kill -USR2 <pid>` writes a Chrome-DevTools-loadable v8 `.heapsnapshot` under `<dataDir>/heap-snapshots` via `Bun.generateHeapSnapshot("v8")` — the only way to answer "what is holding the bytes" on a live process rather than after it is already dead.

`initObservability` returns an `ObservabilityHandle` whose `shutdown()` runs every registered teardown (safe to call twice) and is wired into `server.ts`'s existing stop path alongside `scheduleManager.shutdown()` / `tunnelGateway.shutdown()`.

Call sites instrumented so far, all additive (span/counter wrapping around an unchanged inner function, verified by the `*Inner`/`*Outer` extraction pattern in the diff — the wrapped call's behavior and return value are untouched): `kanna.turn.start` span around `startTurnForChat` (claude-turn-starter.ts); `kanna.subagent.run` span around the whole `SubagentOrchestrator.spawnRun` body (split into `spawnRun`/`spawnRunInner`) plus a `kanna.subagent.run.finished` counter keyed by outcome status; `kanna.loop.wake.deliver` span around `deliverSubagentToMain`; counters `kanna.autocontinue.fired`, `kanna.queued_message.recovered`, and `kanna.loop.wake.recovered` (the last introduced by the sibling `adr-20260814-armed-loop-wake-recovery`).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-2 | container | observability.ts and otel.adapter.ts are new cross-cutting files with no owning component in code-map.yaml or any component's stated Purpose; named honestly at the container level rather than forced under an ill-fitting component | c3-2#n8693@v1:sha256:a150ce22160259313c47bc66940b905a9c2196924fd447f802cff12dbb1e9702 | Decide in a future change-unit whether sustained growth of this concern (more spans, more exporters, a dashboard) earns a dedicated component fact, e.g. c3-233 |
| c3-210 | component | claude-turn-starter.ts and subagent-orchestrator.ts (both c3-210-owned files — the latter directly per code-map.yaml, the former per the same precedent adr-20260814-armed-loop-wake-recovery and the predecessor queued-message ADR already establish) gained withSpan/addCounter wrapping around startTurnForChat and SubagentOrchestrator.spawnRun; claude-loop-commands.ts and claude-autocontinue-commands.ts (also c3-210 dispatch modules) gained counter calls in deliverSubagentToMain, recoverArmedLoopWakes, and fireAutoContinue | c3-210#n9234@v1:sha256:a05654b71a70d17325200188f8d400c656f6367e092b22993a40c7406f366287 | Confirm every span/counter wrapper preserves the wrapped function's return value and rethrows on error unchanged — the *Inner/*Outer split pattern used here, not an inline try/catch that could swallow a result |
| c3-202 | component | server.ts (c3-202-owned) calls initObservability right after constructing the EventStore and awaits observability.shutdown() in the existing stop sequence | c3-202#n8788@v1:sha256:4b6bc38cb5853617238dea8fe1682a26ea2f126b27eacbb9a6d3a482fb3dd4b6 | Confirm initObservability never throws (verified: the whole KANNA_OTEL=enabled branch is wrapped in try/catch that logs and continues) and never delays the HTTP/WS listener coming up |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-local-first-data | OTLP export opens outbound sockets, which this repo's local-first posture requires be an explicit opt-in rather than a default; KANNA_OTEL defaults unset (disabled) and the endpoint is the standard OTEL_EXPORTER_OTLP_ENDPOINT env var, never a hardcoded remote host | ref-local-first-data#n10998@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Both new modules ship colocated suites: observability.test.ts (5 cases: pass-through, throw propagation, span handle, no-op safety for both metric helpers) and otel.adapter.test.ts (4 cases: disabled-by-default, idempotent shutdown, a real SIGUSR2 heap-snapshot write, and the opt-out flag) | rule-colocated-bun-test#n11234@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Facade | withSpan, addCounter, recordUpDown — pure, @opentelemetry/api-only, no IO | src/server/observability.ts |
| Adapter | initObservability/ObservabilityHandle; the sole SDK/exporter/IO import site | src/server/otel.adapter.ts |
| Boot wiring | initObservability({dataDir: store.dataDir}) called right after EventStore construction; observability.shutdown() in the stop path | src/server/server.ts |
| Turn-start instrumentation | kanna.turn.start span wrapping the pre-existing startTurnForChat body (renamed startTurnForChatOuter) | src/server/claude-turn-starter.ts |
| Subagent-run instrumentation | kanna.subagent.run span + kanna.subagent.run.finished counter wrapping the pre-existing spawnRun body (renamed spawnRunInner) | src/server/subagent-orchestrator.ts |
| Loop-wake instrumentation | kanna.loop.wake.deliver span wrapping the pre-existing deliverSubagentToMain body (renamed deliverSubagentToMainInner); kanna.loop.wake.recovered counter in recoverArmedLoopWakes | src/server/claude-loop-commands.ts |
| Auto-continue / queue counters | kanna.autocontinue.fired in fireAutoContinue; kanna.queued_message.recovered in recoverQueuedMessages | src/server/claude-autocontinue-commands.ts; src/server/queued-message-recovery.ts |
| Dependencies | @opentelemetry/api 1.9.1, sdk-trace-node 2.10.0, sdk-metrics 2.10.0, exporter-trace-otlp-http 0.221.0, exporter-metrics-otlp-http 0.221.0, resources 2.10.0 | package.json |
| Tests | 5 + 4 new colocated cases | src/server/observability.test.ts; src/server/otel.adapter.test.ts |
| Docs | New CLAUDE.md section "Observability (OTel traces + metrics, memlog, SIGUSR2 heap snapshot)" | CLAUDE.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| observability.test.ts | "returns the wrapped function's value"; "propagates the wrapped function's throw"; "passes the span handle to the wrapped function"; "addCounter is a safe no-op without an SDK"; "recordUpDown is a safe no-op without an SDK" — asserts the no-SDK contract every production request depends on when KANNA_OTEL is off | bun test --conditions production src/server/observability.test.ts |
| otel.adapter.test.ts | "does not register an SDK when KANNA_OTEL is unset"; "shutdown is safe to call twice"; "SIGUSR2 writes a heap snapshot under dataDir/heap-snapshots" (asserts a real file >1000 bytes); "KANNA_HEAP_SNAPSHOT=disabled leaves SIGUSR2 alone" | bun test --conditions production src/server/otel.adapter.test.ts |
| Full suite + typecheck + lint | Whole-repo regression gate before any push, per this repo's CLAUDE.md | bun run test; bun run typecheck; bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| @opentelemetry/sdk-node (NodeSDK) + auto-instrumentations-node | Auto-instrumentation monkey-patches Node built-ins (http, fs, dns, …) whose behavior under Bun's compatibility layer is not guaranteed; the two manual providers (NodeTracerProvider, MeterProvider) this ADR wires are the exact and only two pieces the server needs, with nothing implicit riding along |
| Console/file-based tracing without OpenTelemetry | No trace tree (no span parenting, no cross-process correlation), no ecosystem (no OTLP collector, no existing dashboard tooling); the api-facade pattern this ADR uses already gives no-op-when-disabled for free, which a hand-rolled logger would have to reimplement |
| Always-on OTLP export (no KANNA_OTEL gate) | Opens outbound sockets by default on a tool whose stated default posture is 127.0.0.1-only (ref-local-first-data); an opt-in env var keeps the default behavior identical to before this ADR |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A broken/unreachable OTLP collector endpoint crashes or hangs server boot | The entire KANNA_OTEL=enabled branch is wrapped in try/catch that logs a warning and continues without export; BatchSpanProcessor/PeriodicExportingMetricReader buffer and retry asynchronously rather than blocking the caller | otel.adapter.test.ts: "does not register an SDK when KANNA_OTEL is unset" exercises the disabled path; the enabled path is deliberately NOT exercised in any test (see the file's own comment) because it would open real sockets in CI — accepted residual, see below |
| The KANNA_OTEL=enabled code path itself is untested (no test sets that env var) | Deliberate: a test exercising it would attempt a real OTLP connection in CI. The try/catch wrapper is the only safety net for that path, and it is structurally simple (three SDK constructor calls, no branching) | Manual verification only; flagged here rather than silently uncovered |
| A span/counter call site changes the wrapped function's behavior (e.g. swallows an error, changes a return value) | Every call site uses the *Inner/*Outer (or spawnRun/spawnRunInner) split: the original function body is renamed verbatim and called unmodified inside the wrapper, so the diff itself proves no logic moved | Diff inspection at each of the four call sites; withSpan's own test asserts throw-propagation and value pass-through |
| SIGUSR2 heap-snapshot write blocks the event loop on a large heap | Bun.generateHeapSnapshot is synchronous by the runtime's own API surface; accepted because it fires only on an operator's explicit kill -USR2, never in the request path | otel.adapter.test.ts: "SIGUSR2 writes a heap snapshot" (30s test timeout headroom for a large heap) |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/observability.test.ts | 5 pass, 0 fail |
| bun test --conditions production src/server/otel.adapter.test.ts | 4 pass, 0 fail (SIGUSR2 test writes and stats a real heapsnapshot file) |
| bun run test | 5818 pass, 2 skip, 0 fail across 477 files (two consecutive clean runs; one earlier run had a single unreproduced flake, noted honestly rather than hidden) |
| bun run typecheck | clean |
| bun run lint | clean at --max-warnings=0 |
