---
title: Remote MCP server
description: Let Claude Code, Codex, Claude Desktop and ChatGPT drive Kanna over MCP — step-by-step setup per client, how sign-in works, the tools they get, troubleshooting and security.
---

Kanna can act as a **Model Context Protocol (MCP) server**. Once it is on, other
agents and apps — Claude Code, Codex, Claude Desktop and claude.ai, ChatGPT —
can list your projects, send prompts, answer tool requests, move board cards,
read git state and change settings, using the same commands the web UI uses.
Open browsers keep updating, because every action runs through the same server
code as a click in the UI.

The endpoint is `<your Kanna URL>/mcp`, for example `http://127.0.0.1:3210/mcp`
on the same machine or `https://kanna.example.com/mcp` through a tunnel.

## Quick start on one machine

If the client runs on the same computer as Kanna, three steps are enough:

```bash
kanna --password <secret>
claude mcp add --transport http kanna http://127.0.0.1:3210/mcp --header "Authorization: Bearer <secret>"
claude mcp list
```

`claude mcp list` should show `kanna: http://127.0.0.1:3210/mcp (HTTP) - ✔ Connected`.
Ask Claude Code to "list my Kanna projects" to try it.

The rest of this page covers each client, a public URL for the apps that
connect from the cloud, and what to do when something does not connect.

## Step 1: start Kanna with a password

```bash
kanna --password <secret>
```

The password is the only credential. Without `--password` the remote MCP server
is off and every MCP path answers `404`. Under pm2, systemd or Docker, add the
flag to the start command ([pm2](/guides/ops/pm2/),
[systemd](/guides/ops/systemd/), [Docker](/guides/ops/docker/)).

Then open **Settings → Remote MCP** and check that **Remote MCP server** is
**Enabled**. It is enabled by default.

## Step 2: choose the URL clients use

Where the client runs decides the URL.

| Client | Runs on | URL it can use |
| --- | --- | --- |
| Claude Code, Codex | your computer | `http://127.0.0.1:<port>/mcp`, or a public https URL |
| Claude Desktop through the local bridge | your computer | `http://127.0.0.1:<port>/mcp`, or a public https URL |
| Claude Desktop and claude.ai connectors | Anthropic's servers | a public https URL only |
| ChatGPT | OpenAI's servers | a public https URL only |

**For a public URL, use a named Cloudflare tunnel**, so the hostname stays the
same across restarts:

```bash
kanna --cloudflared <token> --password <secret>
```

The [Cloudflare tunnel guide](/guides/ops/cloudflare-tunnel/) shows how to create
the tunnel and its hostname. A quick tunnel (`kanna --share --password <secret>`)
also works for a test, but its `trycloudflare.com` address changes every time
Kanna starts.

**Then set the Public URL.** In **Settings → Remote MCP → Public URL**, enter the
https address clients open, for example `https://kanna.example.com`, and click
**Save**. Kanna keeps only the origin (scheme, host and port).

:::caution[The Public URL must match what clients open]
OAuth tokens are issued for `<Public URL>/mcp` and signed by
`<Public URL>/api/auth`. If a client connects through a different address, its
OAuth sign-in fails. The password header does not depend on the Public URL.
When a quick-tunnel address changes, update the Public URL and sign the OAuth
clients in again. Leave the field empty to use `http://127.0.0.1:<port>`.
:::

The Settings page also shows the endpoint and a copy-ready setup card for each
client below. The cards never contain your password; they use the placeholder
`<your Kanna password>`.

## Step 3: connect a client

Each client can sign in two ways:

- **Password header.** The client sends `Authorization: Bearer <your Kanna password>`
  on every request. Simplest; nothing to click.
- **OAuth.** The client opens a Kanna page in your browser, you type your
  password once and click **Allow**. The client then holds a token instead of
  the password. ChatGPT supports only this way.

### Claude Code

With the password header:

```bash
claude mcp add --transport http kanna https://kanna.example.com/mcp --header "Authorization: Bearer <your Kanna password>"
```

With OAuth, add it without the header, then sign in:

```bash
claude mcp add --transport http kanna https://kanna.example.com/mcp
claude mcp login kanna
```

You can also run `/mcp` inside Claude Code, select `kanna` and choose
**Authenticate**.

The server is added to the current project only. Add `--scope user` to make it
available in every project. To keep the password out of a shared `.mcp.json`,
reference an environment variable instead:

```json
{
  "mcpServers": {
    "kanna": {
      "type": "http",
      "url": "https://kanna.example.com/mcp",
      "headers": { "Authorization": "Bearer ${KANNA_PASSWORD}" }
    }
  }
}
```

Check it with `claude mcp list` or `claude mcp get kanna`.

### Codex

Export the password, then add the server:

