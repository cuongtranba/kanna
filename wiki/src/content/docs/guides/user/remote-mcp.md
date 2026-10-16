---
title: Remote MCP server
description: Let Claude Code, Codex, Claude Desktop and ChatGPT drive Kanna over MCP — setup per client, how sign-in works, the tools they get, and the security notes.
---

Kanna can act as a **Model Context Protocol (MCP) server**. Once it is on, other
agents and apps — Claude Code, Codex, Claude Desktop and claude.ai, ChatGPT —
can list your projects, send prompts, answer tool requests, move board cards,
read git state and change settings, using the same commands the web UI uses.
Open browsers keep updating, because every action runs through the same server
code as a click in the UI.

The endpoint is `<your Kanna URL>/mcp`.

## Requirements

- **Start Kanna with `--password`.** Without a password the remote MCP server is
  off and `/mcp` answers `404`.
- **For Claude Desktop, claude.ai and ChatGPT, a public https URL.** Those apps
  connect from the vendor's servers, so Kanna must be reachable from the
  internet over https: use a Cloudflare tunnel or `--share`
  ([Self-host basics](/guides/ops/self-host/#reverse-proxy)). Claude Code and
  Codex can use `http://127.0.0.1:<port>` on the same machine.

## Settings page

Open **Settings → Remote MCP**.

- **Remote MCP server** switches the whole surface on or off. Off answers `404`
  on `/mcp`, the sign-in pages and the OAuth endpoints.
- **Public URL** is the address clients use: an https URL, or http on localhost.
  Kanna keeps only the origin (scheme, host and port). The OAuth issuer and the
  MCP resource are derived from it, so set it to the URL your clients actually
  open. Leave it empty to use the loopback address.
- **Connect a client** shows a copy-ready snippet for each client below, with the
  endpoint filled in. The snippets never contain your password; they use the
  placeholder `<your Kanna password>`.

## Connect a client

### Claude Code

```bash
claude mcp add --transport http kanna https://kanna.example.com/mcp --header "Authorization: Bearer <your Kanna password>"
```

Or add it without the header, run `/mcp` inside Claude Code and choose
**Authenticate** to sign in with OAuth.

### Codex

Add to `~/.codex/config.toml` and export your password as `KANNA_PASSWORD`:

```toml
[mcp_servers.kanna]
url = "https://kanna.example.com/mcp"
bearer_token_env_var = "KANNA_PASSWORD"
```

For OAuth instead, drop `bearer_token_env_var` and run `codex mcp login kanna`.

### Claude Desktop and claude.ai

**Settings → Connectors → Add custom connector**, URL
`https://kanna.example.com/mcp`. Either add the request header
`Authorization: Bearer <your Kanna password>`, or leave it empty to sign in with
OAuth. The URL must be https and reachable from the internet.

### ChatGPT

Open [ChatGPT Plugins](https://chatgpt.com/plugins), select the plus button, then
**Add custom MCP server**. Choose **Server URL**, enter
`https://kanna.example.com/mcp`, and choose **OAuth** as the authentication;
the default **Advanced OAuth settings** work as they are. ChatGPT supports OAuth
only. The URL must be https and reachable from the internet, and **Public URL**
in Settings must be set to that same address. Custom MCP servers are limited by
ChatGPT plan; see OpenAI's
[Connect to ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)
guide.

ChatGPT speaks MCP protocol revision `2026-07-28`, which Kanna 1.74 and later
serve. An older Kanna answers its first request with `400` and ChatGPT reports
"Some app settings were rejected".

## How sign-in works

- **Password header.** The client sends your launch password as a bearer token.
  Kanna signs in once through its normal password check and reuses that session
  for later calls. Kanna never stores the password; Better Auth keeps only its hash
  and applies the same check and the same rate limiter as the login page.
- **OAuth.** The client discovers Kanna's authorization server, registers itself,
  and opens a Kanna page in your browser. You enter your password on
  `/oauth/login`, then choose **Allow** or **Deny** on `/oauth/consent`. The client
  receives a short-lived access token (one hour) and a refresh token (30 days)
  bound to the `/mcp` resource.

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
| Chats | `create_chat`, `get_chat`, `send_message`, `wait_for_chat`, `enqueue_message`, `cancel_chat`, `rename_chat`, `archive_chat`, `unarchive_chat`, `fork_chat`, `delete_chat` |
| Tool requests | `list_pending_tool_requests`, `answer_tool_request`, `respond_tool` |
| Git | `get_git_status`, `commit_changes`, `list_branches`, `checkout_branch`, `sync_branch` |
| Boards | `list_boards`, `get_board`, `create_card`, `move_card`, `comment_card`, `start_work_on_card` |
| Cron | `list_cron_jobs`, `pause_cron_job`, `resume_cron_job`, `remove_cron_job` |
| Settings | `read_app_settings`, `patch_app_settings`, `list_subagents`, `list_installed_packages`, `check_package_updates` |
| Observability | `list_workflows`, `get_workflow_run`, `get_subagent_run`, `get_background_task_output` |
| Files | `upload_attachment`, `read_project_file` |
| System | `get_update_status`, `server_info` |

`send_message` starts a turn and waits for it. If the chat stops at
`waiting_for_user`, the reply lists the pending tool requests; answer them with
`answer_tool_request` or `respond_tool`. The server also publishes the resources
`kanna://projects`, `kanna://chats/{chatId}` and `kanna://boards/{boardId}`, and
sends the client written instructions on how to use the chat tools.

`read_app_settings` and `patch_app_settings` redact anything that looks like a
secret — API keys, tokens, passwords, environment and header values.

## Long turns, progress and waiting

A turn can run for many minutes, so `send_message` does not hold the connection
open for the whole turn. It waits up to `timeoutSeconds` (default 45) and then
answers with what it has:

| Field | Meaning |
| --- | --- |
| `done` | `true` when the turn has finished. `false` means it is still running, queued or waiting for you |
| `assistantText`, `activity` | The reply so far and up to 20 recent entries (tool calls, text) |
| `cursor` | A position in the chat. Pass it to `wait_for_chat` to get only what is newer |
| `queued`, `queuedMessageId` | The chat was busy, so the message waits behind the running turn |
| `next` | A plain instruction for the client, such as "call `wait_for_chat`, do not send again" |

`wait_for_chat` follows a chat without sending anything and returns the same
shape; call it repeatedly until `done` is `true`. A client that sends a progress
token also receives `notifications/progress` while Kanna waits, which keeps the
connection alive. Without progress, one call waits at most 100 seconds, which is
below the idle limits of Bun (10 seconds by default, raised to 130 seconds for
`/mcp`) and of a Cloudflare tunnel (125 seconds); a shorter wait is reported in
`timeoutClamp`. Clients on the 2025 protocol revisions keep the connection open
with SSE pings and may wait up to 600 seconds.

## Duplicate protection

Retrying `send_message` never starts the same work twice:

- **`idempotencyKey`.** Pass a stable string per user request. A repeat with the
  same key within 30 minutes returns the original chat with `duplicate: true`.
- **Identical requests in flight.** Without a key, a message with the same
  client, destination (chat or project) and text is not dispatched again while
  the first one is still running, waiting for you, or queued. Kanna follows the
  original instead and says so in `next`. Once the first turn has finished, the
  same words are a new request.
- `enqueue_message` and `kanna_command` with `chat.send` or `message.enqueue`
  follow the same rule.

A message sent to a busy chat is queued. If the running turn fails, Kanna does
not start the queued message by itself; the result says so and names
`message.dequeue` to clear it.

## Where a message came from

A message sent over MCP is marked in the transcript as "via MCP · client name",
with the client id, tool and call id in the tooltip. Kanna sets the mark itself
from the authenticated connection; a browser cannot claim it. Board cards, comments
and moves made through MCP are attributed to an "MCP client" and, like agent
writes, are not pushed to a connected tracker unless the binding allows agent
pushes.

Every tool call is also appended to `remote-mcp-calls.jsonl` in the Kanna data
directory (`~/.kanna/data/` by default), one JSON object per line, rotated to
`remote-mcp-calls.jsonl.1` at 10 MiB. A record holds the time, `callId`, tool,
`clientId`, `clientName`, `via` (`oauth` or `password`), protocol era, duration,
`outcome` (`ok`, `error` or `duplicate`), the chat and project ids and the
arguments with secrets removed and long text cut to 500 characters. The
`callId` matches the call id on the transcript mark, so a chat can be traced back
to the exact tool call and a retry loop shows up as repeated records from one
client.

## Security notes

- **A client with your password or an OAuth token can do what you can do** in the
  UI, including deleting chats and running commands in your projects. Only
  approve clients you trust, and use **Deny** on the consent page otherwise.
- **Rate limiting.** Wrong passwords are throttled — three attempts in ten seconds,
  then `429` with a `Retry-After` header — whether they arrive at the login page,
  the OAuth sign-in page or as a bearer token. Client registration and token
  requests have their own per-address limits, keyed on the real connection
  address; a client-supplied address header is ignored.
- **Fail closed.** No password, or the setting off, means `404` — never a
  half-open endpoint.
- **No MCP sessions.** `/mcp` serves protocol revision `2026-07-28` and the
  2025 revisions statelessly: every request is authorized on its own, Kanna keeps
  no per-client MCP state, and restarting Kanna interrupts only requests in flight.
- **To disable it**, switch **Remote MCP server** off in Settings, or start Kanna
  without `--password`.
- See [Security & sandboxing](/features/security-sandboxing/) for how the password
  gate works in general.
