---
id: c3-0
c3-version: 4
c3-seal: b5e913fe120829f2ba2c77e05e71abfbe5a23eed841b79c03e6c8b3025330589
title: Kanna
goal: ${GOAL}
summary: Bun+React web app that drives Claude Agent SDK and Codex App Server over WebSocket, persisting all state as append-only JSONL and rendering live transcripts with hydrated tool calls.
---

# ${PROJECT}

## Goal

${GOAL}

## Abstract Constraints

| Constraint | Rationale | Affected Containers |
| --- | --- | --- |
| Event sourcing for all state mutations | Replayable history, crash-safe, debuggable audit trail | c3-2 |
| CQRS: write path (events) decoupled from read path (derived models) | UI subscribes to fast snapshots without touching the log | c3-1, c3-2 |
| Reactive WebSocket broadcasting of snapshots on every state change | Multiple tabs and agents stay consistent in real time | c3-1, c3-2 |
| Local-first: all user data under ~/.kanna/data, default bind is localhost | Zero server infra, user owns their data, safe by default | c3-2 |
| Provider-agnostic agent coordination (Claude Agent SDK + Codex App Server) | Per-turn provider/model/effort picks without forking transcript model | c3-1, c3-2 |
| Strong TypeScript typing — no any/untyped shapes at boundaries | Shared types guarantee client+server agree on protocol + events | c3-1, c3-2, c3-3 |

## Containers

| ID | Name | Boundary | Status | Responsibilities | Goal Contribution |
| --- | --- | --- | --- | --- | --- |
| c3-1 | Client | app | implemented | Render transcript, accept chat input, manage sidebar + settings, subscribe to WebSocket pushes | Provides the browser UX that makes Claude/Codex usable through a beautiful chat view |
| c3-2 | Server | service | implemented | Host HTTP+WS on localhost, drive agents, persist events, derive read models | Single-binary local backend that coordinates providers and owns all state |
| c3-3 | Shared | library | implemented | Define protocol, types, tool normalization, ports, branding shared by client and server | Guarantees client + server agree on wire format and domain types |
