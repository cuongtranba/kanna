---
id: c3-125
c3-seal: 19e0df4ca5e245ccb9e0909983c6233095769f0023d600f07920dd702f0ac4be
title: webhooks-ui
type: component
category: feature
parent: c3-1
goal: 'Render the inbound webhook feature in the client: a Webhooks page opened as a workspace pane tab, the one-time secret dialog, and the transcript card for each delivery.'
uses:
    - ref-ws-subscription
    - ref-zustand-store
    - rule-zustand-store
---

## Goal

Render the inbound webhook feature in the client: a Webhooks page opened as a workspace pane tab, the one-time secret dialog, and the transcript card for each delivery.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 Client |
| Runtime | Browser. The page lazy-loads inside PageTabContent and reads the webhooks topic through the global subscription in useAppGlobalState. |
| Consumers | The sidebar utility nav opens it; KannaTranscript renders the delivery card in any chat the delivery landed in. |
| Boundary | Owns presentation and the pending-state wiring of the four webhooks commands. Hook state, secrets and delivery live in c3-243. |

## Purpose

Lets the user create and edit hooks in notify, inline or spawn mode, pick a target chat or project from the sidebar data through a searchable picker that also matches the project path, choose an optional model for inline and spawn hooks, copy the hook url, enable or disable, rotate or delete a hook, and see a new or rotated secret exactly once together with ready-to-run bearer and HMAC curl commands. It also renders the webhook_delivery card with the hook name, mode and delivery id. Non-goals: it never stores a secret after the dialog closes and does not compute signatures.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-zustand-store | ref | webhooksStore holds hooks, the one-time secret reveal and the editor state; selectors return the module-level EMPTY list | Mandatory | The form draft lives in a scoped store, not in useState. |
| rule-zustand-store | rule | State transitions are named store actions; JSX attributes call stable callbacks | Mandatory | The ast-grep rules fail an inline state updater in a JSX attribute. |
| ref-ws-subscription | ref | The webhooks topic is subscribed once in useAppGlobalState next to cron-jobs | Mandatory | The snapshot never contains a secret. |
| adr-20261013-pages-as-workspace-tabs | adr | The page is a PageKind webhooks tab resolved by pageTabs.ts and rendered by PageTabContent | Mandatory | No standalone route; App.tsx mounts WorkspacePage for /webhooks. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| webhooks topic | IN | WebhooksSnapshot of summaries with secretHint and last delivery | Replaced wholesale on every push | src/client/stores/webhooksStore.ts |
| webhooks commands | OUT | create, update, delete and rotateSecret sent through runPendingAction with a key per hook | Failures surface through setCommandError; the trigger renders pending | src/client/app/WebhookRow.tsx |
| One-time secret | IN | create and rotateSecret acks carry the secret; the dialog shows it and dismissing clears it from the store | The secret is never written to localStorage or a persisted layout | src/client/app/WebhookSecretDialog.tsx |
| Delivery card | IN | webhook_delivery entries render as an icon, hook name, mode label and delivery id | No tinted pill pairs; mode is plain text | src/client/components/messages/WebhookDeliveryMessage.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Sample curl commands | c3-243 Contract | Quoting style is free; the Authorization bearer header and the sha256 HMAC over the raw body must match what the server verifies | src/client/lib/webhookPresentation.ts |

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | The socket is connected and the webhooks topic has delivered a snapshot | N.A - no governing entity |
| Input | User actions on the page and the webhooks snapshot | N.A - no governing entity |
| State | hooks, secretReveal, editor (create, or edit with a hook id) and copiedId in webhooksStore; the create or edit form draft in WebhookCreateStore | N.A - no governing entity |
| Shared dependency | sidebarData from kannaStateStore supplies the chat and project pickers | N.A - no governing entity |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | The user can wire an outside system to Kanna without leaving the app | N.A - no governing entity |
| Primary path | New webhook, choose a mode and target, create, copy the secret from the dialog | N.A - no governing entity |
| Alternate path | Rotate or delete asks for confirmation first; Disable stops deliveries without losing the hook | N.A - no governing entity |
| Failure behavior | A failed command shows the server message as the command error and the trigger stops pending | N.A - no governing entity |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| The secret outlives its dialog | Moving secretReveal into a persisted store | The dismiss action no longer clears it | src/client/stores/webhooksStore.ts |
| A trigger shows no pending state | Calling sendWebhookCommand outside runPendingAction | no-floating-promises in the client lint gate | src/client/app/WebhookRow.tsx |
