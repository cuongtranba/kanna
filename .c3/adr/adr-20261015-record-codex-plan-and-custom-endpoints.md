---
id: adr-20261015-record-codex-plan-and-custom-endpoints
c3-seal: eab10aeb22ff43a7203c9b0060b82f3b9d15f1bc5c3a3586f9eddae41d04461d
title: record-codex-plan-and-custom-endpoints
type: adr
goal: Bring the codex-app-server and provider-catalog facts up to the code on main, which now enables the Codex update_plan tool and routes custom Anthropic-compatible endpoints through the SDK session, so a reader of either fact learns both surfaces exist.
status: done
date: "2026-10-15"
---

## Goal

Bring the codex-app-server and provider-catalog facts up to the code on main, which now enables the Codex update_plan tool and routes custom Anthropic-compatible endpoints through the SDK session, so a reader of either fact learns both surfaces exist.

## Context

Two shipped features left no trace in the component facts that own them. Pull requests 1291 and 1293 made Kanna enable the Codex update_plan tool in the thread config and turn its calls and turn/plan/updated notifications into a plan entry; c3-211 mentions neither. Pull request 1261 added custom Anthropic-compatible endpoints whose models are addressed as provider-id/vendor-model and resolved to an SDK endpoint with its own base URL, key and context window; c3-212 binds the files but its prose describes only the static catalog.

## Decision

Insert one Contract row into each fact, after its last existing row, describing the surface, its boundary and its evidence file. No other section changes; the eval bindings already cover the files.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-211 | component | Gains the update_plan Contract row | c3-211#n14940@v1:sha256:d3b406d930f789fda5e4ef6289682d9d0a87943cf7ae307677b11b70359d2dd4 | Provider-adapter ref unchanged |
| c3-212 | component | Gains the custom endpoint Contract row | c3-212#n14941@v1:sha256:b8ef2c3986e52e8cd4ac972a0f9edbe62ee42d016652ad2bc0f7ae47e33738a8 | Provider-adapter ref unchanged |

## Verification

| Check | Result |
| --- | --- |
| c3x check after apply | Recorded in the pull request |
