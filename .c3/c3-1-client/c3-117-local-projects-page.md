---
id: c3-117
c3-version: 4
c3-seal: 84cd4964e2bb596beefd5612d2473cfdbd4bffdecb8b0f84f7deffd0ea99dc6c
title: local-projects-page
type: component
category: feature
parent: c3-1
goal: List projects auto-discovered from local Claude and Codex history so users can open them into Kanna.
uses:
    - ref-local-first-data
    - ref-ws-subscription
---

# local-projects-page

## Goal

List projects auto-discovered from local Claude and Codex history so users can open them into Kanna.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "drag-to-reorder projects" — onboarding surface that bootstraps the project list |
| Category | feature |
| Lifecycle | Mounts on /projects route |
| Replaceability | Layout replaceable; discovery feed contract preserved |

## Purpose

Lists projects auto-discovered from local Claude and Codex history; lets the user open a project into Kanna or create a new one. Non-goals: discovery itself (server), project removal, agent history mutation.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | App-shell mounted; socket subscribed | c3-110 |
| Input — discovery feed | discoveryView snapshot from server | c3-214 |
| Input — primitives | Cards, dialogs, buttons | c3-103 |
| Internal state | Filter text, last-open list | c3-117 |
| Initialization | Subscribe on mount; unsubscribe on unmount | ref-ws-subscription |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User opens an existing project as a Kanna chat with one click | c3-1 |
| Primary path | Render discovered list → click → emit project.open | c3-208 |
| Alternate — create project | Modal collects path → project.create command | c3-117 |
| Alternate — empty state | "No projects discovered" with onboarding tip | c3-117 |
| Failure — open reject | Show banner; retain list state | c3-117 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Subscribe to discovery projection | must follow | One subscription per mount |
| ref-local-first-data | ref | Read only local discovery data | must follow | No cloud lookup |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| <LocalProjectsPage> route | OUT | Mounts at /projects | c3-110 | src/client/app/LocalProjectsPage.tsx |
| project.open command | OUT | Emits via socket with project path | c3-208 | src/client/app/LocalProjectsPage.tsx |
| <NewProjectModal> | OUT | Drives project.create command | c3-208 | src/client/components/NewProjectModal.tsx |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Stale list after rescan | Subscription drop unhandled | List doesn't refresh after directory change | bun run check + smoke src/client/app/LocalProjectsPage.tsx |
| Create regression | Modal validation regression | User cannot create new project | bun run check + smoke src/client/components/NewProjectModal.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/LocalProjectsPage.tsx | c3-117 Contract | Layout detail | src/client/app/LocalProjectsPage.tsx |
| src/client/components/NewProjectModal.tsx | c3-117 Contract | Form layout detail | src/client/components/NewProjectModal.tsx |
