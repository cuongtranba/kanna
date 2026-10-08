---
title: Kanna plugins
description: Write a plugin that adds UI to Kanna and runs its own server-side process, then install, reload and debug it from the CLI or from a chat.
---

A **Kanna plugin** adds UI to Kanna itself: a page in the sidebar, a panel in the
chat footer, an entry in the `/` picker. Its server half runs in **its own
process** and talks to Kanna over typed RPC, so a misbehaving plugin cannot take
the server down with it.

This is not the same thing as a Claude Code or Codex plugin. Those add skills and
commands to the agent and are managed under **Settings → Plugins**; see
[Package auto-update](/features/package-auto-update/).

## Turn plugins on

Plugins are **off by default**. While they are off, every plugin route, tool and
UI surface stays dark. Turn them on in `~/.kanna/data/settings.json`:

```json
{
  "plugins": { "enabled": true }
}
```

A **Settings → Kanna plugins** page then appears, listing what is installed.

## Write one

A plugin is a directory with a manifest and an entry file. Ask the agent to
scaffold one (`plugin_scaffold`), or write the three files yourself:

```json title="kanna-plugin.json"
{
  "id": "hello",
  "name": "Hello",
  "version": "0.1.0",
  "kannaPluginApi": 1
}
```

```tsx title="index.ts"
import type { PluginContext } from "@kanna/plugin"
import { Panel } from "./panel.client"

export default function contribute(plugin: PluginContext) {
  plugin.addSurface("main", Panel)
  plugin.addSidebarItem({ id: "main", title: "Hello", icon: "Blocks", surface: "main" })
  plugin.addCommandCenterItem({
    name: "greet",
    description: "Say hello",
    prompt: "Say hello to the team in one sentence.",
  })
  return () => {}
}
```

```tsx title="panel.client.tsx"
import type { PluginSurfaceProps } from "@kanna/plugin"

export function Panel({ theme }: PluginSurfaceProps) {
  return <div style={{ color: theme.colors.foreground }}>Hello is running.</div>
}
```

The `id` is lowercase letters, digits and hyphens, starts with a letter, and
`kanna` is reserved. `entry` in the manifest defaults to `index.ts`.

What a plugin can contribute:

| Call | Adds |
| --- | --- |
| `addSurface(id, Component)` | A React component, shown as a panel in the chat footer |
| `addSidebarItem({ id, title, icon, surface })` | A sidebar entry that opens one of your surfaces as a page |
| `addCommandCenterItem({ name, description, prompt })` | A `/` picker entry, listed as `<pluginId>:<name>` |
| `handle(contract, handler)` | A server-side RPC handler, with `defineRpc` from `@kanna/plugin/server` |

Selecting a plugin's `/` entry inserts its `prompt` text into the composer, so it
works on every provider. A plugin can add picker entries but never replace one:
if the name is already taken, the plugin's entry is dropped.

## Install and manage

Kanna compiles the directory into a browser bundle and a server bundle, stores
them under `~/.kanna/plugins/<id>/`, and remembers the install across restarts.

```bash
kanna plugin install ./my-plugin   # compile and install from a directory
kanna plugin ls                    # list installed plugins and their state
kanna plugin reload hello          # restart it, picking up a rebuilt bundle
kanna plugin logs hello --tail 50  # the plugin's most recent log lines
```

The agent has the same verbs as tools (`plugin_scaffold`, `plugin_validate`,
`plugin_install`, `plugin_list`, `plugin_reload`, `plugin_logs`), so you can ask a
chat to build and iterate on a plugin for you.

Each compile runs in a separate process with a 20-second deadline. A build that
hangs fails cleanly instead of freezing Kanna.
