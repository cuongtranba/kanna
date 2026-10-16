import { isJsonObject, safeJsonParse, type JsonPrimitive, type JsonValue } from "../../shared/json"
import type { ClientCommand } from "../../shared/protocol"
import type { ChatSnapshot, SidebarChatRow, SidebarData, SidebarProjectGroup } from "../../shared/types"
import type { TranscriptEntry } from "../../shared/transcript-types"
import { fail, ok, type ToolResult } from "../kanna-mcp-tool"
import type { RemoteMcpHost } from "./remote-mcp-server"

const MAX_SUMMARY_CHARS = 160

export type CommandRunner = Pick<RemoteMcpHost, "dispatchCommand">
export type SnapshotReader = Pick<RemoteMcpHost, "readSnapshot">

export type CommandOutcome = { ok: true; result: JsonValue } | { ok: false; message: string }

export interface ProjectRow {
  projectId: string
  title: string
  localPath: string
  starred: boolean
  chatCount: number
}

export interface ChatRow {
  chatId: string
  projectId: string
  title: string
  status: string
  lastMessageAt: number | null
  unread: boolean
  archived: boolean
}

export interface EntryView {
  kind: string
  role?: "user" | "assistant"
  text?: string
  toolName?: string
  at?: number
}

export interface PendingRequestView {
  kind: "tool_request" | "interactive_tool"
  toolRequestId?: string
  toolUseId?: string
  tool: string
  input: JsonValue
}

export function stringFieldOf(value: JsonValue, key: string): string | undefined {
  if (!isJsonObject(value)) return undefined
  const found = value[key]
  return typeof found === "string" ? found : undefined
}

export function toJson(value: JsonPrimitive | object): JsonValue {
  return safeJsonParse(JSON.stringify(value)) ?? null
}

export function jsonResult(value: JsonPrimitive | object): ToolResult {
  return ok(JSON.stringify(value))
}

export async function runCommand(host: CommandRunner, command: ClientCommand): Promise<CommandOutcome> {
  const envelope = await host.dispatchCommand(command)
  if (envelope.type === "error") return { ok: false, message: envelope.message }
  if (envelope.type === "ack") return { ok: true, result: envelope.result === undefined ? { ok: true } : toJson(envelope.result) }
  if (envelope.type === "snapshot") return { ok: true, result: toJson(envelope.snapshot) }
  return { ok: true, result: toJson(envelope.event) }
}

export async function commandResult(host: CommandRunner, command: ClientCommand): Promise<ToolResult> {
  const outcome = await runCommand(host, command)
  return outcome.ok ? jsonResult(outcome.result) : fail(outcome.message)
}

export function readChat(host: SnapshotReader, chatId: string, recentLimit: number): ChatSnapshot | null {
  const envelope = host.readSnapshot({ type: "chat", chatId, recentLimit })
  return envelope.type === "snapshot" && envelope.snapshot.type === "chat" ? envelope.snapshot.data : null
}

export function readSidebar(host: SnapshotReader): SidebarData | null {
  const envelope = host.readSnapshot({ type: "sidebar" })
  return envelope.type === "snapshot" && envelope.snapshot.type === "sidebar" ? envelope.snapshot.data : null
}

function allGroups(data: SidebarData): SidebarProjectGroup[] {
  return [...data.starredProjectGroups, ...data.projectGroups]
}

function lastPathSegment(localPath: string): string {
  const segments = localPath.split(/[\\/]/).filter((segment) => segment.length > 0)
  return segments.at(-1) ?? localPath
}

export function readProjectTitles(host: SnapshotReader): Map<string, string> {
  const envelope = host.readSnapshot({ type: "local-projects" })
  const titles = new Map<string, string>()
  if (envelope.type !== "snapshot" || envelope.snapshot.type !== "local-projects") return titles
  for (const project of envelope.snapshot.data.projects) titles.set(project.localPath, project.title)
  return titles
}

export function projectRows(data: SidebarData, titles: ReadonlyMap<string, string>): ProjectRow[] {
  return allGroups(data).map((group) => ({
    projectId: group.groupKey,
    title: titles.get(group.localPath) ?? lastPathSegment(group.localPath),
    localPath: group.localPath,
    starred: group.starredAt !== undefined,
    chatCount: group.chats.length,
  }))
}

