import path from "node:path"
import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../../shared/json"
import type { McpServerConfig } from "../../shared/mcp-types"
import { runDatasetQuery, type DatasetDecl, type DatasetQuery } from "../../shared/genui"
import type { DatasetErrorCode, DatasetQueryOutcome } from "../../shared/genui/protocol"
import { formatForPath, rowsFromJson, rowsFromText, type RowsParse } from "../../shared/genui/rows"
import { contentHash } from "../../shared/genui/hash"
import {
  addCounter,
  GENUI_DATASET_QUERY,
  GENUI_DATASET_QUERY_DURATION_MS,
  GENUI_TOOL_APPROVED,
  recordHistogram,
  withSpan,
} from "../observability"
import { policy } from "../permission-gate"
import type { DatasetFileReader, GenUIDataScope, McpDataClient, McpToolDescriptor } from "./dataset-ports"

export const DATASET_FILE_MAX_BYTES = 20 * 1024 * 1024
const CACHE_MAX_BYTES = 32 * 1024 * 1024
const CACHE_MAX_ENTRIES = 32
const MCP_DEFAULT_TTL_SECONDS = 60
const TOOL_LIST_TTL_MS = 5 * 60_000

export interface GenUIDatasetSources {
  files: DatasetFileReader
  mcp: McpDataClient
  scopeOf(chatId: string): GenUIDataScope | null
  mcpServers(): readonly McpServerConfig[]
  now?(): number
}

interface CachedRows {
  rows: readonly JsonObject[]
  revision: string
  bytes: number
  fetchedAt: number
}

type Loaded =
  | { ok: true; rows: readonly JsonObject[]; revision: string; fetchedAt: number }
  | { ok: false; outcome: DatasetQueryOutcome }

type ToolAccess = "allowed" | "ask" | "missing" | "unavailable"

function failure(code: DatasetErrorCode, message: string): Loaded {
  return { ok: false, outcome: { status: "error", code, message } }
}