```bash
export KANNA_PASSWORD='<your Kanna password>'
codex mcp add kanna --url https://kanna.example.com/mcp --bearer-token-env-var KANNA_PASSWORD
```

The same thing in `~/.codex/config.toml`:

```toml
[mcp_servers.kanna]
url = "https://kanna.example.com/mcp"
bearer_token_env_var = "KANNA_PASSWORD"
```

For OAuth, leave out `bearer_token_env_var` and run `codex mcp login kanna`.
Check it with `codex mcp list`, or `/mcp` inside the Codex TUI.

### Claude Desktop and claude.ai (connector)

A connector is reached from Anthropic's servers, so it needs the public https URL
from Step 2.

1. Go to **Customize → Connectors** and click **Add custom connector**. On a Team
   or Enterprise plan an Owner adds it under **Organization settings →
   Connectors** instead.
2. Enter the MCP server URL, for example `https://kanna.example.com/mcp`.
3. For **Authentication**, choose **Sign in now** or **Sign in when needed**. For
   **OAuth client**, choose **Register automatically**. Kanna does not support
   Claude's published client identity, so the default option will not connect.
4. Click **Add**, then **Connect**. Kanna's sign-in page opens: enter your password
   and click **Allow**.

If your dialog shows **Request headers** (a beta not every account has), you can
skip OAuth: choose **No sign-in** and add the header `authorization` with the value
`Bearer <your Kanna password>`. Type the `Bearer ` prefix yourself; Claude sends
the value exactly as entered.

### Claude Desktop (local bridge, no public URL)