function chatRow(group: SidebarProjectGroup, chat: SidebarChatRow, archived: boolean): ChatRow {
  return {
    chatId: chat.chatId,
    projectId: group.groupKey,
    title: chat.title,
    status: chat.status,
    lastMessageAt: chat.lastMessageAt ?? null,
    unread: chat.unread,
    archived,
  }
}

export function chatRows(data: SidebarData, filter: { projectId?: string; includeArchived?: boolean }): ChatRow[] {
  const rows: ChatRow[] = []
  for (const group of allGroups(data)) {
    if (filter.projectId !== undefined && group.groupKey !== filter.projectId) continue
    for (const chat of group.chats) rows.push(chatRow(group, chat, false))
    if (!filter.includeArchived) continue
    for (const chat of group.archivedChats ?? []) rows.push(chatRow(group, chat, true))
  }
  return rows
}

export function clipText(text: string, maxChars: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  return oneLine.length > maxChars ? `${oneLine.slice(0, maxChars)}...` : oneLine
}

function clip(text: string): string {
  return clipText(text, MAX_SUMMARY_CHARS)
}

function summarizeToolInput(input: object): string {
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.length > 0) return clip(value)
  }
  return ""
}

function entryView(entry: TranscriptEntry): EntryView | null {
  if (entry.hidden) return null
  const at = entry.createdAt
  switch (entry.kind) {
    case "user_prompt":
      return { kind: entry.kind, role: "user", text: entry.content, at }
    case "assistant_text":
      return { kind: entry.kind, role: "assistant", text: entry.text, at }
    case "tool_call":
      return { kind: entry.kind, toolName: entry.tool.toolName, text: summarizeToolInput(entry.tool.input), at }
    case "result":
      return { kind: entry.kind, text: entry.isError ? `error: ${entry.result}` : entry.result, at }
    case "api_error":
    case "policy_refusal":
      return { kind: entry.kind, text: entry.text, at }
    case "pending_tool_request":
      return { kind: entry.kind, toolName: entry.toolName, text: clip(JSON.stringify(entry.arguments)), at }
    case "tool_request_resolved":
    case "interrupted":
      return { kind: entry.kind, at }
    default:
      return null
  }
}

export function flattenEntries(entries: readonly TranscriptEntry[]): EntryView[] {
  const views: EntryView[] = []
  for (const entry of entries) {
    const view = entryView(entry)
    if (view) views.push(view)
  }
  return views
}

export function pendingToolRequests(entries: readonly TranscriptEntry[]): PendingRequestView[] {
  const resolved = new Set<string>()
  const answeredToolUses = new Set<string>()
  for (const entry of entries) {
    if (entry.kind === "tool_request_resolved") resolved.add(entry.toolRequestId)
    if (entry.kind === "tool_result") answeredToolUses.add(entry.toolId)
  }
  const pending: PendingRequestView[] = []
  for (const entry of entries) {
    if (entry.kind === "pending_tool_request" && !resolved.has(entry.toolRequestId)) {
      pending.push({ kind: "tool_request", toolRequestId: entry.toolRequestId, tool: entry.toolName, input: entry.arguments })
    }
    if (entry.kind !== "tool_call") continue
    const { tool } = entry
    const interactive = tool.toolKind === "ask_user_question" || tool.toolKind === "exit_plan_mode"
    if (interactive && !answeredToolUses.has(tool.toolId)) {
      pending.push({ kind: "interactive_tool", toolUseId: tool.toolId, tool: tool.toolName, input: toJson(tool.input) })
    }
  }
  return pending
}

export function assistantTextAfter(entries: readonly TranscriptEntry[], baseline: number): string {
  return entries
    .filter((entry) => entry.kind === "assistant_text" && !entry.hidden && entry.createdAt > baseline)
    .map((entry) => (entry.kind === "assistant_text" ? entry.text : ""))
    .join("\n\n")
}

export function newestEntryTime(entries: readonly TranscriptEntry[]): number {
  return entries.reduce((newest, entry) => Math.max(newest, entry.createdAt), 0)
}

export function latestModel(entries: readonly TranscriptEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.kind === "system_init") return entry.model
  }
  return undefined
}