export function stableStringify(value: JsonValue): string {
  if (isJsonArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (isJsonObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function rowsFromMcpValue(value: JsonValue, rowsPath: string | undefined): RowsParse {
  if (typeof value !== "string") return rowsFromJson(value, rowsPath)
  const asJson = rowsFromText(value, "json", rowsPath)
  return asJson.ok ? asJson : rowsFromText(value, "csv")
}

export class GenUIDatasetService {
  private readonly cache = new Map<string, CachedRows>()
  private cacheBytes = 0
  private readonly approvals = new Set<string>()
  private readonly toolLists = new Map<string, { at: number; tools: McpToolDescriptor[] }>()

  constructor(private readonly sources: GenUIDatasetSources) {}

  private now(): number {
    return this.sources.now?.() ?? Date.now()
  }

  async query(chatId: string, decl: DatasetDecl, query: DatasetQuery, refresh = false): Promise<DatasetQueryOutcome> {
    const started = this.now()
    return await withSpan("kanna.genui.dataset.query", { "kanna.genui.source": decl.source }, async () => {
      const outcome = await this.run(chatId, decl, query, refresh)
      const result = outcome.status === "error" ? outcome.code : outcome.status
      addCounter(GENUI_DATASET_QUERY, 1, { source: decl.source, result })
      recordHistogram(GENUI_DATASET_QUERY_DURATION_MS, this.now() - started, { source: decl.source })
      return outcome
    })
  }

  approveTool(chatId: string, server: string, tool: string): void {
    this.approvals.add(approvalKey(chatId, server, tool))
    addCounter(GENUI_TOOL_APPROVED, 1)
  }

  async checkResolvable(chatId: string, decl: DatasetDecl): Promise<string | null> {
    if (decl.source === "inline") return null
    if (decl.source === "mcp") {
      const server = this.sources.mcpServers().find((candidate) => candidate.name === decl.server)
      if (!server) return `no MCP server named "${decl.server}" is configured in Kanna's Settings`
      return server.enabled ? null : `the MCP server "${decl.server}" is disabled in Settings`
    }
    const scope = this.sources.scopeOf(chatId)
    if (!scope) return null
    const resolved = await this.sources.files.resolve(scope.cwd, decl.path)
    if (resolved.ok) return null
    return resolved.reason === "outside_root"
      ? `"${decl.path}" resolves outside the chat's working directory`
      : `"${decl.path}" does not exist in ${scope.cwd} — write the file before showing the view`
  }

  private async run(chatId: string, decl: DatasetDecl, query: DatasetQuery, refresh: boolean): Promise<DatasetQueryOutcome> {
    const loaded = await this.load(chatId, decl, refresh)
    if (!loaded.ok) return loaded.outcome
    const outcome = runDatasetQuery(decl, loaded.rows, query)
    if (!outcome.ok) return { status: "error", code: "invalid_query", message: outcome.message }
    return { status: "ok", result: outcome.result, revision: loaded.revision, fetchedAt: loaded.fetchedAt }
  }

  private async load(chatId: string, decl: DatasetDecl, refresh: boolean): Promise<Loaded> {
    switch (decl.source) {
      case "inline":
        return { ok: true, rows: decl.rows, revision: "inline", fetchedAt: 0 }
      case "file":
        return await this.loadFile(chatId, decl)
      case "mcp":
        return await this.loadMcp(chatId, decl, refresh)
    }
  }

  private async loadFile(chatId: string, decl: Extract<DatasetDecl, { source: "file" }>): Promise<Loaded> {
    const scope = this.sources.scopeOf(chatId)
    if (!scope) return failure("not_found", "This chat no longer exists")
    const resolved = await this.sources.files.resolve(scope.cwd, decl.path)
    if (!resolved.ok) {
      return resolved.reason === "outside_root"
        ? failure("unauthorized", `"${decl.path}" is outside the chat's working directory`)
        : failure("not_found", `"${decl.path}" was not found`)
    }
    if (policyDeniesRead(scope, [path.resolve(scope.cwd, decl.path), resolved.absolutePath])) {
      return failure("unauthorized", `The chat's permission policy blocks reading "${decl.path}"`)
    }
    if (resolved.size > DATASET_FILE_MAX_BYTES) return failure("too_large", `"${decl.path}" is larger than ${DATASET_FILE_MAX_BYTES / 1024 / 1024} MB`)

    const key = `file\u0001${resolved.absolutePath}\u0001${decl.format ?? ""}\u0001${decl.rowsPath ?? ""}`
    const cached = this.recall(key)
    if (cached && cached.revision === resolved.revision) return { ok: true, rows: cached.rows, revision: cached.revision, fetchedAt: cached.fetchedAt }

    const text = await this.sources.files.readText(resolved.absolutePath)
    const parsed = rowsFromText(text, formatForPath(decl.path, decl.format), decl.rowsPath)
    if (!parsed.ok) return failure("parse_failed", parsed.message)
    const fetchedAt = this.now()
    this.remember(key, { rows: parsed.rows, revision: resolved.revision, bytes: resolved.size, fetchedAt })
    return { ok: true, rows: parsed.rows, revision: resolved.revision, fetchedAt }
  }

  private async loadMcp(chatId: string, decl: Extract<DatasetDecl, { source: "mcp" }>, refresh: boolean): Promise<Loaded> {
    const server = this.sources.mcpServers().find((candidate) => candidate.name === decl.server)
    if (!server) return failure("not_found", `No MCP server named "${decl.server}" is configured`)
    if (!server.enabled) return failure("source_unavailable", `The MCP server "${decl.server}" is disabled`)

    const access = await this.toolAccess(chatId, server, decl.tool)
    if (access === "missing") return failure("not_found", `The MCP server "${decl.server}" has no tool "${decl.tool}"`)
    if (access === "unavailable") return failure("source_unavailable", `The MCP server "${decl.server}" did not answer`)
    if (access === "ask") {
      return {
        ok: false,
        outcome: {
          status: "needs_approval",
          server: decl.server,
          tool: decl.tool,
          message: `"${decl.tool}" on ${decl.server} does not declare itself read-only. Allow this view to call it in this chat?`,
        },
      }
    }

    const args = decl.arguments ?? {}
    const key = `mcp\u0001${server.id}\u0001${decl.tool}\u0001${stableStringify(args)}\u0001${decl.rowsPath ?? ""}`
    const ttlMs = (decl.refreshSeconds ?? MCP_DEFAULT_TTL_SECONDS) * 1000
    const cached = this.recall(key)
    if (cached && !refresh && this.now() - cached.fetchedAt < ttlMs) {
      return { ok: true, rows: cached.rows, revision: cached.revision, fetchedAt: cached.fetchedAt }
    }

    const result = await this.sources.mcp.callTool(server, decl.tool, args)
    if (!result.ok) return failure("source_unavailable", result.message)
    const parsed = rowsFromMcpValue(result.value, decl.rowsPath)
    if (!parsed.ok) return failure("parse_failed", parsed.message)
    const text = typeof result.value === "string" ? result.value : stableStringify(result.value)
    const fetchedAt = this.now()
    const revision = contentHash(text)
    this.remember(key, { rows: parsed.rows, revision, bytes: text.length, fetchedAt })
    return { ok: true, rows: parsed.rows, revision, fetchedAt }
  }

  private async toolAccess(chatId: string, server: McpServerConfig, tool: string): Promise<ToolAccess> {
    const tools = await this.listTools(server)
    if (!tools) return "unavailable"
    const descriptor = tools.find((candidate) => candidate.name === tool)
    if (!descriptor) return "missing"
    if (descriptor.readOnly || this.approvals.has(approvalKey(chatId, server.name, tool))) return "allowed"
    return "ask"
  }

  private async listTools(server: McpServerConfig): Promise<McpToolDescriptor[] | null> {
    const key = `${server.id}\u0001${server.updatedAt}`
    const cached = this.toolLists.get(key)
    if (cached && this.now() - cached.at < TOOL_LIST_TTL_MS) return cached.tools
    try {
      const tools = await this.sources.mcp.listTools(server)
      this.toolLists.set(key, { at: this.now(), tools })
      return tools
    } catch {
      return null
    }
  }

  private recall(key: string): CachedRows | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry
  }

  private remember(key: string, entry: CachedRows): void {
    const previous = this.cache.get(key)
    if (previous) {
      this.cacheBytes -= previous.bytes
      this.cache.delete(key)
    }
    this.cache.set(key, entry)
    this.cacheBytes += entry.bytes
    for (const [oldestKey, oldest] of this.cache) {
      if (this.cache.size <= 1) break
      if (this.cacheBytes <= CACHE_MAX_BYTES && this.cache.size <= CACHE_MAX_ENTRIES) break
      this.cache.delete(oldestKey)
      this.cacheBytes -= oldest.bytes
    }
  }
}

function policyDeniesRead(scope: GenUIDataScope, candidates: readonly string[]): boolean {
  return candidates.some((candidate) =>
    policy.evaluate({ toolName: "mcp__kanna__read", args: { path: candidate }, chatPolicy: scope.policy, cwd: scope.cwd }).verdict === "auto-deny")
}

function approvalKey(chatId: string, server: string, tool: string): string {
  return `${chatId}\u0001${server}\u0001${tool}`
}
