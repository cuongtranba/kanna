---
id: c3-3
c3-version: 4
c3-seal: 5a7f4a101f22cf1c35659adf1457783278f7ca369a0fa048c58b7f6952724ddd
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
