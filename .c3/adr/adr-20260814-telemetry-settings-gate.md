---
id: adr-20260814-telemetry-settings-gate
c3-seal: c323166b71ca17db81380efbe8765806a74411fac38660d46d10b7e36291253f
title: telemetry-settings-gate
type: adr
goal: 'Make Kanna''s OTel trace + metric export a user-controlled product feature instead of an operator env flag: gate it on a persisted `telemetry: {enabled, endpoint}` settings group (default ON, endpoint `https://kanna-otel.lowbit.link` — the grafana/otel-lgtm compose on the lowbit Dokploy), name each install''s `service.name` after the machine''s computer name (`kanna-<sanitized getMachineDisplayName()>`) so distinct Kanna distributions stay distinguishable at one shared collector, and apply the Settings toggle at runtime without a server restart.'
status: proposed
date: "2026-08-14"
---

# telemetry-settings-gate

## Goal

Make Kanna's OTel trace + metric export a user-controlled product feature instead of an operator env flag: gate it on a persisted `telemetry: {enabled, endpoint}` settings group (default ON, endpoint `https://kanna-otel.lowbit.link` — the grafana/otel-lgtm compose on the lowbit Dokploy), name each install's `service.name` after the machine's computer name (`kanna-<sanitized getMachineDisplayName()>`) so distinct Kanna distributions stay distinguishable at one shared collector, and apply the Settings toggle at runtime without a server restart.

## Context

`adr-20260814-otel-observability` added the facade (`src/server/observability.ts`) and the one SDK-importing adapter (`src/server/otel.adapter.ts`), gated exclusively on `KANNA_OTEL=enabled` with `service.name` defaulting to the constant `"kanna"`. Kanna installs now run on multiple machines reporting to one collector: a constant service name collapses them into one indistinguishable stream, and an env-only gate means a user cannot opt out (or in) from the product UI. `initObservability` also ran before `AppSettingsManager` initialized in `server.ts` boot, so no persisted setting could reach it. Constraint: the side-effect seal — `process.env` and the OTel SDK stay confined to `otel.adapter.ts`; any new decision logic must be pure and injectable.

## Decision

A pure resolver `src/server/otel-config.ts` (`resolveOtelConfig({env, telemetry, machineName})`) owns the whole precedence: `KANNA_OTEL=disabled` hard-disables; `KANNA_OTEL=enabled` enables even when the setting is off; otherwise `telemetry.enabled` decides. `OTEL_EXPORTER_OTLP_ENDPOINT` beats the settings endpoint (resolver returns undefined URLs so the exporters read the env themselves); `KANNA_OTEL_SERVICE_NAME` beats the machine-derived name. The machine display name is sanitized (`sanitizeServiceNamePart`) into `kanna-<part>` and the raw name rides the `host.name` resource attribute. The settings group lives in `AppSettingsSnapshot.telemetry` (normalized in `app-settings.ts`, defaults in `TELEMETRY_DEFAULTS`, patched through all three `mergeAppSettingsPatch` copies), with a "Telemetry Tracing" SegmentedControl row on the Settings page. `server.ts` initializes observability right after `appSettings.initialize()` and subscribes `appSettings.onChange` to the new `ObservabilityHandle.applyTelemetrySettings(telemetry)`, which re-resolves, serializes provider stop/start transitions on an internal promise chain, and calls the facade's new `resetMetricInstrumentCache()` on every transition so cached counters never record into a shut-down meter provider.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-2 | container | otel.adapter.ts gains config resolution via the new pure otel-config.ts; boot order in server.ts moves observability init after settings load and wires the runtime toggle | c3-2#n8817@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models." | Side-effect seal: env reads stay in the adapter; otel-config.ts is pure and takes env as a parameter |
| c3-202 | component | app-settings.ts normalizes the new telemetry group; server.ts (this component's file) reorders boot so settings precede observability init; ws-router-defaults.ts merge + initial snapshot carry the group | c3-202#n8913@v1:sha256:2e868029505a294cb79ac3750f443e489fdca9fb37d30d865fbfc0e47ac582e0 "Serve HTTP (static + API) and upgrade to WebSocket; attach auth gating; expose /health." | Settings-group conventions: normalize-with-warnings, defaults exported from app-settings-types.ts, patch spread in every merge copy |
| c3-102 | component | appSettingsStore.ts client merge copy gains the telemetry spread; the Settings page row writes through handleWriteAppSettings({telemetry}) | c3-102#n8116@v1:sha256:d67b854a4ec698edc79613ae615dc5d2002600efd31b355af5ab989c3d41fcbe "Hold UI-local state (chat input, terminal layout, sidebar, preferences) in small Zustand stores, persisting only what must survive reload." | Client merge copy must stay in sync with the two server copies (documented drift hazard) |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/otel-config.test.ts — resolver precedence (env override both directions, machine-name derivation, endpoint expansion) | 14 pass, 0 fail |
| bun test --conditions production src/server/app-settings.test.ts — telemetry group defaults, endpoint validation warning, writePatch round-trip | 119 pass across settings+otel suites, 0 fail |
| bun run lint && bunx ast-grep test && bun run test on the branch | lint clean, 14 rule tests pass, 5836 tests pass / 0 fail |
| Runtime smoke: toggle Settings → Telemetry Tracing off → [kanna/otel] tracing + metrics disabled via settings in server log; on → [kanna/otel] tracing + metrics enabled with serviceName: kanna-<machine>; spans visible in Grafana Tempo at kanna-grafana.lowbit.link | manual, pending first deployed install |
