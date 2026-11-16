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
| `addSidebarItem({ id, title, icon, surface })` | A sidebar entry that opens one of your surfaces as a page at `/plugins/<pluginId>/<surface>` |
| `addCommandCenterItem({ name, description, prompt })` | A `/` picker entry, listed as `<pluginId>:<name>` |
| `handle(contract, handler)` | A server-side RPC handler, with `defineRpc` from `@kanna/plugin/server` |

`addSidebarItem` accepts the icons `Blocks`, `LayoutDashboard`, `ListTodo` and
`ChartNoAxesColumn`; any other name falls back to `Blocks`. The page opens in a
tab titled with the item's `title`, and its sidebar entry stays highlighted while
the page is open.

### Read projects, chats and cron jobs

A surface can read Kanna's projects and chats, jump into a chat, and start a new
one with the `useKannaWorkspace` hook from `@kanna/plugin`:

```tsx
import { useKannaWorkspace } from "@kanna/plugin"

export function Chats() {
  const { projects, ready, starting, openChat, startChat } = useKannaWorkspace()
  if (!ready) return <span>Loading…</span>
  return (
    <ul>
      {projects.map((project) => (
        <li key={project.localPath}>
          {project.name}
          <button
            type="button"
            disabled={starting}
            onClick={() => startChat(project.localPath, { prompt: "Summarise what changed this week." })}
          >
            Start with a prompt
          </button>
          {project.chats.map((chat) => (
            <button key={chat.chatId} type="button" onClick={() => openChat(chat.chatId)}>{chat.title}</button>
          ))}
        </li>
      ))}
    </ul>
  )
}
```

`projects` lists every project in the sidebar. Each project has:

| Field | Meaning |
| --- | --- |
| `localPath`, `name` | The folder and its last path segment |
| `chats` | Newest first: `chatId`, `title`, `status` (`idle`, `starting`, `running`, `waiting_for_user` or `failed`), `unread`, `lastMessageAt` |
| `cronJobs` | The project's armed [cron jobs](/features/cron-jobs/), read-only: `jobId`, `chatId` (the chat that owns it), `instruction`, `mode`, `schedule` (as typed), `scheduleHuman`, `paused`, `model`, `nextFireAt`, and `lastRun` (`status` and `firedAt`, or `null`) |

`openChat(chatId)` opens the chat in a tab. `startChat(localPath, options?)` starts
a new chat in that project and opens it. Without `options.prompt` it creates an
empty chat. With `options.prompt` the new chat is created and the prompt is sent
in one step, using your new-chat provider and model defaults, so the agent starts
working straight away. If the folder is not in the sidebar yet, Kanna opens it as
a project first. `starting` is `true` while a start is in flight, and a failure is
shown in the app's usual command error banner.

The hook reads data Kanna already keeps in the browser, so it opens no extra
subscription, and it only works inside a surface because it needs the app's
router and socket.

Selecting a plugin's `/` entry inserts its `prompt` text into the composer, so it
works on every provider. A plugin can add picker entries but never replace one:
if the name is already taken, the plugin's entry is dropped.

## Install and manage

Enabled plugins start when the server boots, so a restart does not leave them
answering "not running" until someone reloads them. A plugin that fails to start
is logged and skipped; it does not stop the others or the server. Starting at boot
only happens while plugins are switched on globally.

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
