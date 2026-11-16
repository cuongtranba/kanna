---
id: adr-20261116-plugin-workspace-boot-start
c3-seal: ad02281c96537a695edd9184a08f23cae0b6af831240ee9ab2c27ab6e3cafd51
title: plugin-workspace-boot-start
type: adr
goal: 'Let a Kanna plugin run a real workflow inside Kanna: enabled plugins start with the server, a plugin sidebar item opens a page, a plugin surface reads projects, chats and cron jobs and can start a chat with a prompt already sent, a fired cron job runs on the model it was armed with, and the Remote MCP settings warn when the OAuth sign-in would point at loopback.'
status: done
date: "2026-11-16"
---

## Goal

Let a Kanna plugin run a real workflow inside Kanna: enabled plugins start with the server, a plugin sidebar item opens a page, a plugin surface reads projects, chats and cron jobs and can start a chat with a prompt already sent, a fired cron job runs on the model it was armed with, and the Remote MCP settings warn when the OAuth sign-in would point at loopback.

## Context

PluginService.restore() registered enabled plugins as stopped and start() was reached only through reload, so after a restart an enabled plugin's RPC answered "not running". A plugin sidebar item rendered disabled because nothing passed a select handler, although the plugin docs promise a page. A surface had no way to read the sidebar's projects and chats or to start a chat, and the cron fire path called enqueueMessage with only the run tag, so the armed model was ignored. RemoteMcpSection built setup snippets from the browser origin while the server advertised the loopback address when publicUrl is empty.

## Decision

PluginService owns boot start: a startEnabled() method starts every enabled plugin, logs a failure and moves on, and only the server's http-dispatcher calls it, behind the global plugins switch, so the CLI process never spawns plugin children. A plugin page is the route /plugins/:pluginId/:surfaceId rendered by PluginPage. useKannaWorkspace is a host-module export built from the stores that already hold the sidebar and the cron-jobs snapshot plus the socket from KannaSocketProvider; startChat is launched through runPendingAction and sends the prompt with chat.send or creates an empty chat with chat.create. The public shapes are declared once in kanna-plugin.d.ts and the client implementation imports them type-only. The server never derives the public origin from request headers; the client offers the page origin as a one-click save instead.

## Affected Topology

| Entity | Type | Why affected | Governance review | Evidence |
| --- | --- | --- | --- | --- |
| c3-238 | component | PluginService gains startEnabled and the server wires it at boot | Contract row PluginService updated | c3-238#n14314@v1:sha256:720fb5e72a2f79bf64a41229abcd67087c09752062f5551dbd193f86e2f64e73 |
| c3-121 | component | Adds the workspace hook and the plugin page to what plugins-ui exposes | Two contract rows inserted | c3-121#n15939@v1:sha256:94a820b691f85b4a0070bb42bc7f6b802440a33c0b09de63d66769af3ae5cc1e |
| c3-124 | component | RemoteMcpSection warns and offers the page origin as the public URL | Contract row RemoteMcpSection updated | c3-124#n12105@v1:sha256:eb86fcf67ccc0199e2e863270351331f1b90de76afc412f46c5253792822930d |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Server | startEnabled in plugin-service.ts, wired in http-dispatcher.ts | src/server/plugins/plugin-service.ts |
| Client | PluginPage, pluginWorkspaceApi.ts, kanna-plugin.d.ts types | src/client/plugins/pluginWorkspaceApi.ts |
| Cron | cronRunOptions in fire.ts passes the armed model and provider | src/server/cron/fire.ts |
| Remote MCP | suggestRemoteMcpPublicUrl and the warning block | src/client/components/settings/RemoteMcpSection.tsx |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/plugins/plugin-service.test.ts src/client/plugins src/server/cron/fire.test.ts src/client/components/settings/RemoteMcpSection.test.tsx | pass |
| bun run check:arch | pass |
