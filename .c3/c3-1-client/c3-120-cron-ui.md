---
id: c3-120
c3-seal: 3d940670daf2f7457b06c07d4f1185cecc15b97c4c47d5b01516bc74782c5911
title: cron-ui
type: component
category: feature
parent: c3-1
goal: |-
    Render the cron feature in the client: six transcript cards for cron entries,
    the per-chat Cron Jobs footer panel with pause/resume/remove controls, and
    the global /cron management page across all projects.
uses:
    - rule-colocated-bun-test
    - rule-strong-typing
    - rule-zustand-store
---

# cron-ui

## Goal

Render the cron feature in the client: six transcript cards for cron entries,
the per-chat Cron Jobs footer panel with pause/resume/remove controls, and
the global /cron management page across all projects.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "hydrate transcripts, stay synchronized via WebSocket subscriptions" — the cron entries' rendering plus two live cron read-model consumers |
| Category | feature |
| Lifecycle | Stateless components over snapshot props; one global zustand store fed by the cron-jobs topic |
| Replaceability | Replaceable while the six entry kinds render and the pause/resume/remove commands keep their wire shapes |

## Purpose

Owns every cron surface the user sees. Transcript cards: CronArmedMessage
(static arming record), CronCommandErrorMessage (field-level error + the
ready-to-send corrected command behind the sanctioned CopyStateStore +
clipboard adapter), CronRunMessage (spawn-mode run card whose LIVE status
pill joins ChatSnapshot.cronJobs by runId — the entry itself stays
immutable), CronRunSkippedMessage and CronJobChangeMessage one-liners, and
CronListMessage (renders the CURRENT job list, not a frozen copy).
CronJobsSection is the live footer panel (humanized schedule, mode,
next-fire countdown in tabular-nums, last-run status, controls issuing
cron.pause/resume/remove WS commands). CronJobsPage at /cron consumes the
global cron-jobs topic through cronJobsStore (stable EMPTY ref), grouped by
project with chat links; a sidebar nav entry reaches it. Non-goals: any cron
domain logic (c3-311) or scheduling (c3-233); the client never computes
occurrences — it renders the server-computed nextFireAt.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-zustand-store | rule | cronJobsStore + CopyStateStore usage; no useState for application state | wired compliance target | stable EMPTY refs on selectors |
| rule-strong-typing | rule | Processed* message types and snapshot props are fully typed | wired compliance target | no any on component props |
| rule-colocated-bun-test | rule | Cron components covered by colocated renderToStaticMarkup tests | wired compliance target | CronMessages.test.tsx |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Cron entry rendering | IN | The six cron_* transcript kinds each render a dedicated card/one-liner in the KannaTranscript switch; cronJobs threads reference-stably through the row comparators | c3-311 | src/client/app/KannaTranscript.tsx, src/client/components/messages/CronRunMessage.tsx |
| Live status join | IN | CronRunMessage and CronListMessage join live run state from ChatSnapshot.cronJobs (by runId / whole list), never from the immutable entry | c3-207 | src/client/components/messages/CronRunMessage.tsx, src/client/components/messages/CronListMessage.tsx |
| Management commands | OUT | Footer panel and /cron page issue cron.pause / cron.resume / cron.remove WS commands (the same dispatch the typed /cron subcommands use) | c3-233 | src/client/app/CronJobsSection.tsx, src/client/app/CronJobsPage.tsx |
| Global topic | IN | cronJobsStore consumes the cron-jobs subscription snapshot (all projects/chats) with a stable EMPTY fallback | c3-233 | src/client/stores/cronJobsStore.ts, src/client/app/useAppGlobalState.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/components/messages/Cron*.tsx | Contract (entry rendering + live status join) | Visual detail within DESIGN.md tokens | src/client/components/messages/CronRunMessage.tsx |
| src/client/app/CronJobsSection.tsx | Contract (management commands) | Layout detail | src/client/app/CronJobsSection.tsx |
| src/client/app/CronJobsPage.tsx | Contract (management commands + global topic) | Grouping presentation | src/client/app/CronJobsPage.tsx |
| src/client/components/messages/CronMessages.test.tsx | Contract (entry rendering) | Fixture selection | src/client/components/messages/CronMessages.test.tsx |
