---
id: c3-219
c3-version: 4
c3-seal: fb3750a9bd0f9c431b29868624ed6100bd80bd01f021faa73c6b509def74d5e4
title: update-manager
type: component
category: feature
parent: c3-2
goal: Detect newer kanna-code versions, expose update state to the UI, and reload the app via a swappable strategy.
uses:
    - ref-cqrs-read-models
    - ref-strong-typing
---

# update-manager

## Goal

Detect newer kanna-code versions, expose update state to the UI, and reload the app via a swappable strategy.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Detect new versions and reload via swappable strategies (npm/pm2/git)" |
| Category | feature |
| Lifecycle | Singleton manager with timer-driven checks |
| Replaceability | Replaceable provided checker/reloader interface contract preserved |

## Purpose

Hosts the version-check loop, exposes typed update state via a projection, and triggers reloads through a swappable `UpdateChecker` + `UpdateReloader` pair (npm/supervisor default, git/pm2 opt-in). Non-goals: HTTP serving, persistence, restart mechanics — those live in c3-220.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Strategy chosen via KANNA_RELOADER env | c3-219 |
| Input — strategy module | Checker + reloader factories | c3-219 |
| Input — read-models | Surfaces update projection | c3-207 |
| Internal state | Timer + last-known version | c3-219 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Users see update banner and can trigger reload | c3-101 |
| Primary path | Timer → checker → projection update | c3-207 |
| Alternate — apply | User confirms → reloader installs + relaunches | c3-220 |
| Alternate — pm2 strategy | git pull → build → pm2 reload | c3-219 |
| Failure — install error | Surfaces structured UpdateInstallError | c3-208 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-cqrs-read-models | ref | Update state projected over WS | must follow | Push, never pull |
| ref-strong-typing | ref | Typed checker/reloader interfaces | must follow | No any, no globals |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Update projection | OUT | Typed update state for UI | c3-207 | src/server/update-manager.ts |
| applyUpdate() | IN | Triggers checker → reloader chain | c3-220 | src/server/update-manager.ts |
| Strategy factory | IN/OUT | Returns checker + reloader pair | c3-219 | src/server/update-strategy.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Hardcoded strategy regression | Manager imports specific reloader | Tests fail without env | bun run test src/server/update-manager.test.ts |
| Reloader misfire | pm2 strategy edit | Service stuck after reload | bun run test src/server/update-strategy.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/update-manager.ts | c3-219 Contract | State machine detail | src/server/update-manager.ts |
| src/server/update-strategy.ts | c3-219 Contract | Strategy implementations | src/server/update-strategy.ts |
| src/server/update-manager.test.ts | c3-219 Contract | Manager test cases | src/server/update-manager.test.ts |
| src/server/update-strategy.test.ts | c3-219 Contract | Strategy test cases | src/server/update-strategy.test.ts |
