import type { ClientCommand } from "../protocol"

export type CommandRisk = "read" | "write" | "destructive" | "local" | "unavailable"

export interface CommandCatalogEntry {
  readonly summary: string
  readonly params: string
  readonly risk: CommandRisk
  readonly domain: string
}

type CommandType = ClientCommand["type"]

function entry(domain: string, risk: CommandRisk, params: string, summary: string): CommandCatalogEntry {
  return { summary, params, risk, domain }
}

const BRANCH_PARAM =
  "branch: {kind:'local',name} | {kind:'remote',name,remoteRef} | {kind:'pull_request',name,prNumber,headRefName,headRepoCloneUrl?,isCrossRepository?,remoteRef?}"

export const COMMAND_CATALOG: Readonly<Record<CommandType, CommandCatalogEntry>> = {
  "project.open": entry("project", "write", "localPath: string", "Open an existing folder as a project, registering it if new."),
  "project.create": entry("project", "write", "localPath: string, title: string", "Create a project directory and register it as a project."),
  "project.remove": entry("project", "destructive", "projectId: string", "Hide a project from the sidebar; reopening the folder restores it."),
  "project.delete": entry("project", "destructive", "projectId: string", "Permanently delete a project with its chats, boards, shares, worktrees and stored files."),
  "project.setStar": entry("project", "write", "projectId: string, starred: boolean", "Star or unstar a project."),
  "project.setInstructions": entry("project", "write", "projectId: string, instructions: string", "Set the standing instructions added to every chat in the project."),
  "project.readDiffPatch": entry("project", "read", "projectId: string, path: string, chatId?: string", "Read the git patch of one changed file in the project."),
  "sessions.importClaude": entry("sessions", "write", "(none)", "Import all Claude Code sessions found on this machine as chats."),
  "sessions.importClaudeSession": entry("sessions", "write", "sessionIds: string[]", "Import specific Claude Code sessions by id."),
  "sidebar.reorderProjectGroups": entry("sidebar", "write", "projectIds: string[]", "Set the sidebar order of project groups."),
  "stack.create": entry("stack", "write", "title: string, projectIds: string[], instructions?: string", "Create a stack grouping several projects."),
  "stack.rename": entry("stack", "write", "stackId: string, title: string", "Rename a stack."),
  "stack.setInstructions": entry("stack", "write", "stackId: string, instructions: string", "Set the standing instructions for a stack."),
  "stack.remove": entry("stack", "destructive", "stackId: string", "Remove a stack."),
  "stack.addProject": entry("stack", "write", "stackId: string, projectId: string", "Add a project to a stack."),
  "stack.removeProject": entry("stack", "write", "stackId: string, projectId: string", "Remove a project from a stack."),
  "stack.listWorktrees": entry("stack", "read", "projectId: string", "List the git worktrees of a project."),
  "system.ping": entry("system", "read", "(none)", "Liveness check; answers with an ack."),
  "system.openExternal": entry("system", "local", "localPath: string, action: 'open_finder'|'open_terminal'|'open_editor'|'open_preview'|'open_default', line?: number, column?: number, editor?: {preset,commandTemplate}", "Open a path in Finder, a terminal, an editor or the default app on the host machine."),
  "update.check": entry("update", "write", "force?: boolean", "Check whether a newer Kanna version is available."),
  "update.install": entry("update", "destructive", "version?: string", "Install a Kanna update and restart the server."),
  "update.reload": entry("update", "write", "(none)", "Reload the running Kanna client after an update."),
  "settings.readKeybindings": entry("settings", "read", "(none)", "Read the keybindings snapshot."),
  "settings.writeKeybindings": entry("settings", "write", "bindings: object", "Replace the keybindings."),
  "settings.readAppSettings": entry("settings", "read", "(none)", "Read the application settings snapshot."),
  "settings.writeAppSettings": entry("settings", "write", "analyticsEnabled: boolean", "Enable or disable analytics."),
  "settings.writeAppSettingsPatch": entry("settings", "write", "patch: AppSettingsPatch", "Apply a partial update to the application settings."),
  "settings.testMcpServer": entry("settings", "write", "id: string", "Probe a configured custom MCP server and record the result."),
  "settings.startMcpOAuth": entry("settings", "write", "id: string", "Begin the OAuth flow for a custom MCP server and return the authorization URL."),
  "settings.completeMcpOAuth": entry("settings", "write", "id: string, callbackUrl: string", "Finish a custom MCP server OAuth flow from the pasted callback URL."),
  "settings.readLlmProvider": entry("settings", "read", "(none)", "Read the LLM provider used for title and commit-message generation."),
  "settings.listOpenRouterModels": entry("settings", "read", "(none)", "List the models available from OpenRouter."),
  "settings.getChangelog": entry("settings", "read", "(none)", "Read the Kanna changelog."),
  "settings.writeLlmProvider": entry("settings", "write", "provider: string, apiKey: string, model: string, baseUrl: string", "Save the LLM provider configuration."),
  "settings.validateLlmProvider": entry("settings", "write", "provider: string, apiKey: string, model: string, baseUrl: string", "Validate an LLM provider configuration with a test call."),
  "appSettings.setCloudflareTunnel": entry("appSettings", "write", "patch: Partial<CloudflareTunnelSettings>", "Update the Cloudflare tunnel settings."),
  "appSettings.setClaudeAuth": entry("appSettings", "write", "patch: Partial<ClaudeAuthSettings>", "Update the Claude authentication settings."),
  "appSettings.testOAuthToken": entry("appSettings", "write", "token: string, baseUrl?: string", "Test a Claude OAuth token against the API."),
  "subagent.create": entry("subagent", "write", "input: SubagentInput", "Create a subagent definition."),
  "subagent.update": entry("subagent", "write", "id: string, patch: SubagentPatch", "Update a subagent definition."),
  "subagent.delete": entry("subagent", "write", "id: string", "Delete a subagent definition."),
  "beacons.mintPairingCode": entry("beacons", "write", "(none)", "Mint a one-time pairing code for a remote beacon."),
  "beacons.update": entry("beacons", "write", "beaconId: string", "Ask a paired beacon to update itself."),
  "skills.search": entry("skills", "read", "query: string, limit?: number", "Search the skills registry."),
  "skills.install": entry("skills", "write", "source: string, skillId: string", "Install a skill from a source."),
  "skills.uninstall": entry("skills", "write", "skillId: string", "Uninstall a skill."),
  "skills.listInstalled": entry("skills", "read", "(none)", "List installed skills."),
  "packages.listInstalled": entry("packages", "read", "(none)", "List installed skills and plugins with their update state."),
  "packages.checkUpdates": entry("packages", "read", "(none)", "Check installed packages for available updates."),
  "packages.update": entry("packages", "write", "id: string", "Update one installed package."),
  "packages.updateAll": entry("packages", "write", "ids: string[]", "Update several installed packages."),
  "chat.create": entry("chat", "write", "projectId: string, stackId?: string, stackBindings?: Array<{projectId,worktreePath,role}>", "Create an empty chat in a project."),
  "chat.fork": entry("chat", "write", "chatId: string", "Fork a chat into a new one."),
  "chat.rename": entry("chat", "write", "chatId: string, title: string", "Rename a chat."),
  "chat.archive": entry("chat", "write", "chatId: string", "Archive a chat."),
  "chat.unarchive": entry("chat", "write", "chatId: string", "Restore an archived chat."),
  "chat.delete": entry("chat", "destructive", "chatId: string", "Permanently delete a chat and its transcript."),
  "chat.setDraftProtection": entry("chat", "unavailable", "chatIds: string[]", "Mark chats whose unsent draft the browser protects; bound to one socket."),
  "chat.markRead": entry("chat", "write", "chatId: string", "Mark a chat as read."),
  "chat.setPolicyOverride": entry("chat", "write", "chatId: string, policyOverride: ChatPermissionPolicyOverride | null", "Set or clear the permission policy override of a chat."),
  "chat.send": entry("chat", "write", "chatId?: string, projectId?: string, content: string, provider?: string, model?: string, modelOptions?: object, effort?: string, planMode?: boolean, attachments?: ChatAttachment[], autoResumeOnRateLimit?: boolean, clientTraceId?: string", "Send a prompt to a chat, or start a new chat in a project, and run a turn."),
  "chat.refreshDiffs": entry("chat", "write", "chatId: string", "Recompute the git diff snapshot of a chat."),
  "chat.initGit": entry("chat", "write", "chatId: string", "Run git init in the chat's working directory."),
  "chat.getGitHubPublishInfo": entry("chat", "read", "chatId: string", "Read whether and how the chat's repository can be published to GitHub."),
  "chat.checkGitHubRepoAvailability": entry("chat", "read", "chatId: string, owner: string, name: string", "Check whether a GitHub repository name is free."),
  "chat.publishToGitHub": entry("chat", "write", "chatId: string, owner: string, name: string, visibility: 'public'|'private', description?: string", "Create a GitHub repository and push the chat's repository to it."),
  "chat.listBranches": entry("chat", "read", "chatId: string", "List local, remote and pull-request branches of the chat's repository."),
  "chat.previewMergeBranch": entry("chat", "read", `chatId: string, ${BRANCH_PARAM}`, "Preview the result of merging a branch."),
  "chat.mergeBranch": entry("chat", "write", `chatId: string, ${BRANCH_PARAM}`, "Merge a branch into the current branch."),
  "chat.syncBranch": entry("chat", "write", "chatId: string, action: 'fetch'|'pull'|'push'|'publish'", "Fetch, pull, push or publish the current branch."),
  "chat.checkoutBranch": entry("chat", "write", `chatId: string, ${BRANCH_PARAM}, bringChanges?: boolean`, "Check out a branch, optionally carrying uncommitted changes."),
  "chat.createBranch": entry("chat", "write", "chatId: string, name: string, baseBranchName?: string", "Create and check out a new branch."),
  "chat.generateCommitMessage": entry("chat", "write", "chatId: string, paths: string[]", "Generate a commit message for the given changed files."),
  "chat.commitDiffs": entry("chat", "write", "chatId: string, paths: string[], summary: string, description?: string, mode: DiffCommitMode", "Commit the given changed files."),
  "chat.discardDiffFile": entry("chat", "destructive", "chatId: string, path: string", "Discard the uncommitted changes of one file."),
  "chat.ignoreDiffFile": entry("chat", "write", "chatId: string, path: string", "Add one file to the repository's ignore list."),
  "chat.cancel": entry("chat", "write", "chatId: string", "Cancel the running turn of a chat."),
  "chat.stopDraining": entry("chat", "write", "chatId: string", "Stop a chat that is draining background work after its turn."),
  "chat.loadHistory": entry("chat", "read", "chatId: string, beforeCursor: string, limit: number", "Load a page of older transcript entries."),
  "chat.respondTool": entry("chat", "write", "chatId: string, toolUseId: string, result: JsonValue", "Answer a pending interactive tool such as a question or plan approval."),
  "chat.toolRequestAnswer": entry("chat", "write", "chatId: string, toolRequestId: string, decision: ToolRequestDecision", "Allow or deny a pending tool permission request."),
  "chat.respondSubagentTool": entry("chat", "write", "chatId: string, runId: string, toolUseId: string, result: JsonObject", "Answer an interactive tool requested by a subagent run."),
  "chat.cancelSubagentRun": entry("chat", "write", "chatId: string, runId: string", "Cancel a running subagent run."),
  "board.create": entry("board", "write", "ownerKind: 'project'|'stack', ownerId: string, title: string, templateId?: string | null", "Create a board for a project or stack, optionally from a template."),
  "board.archive": entry("board", "destructive", "boardId: string", "Archive a board."),
  "board.update": entry("board", "write", "boardId: string, title?: string, description?: string | null, cardFields?: JsonValue", "Update a board's title, description or card fields."),
  "board.duplicate": entry("board", "write", "boardId: string, title: string", "Duplicate a board under a new title."),
  "board.saveAsTemplate": entry("board", "write", "boardId: string, name: string", "Save a board's columns as a reusable template."),
  "board.sync.bind": entry("board", "write", "boardId: string, owner: string, repo: string, direction: SyncDirection, allowAgentPush: boolean, projectId?: string | null, detachFromBoardId?: string | null", "Bind a board to a GitHub repository's issues."),
  "board.sync.unbind": entry("board", "write", "boardId: string, bindingId: string", "Remove a board's GitHub binding."),
  "board.sync.pull": entry("board", "write", "boardId: string", "Pull issues from the bound GitHub repository into the board."),
  "board.sync.push": entry("board", "write", "boardId: string", "Push held board changes to the bound GitHub repository."),
  "board.sync.status": entry("board", "read", "boardId: string", "Read the sync status of a board."),
  "board.column.create": entry("board", "write", "boardId: string, title: string, afterColumnId?: string | null", "Add a column to a board."),
  "board.column.update": entry("board", "write", "columnId: string, title?: string, semantic?: ColumnSemantic | null, colorToken?: ColumnColorToken | null, wipLimit?: number | null", "Update a column's title, semantic, colour or WIP limit."),
  "board.column.move": entry("board", "write", "columnId: string, afterColumnId: string | null", "Reorder a column."),
  "board.column.delete": entry("board", "destructive", "columnId: string", "Delete a column."),
  "board.card.create": entry("board", "write", "boardId: string, columnId: string, title: string, projectId?: string | null, afterCardId?: string | null", "Create a card in a column."),
  "board.card.move": entry("board", "write", "cardId: string, toColumnId: string, aboveCardId: string | null, belowCardId: string | null", "Move a card to a column position."),
  "board.card.archive": entry("board", "destructive", "cardId: string", "Archive a card."),
  "board.card.detail": entry("board", "read", "cardId: string", "Read a card with its comments, links and blockers."),
  "board.card.comment": entry("board", "write", "cardId: string, body: string", "Add a comment to a card."),
  "board.card.block": entry("board", "write", "cardId: string, blockedByCardId: string", "Mark a card as blocked by another card."),
  "board.card.unblock": entry("board", "write", "cardId: string, blockedByCardId: string", "Remove a blocker from a card."),
  "board.card.update": entry("board", "write", "cardId: string, title?: string, content?: JsonValue", "Update a card's title or content."),
  "board.card.startWork": entry("board", "write", "cardId: string", "Create a worktree and chat for a card and start the agent."),
  "board.card.resolveWorktree": entry("board", "write", "cardId: string, decision: CleanupDecision", "Merge, discard or keep the worktree of a finished card."),
  "board.cards.page": entry("board", "read", "columnId: string, limit: number, afterRank?: string | null", "Read a page of cards in a column."),
  "board.templates.list": entry("board", "read", "(none)", "List board templates."),
  "workflows.getRun": entry("workflows", "read", "chatId: string, runId: string", "Read the full detail of a workflow run."),
  "workflows.getAgentTranscript": entry("workflows", "read", "chatId: string, runId: string, agentId: string", "Read one agent's transcript within a workflow run."),
  "subagents.getRun": entry("subagents", "read", "chatId: string, agentId: string", "Read the detail of a subagent run."),
  "backgroundTasks.getOutput": entry("backgroundTasks", "read", "chatId: string, taskId: string", "Read the captured output of a background task."),
  "genui.dataset.query": entry("genui", "read", "chatId: string, dataset: JsonObject, query: JsonObject, refresh?: boolean", "Run a query against a generative-UI dataset."),
  "genui.dataset.approve": entry("genui", "write", "chatId: string, server: string, tool: string", "Allow a generative-UI dataset to call an MCP tool for this chat."),
  "message.enqueue": entry("message", "write", "chatId: string, content: string, attachments?: ChatAttachment[], provider?: string, model?: string, modelOptions?: object, planMode?: boolean, autoResumeOnRateLimit?: boolean", "Queue a message to run when the chat becomes idle."),
  "message.steer": entry("message", "write", "chatId: string, queuedMessageId: string", "Deliver a queued message into the running turn."),
  "message.dequeue": entry("message", "write", "chatId: string, queuedMessageId: string", "Remove a queued message."),
  "autoContinue.accept": entry("autoContinue", "write", "chatId: string, scheduleId: string, scheduledAt: number", "Accept a proposed auto-continue and schedule it."),
  "autoContinue.reschedule": entry("autoContinue", "write", "chatId: string, scheduleId: string, scheduledAt: number", "Move a scheduled auto-continue to another time."),
  "autoContinue.cancel": entry("autoContinue", "write", "chatId: string, scheduleId: string", "Cancel a scheduled auto-continue."),
  "cron.remove": entry("cron", "destructive", "chatId: string, jobId: string", "Remove a cron job."),
  "cron.pause": entry("cron", "write", "chatId: string, jobId: string", "Pause a cron job."),
  "cron.resume": entry("cron", "write", "chatId: string, jobId: string", "Resume a paused cron job."),
  "cron.update": entry("cron", "write", "chatId: string, jobId: string, patch: CronJobPatch", "Change a cron job's schedule, mode or instruction."),
  "tunnel.accept": entry("tunnel", "write", "chatId: string, tunnelId: string", "Accept a proposed Cloudflare tunnel for a chat's local port."),
  "tunnel.stop": entry("tunnel", "write", "chatId: string, tunnelId: string", "Stop a running tunnel."),
  "tunnel.retry": entry("tunnel", "write", "chatId: string, tunnelId: string", "Retry a failed tunnel."),
  "terminal.create": entry("terminal", "local", "projectId: string, terminalId: string, cols: number, rows: number, scrollback: number", "Spawn a shell terminal on the host machine in the project directory."),
  "terminal.input": entry("terminal", "local", "terminalId: string, data: string", "Send keystrokes to a host terminal."),
  "terminal.resize": entry("terminal", "local", "terminalId: string, cols: number, rows: number", "Resize a host terminal."),
  "terminal.close": entry("terminal", "destructive", "terminalId: string", "Close a host terminal and kill its shell."),
  "push.identifyDevice": entry("push", "unavailable", "pushDeviceId: string | null", "Bind this socket to a browser push device."),
  "push.subscribe": entry("push", "unavailable", "subscription: PushSubscribeRequestPayload, label: string, userAgent: string", "Register a browser for web push."),
  "push.unsubscribe": entry("push", "unavailable", "pushDeviceId: string", "Unregister a browser from web push."),
  "push.test": entry("push", "unavailable", "(none)", "Send a test push notification to this browser."),
  "push.setProjectMute": entry("push", "unavailable", "localPath: string, muted: boolean", "Mute or unmute push notifications for a project."),
  "push.setChatMute": entry("push", "unavailable", "chatId: string, muted: boolean", "Mute or unmute push notifications for a chat."),
  "push.setFocusedChat": entry("push", "unavailable", "chatId: string | null", "Tell the server which chat this browser is viewing."),
  "share.mint": entry("share", "write", "payload: {chatId: string, ttlHours?: number}", "Create a read-only share link for a chat."),
  "share.revoke": entry("share", "write", "payload: {tokenId: string}", "Revoke a share link."),
  "share.list": entry("share", "read", "payload: {chatId: string}", "List the share links of a chat."),
}

export function isCatalogedCommandType(type: string): type is CommandType {
  return Object.hasOwn(COMMAND_CATALOG, type)
}

export function listCommandCatalog(domain?: string): Array<{ type: string } & CommandCatalogEntry> {
  const rows: Array<{ type: string } & CommandCatalogEntry> = []
  for (const type of Object.keys(COMMAND_CATALOG).sort()) {
    if (!isCatalogedCommandType(type)) continue
    const catalogEntry = COMMAND_CATALOG[type]
    if (domain === undefined || catalogEntry.domain === domain) rows.push({ type, ...catalogEntry })
  }
  return rows
}
