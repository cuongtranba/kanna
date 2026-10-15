---
id: c3-244
c3-seal: 8aa3fed24f9af38d1afd7e31ca4baf6c399d7b5970444c47f1623d9376ea90b9
title: push-notifications
type: component
category: feature
parent: c3-2
goal: Tell a user's subscribed browsers when a chat needs them, failed, or finished, without notifying for a chat they are already looking at or for work that is still running in the background.
uses:
    - ref-event-sourcing
    - ref-local-first-data
    - ref-side-effect-adapter
---

## Goal

Tell a user's subscribed browsers when a chat needs them, failed, or finished, without notifying for a chat they are already looking at or for work that is still running in the background.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | In-process. server.ts builds one PushManager after loading the VAPID keypair; it observes every chat status snapshot and is told each turn outcome through onTurnOutcome. |
| Consumers | c3-208 ws-router dispatches the push.* commands through ws-router-push.ts; c3-116 settings-page renders PushNotificationsSection; public/sw.js shows the notification in the browser. |
| Boundary | Owns subscriptions, project and chat mutes, focused-chat suppression, transition detection and Web Push delivery. It does not own chat status; it reads the derived status the read models already compute. |

## Purpose

Owns browser push notifications: the VAPID keypair in vapid.json (mode 0600), the push event log of subscriptions and mutes, the per-device focused chat, and the three notified transitions waiting_for_user, failed and completed. A completed turn is held while the chat still has background work and is released when that work ends; a turn the user stopped is never announced as done. Non-goals: it does not notify for inbound webhooks, cron runs or other devices' activity, and it does not retry a failed delivery.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-event-sourcing | ref | Subscriptions and mutes are push.jsonl events replayed at boot; dropUnmutedHistory prunes mutes whose latest state is unmuted | Mandatory | The log is pruned on load, never rewritten in place. |
| ref-side-effect-adapter | ref | vapid.adapter.ts is the only file that reads or writes the keypair; the Web Push send is injected as WebPushSender | Mandatory | Tests pass a fake sender, never the web-push module. |
| ref-local-first-data | ref | The VAPID private key stays on the machine in a file readable only by the owner | Mandatory | Keys are generated on first boot. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| push.* WS commands | IN | identifyDevice, subscribe, unsubscribe, sendTest, setProjectMute, setChatMute and setFocusedChat, each acknowledged on the command id | The browser client drops a subscription made with a different VAPID key before subscribing again (src/client/app/pushClient.ts), so a rotated key never strands a device. | src/server/ws-router-push.ts |
| PushPayload | OUT | v 1 with kind, project, chat id, chat title of at most 80 characters and chatUrl; urgency high for failed, low for completed | Never sent to a device whose focused chat is the chat the payload is about; repeats of the same chat and kind within 2 seconds are dropped. | src/server/push/push-manager.ts |
| Completed transition | OUT | Sent on running to idle only when the chat has no pending background work; held otherwise and released when the chat goes idle with none left | A cancelled turn clears the hold and sends nothing. | src/server/push/push-manager.ts |
| vapid.json | IN/OUT | publicKey, privateKey and a valid mailto or https subject, written with mode 0600; an invalid stored subject is healed to the default | The contact subject in Settings overrides the stored one at send time. | src/server/push/vapid.adapter.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| wiki/src/content/docs/guides/user/push-notifications.md | c3-244 Contract | Wording is free; the three transitions, the background-work hold and the no-notification-after-stop rule must survive | wiki/src/content/docs/guides/user/push-notifications.md |
