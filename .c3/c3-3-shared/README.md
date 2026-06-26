---
id: c3-3
c3-version: 4
c3-seal: bd91ae5f9ac119d7a2844317f7b2c364d01cab2e3a2a5365df987595e5239175
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
| c3-301 | types | foundation | implemented | Core domain types shared by client + server |
| c3-302 | protocol | foundation | implemented | WS envelope definitions |
| c3-303 | tools | foundation | implemented | Tool-call hydration pipeline |
| c3-304 | ports | foundation | implemented | Port constants + dev-port helpers |
| c3-305 | branding | foundation | implemented | Product name + data dir constants |
| c3-306 | share-shared | foundation | implemented | Share DTOs shared with client |
| c3-307 | token-pricing | foundation | implemented | Pure USD token-cost math + model-price resolution |
