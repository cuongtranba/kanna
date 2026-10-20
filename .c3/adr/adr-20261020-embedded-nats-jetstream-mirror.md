---
id: adr-20261020-embedded-nats-jetstream-mirror
c3-seal: 374f657bb40935cdef8aad64fed7a7d517e58aadc6ab5b46a4266c306c9187f6
title: embedded-nats-jetstream-mirror
type: adr
goal: Record the decision to mirror the in-process service bus into a NATS JetStream stream that Kanna can run itself as a managed nats-server child or reach at a user-run URL, configured from Settings and reconciled with create-or-update, while the JSONL EventStore stays the store of record and Kanna boots and works with NATS absent.
status: done
date: "2026-10-20"
---

## Goal

Record the decision to mirror the in-process service bus into a NATS JetStream stream that Kanna can run itself as a managed nats-server child or reach at a user-run URL, configured from Settings and reconciled with create-or-update, while the JSONL EventStore stays the store of record and Kanna boots and works with NATS absent.

## Context

The service bus (c3-246) gave every durable fact one in-process stream, but nothing outside the process could read it. The user wants one external source of truth for Kanna's events and asked for NATS, embedded in Kanna rather than a server they install. No JavaScript or WebAssembly NATS server exists and the npm wrappers are unusable, so embedding means managing the official Go binary the way the cloudflared dependency and the beacon self-update already manage binaries: a pinned release, a SHA256SUMS check and a supervised child. The user also asked for the JetStream stream limits, identity and subjects, durable consumers and the embedded server's resources to be configurable, applied to an existing stream, not only at creation.

## Decision

Add to c3-246: a JetStream settings model with defaults and validation; settings.serviceBus with a write-only token and a public tokenHint, following the custom-provider credential pattern; an installer adapter that downloads nats-server v2.15.1 for darwin and linux, verifies the archive against SHA256SUMS and extracts the binary into the data dir (Windows reports that external mode is required); a process adapter that writes a 0600 config carrying the token, picks a free loopback port, waits for the ready line, restarts with backoff and stops at shutdown; a mirror with a bounded queue of 2000 envelopes that publishes with Nats-Msg-Id set to the idempotency key and never throws into the publisher; a reconcile that creates or updates the stream and the kanna-managed consumers on every connect and reports, rather than applies, a change the server would refuse; a service-bus status topic; a resetStore command; and a Settings section with stream, consumer and embedded-server groups. createStoreBus moves the in-memory bus and the tap into service-bus-boot.ts so server.ts stays under its line budget. This wins over NATS as the store of record, which would make Kanna require a broker to boot, and over spawning nothing and asking the user to run a server, which the user rejected.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-246 | component | Gains the mirror, the embedded server, the reconcile and the settings surface; its Purpose and Contract grow | c3-246#n15253@v1:sha256:c18c2655212b8743645a636cd29018681c8424658241caf9b6df6ae6388712bf | Every IO path is an adapter; the mirror is pure over an injected connector; the token never reaches argv or a snapshot |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared | jetstream-config.ts settings, defaults, validation, stream and consumer config rendering, nats config rendering; release-sums.ts shared with the beacon updater | src/shared/service-bus/jetstream-config.ts, src/shared/release-sums.ts |
| Settings | serviceBus state with write-only token, getServiceBusCredential, normaliser | src/server/service-bus-settings.ts, src/server/app-settings.ts |
| Server | release pin, installer, process supervisor, mirror queue, mirror, reconcile, link adapter, boot and status topic, resetStore command | src/server/service-bus/ |
| Client | Service bus settings section with stream, consumers and embedded groups | src/client/app/ServiceBusSection.tsx |
| Docs | CLAUDE.md Embedded NATS mirror subsection and the wiki service-bus guide | CLAUDE.md, wiki/src/content/docs/guides/user/service-bus.md |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| NATS as the store of record | Kanna would need a reachable broker to boot and would stop being a single npm install |
| Ask the user to run nats-server themselves | The user asked for the server embedded in Kanna; external mode stays as a fallback |
| Create the stream only when absent | A Settings change would silently not apply to a stream that already exists |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A broker outage slows or fails an EventStore append | publish only pushes to a bounded ring; the drain loop and connect are isolated and never throw into the caller | bun test --conditions production src/server/service-bus/nats-mirror.test.ts |
| A tampered download runs as a child process | The archive hash is checked against the release's SHA256SUMS before extraction | bun test --conditions production src/server/service-bus/nats-server-install.adapter.test.ts |
| A remote MCP client points the mirror at a foreign broker through settings.writeAppSettingsPatch | Recorded as a follow-up to gate serviceBus patches like the webhooks commands | bun test --conditions production src/server/remote-mcp/command-catalog.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck, lint, lint:comments, lint:usestate, ast-grep test, check:arch | clean, no pin changed |
| bun run test | passes |
| KANNA_TEST_NATS_URL integration test against a real nats-server started by the installer | passes |
