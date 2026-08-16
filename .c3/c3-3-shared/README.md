---
id: c3-3
c3-version: 4
c3-seal: 5fb30892b2c3b8936b76ba4c9e2e74b7b6c145004b881413892cce771b36b23f
title: Shared
type: container
boundary: library
parent: c3-0
goal: Publish the wire protocol, core domain types, tool-call normalization, port and branding config that both client and server import — a thin seam that keeps the two containers honest.
---

# shared

## Goal

Publish the wire protocol, core domain types, tool-call normalization, port and branding config that both client and server import — a thin seam that keeps the two containers honest.

## Responsibilities

- Define domain types (projects, chats, turns, transcript entries, provider catalog).
- Define the WebSocket protocol envelope shared by client + server.
- Normalize tool-call shapes so Claude and Codex render through one pipeline.
- Publish port helpers and branding constants.
- Provide pure USD token-cost math and model-price resolution used by both server providers and client readouts.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-301 | types | foundation | active | Core domain types shared by client + server |
| c3-302 | protocol | foundation | active | WS envelope definitions |
| c3-303 | tools | foundation | active | Tool-call hydration pipeline |
| c3-304 | ports | foundation | active | Port constants + dev-port helpers |
| c3-305 | branding | foundation | active | Product name + data dir constants |
| c3-306 | share-shared | foundation | active | Share DTOs shared with client |
| c3-307 | token-pricing | foundation | active | Pure USD token-cost math + model-price resolution |
| c3-310 | boards-domain | feature | active | Define the board domain — boards, columns, cards, fields, ranks — and the pure decisions about it that the server and the client must not be able to disagree on. |
| c3-311 | cron-domain | feature | active | Own the pure /cron command domain: grammar parsing with field-level |