The [`mcp-remote`](https://github.com/geelen/mcp-remote) bridge runs on your
computer and connects Claude Desktop to Kanna directly, so a localhost URL works
and no tunnel is needed. It needs Node.js.

In Claude Desktop open **Settings → Developer → Edit Config**, add this to
`claude_desktop_config.json`, and restart Claude:

```json
{
  "mcpServers": {
    "kanna": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3210/mcp", "--header", "Authorization:${KANNA_AUTH}"],
      "env": { "KANNA_AUTH": "Bearer <your Kanna password>" }
    }
  }
}
```

Keep `Authorization:${KANNA_AUTH}` without a space: Claude Desktop on Windows does
not escape spaces inside `args`, so the space lives in the `env` value instead.
`mcp-remote` allows plain http only for `localhost` and `127.0.0.1`.

### ChatGPT

ChatGPT connects from OpenAI's servers, so it needs the public https URL, and it
supports OAuth only.

1. Go to **Settings → Apps → Advanced settings** and turn on **Developer mode**.
   It is available on the web for Plus, Pro, Business, Enterprise and Education
   accounts.
2. Choose **Create app**, give it a name, and enter the MCP server URL, for
   example `https://kanna.example.com/mcp`.
3. Choose **OAuth** as the authentication and leave the client ID and secret
   empty, so ChatGPT registers itself with Kanna.
4. Create the app. Kanna's sign-in page opens: enter your password and click
   **Allow**.

The app then appears under **Developer mode** in the composer's tools menu.
ChatGPT's menus change often; if a name differs, look for the developer-mode and
create-app entries in its Apps settings.

## Step 4: check that it works

Without credentials, `/mcp` must answer `401` and point at the sign-in metadata:

```bash
curl -i -X POST https://kanna.example.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Expect `HTTP/1.1 401 Unauthorized` and a header like
`www-authenticate: Bearer resource_metadata="https://kanna.example.com/.well-known/oauth-protected-resource/mcp"`.
That metadata document must name the same `resource` your client uses:

```bash
curl https://kanna.example.com/.well-known/oauth-protected-resource/mcp
```

Then ask the client something that calls a tool, such as "ping Kanna" (the `ping`
tool answers `pong`) or "list my Kanna projects".

## How sign-in works

- **Password header.** Kanna signs in once through its normal password check and
  reuses that session for later calls. Kanna never stores the password; Better
  Auth keeps only its hash and applies the same check and the same rate limiter
  as the login page. Starting Kanna with a different `--password` ends those
  sessions, so every password-header client must be given the new password.
- **OAuth.** The client discovers Kanna's authorization server, registers itself,
  and opens `/oauth/login` in your browser. You enter your password, then choose
  **Allow** or **Deny** on `/oauth/consent`. The client receives an access token
  that lasts one hour and a refresh token that lasts 30 days, both bound to the
  `/mcp` resource, and refreshes on its own.

## What the client can do

Two generic tools reach every command the web UI has: `kanna_commands` lists
them with their parameters and a risk level (`read`, `write`, `destructive`,
`local` or `unavailable`), and `kanna_command` runs one. `kanna_read` reads any
subscription snapshot. Commands bound to a browser, such as push notifications,
are refused. The typed tools below cover the common flows.

| Area | Tools |
| --- | --- |
| Generic | `ping`, `kanna_commands`, `kanna_command`, `kanna_read` |
| Projects | `list_projects`, `open_project`, `create_project`, `list_chats`, `search`, `fetch` |
| Chats | `create_chat`, `get_chat`, `send_message`, `enqueue_message`, `cancel_chat`, `rename_chat`, `archive_chat`, `unarchive_chat`, `fork_chat`, `delete_chat` |
| Tool requests | `list_pending_tool_requests`, `answer_tool_request`, `respond_tool` |
| Git | `get_git_status`, `commit_changes`, `list_branches`, `checkout_branch`, `sync_branch` |
| Boards | `list_boards`, `get_board`, `create_card`, `move_card`, `comment_card`, `start_work_on_card` |
| Cron | `list_cron_jobs`, `pause_cron_job`, `resume_cron_job`, `remove_cron_job` |
| Settings | `read_app_settings`, `patch_app_settings`, `list_subagents`, `list_installed_packages`, `check_package_updates` |
| Observability | `list_workflows`, `get_workflow_run`, `get_subagent_run`, `get_background_task_output` |
| Files | `upload_attachment`, `read_project_file` |
| System | `get_update_status`, `server_info` |

`send_message` waits for the turn to finish by default (up to 120 seconds, at
most 600) and returns the assistant text. If the chat stops at
`waiting_for_user`, the reply lists the pending tool requests; answer them with
`answer_tool_request` or `respond_tool`. Pass `wait: false` to return as soon as
the message is sent and read the chat later with `get_chat`. The server also
publishes the resources `kanna://projects`, `kanna://chats/{chatId}` and
`kanna://boards/{boardId}`.

`read_app_settings` and `patch_app_settings` redact anything that looks like a
secret — API keys, tokens, passwords, environment and header values.

Some prompts to start with:

- "List my Kanna projects and the chats that are waiting for me."
- "In Kanna project *api*, start a chat that fixes the failing test, and tell me what it changed."
- "Move the card *Rate limiting* to In progress and start work on it."

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `404` with `Remote MCP requires --password` | Kanna was started without `--password`. Restart it with the flag. |
| `404` with `Remote MCP is disabled` | **Settings → Remote MCP → Remote MCP server** is off. |
| `401 Unauthorized` with the password header | The password is wrong, or the header lacks the `Bearer ` prefix. The value must be exactly `Bearer <password>`. |
| `429 Too many attempts` | Three wrong passwords in ten seconds from one address. Wait for the `Retry-After` seconds, then fix the password. |
| `403 Forbidden` | The request carried an `Origin` header that does not match Kanna's address. Behind a tunnel, start Kanna with `--cloudflared` or `--share` so it trusts the forwarded https scheme. |
| OAuth sign-in fails, or the client reports an invalid resource or target | The Public URL does not match the address the client uses. Set it to that address, then sign the client in again. |
| Claude connector never shows Kanna's sign-in page | **OAuth client** is set to Claude's published identity. Remove the connector and add it again with **Register automatically**. |
| Claude Desktop or ChatGPT cannot reach Kanna | They connect from the cloud and cannot open `127.0.0.1` or a LAN address. Use a public https URL, or the local bridge for Claude Desktop. |
| `404 Session not found` after a restart | MCP sessions live in memory and end when Kanna restarts. The client starts a new one on its next request; reconnect it if it does not. |
| `send_message` returns `timedOut: true` | The turn is still running. Read it later with `get_chat`, or raise `timeoutSeconds`. |

## Security notes

- **A client with your password or an OAuth token can do what you can do** in the
  UI, including deleting chats and running commands in your projects. Only
  approve clients you trust, and use **Deny** on the consent page otherwise.
- **Prefer OAuth for cloud clients.** With OAuth the vendor holds a revocable,
  expiring token instead of your password.
- **Rate limiting.** Wrong passwords are throttled — three attempts in ten seconds,
  then `429` with a `Retry-After` header — whether they arrive at the login page,
  the OAuth sign-in page or as a bearer token. Client registration and token
  requests have their own per-address limits, keyed on the real connection
  address; a client-supplied address header is ignored.
- **Fail closed.** No password, or the setting off, means `404` — never a
  half-open endpoint.
- **Sessions.** MCP sessions are kept in memory, close after an hour of silence,
  and at most 64 live at once.
- **To cut every client off**, switch **Remote MCP server** off in Settings. While
  it is off, every request is refused, including ones with a valid token.
- **A new password does not sign out OAuth clients.** Restarting Kanna with a
  different `--password` ends every password-header session at once. An OAuth
  client, however, holds a refresh token that stays valid for up to 30 days and
  keeps working. Kanna has no button to revoke a single OAuth client yet, so turn
  the server off if a token may have leaked.
- See [Security & sandboxing](/features/security-sandboxing/) for how the password
  gate works in general.
