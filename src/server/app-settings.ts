import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"
import {
  mkdirRecursive,
  readBunFileText,
  readTextFileOrThrow,
  renameFile,
  writeTextFileUtf8,
} from "./app-settings-io.adapter"
import { getSettingsFilePath } from "../shared/branding"
import {
  AUTH_DEFAULTS,
  AUTH_SESSION_MAX_AGE_DAYS_MAX,
  AUTH_SESSION_MAX_AGE_DAYS_MIN,
  CLAUDE_AUTH_DEFAULTS,
  CLAUDE_DRIVER_DEFAULTS,
  CLAUDE_PTY_IDLE_TIMEOUT_MS_MAX,
  CLAUDE_PTY_IDLE_TIMEOUT_MS_MIN,
  CLAUDE_PTY_LIFECYCLE_DEFAULTS,
  CLAUDE_PTY_MAX_CONCURRENT_MAX,
  CLAUDE_PTY_MAX_CONCURRENT_MIN,
  CLOUDFLARE_TUNNEL_DEFAULTS,
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  DEFAULT_OPENROUTER_SDK_MODEL,
  GLOBAL_PROMPT_APPEND_MAX_CHARS,
  isClaudeDriverPreference,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  normalizeClaudeContextWindow,
  normalizeClaudeModelId,
  normalizeCodexModelId,
  OAUTH_TOKEN_CONCURRENCY_DEFAULT,
  OAUTH_TOKEN_LABEL_MAX,
  OAUTH_TOKEN_MAX_CONCURRENT_MAX,
  OAUTH_TOKEN_MAX_CONCURRENT_MIN,
  OAUTH_TOKEN_VALUE_MAX,
  PROVIDERS,
  supportsClaudeMaxReasoningEffort,
  UPLOAD_DEFAULTS,
  UPLOAD_MAX_FILE_SIZE_MB_MAX,
  UPLOAD_MAX_FILE_SIZE_MB_MIN,
  type AgentProvider,
  type AppSettingsPatch,
  type AppSettingsSnapshot,
  type AppThemePreference,
  type AuthSettings,
  type ChatProviderPreferences,
  type ChatSoundId,
  type ChatSoundPreference,
  type ClaudeAuthSettings,
  type ClaudeDriverPreference,
  type ClaudeDriverSettings,
  type ClaudeModelOptions,
  type ClaudePtyLifecycleSettings,
  type CloudflareTunnelSettings,
  type CodexModelOptions,
  type CustomModelEntry,
  type CustomModelInput,
  type CustomModelPatch,
  type TextSnippet,
  type TextSnippetInput,
  type TextSnippetPatch,
  type DefaultProviderPreference,
  type EditorPreset,
  type McpOAuthState,
  type McpServerConfig,
  type McpServerInput,
  type McpServerPatch,
  type McpServerTestResult,
  type McpServerTransport,
  type McpValidationError,
  type OAuthTokenEntry,
  type OAuthTokenStatus,
  type ProviderPreference,
  type Subagent,
  type SubagentContextScope,
  type SubagentInput,
  type SubagentTriggerMode,
  type SubagentPatch,
  type SubagentValidationError,
  type UploadSettings,
} from "../shared/types"

type StatusPatch = Partial<Pick<OAuthTokenEntry,
  "status" | "limitedUntil" | "lastUsedAt" | "lastErrorAt" | "lastErrorMessage"
>>

interface AppSettingsFile {
  analyticsEnabled?: boolean
  analyticsUserId?: string
  browserSettingsMigrated?: boolean
  theme?: string
  chatSoundPreference?: string
  chatSoundId?: string
  terminal?: {
    scrollbackLines?: number
    minColumnWidth?: number
  }
  editor?: {
    preset?: string
    commandTemplate?: string
  }
  defaultProvider?: string
  providerDefaults?: {
    claude?: Partial<ProviderPreference<Partial<ClaudeModelOptions>>> & { effort?: string }
    codex?: Partial<ProviderPreference<Partial<CodexModelOptions>>> & { effort?: string }
    openrouter?: Partial<ProviderPreference<Record<string, never>>>
  }
  cloudflareTunnel?: Record<string, unknown>
  auth?: Record<string, unknown>
  claudeAuth?: Record<string, unknown>
  uploads?: Record<string, unknown>
  subagents?: readonly unknown[]
  customMcpServers?: readonly unknown[]
  customModels?: readonly unknown[]
  textSnippets?: readonly unknown[]
  claudeDriver?: Record<string, unknown>
  globalPromptAppend?: string
  shareDefaultTtlHours?: number
}

function isPlainObject<T>(value: T): value is T & Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isAppSettingsFile<T>(value: T): value is T & AppSettingsFile {
  return isPlainObject(value)
}

function isErrnoException<T>(error: T): error is T & NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function isMcpOAuthState<T>(value: T): value is T & McpOAuthState {
  return isPlainObject(value)
}

function isMcpTransport<T>(value: T): value is T & McpServerTransport {
  return value === "stdio" || value === "http" || value === "sse" || value === "ws"
}

interface AppSettingsState extends AppSettingsSnapshot {
  analyticsUserId: string
}

interface NormalizedAppSettings {
  payload: AppSettingsState
  warning: string | null
  shouldWrite: boolean
}

const DEFAULT_SHARE_DEFAULT_TTL_HOURS = 24
const DEFAULT_TERMINAL_SCROLLBACK = 1_000
const MIN_TERMINAL_SCROLLBACK = 500
const MAX_TERMINAL_SCROLLBACK = 5_000
const DEFAULT_TERMINAL_MIN_COLUMN_WIDTH = 450
const MIN_TERMINAL_MIN_COLUMN_WIDTH = 250
const MAX_TERMINAL_MIN_COLUMN_WIDTH = 900
const DEFAULT_EDITOR_PRESET: EditorPreset = "cursor"
const DEFAULT_CHAT_SOUND_PREFERENCE: ChatSoundPreference = "always"
const DEFAULT_CHAT_SOUND_ID: ChatSoundId = "funk"
const SUBAGENT_NAME_REGEX = /^[a-z0-9_-]+$/
const SUBAGENT_RESERVED_NAMES = new Set(["agent", "agents"])
const SUBAGENT_NAME_MAX = 64
const MCP_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/
const MCP_RESERVED_NAMES = new Set(["kanna"])
const MODEL_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const MODEL_LABEL_MAX = 64
const SNIPPET_SHORTCUT_REGEX = /^\S{1,32}$/
const SNIPPET_EXPANSION_MAX = 4_000

class SubagentValidationException extends Error {
  constructor(readonly validationError: SubagentValidationError) {
    super(validationError.message)
    this.name = "SubagentValidationException"
  }
}

class McpValidationException extends Error {
  constructor(readonly validationError: McpValidationError) {
    super(validationError.message)
    this.name = "McpValidationException"
  }
}

async function atomicWriteJson(filePath: string, content: string) {
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeTextFileUtf8(tmpPath, content)
  await renameFile(tmpPath, filePath)
}

function formatDisplayPath(filePath: string) {
  const homePath = homedir()
  if (filePath === homePath) return "~"
  if (filePath.startsWith(`${homePath}${path.sep}`)) {
    return `~${filePath.slice(homePath.length)}`
  }
  return filePath
}

function createAnalyticsUserId() {
  return `anon_${randomUUID()}`
}

function getDefaultEditorCommandTemplate(preset: EditorPreset) {
  switch (preset) {
    case "vscode":
      return "code {path}"
    case "xcode":
      return "xed {path}"
    case "windsurf":
      return "windsurf {path}"
    case "custom":
    case "cursor":
    default:
      return "cursor {path}"
  }
}

function createDefaultProviderDefaults(): ChatProviderPreferences {
  return {
    claude: {
      model: "claude-opus-4-7",
      modelOptions: { ...DEFAULT_CLAUDE_MODEL_OPTIONS },
      planMode: false,
    },
    codex: {
      model: "gpt-5.5",
      modelOptions: { ...DEFAULT_CODEX_MODEL_OPTIONS },
      planMode: false,
    },
    openrouter: {
      model: DEFAULT_OPENROUTER_SDK_MODEL,
      modelOptions: {},
      planMode: false,
    },
  }
}

function clampNumber<T>(value: T, fallback: number, min: number, max: number) {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, Math.round(numberValue)))
}

function normalizeTheme<T>(value: T): AppThemePreference {
  if (value === "light") return "light"
  if (value === "dark") return "dark"
  if (value === "system") return "system"
  return "system"
}

function normalizeChatSoundPreference<T>(value: T): ChatSoundPreference {
  if (value === "never") return "never"
  if (value === "unfocused") return "unfocused"
  if (value === "always") return "always"
  return DEFAULT_CHAT_SOUND_PREFERENCE
}

function normalizeChatSoundId<T>(value: T): ChatSoundId {
  switch (value) {
    case "blow": return "blow"
    case "bottle": return "bottle"
    case "frog": return "frog"
    case "funk": return "funk"
    case "glass": return "glass"
    case "ping": return "ping"
    case "pop": return "pop"
    case "purr": return "purr"
    case "tink": return "tink"
    default:
      return DEFAULT_CHAT_SOUND_ID
  }
}

function normalizeDefaultProvider<T>(value: T): DefaultProviderPreference {
  if (value === "claude") return "claude"
  if (value === "codex") return "codex"
  if (value === "last_used") return "last_used"
  return "last_used"
}

function normalizeEditorPreset<T>(value: T): EditorPreset {
  if (value === "vscode") return "vscode"
  if (value === "xcode") return "xcode"
  if (value === "windsurf") return "windsurf"
  if (value === "custom") return "custom"
  if (value === "cursor") return "cursor"
  return DEFAULT_EDITOR_PRESET
}

function normalizeEditorCommandTemplate<T>(value: T, preset: EditorPreset) {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed || getDefaultEditorCommandTemplate(preset)
}

function normalizeClaudePreference(value?: {
  model?: string
  effort?: string
  modelOptions?: Partial<Record<keyof ClaudeModelOptions, unknown>>
  planMode?: boolean
}, customModels?: readonly CustomModelEntry[]): ProviderPreference<ClaudeModelOptions> {
  const model = normalizeClaudeModelId(typeof value?.model === "string" ? value.model : undefined, undefined, customModels)
  const rawEffort = value?.modelOptions?.reasoningEffort
  const effortStr = typeof rawEffort === "string" ? rawEffort : undefined
  const rawLegacyEffort = value?.effort
  const legacyEffortStr = typeof rawLegacyEffort === "string" ? rawLegacyEffort : undefined
  let normalizedEffort: ClaudeModelOptions["reasoningEffort"]
  if (isClaudeReasoningEffort(effortStr)) {
    normalizedEffort = effortStr
  } else if (isClaudeReasoningEffort(legacyEffortStr)) {
    normalizedEffort = legacyEffortStr
  } else {
    normalizedEffort = DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort
  }

  return {
    model,
    modelOptions: {
      reasoningEffort: !supportsClaudeMaxReasoningEffort(model, customModels) && normalizedEffort === "max" ? "high" : normalizedEffort,
      contextWindow: normalizeClaudeContextWindow(model, typeof value?.modelOptions?.contextWindow === "string" ? value.modelOptions.contextWindow : undefined, customModels),
    },
    planMode: value?.planMode === true,
  }
}

function normalizeCodexPreference(value?: {
  model?: string
  effort?: string
  modelOptions?: Partial<Record<keyof CodexModelOptions, unknown>>
  planMode?: boolean
}, customModels?: readonly CustomModelEntry[]): ProviderPreference<CodexModelOptions> {
  const rawCodexEffort = value?.modelOptions?.reasoningEffort
  const codexEffortStr = typeof rawCodexEffort === "string" ? rawCodexEffort : undefined
  const rawCodexLegacyEffort = value?.effort
  const codexLegacyEffortStr = typeof rawCodexLegacyEffort === "string" ? rawCodexLegacyEffort : undefined
  let normalizedCodexEffort: CodexModelOptions["reasoningEffort"]
  if (isCodexReasoningEffort(codexEffortStr)) {
    normalizedCodexEffort = codexEffortStr
  } else if (isCodexReasoningEffort(codexLegacyEffortStr)) {
    normalizedCodexEffort = codexLegacyEffortStr
  } else {
    normalizedCodexEffort = DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort
  }
  return {
    model: normalizeCodexModelId(typeof value?.model === "string" ? value.model : undefined, undefined, customModels),
    modelOptions: {
      reasoningEffort: normalizedCodexEffort,
      fastMode: typeof value?.modelOptions?.fastMode === "boolean"
        ? value.modelOptions.fastMode
        : DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
    },
    planMode: value?.planMode === true,
  }
}

function normalizeProviderDefaults(
  value: AppSettingsFile["providerDefaults"] | undefined,
  customModels?: readonly CustomModelEntry[],
): ChatProviderPreferences {
  const defaults = createDefaultProviderDefaults()
  return {
    claude: normalizeClaudePreference(value?.claude ?? defaults.claude, customModels),
    codex: normalizeCodexPreference(value?.codex ?? defaults.codex, customModels),
    openrouter: {
      model: value?.openrouter?.model ?? DEFAULT_OPENROUTER_SDK_MODEL,
      modelOptions: {},
      planMode: Boolean(value?.openrouter?.planMode),
    },
  }
}

function normalizeCloudflareTunnel<T>(value: T, warnings: string[]): CloudflareTunnelSettings {
  const tunnelSource = isPlainObject(value) ? value : null
  if (value !== undefined && !tunnelSource) {
    warnings.push("cloudflareTunnel must be an object")
  }

  const enabled = typeof tunnelSource?.enabled === "boolean"
    ? tunnelSource.enabled
    : CLOUDFLARE_TUNNEL_DEFAULTS.enabled
  if (tunnelSource?.enabled !== undefined && typeof tunnelSource.enabled !== "boolean") {
    warnings.push("cloudflareTunnel.enabled must be a boolean")
  }

  const cloudflaredPath = typeof tunnelSource?.cloudflaredPath === "string" && tunnelSource.cloudflaredPath.trim()
    ? tunnelSource.cloudflaredPath.trim()
    : CLOUDFLARE_TUNNEL_DEFAULTS.cloudflaredPath
  if (tunnelSource?.cloudflaredPath !== undefined && typeof tunnelSource.cloudflaredPath !== "string") {
    warnings.push("cloudflareTunnel.cloudflaredPath must be a string")
  }

  const rawMode = tunnelSource?.mode
  const mode: CloudflareTunnelSettings["mode"] =
    rawMode === "always-ask" || rawMode === "auto-expose"
      ? rawMode
      : CLOUDFLARE_TUNNEL_DEFAULTS.mode
  if (tunnelSource?.mode !== undefined && rawMode !== "always-ask" && rawMode !== "auto-expose") {
    warnings.push(`cloudflareTunnel.mode must be "always-ask" or "auto-expose"`)
  }

  return { enabled, cloudflaredPath, mode }
}

function normalizeAuthSettings<T>(value: T, warnings: string[]): AuthSettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("auth must be an object")
  }

  const rawMaxAge = source?.sessionMaxAgeDays
  let sessionMaxAgeDays = AUTH_DEFAULTS.sessionMaxAgeDays
  if (rawMaxAge !== undefined) {
    if (typeof rawMaxAge !== "number" || !Number.isFinite(rawMaxAge)) {
      warnings.push("auth.sessionMaxAgeDays must be a number")
    } else if (rawMaxAge < AUTH_SESSION_MAX_AGE_DAYS_MIN || rawMaxAge > AUTH_SESSION_MAX_AGE_DAYS_MAX) {
      warnings.push(`auth.sessionMaxAgeDays must be between ${AUTH_SESSION_MAX_AGE_DAYS_MIN} and ${AUTH_SESSION_MAX_AGE_DAYS_MAX}`)
      sessionMaxAgeDays = clampNumber(rawMaxAge, AUTH_DEFAULTS.sessionMaxAgeDays, AUTH_SESSION_MAX_AGE_DAYS_MIN, AUTH_SESSION_MAX_AGE_DAYS_MAX)
    } else {
      sessionMaxAgeDays = Math.round(rawMaxAge)
    }
  }

  return { sessionMaxAgeDays }
}

function normalizeUploadSettings<T>(value: T, warnings: string[]): UploadSettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("uploads must be an object")
  }

  const rawSize = source?.maxFileSizeMb
  let maxFileSizeMb = UPLOAD_DEFAULTS.maxFileSizeMb
  if (rawSize !== undefined) {
    if (typeof rawSize !== "number" || !Number.isFinite(rawSize)) {
      warnings.push("uploads.maxFileSizeMb must be a number")
    } else if (rawSize < UPLOAD_MAX_FILE_SIZE_MB_MIN || rawSize > UPLOAD_MAX_FILE_SIZE_MB_MAX) {
      warnings.push(`uploads.maxFileSizeMb must be between ${UPLOAD_MAX_FILE_SIZE_MB_MIN} and ${UPLOAD_MAX_FILE_SIZE_MB_MAX}`)
      maxFileSizeMb = clampNumber(rawSize, UPLOAD_DEFAULTS.maxFileSizeMb, UPLOAD_MAX_FILE_SIZE_MB_MIN, UPLOAD_MAX_FILE_SIZE_MB_MAX)
    } else {
      maxFileSizeMb = Math.round(rawSize)
    }
  }

  return { maxFileSizeMb }
}

function validateSubagentRestriction(
  provider: AgentProvider,
  workingDir: string | undefined,
  allowedPaths: string[] | undefined,
): SubagentValidationError | null {
  const hasRestriction = workingDir !== undefined || allowedPaths !== undefined
  if (!hasRestriction) return null
  if (provider === "codex") {
    return {
      code: "RESTRICTION_NOT_SUPPORTED",
      message: "workingDir / allowedPaths are not supported for codex subagents",
    }
  }
  const validateRelativePath = (raw: string, field: string): SubagentValidationError | null => {
    const trimmed = raw.trim()
    if (!trimmed) {
      return { code: "INVALID_PATH", message: `${field} must not be empty` }
    }
    if (trimmed.startsWith("/") || trimmed.startsWith("~")) {
      return { code: "INVALID_PATH", message: `${field} '${trimmed}' must be relative to parent cwd` }
    }
    const segments = trimmed.split(/[/\\]/)
    if (segments.includes("..")) {
      return { code: "PATH_ESCAPE", message: `${field} '${trimmed}' must not contain '..'` }
    }
    return null
  }
  if (workingDir !== undefined) {
    const err = validateRelativePath(workingDir, "workingDir")
    if (err) return err
  }
  if (allowedPaths !== undefined) {
    if (allowedPaths.length === 0) {
      return { code: "EMPTY_ALLOWED_PATHS", message: "allowedPaths must be non-empty when set" }
    }
    for (const p of allowedPaths) {
      const err = validateRelativePath(p, "allowedPaths entry")
      if (err) return err
    }
  }
  return null
}

function validateSubagentName(
  rawName: string,
  existingIds: { id: string; name: string }[],
  ignoreId?: string,
): SubagentValidationError | null {
  const name = rawName.trim()
  if (!name) return { code: "EMPTY_NAME", message: "Name is required" }
  if (name.length > SUBAGENT_NAME_MAX) {
    return { code: "TOO_LONG", message: `Name must be <= ${SUBAGENT_NAME_MAX} chars` }
  }
  if (name.startsWith(".") || name.includes("/")) {
    return { code: "INVALID_CHAR", message: "Name cannot contain '/' or start with '.'" }
  }
  if (SUBAGENT_RESERVED_NAMES.has(name.toLowerCase())) {
    return { code: "RESERVED_NAME", message: `'${name}' is reserved` }
  }
  const lower = name.toLowerCase()
  for (const existing of existingIds) {
    if (existing.id === ignoreId) continue
    if (existing.name.toLowerCase() === lower) {
      return { code: "DUPLICATE_NAME", message: `Name '${name}' already in use` }
    }
  }
  if (!SUBAGENT_NAME_REGEX.test(name)) {
    return { code: "INVALID_CHAR", message: "Name must match [a-z0-9_-]+" }
  }
  return null
}

function normalizeSubagentEntry<T>(
  value: T,
  warnings: string[],
  customModels?: readonly CustomModelEntry[],
): Subagent | null {
  const source = isPlainObject(value) ? value : null
  if (!source) return null
  if (typeof source.id !== "string" || !source.id.trim()) return null
  if (typeof source.name !== "string") return null
  const provider = source.provider === "claude" || source.provider === "codex" ? source.provider : null
  if (!provider) {
    warnings.push(`Subagent '${source.id}' has invalid provider; dropped`)
    return null
  }
  const rawModelOptions = isPlainObject(source.modelOptions) ? source.modelOptions : {}
  const model = provider === "claude"
    ? normalizeClaudeModelId(typeof source.model === "string" ? source.model : undefined, undefined, customModels)
    : normalizeCodexModelId(typeof source.model === "string" ? source.model : undefined, undefined, customModels)
  const modelOptions = provider === "claude"
    ? normalizeClaudePreference({ model, modelOptions: rawModelOptions }, customModels).modelOptions
    : normalizeCodexPreference({ model, modelOptions: rawModelOptions }, customModels).modelOptions
  const contextScope: SubagentContextScope =
    source.contextScope === "full-transcript" ? "full-transcript" : "previous-assistant-reply"
  const triggerMode: SubagentTriggerMode =
    source.triggerMode === "manual" ? "manual" : "auto"
  const workingDir = typeof source.workingDir === "string" && source.workingDir.length > 0 ? source.workingDir : undefined
  const allowedPaths = Array.isArray(source.allowedPaths)
    ? source.allowedPaths.filter((p): p is string => typeof p === "string" && p.length > 0)
    : undefined
  return {
    id: source.id.trim(),
    name: source.name.trim(),
    description: typeof source.description === "string" ? source.description : undefined,
    provider,
    model,
    modelOptions,
    systemPrompt: typeof source.systemPrompt === "string" ? source.systemPrompt : "",
    contextScope,
    triggerMode,
    workingDir,
    allowedPaths: allowedPaths && allowedPaths.length > 0 ? allowedPaths : undefined,
    createdAt: typeof source.createdAt === "number" && Number.isFinite(source.createdAt) ? source.createdAt : Date.now(),
    updatedAt: typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now(),
  }
}

function normalizeSubagents<T>(
  value: T,
  warnings: string[],
  customModels?: readonly CustomModelEntry[],
): Subagent[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    warnings.push("subagents must be an array")
    return []
  }
  const out: Subagent[] = []
  for (const entry of value) {
    const normalized = normalizeSubagentEntry(entry, warnings, customModels)
    if (!normalized) continue
    const error = validateSubagentName(normalized.name, out.map((s) => ({ id: s.id, name: s.name })))
    if (error) {
      warnings.push(`Subagent '${normalized.id}' rejected: ${error.message}`)
      continue
    }
    out.push(normalized)
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

function normalizeStringMap<T>(value: T): Record<string, string> {
  const obj = isPlainObject(value) ? value : null
  if (!obj) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof k !== "string" || k.length === 0) continue
    out[k] = typeof v === "string" ? v : String(v ?? "")
  }
  return out
}

function normalizeMcpTestResult<T>(value: T): McpServerTestResult {
  const v = isPlainObject(value) ? value : null
  if (!v) return { status: "untested" as const }
  switch (v.status) {
    case "pending":
      return { status: "pending", startedAt: typeof v.startedAt === "string" ? v.startedAt : new Date().toISOString() }
    case "ok":
      return {
        status: "ok",
        testedAt: typeof v.testedAt === "string" ? v.testedAt : new Date().toISOString(),
        toolCount: typeof v.toolCount === "number" ? v.toolCount : 0,
      }
    case "error":
      return {
        status: "error",
        testedAt: typeof v.testedAt === "string" ? v.testedAt : new Date().toISOString(),
        message: typeof v.message === "string" ? v.message : "unknown error",
      }
    default:
      return { status: "untested" }
  }
}

function normalizeMcpEntry<T>(value: T, warnings: string[]): McpServerConfig | null {
  const src = isPlainObject(value) ? value : null
  if (!src) return null
  const id = typeof src.id === "string" && src.id.length > 0 ? src.id : null
  const name = typeof src.name === "string" ? src.name : null
  const transport = src.transport
  if (!id || !name || typeof transport !== "string") {
    warnings.push(`MCP entry rejected: missing id/name/transport`)
    return null
  }
  if (!isMcpTransport(transport)) {
    warnings.push(`MCP entry '${id}' rejected: unknown transport ${transport}`)
    return null
  }
  const base = {
    id,
    name,
    enabled: src.enabled !== false,
    createdAt: typeof src.createdAt === "string" ? src.createdAt : new Date().toISOString(),
    updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : new Date().toISOString(),
    lastTest: normalizeMcpTestResult(src.lastTest),
  }
  if (transport === "stdio") {
    const command = typeof src.command === "string" && src.command.trim().length > 0 ? src.command : null
    if (!command) {
      warnings.push(`MCP entry '${id}' rejected: stdio command missing`)
      return null
    }
    const args = Array.isArray(src.args) ? src.args.filter((a): a is string => typeof a === "string") : []
    return {
      ...base,
      transport: "stdio",
      command,
      args,
      env: normalizeStringMap(src.env),
      cwd: typeof src.cwd === "string" && src.cwd.length > 0 ? src.cwd : undefined,
    }
  }
  const url = typeof src.url === "string" ? src.url : null
  if (!url) {
    warnings.push(`MCP entry '${id}' rejected: url missing`)
    return null
  }
  return {
    ...base,
    transport,
    url,
    headers: normalizeStringMap(src.headers),
    ...(isMcpOAuthState(src.oauth) ? { oauth: src.oauth } : {}),
  }
}

function normalizeMcpServers<T>(value: T, warnings: string[]): McpServerConfig[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    warnings.push("customMcpServers must be an array")
    return []
  }
  const out: McpServerConfig[] = []
  const seenNames = new Set<string>()
  for (const entry of value) {
    const normalized = normalizeMcpEntry(entry, warnings)
    if (!normalized) continue
    if (seenNames.has(normalized.name)) {
      warnings.push(`MCP entry '${normalized.id}' rejected: duplicate name '${normalized.name}'`)
      continue
    }
    seenNames.add(normalized.name)
    out.push(normalized)
  }
  return out
}

function normalizeOAuthTokenStatus<T>(value: T): OAuthTokenStatus {
  if (value === "limited") return "limited"
  if (value === "error") return "error"
  if (value === "disabled") return "disabled"
  return "active"
}

function normalizeTokenEntry<T>(value: T, warnings: string[]): OAuthTokenEntry | null {
  const src = isPlainObject(value) ? value : null
  if (!src) return null
  const id = typeof src.id === "string" && src.id.trim() ? src.id.trim() : null
  const token = typeof src.token === "string" ? src.token : ""
  if (!id || !token) {
    warnings.push("claudeAuth.tokens entry missing id or token")
    return null
  }
  const label = typeof src.label === "string" && src.label.trim()
    ? src.label.trim().slice(0, OAUTH_TOKEN_LABEL_MAX)
    : id
  let maxConcurrent: number | undefined
  if (src.maxConcurrent !== undefined) {
    if (typeof src.maxConcurrent !== "number" || !Number.isFinite(src.maxConcurrent)) {
      warnings.push("claudeAuth.tokens entry maxConcurrent must be a number")
    } else if (
      src.maxConcurrent < OAUTH_TOKEN_MAX_CONCURRENT_MIN
      || src.maxConcurrent > OAUTH_TOKEN_MAX_CONCURRENT_MAX
    ) {
      warnings.push(
        `claudeAuth.tokens entry maxConcurrent must be between ${OAUTH_TOKEN_MAX_CONCURRENT_MIN} and ${OAUTH_TOKEN_MAX_CONCURRENT_MAX}`,
      )
      maxConcurrent = clampNumber(
        src.maxConcurrent,
        OAUTH_TOKEN_CONCURRENCY_DEFAULT,
        OAUTH_TOKEN_MAX_CONCURRENT_MIN,
        OAUTH_TOKEN_MAX_CONCURRENT_MAX,
      )
    } else {
      maxConcurrent = Math.round(src.maxConcurrent)
    }
  }
  return {
    id,
    label,
    token: token.slice(0, OAUTH_TOKEN_VALUE_MAX),
    status: normalizeOAuthTokenStatus(src.status),
    limitedUntil: typeof src.limitedUntil === "number" && Number.isFinite(src.limitedUntil) ? src.limitedUntil : null,
    lastUsedAt: typeof src.lastUsedAt === "number" && Number.isFinite(src.lastUsedAt) ? src.lastUsedAt : null,
    lastErrorAt: typeof src.lastErrorAt === "number" && Number.isFinite(src.lastErrorAt) ? src.lastErrorAt : null,
    lastErrorMessage: typeof src.lastErrorMessage === "string" ? src.lastErrorMessage : null,
    addedAt: typeof src.addedAt === "number" && Number.isFinite(src.addedAt) ? src.addedAt : Date.now(),
    ...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
  }
}

function normalizeClaudePtyLifecycle<T>(value: T, warnings: string[]): ClaudePtyLifecycleSettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("claudeDriver.lifecycle must be an object")
  }
  const idleRaw = source?.idleTimeoutMs
  let idleTimeoutMs = CLAUDE_PTY_LIFECYCLE_DEFAULTS.idleTimeoutMs
  if (idleRaw !== undefined) {
    if (typeof idleRaw !== "number" || !Number.isFinite(idleRaw)) {
      warnings.push("claudeDriver.lifecycle.idleTimeoutMs must be a number")
    } else if (idleRaw < CLAUDE_PTY_IDLE_TIMEOUT_MS_MIN || idleRaw > CLAUDE_PTY_IDLE_TIMEOUT_MS_MAX) {
      warnings.push(
        `claudeDriver.lifecycle.idleTimeoutMs must be between ${CLAUDE_PTY_IDLE_TIMEOUT_MS_MIN} and ${CLAUDE_PTY_IDLE_TIMEOUT_MS_MAX}`,
      )
      idleTimeoutMs = clampNumber(idleRaw, CLAUDE_PTY_LIFECYCLE_DEFAULTS.idleTimeoutMs, CLAUDE_PTY_IDLE_TIMEOUT_MS_MIN, CLAUDE_PTY_IDLE_TIMEOUT_MS_MAX)
    } else {
      idleTimeoutMs = Math.round(idleRaw)
    }
  }
  const maxRaw = source?.maxConcurrent
  let maxConcurrent = CLAUDE_PTY_LIFECYCLE_DEFAULTS.maxConcurrent
  if (maxRaw !== undefined) {
    if (typeof maxRaw !== "number" || !Number.isFinite(maxRaw)) {
      warnings.push("claudeDriver.lifecycle.maxConcurrent must be a number")
    } else if (maxRaw < CLAUDE_PTY_MAX_CONCURRENT_MIN || maxRaw > CLAUDE_PTY_MAX_CONCURRENT_MAX) {
      warnings.push(
        `claudeDriver.lifecycle.maxConcurrent must be between ${CLAUDE_PTY_MAX_CONCURRENT_MIN} and ${CLAUDE_PTY_MAX_CONCURRENT_MAX}`,
      )
      maxConcurrent = clampNumber(maxRaw, CLAUDE_PTY_LIFECYCLE_DEFAULTS.maxConcurrent, CLAUDE_PTY_MAX_CONCURRENT_MIN, CLAUDE_PTY_MAX_CONCURRENT_MAX)
    } else {
      maxConcurrent = Math.round(maxRaw)
    }
  }
  return { idleTimeoutMs, maxConcurrent }
}

function normalizeClaudeDriverSettings<T>(value: T, warnings: string[]): ClaudeDriverSettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("claudeDriver must be an object")
    return {
      ...CLAUDE_DRIVER_DEFAULTS,
      lifecycle: { ...CLAUDE_PTY_LIFECYCLE_DEFAULTS },
    }
  }
  const rawPref = typeof source?.preference === "string" ? source.preference : undefined
  const preference: ClaudeDriverPreference = isClaudeDriverPreference(rawPref)
    ? rawPref
    : CLAUDE_DRIVER_DEFAULTS.preference
  if (source?.preference !== undefined && !isClaudeDriverPreference(rawPref)) {
    warnings.push(`claudeDriver.preference must be "sdk" or "pty"`)
  }
  const lifecycle = normalizeClaudePtyLifecycle(source?.lifecycle, warnings)
  return { preference, lifecycle }
}

function normalizeGlobalPromptAppend<T>(value: T, warnings: string[]): string {
  if (value === undefined || value === null) return ""
  if (typeof value !== "string") {
    warnings.push("globalPromptAppend must be a string")
    return ""
  }
  const trimmed = value.replace(/\s+$/u, "")
  if (trimmed.length > GLOBAL_PROMPT_APPEND_MAX_CHARS) {
    warnings.push(`globalPromptAppend must be ${GLOBAL_PROMPT_APPEND_MAX_CHARS} chars or fewer`)
    return trimmed.slice(0, GLOBAL_PROMPT_APPEND_MAX_CHARS)
  }
  return trimmed
}

function normalizeClaudeAuth<T>(value: T, warnings: string[]): ClaudeAuthSettings {
  if (value === undefined) return { ...CLAUDE_AUTH_DEFAULTS }
  const src = isPlainObject(value) ? value : null
  if (!src) {
    warnings.push("claudeAuth must be an object")
    return { ...CLAUDE_AUTH_DEFAULTS }
  }
  if (src.tokens !== undefined && !Array.isArray(src.tokens)) {
    warnings.push("claudeAuth.tokens must be an array")
    return { ...CLAUDE_AUTH_DEFAULTS }
  }
  const tokens: OAuthTokenEntry[] = []
  for (const raw of (Array.isArray(src.tokens) ? src.tokens : [])) {
    const entry = normalizeTokenEntry(raw, warnings)
    if (entry) tokens.push(entry)
  }
  let concurrencyDefault = OAUTH_TOKEN_CONCURRENCY_DEFAULT
  if (src.concurrencyDefault !== undefined) {
    if (typeof src.concurrencyDefault !== "number" || !Number.isFinite(src.concurrencyDefault)) {
      warnings.push("claudeAuth.concurrencyDefault must be a number")
    } else if (
      src.concurrencyDefault < OAUTH_TOKEN_MAX_CONCURRENT_MIN
      || src.concurrencyDefault > OAUTH_TOKEN_MAX_CONCURRENT_MAX
    ) {
      warnings.push(
        `claudeAuth.concurrencyDefault must be between ${OAUTH_TOKEN_MAX_CONCURRENT_MIN} and ${OAUTH_TOKEN_MAX_CONCURRENT_MAX}`,
      )
      concurrencyDefault = clampNumber(
        src.concurrencyDefault,
        OAUTH_TOKEN_CONCURRENCY_DEFAULT,
        OAUTH_TOKEN_MAX_CONCURRENT_MIN,
        OAUTH_TOKEN_MAX_CONCURRENT_MAX,
      )
    } else {
      concurrencyDefault = Math.round(src.concurrencyDefault)
    }
  }
  return { tokens, concurrencyDefault }
}

function toFilePayload(state: AppSettingsState) {
  return {
    analyticsEnabled: state.analyticsEnabled,
    analyticsUserId: state.analyticsUserId,
    browserSettingsMigrated: state.browserSettingsMigrated,
    theme: state.theme,
    chatSoundPreference: state.chatSoundPreference,
    chatSoundId: state.chatSoundId,
    terminal: state.terminal,
    editor: state.editor,
    defaultProvider: state.defaultProvider,
    providerDefaults: state.providerDefaults,
    cloudflareTunnel: state.cloudflareTunnel,
    auth: state.auth,
    claudeAuth: state.claudeAuth,
    uploads: state.uploads,
    subagents: state.subagents,
    customMcpServers: state.customMcpServers,
    customModels: state.customModels,
    textSnippets: state.textSnippets,
    claudeDriver: state.claudeDriver,
    globalPromptAppend: state.globalPromptAppend,
    shareDefaultTtlHours: state.shareDefaultTtlHours,
  }
}

function toSnapshot(state: AppSettingsState): AppSettingsSnapshot {
  return {
    analyticsEnabled: state.analyticsEnabled,
    browserSettingsMigrated: state.browserSettingsMigrated,
    theme: state.theme,
    chatSoundPreference: state.chatSoundPreference,
    chatSoundId: state.chatSoundId,
    terminal: state.terminal,
    editor: state.editor,
    defaultProvider: state.defaultProvider,
    providerDefaults: state.providerDefaults,
    warning: state.warning,
    filePathDisplay: state.filePathDisplay,
    cloudflareTunnel: state.cloudflareTunnel,
    auth: state.auth,
    claudeAuth: state.claudeAuth,
    uploads: state.uploads,
    subagents: state.subagents,
    customMcpServers: state.customMcpServers,
    customModels: state.customModels,
    textSnippets: state.textSnippets,
    claudeDriver: state.claudeDriver,
    globalPromptAppend: state.globalPromptAppend,
    shareDefaultTtlHours: state.shareDefaultTtlHours,
  }
}

function normalizeAppSettings<T>(
  value: T,
  filePath = getSettingsFilePath(homedir())
): NormalizedAppSettings {
  const source = isAppSettingsFile(value) ? value : null
  const warnings: string[] = []

  if (value !== undefined && value !== null && !source) {
    warnings.push("Settings file must contain a JSON object")
  }

  const analyticsEnabled = typeof source?.analyticsEnabled === "boolean" ? source.analyticsEnabled : true
  if (source?.analyticsEnabled !== undefined && typeof source.analyticsEnabled !== "boolean") {
    warnings.push("analyticsEnabled must be a boolean")
  }

  const rawAnalyticsUserId = typeof source?.analyticsUserId === "string" ? source.analyticsUserId.trim() : ""
  if (source?.analyticsUserId !== undefined && typeof source.analyticsUserId !== "string") {
    warnings.push("analyticsUserId must be a string")
  }
  const analyticsUserId = rawAnalyticsUserId || createAnalyticsUserId()
  if (!rawAnalyticsUserId && source?.analyticsUserId !== undefined) {
    warnings.push("analyticsUserId must be a non-empty string")
  }

  const cloudflareTunnel = normalizeCloudflareTunnel(source?.cloudflareTunnel, warnings)
  const auth = normalizeAuthSettings(source?.auth, warnings)
  const claudeAuth = normalizeClaudeAuth(source?.claudeAuth, warnings)
  const uploads = normalizeUploadSettings(source?.uploads, warnings)
  const customModels = normalizeCustomModels(source?.customModels, warnings)
  const textSnippets = normalizeTextSnippets(source?.textSnippets, warnings)
  const subagents = normalizeSubagents(source?.subagents, warnings, customModels)
  const claudeDriver = normalizeClaudeDriverSettings(source?.claudeDriver, warnings)
  const globalPromptAppend = normalizeGlobalPromptAppend(source?.globalPromptAppend, warnings)

  let shareDefaultTtlHours = DEFAULT_SHARE_DEFAULT_TTL_HOURS
  if (source?.shareDefaultTtlHours !== undefined) {
    const raw = source.shareDefaultTtlHours
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
      warnings.push("shareDefaultTtlHours must be a positive integer")
    } else {
      shareDefaultTtlHours = raw
    }
  }

  const editorPreset = normalizeEditorPreset(source?.editor?.preset)
  const state: AppSettingsState = {
    analyticsEnabled,
    analyticsUserId,
    browserSettingsMigrated: source?.browserSettingsMigrated === true,
    theme: normalizeTheme(source?.theme),
    chatSoundPreference: normalizeChatSoundPreference(source?.chatSoundPreference),
    chatSoundId: normalizeChatSoundId(source?.chatSoundId),
    terminal: {
      scrollbackLines: clampNumber(source?.terminal?.scrollbackLines, DEFAULT_TERMINAL_SCROLLBACK, MIN_TERMINAL_SCROLLBACK, MAX_TERMINAL_SCROLLBACK),
      minColumnWidth: clampNumber(source?.terminal?.minColumnWidth, DEFAULT_TERMINAL_MIN_COLUMN_WIDTH, MIN_TERMINAL_MIN_COLUMN_WIDTH, MAX_TERMINAL_MIN_COLUMN_WIDTH),
    },
    editor: {
      preset: editorPreset,
      commandTemplate: normalizeEditorCommandTemplate(source?.editor?.commandTemplate, editorPreset),
    },
    defaultProvider: normalizeDefaultProvider(source?.defaultProvider),
    providerDefaults: normalizeProviderDefaults(source?.providerDefaults, customModels),
    warning: null,
    filePathDisplay: formatDisplayPath(filePath),
    cloudflareTunnel,
    auth,
    claudeAuth,
    uploads,
    subagents,
    customMcpServers: normalizeMcpServers(source?.customMcpServers, warnings),
    customModels,
    textSnippets,
    claudeDriver,
    globalPromptAppend,
    shareDefaultTtlHours,
  }

  const shouldWrite = JSON.stringify(source ? toComparablePayload(source) : null) !== JSON.stringify(toFilePayload(state))
  state.warning = warnings.length > 0
    ? `Some settings were reset to defaults: ${warnings.join("; ")}`
    : null

  return {
    payload: state,
    warning: state.warning,
    shouldWrite,
  }
}

function toComparablePayload(source: AppSettingsFile) {
  return {
    analyticsEnabled: source.analyticsEnabled,
    analyticsUserId: typeof source.analyticsUserId === "string" ? source.analyticsUserId.trim() : source.analyticsUserId,
    browserSettingsMigrated: source.browserSettingsMigrated,
    theme: source.theme,
    chatSoundPreference: source.chatSoundPreference,
    chatSoundId: source.chatSoundId,
    terminal: source.terminal,
    editor: source.editor,
    defaultProvider: source.defaultProvider,
    providerDefaults: source.providerDefaults,
    cloudflareTunnel: source.cloudflareTunnel,
    auth: source.auth,
    claudeAuth: source.claudeAuth,
    uploads: source.uploads,
    subagents: source.subagents,
    customMcpServers: source.customMcpServers,
    customModels: source.customModels,
    textSnippets: source.textSnippets,
    claudeDriver: source.claudeDriver,
    globalPromptAppend: typeof source.globalPromptAppend === "string"
      ? source.globalPromptAppend.replace(/\s+$/u, "")
      : source.globalPromptAppend,
    shareDefaultTtlHours: source.shareDefaultTtlHours,
  }
}

function validateMcpName(
  name: string,
  others: Array<{ id: string; name: string }>,
  ignoreId?: string,
): McpValidationError | null {
  if (!MCP_NAME_REGEX.test(name)) {
    return { code: "INVALID_NAME", field: "name", message: `name must match ${MCP_NAME_REGEX}` }
  }
  if (MCP_RESERVED_NAMES.has(name)) {
    return { code: "RESERVED_NAME", field: "name", message: `name '${name}' is reserved` }
  }
  for (const other of others) {
    if (other.id !== ignoreId && other.name === name) {
      return { code: "DUPLICATE_NAME", field: "name", message: `name '${name}' already exists` }
    }
  }
  return null
}

function validateMcpUrl(url: string, transport: "http" | "sse" | "ws"): McpValidationError | null {
  try {
    const u = new URL(url)
    const allowed = transport === "ws" ? new Set(["ws:", "wss:"]) : new Set(["http:", "https:"])
    if (!allowed.has(u.protocol)) {
      return { code: "INVALID_URL", field: "url", message: `expected ${transport === "ws" ? "ws(s)://" : "http(s)://"} URL` }
    }
    return null
  } catch {
    return { code: "INVALID_URL", field: "url", message: "URL is malformed" }
  }
}

function validateMcpShape(
  entry: McpServerConfig,
  others: Array<{ id: string; name: string }>,
): McpValidationError | null {
  const nameErr = validateMcpName(entry.name, others, entry.id)
  if (nameErr) return nameErr
  if (entry.transport === "stdio") {
    if (!entry.command || entry.command.trim().length === 0) {
      return { code: "MISSING_COMMAND", field: "command", message: "stdio requires non-empty command" }
    }
    for (const k of Object.keys(entry.env)) {
      if (k.trim().length === 0) {
        return { code: "INVALID_ENV_KEY", field: "env", message: "env keys must be non-empty" }
      }
    }
  } else {
    const urlErr = validateMcpUrl(entry.url, entry.transport)
    if (urlErr) return urlErr
    for (const k of Object.keys(entry.headers)) {
      if (k.trim().length === 0) {
        return { code: "INVALID_HEADER_KEY", field: "headers", message: "header keys must be non-empty" }
      }
    }
  }
  return null
}

function buildMcpFromInput(input: McpServerInput): McpServerConfig {
  const now = new Date().toISOString()
  const base = {
    id: randomUUID(),
    name: input.name.trim(),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
    lastTest: { status: "untested" as const },
  }
  if (input.transport === "stdio") {
    return {
      ...base,
      transport: "stdio",
      command: input.command,
      args: input.args ?? [],
      env: input.env ?? {},
      cwd: input.cwd,
    }
  }
  return {
    ...base,
    transport: input.transport,
    url: input.url,
    headers: input.headers ?? {},
    ...(input.oauth !== undefined ? { oauth: input.oauth } : {}),
  }
}

function applyMcpPatch(existing: McpServerConfig, patch: McpServerPatch): McpServerConfig {
  const now = new Date().toISOString()
  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name
  const nextEnabled = patch.enabled !== undefined ? patch.enabled : existing.enabled
  const transport = patch.transport ?? existing.transport
  const shared = {
    id: existing.id,
    name: nextName,
    enabled: nextEnabled,
    createdAt: existing.createdAt,
    updatedAt: now,
    lastTest: existing.lastTest,
  }
  if (transport === "stdio") {
    let cwd: string | undefined
    if (patch.cwd !== undefined) {
      cwd = patch.cwd
    } else if (existing.transport === "stdio") {
      cwd = existing.cwd
    } else {
      cwd = undefined
    }
    return {
      ...shared,
      transport: "stdio",
      command: patch.command ?? (existing.transport === "stdio" ? existing.command : ""),
      args: patch.args ?? (existing.transport === "stdio" ? existing.args : []),
      env: patch.env ?? (existing.transport === "stdio" ? existing.env : {}),
      cwd,
    }
  }
  let oauthSpread: { oauth?: McpOAuthState }
  if (patch.oauth !== undefined) {
    oauthSpread = { oauth: patch.oauth }
  } else if (existing.transport !== "stdio" && existing.oauth !== undefined) {
    oauthSpread = { oauth: existing.oauth }
  } else {
    oauthSpread = {}
  }
  return {
    ...shared,
    transport,
    url: patch.url ?? (existing.transport !== "stdio" ? existing.url : ""),
    headers: patch.headers ?? (existing.transport !== "stdio" ? existing.headers : {}),
    ...oauthSpread,
  }
}

interface CustomModelValidationError {
  code: "INVALID_ID" | "EMPTY_LABEL" | "INVALID_PROVIDER" | "DUPLICATE_ID" | "NOT_FOUND"
  field?: string
  message: string
}

class CustomModelValidationException extends Error {
  constructor(readonly validationError: CustomModelValidationError) {
    super(validationError.message)
    this.name = "CustomModelValidationException"
  }
}

function validateCustomModelShape(
  entry: CustomModelEntry,
  others: Array<{ id: string; provider: string }>,
): CustomModelValidationError | null {
  if (!MODEL_ID_REGEX.test(entry.id)) return { code: "INVALID_ID", field: "id", message: `id must match ${MODEL_ID_REGEX}` }
  if (entry.label.trim().length === 0 || entry.label.length > MODEL_LABEL_MAX) return { code: "EMPTY_LABEL", field: "label", message: "label must be non-empty and <= 64 chars" }
  if (entry.provider !== "claude" && entry.provider !== "codex") return { code: "INVALID_PROVIDER", field: "provider", message: "provider must be claude or codex" }
  for (const other of others) {
    if (other.id === entry.id && other.provider === entry.provider) return { code: "DUPLICATE_ID", field: "id", message: `model '${entry.id}' already exists for ${entry.provider}` }
  }
  return null
}

function buildCustomModelFromInput(input: CustomModelInput): CustomModelEntry {
  const now = Date.now()
  return {
    id: input.id.trim(),
    label: input.label.trim(),
    provider: input.provider,
    supportsEffort: input.supportsEffort,
    ...(input.aliases ? { aliases: input.aliases } : {}),
    ...(input.contextWindowOptions ? { contextWindowOptions: input.contextWindowOptions } : {}),
    ...(input.supportsMaxReasoningEffort !== undefined ? { supportsMaxReasoningEffort: input.supportsMaxReasoningEffort } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

function applyCustomModelPatch(existing: CustomModelEntry, patch: CustomModelPatch): CustomModelEntry {
  return {
    ...existing,
    label: patch.label !== undefined ? patch.label.trim() : existing.label,
    supportsEffort: patch.supportsEffort ?? existing.supportsEffort,
    aliases: patch.aliases === null ? undefined : patch.aliases ?? existing.aliases,
    contextWindowOptions: patch.contextWindowOptions === null ? undefined : patch.contextWindowOptions ?? existing.contextWindowOptions,
    supportsMaxReasoningEffort: patch.supportsMaxReasoningEffort ?? existing.supportsMaxReasoningEffort,
    updatedAt: Date.now(),
  }
}

interface TextSnippetValidationError {
  code: "INVALID_SHORTCUT" | "EMPTY_EXPANSION" | "DUPLICATE_SHORTCUT" | "NOT_FOUND"
  field?: string
  message: string
}

class TextSnippetValidationException extends Error {
  constructor(readonly validationError: TextSnippetValidationError) {
    super(validationError.message)
    this.name = "TextSnippetValidationException"
  }
}

function validateTextSnippetShape(
  entry: TextSnippet,
  others: Array<{ id: string; shortcut: string }>,
): TextSnippetValidationError | null {
  if (!SNIPPET_SHORTCUT_REGEX.test(entry.shortcut)) {
    return { code: "INVALID_SHORTCUT", field: "shortcut", message: "shortcut must be 1-32 characters with no whitespace" }
  }
  if (entry.expansion.length === 0 || entry.expansion.length > SNIPPET_EXPANSION_MAX) {
    return { code: "EMPTY_EXPANSION", field: "expansion", message: `expansion must be non-empty and <= ${SNIPPET_EXPANSION_MAX} chars` }
  }
  for (const other of others) {
    if (other.id !== entry.id && other.shortcut === entry.shortcut) {
      return { code: "DUPLICATE_SHORTCUT", field: "shortcut", message: `shortcut '${entry.shortcut}' already exists` }
    }
  }
  return null
}

function buildTextSnippetFromInput(input: TextSnippetInput): TextSnippet {
  const now = Date.now()
  return {
    id: randomUUID(),
    shortcut: input.shortcut.trim(),
    expansion: input.expansion,
    createdAt: now,
    updatedAt: now,
  }
}

function applyTextSnippetPatch(existing: TextSnippet, patch: TextSnippetPatch): TextSnippet {
  return {
    ...existing,
    shortcut: patch.shortcut !== undefined ? patch.shortcut.trim() : existing.shortcut,
    expansion: patch.expansion !== undefined ? patch.expansion : existing.expansion,
    updatedAt: Date.now(),
  }
}

function normalizeTextSnippets<T>(value: T, warnings: string[]): TextSnippet[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    warnings.push("textSnippets must be an array")
    return []
  }
  const out: TextSnippet[] = []
  for (const raw of value) {
    if (!isPlainObject(raw)) continue
    const entry: TextSnippet = {
      id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : randomUUID(),
      shortcut: String(raw.shortcut ?? "").trim(),
      expansion: String(raw.expansion ?? ""),
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    }
    const err = validateTextSnippetShape(entry, out.map((s) => ({ id: s.id, shortcut: s.shortcut })))
    if (err) { warnings.push(`textSnippets: dropped ${entry.shortcut || "entry"} (${err.message})`); continue }
    out.push(entry)
  }
  return out
}

export function seedCustomModelsFromBuiltins(): CustomModelEntry[] {
  const out: CustomModelEntry[] = []
  for (const provider of PROVIDERS) {
    if (provider.id !== "claude" && provider.id !== "codex") continue
    const provId: "claude" | "codex" = provider.id === "claude" ? "claude" : "codex"
    for (const model of provider.models) {
      out.push({
        id: model.id,
        label: model.label,
        provider: provId,
        supportsEffort: model.supportsEffort,
        ...(model.aliases ? { aliases: model.aliases } : {}),
        ...(model.contextWindowOptions ? { contextWindowOptions: model.contextWindowOptions } : {}),
        ...(model.supportsMaxReasoningEffort !== undefined ? { supportsMaxReasoningEffort: model.supportsMaxReasoningEffort } : {}),
        createdAt: 0,
        updatedAt: 0,
      })
    }
  }
  return out
}

function normalizeCustomModels<T>(value: T, warnings: string[]): CustomModelEntry[] {
  if (value === undefined || value === null) return seedCustomModelsFromBuiltins()
  if (!Array.isArray(value)) {
    warnings.push("customModels must be an array")
    return seedCustomModelsFromBuiltins()
  }
  const out: CustomModelEntry[] = []
  for (const raw of value) {
    if (!isPlainObject(raw)) continue
    const entry: CustomModelEntry = {
      id: String(raw.id ?? ""),
      label: String(raw.label ?? ""),
      provider: raw.provider === "codex" ? "codex" : "claude",
      supportsEffort: raw.supportsEffort === true,
      ...(Array.isArray(raw.aliases) ? { aliases: raw.aliases.map(String) } : {}),
      ...(Array.isArray(raw.contextWindowOptions) ? { contextWindowOptions: raw.contextWindowOptions } : {}),
      ...(typeof raw.supportsMaxReasoningEffort === "boolean" ? { supportsMaxReasoningEffort: raw.supportsMaxReasoningEffort } : {}),
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    }
    const err = validateCustomModelShape(entry, out.map((m) => ({ id: m.id, provider: m.provider })))
    if (err) { warnings.push(`customModels: dropped ${entry.id || "entry"} (${err.message})`); continue }
    out.push(entry)
  }
  return out
}

function mergeSubagentModelOptions(
  existing: ClaudeModelOptions | CodexModelOptions,
  patch: Partial<ClaudeModelOptions> | Partial<CodexModelOptions> | undefined,
): ClaudeModelOptions | CodexModelOptions {
  if (!patch) return existing
  if ("contextWindow" in existing) {
    const claudePatch = "contextWindow" in patch ? patch : undefined
    return {
      reasoningEffort: claudePatch?.reasoningEffort ?? existing.reasoningEffort,
      contextWindow: claudePatch?.contextWindow ?? existing.contextWindow,
    }
  }
  const codexPatch = "fastMode" in patch ? patch : undefined
  return {
    reasoningEffort: codexPatch?.reasoningEffort ?? existing.reasoningEffort,
    fastMode: codexPatch?.fastMode ?? existing.fastMode,
  }
}

function applyPatch(state: AppSettingsState, patch: AppSettingsPatch): AppSettingsState {
  if (patch.shareDefaultTtlHours !== undefined) {
    const value = patch.shareDefaultTtlHours
    if (!Number.isInteger(value) || value < 1) {
      throw new Error("shareDefaultTtlHours must be a positive integer >= 1")
    }
  }

  let nextSubagents = state.subagents
  if (patch.subagents?.create) {
    const input = patch.subagents.create
    const error = validateSubagentName(input.name, state.subagents.map((s) => ({ id: s.id, name: s.name })))
    if (error) throw new SubagentValidationException(error)
    const restrictionError = validateSubagentRestriction(input.provider, input.workingDir, input.allowedPaths)
    if (restrictionError) throw new SubagentValidationException(restrictionError)
    const now = Date.now()
    nextSubagents = [
      ...state.subagents,
      {
        id: randomUUID(),
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        provider: input.provider,
        model: input.model,
        modelOptions: input.modelOptions,
        systemPrompt: input.systemPrompt,
        contextScope: input.contextScope,
        triggerMode: input.triggerMode ?? "auto",
        workingDir: input.workingDir,
        allowedPaths: input.allowedPaths && input.allowedPaths.length > 0 ? input.allowedPaths : undefined,
        createdAt: now,
        updatedAt: now,
      },
    ]
  } else if (patch.subagents?.update) {
    const { id, patch: subagentPatch } = patch.subagents.update
    const index = state.subagents.findIndex((subagent) => subagent.id === id)
    if (index < 0) {
      throw new SubagentValidationException({ code: "NOT_FOUND", message: `Subagent ${id} not found` })
    }
    const existing = state.subagents[index]
    const nextName = subagentPatch.name !== undefined ? subagentPatch.name.trim() : existing.name
    if (subagentPatch.name !== undefined) {
      const error = validateSubagentName(nextName, state.subagents.map((s) => ({ id: s.id, name: s.name })), id)
      if (error) throw new SubagentValidationException(error)
    }
    const nextProvider = subagentPatch.provider ?? existing.provider
    let nextWorkingDir: string | undefined
    if (subagentPatch.workingDir === null) {
      nextWorkingDir = undefined
    } else if (subagentPatch.workingDir !== undefined) {
      nextWorkingDir = subagentPatch.workingDir
    } else {
      nextWorkingDir = existing.workingDir
    }
    let nextAllowedPaths: string[] | undefined
    if (subagentPatch.allowedPaths === null) {
      nextAllowedPaths = undefined
    } else if (subagentPatch.allowedPaths !== undefined) {
      nextAllowedPaths = subagentPatch.allowedPaths
    } else {
      nextAllowedPaths = existing.allowedPaths
    }
    const restrictionError = validateSubagentRestriction(nextProvider, nextWorkingDir, nextAllowedPaths)
    if (restrictionError) throw new SubagentValidationException(restrictionError)
    let descriptionValue: string | undefined
    if (subagentPatch.description === null) {
      descriptionValue = undefined
    } else if (subagentPatch.description !== undefined) {
      descriptionValue = subagentPatch.description.trim() || undefined
    } else {
      descriptionValue = existing.description
    }
    const merged: Subagent = {
      ...existing,
      ...subagentPatch,
      name: nextName,
      description: descriptionValue,
      modelOptions: mergeSubagentModelOptions(existing.modelOptions, subagentPatch.modelOptions),
      workingDir: nextWorkingDir,
      allowedPaths: nextAllowedPaths,
      triggerMode: subagentPatch.triggerMode ?? existing.triggerMode,
      updatedAt: Date.now(),
    }
    nextSubagents = [...state.subagents.slice(0, index), merged, ...state.subagents.slice(index + 1)]
  } else if (patch.subagents?.delete) {
    nextSubagents = state.subagents.filter((subagent) => subagent.id !== patch.subagents?.delete?.id)
  }

  let nextMcpServers = state.customMcpServers
  if (patch.customMcpServers?.create) {
    const createInput = patch.customMcpServers.create
    if (
      createInput.transport === "stdio"
      && isPlainObject(createInput)
      && isPlainObject(createInput.oauth)
      && createInput.oauth.enabled
    ) {
      throw new McpValidationException({ code: "INVALID_OAUTH_TRANSPORT", field: "oauth", message: "OAuth is only supported for http/sse transports" })
    }
    const entry = buildMcpFromInput(createInput)
    const error = validateMcpShape(entry, state.customMcpServers.map((s) => ({ id: s.id, name: s.name })))
    if (error) throw new McpValidationException(error)
    nextMcpServers = [...state.customMcpServers, entry]
  } else if (patch.customMcpServers?.update) {
    const { id, patch: mcpPatch } = patch.customMcpServers.update
    const idx = state.customMcpServers.findIndex((s) => s.id === id)
    if (idx < 0) throw new McpValidationException({ code: "NOT_FOUND", message: `MCP server ${id} not found` })
    const updated = applyMcpPatch(state.customMcpServers[idx]!, mcpPatch)
    const error = validateMcpShape(
      updated,
      state.customMcpServers.map((s) => ({ id: s.id, name: s.name })),
    )
    if (error) throw new McpValidationException(error)
    nextMcpServers = [
      ...state.customMcpServers.slice(0, idx),
      updated,
      ...state.customMcpServers.slice(idx + 1),
    ]
  } else if (patch.customMcpServers?.delete) {
    nextMcpServers = state.customMcpServers.filter((s) => s.id !== patch.customMcpServers!.delete!.id)
  } else if (patch.customMcpServers?.setEnabled) {
    const { id, enabled } = patch.customMcpServers.setEnabled
    nextMcpServers = state.customMcpServers.map((s) =>
      s.id === id ? { ...s, enabled, updatedAt: new Date().toISOString() } : s,
    )
  } else if (patch.customMcpServers?.setTestResult) {
    const { id, result } = patch.customMcpServers.setTestResult
    nextMcpServers = state.customMcpServers.map((s) =>
      s.id === id ? { ...s, lastTest: result, updatedAt: new Date().toISOString() } : s,
    )
  } else if (patch.customMcpServers?.setOAuthState) {
    const { id, oauth } = patch.customMcpServers.setOAuthState
    nextMcpServers = state.customMcpServers.map((s) =>
      s.id === id && s.transport !== "stdio" ? { ...s, oauth } : s,
    )
  }

  let nextCustomModels = state.customModels
  if (patch.customModels?.create) {
    const entry = buildCustomModelFromInput(patch.customModels.create)
    const error = validateCustomModelShape(entry, state.customModels.map((m) => ({ id: m.id, provider: m.provider })))
    if (error) throw new CustomModelValidationException(error)
    nextCustomModels = [...state.customModels, entry]
  } else if (patch.customModels?.update) {
    const { id, patch: modelPatch } = patch.customModels.update
    const idx = state.customModels.findIndex((m) => m.id === id)
    if (idx < 0) throw new CustomModelValidationException({ code: "NOT_FOUND", message: `custom model ${id} not found` })
    const updated = applyCustomModelPatch(state.customModels[idx]!, modelPatch)
    nextCustomModels = [...state.customModels.slice(0, idx), updated, ...state.customModels.slice(idx + 1)]
  } else if (patch.customModels?.delete) {
    nextCustomModels = state.customModels.filter((m) => m.id !== patch.customModels!.delete!.id)
  }

  let nextTextSnippets = state.textSnippets
  if (patch.textSnippets?.create) {
    const entry = buildTextSnippetFromInput(patch.textSnippets.create)
    const error = validateTextSnippetShape(entry, state.textSnippets.map((s) => ({ id: s.id, shortcut: s.shortcut })))
    if (error) throw new TextSnippetValidationException(error)
    nextTextSnippets = [...state.textSnippets, entry]
  } else if (patch.textSnippets?.update) {
    const { id, patch: snippetPatch } = patch.textSnippets.update
    const idx = state.textSnippets.findIndex((s) => s.id === id)
    if (idx < 0) throw new TextSnippetValidationException({ code: "NOT_FOUND", message: `text snippet ${id} not found` })
    const updated = applyTextSnippetPatch(state.textSnippets[idx]!, snippetPatch)
    const error = validateTextSnippetShape(updated, state.textSnippets.map((s) => ({ id: s.id, shortcut: s.shortcut })))
    if (error) throw new TextSnippetValidationException(error)
    nextTextSnippets = [...state.textSnippets.slice(0, idx), updated, ...state.textSnippets.slice(idx + 1)]
  } else if (patch.textSnippets?.delete) {
    nextTextSnippets = state.textSnippets.filter((s) => s.id !== patch.textSnippets!.delete!.id)
  }

  return normalizeAppSettings({
    ...toFilePayload(state),
    ...patch,
    terminal: {
      ...state.terminal,
      ...patch.terminal,
    },
    editor: {
      ...state.editor,
      ...patch.editor,
    },
    providerDefaults: {
      claude: {
        ...state.providerDefaults.claude,
        ...patch.providerDefaults?.claude,
        modelOptions: {
          ...state.providerDefaults.claude.modelOptions,
          ...patch.providerDefaults?.claude?.modelOptions,
        },
      },
      codex: {
        ...state.providerDefaults.codex,
        ...patch.providerDefaults?.codex,
        modelOptions: {
          ...state.providerDefaults.codex.modelOptions,
          ...patch.providerDefaults?.codex?.modelOptions,
        },
      },
      openrouter: {
        ...state.providerDefaults.openrouter,
        ...patch.providerDefaults?.openrouter,
        modelOptions: {},
      },
    },
    cloudflareTunnel: {
      ...state.cloudflareTunnel,
      ...patch.cloudflareTunnel,
    },
    auth: {
      ...state.auth,
      ...patch.auth,
    },
    claudeAuth: {
      tokens: patch.claudeAuth?.tokens ?? state.claudeAuth.tokens,
      concurrencyDefault: patch.claudeAuth?.concurrencyDefault ?? state.claudeAuth.concurrencyDefault,
    },
    uploads: {
      ...state.uploads,
      ...patch.uploads,
    },
    subagents: nextSubagents,
    customMcpServers: nextMcpServers,
    customModels: nextCustomModels,
    textSnippets: nextTextSnippets,
    claudeDriver: {
      preference: patch.claudeDriver?.preference ?? state.claudeDriver.preference,
      lifecycle: {
        ...state.claudeDriver.lifecycle,
        ...patch.claudeDriver?.lifecycle,
      },
    },
    globalPromptAppend: patch.globalPromptAppend ?? state.globalPromptAppend,
    shareDefaultTtlHours: patch.shareDefaultTtlHours ?? state.shareDefaultTtlHours,
  }, state.filePathDisplay).payload
}

export async function readAppSettingsSnapshot(filePath = getSettingsFilePath(homedir())) {
  try {
    const text = await readTextFileOrThrow(filePath)
    if (!text.trim()) {
      const normalized = normalizeAppSettings(undefined, filePath)
      return {
        ...toSnapshot(normalized.payload),
        warning: "Settings file was empty. Using defaults.",
      } satisfies AppSettingsSnapshot
    }

    return toSnapshot(normalizeAppSettings(JSON.parse(text), filePath).payload)
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return toSnapshot(normalizeAppSettings(undefined, filePath).payload)
    }
    if (error instanceof SyntaxError) {
      return {
        ...toSnapshot(normalizeAppSettings(undefined, filePath).payload),
        warning: "Settings file is invalid JSON. Using defaults.",
      } satisfies AppSettingsSnapshot
    }
    throw error
  }
}

export class AppSettingsManager {
  readonly filePath: string
  private state: AppSettingsState
  private readonly listeners = new Set<(snapshot: AppSettingsSnapshot) => void>()

  constructor(filePath = getSettingsFilePath(homedir())) {
    this.filePath = filePath
    this.state = normalizeAppSettings(undefined, filePath).payload
  }

  async initialize() {
    await mkdirRecursive(path.dirname(this.filePath))
    await this.reload({ persistNormalized: true, allowDefaultsFallback: true })
  }

  dispose() {
    this.listeners.clear()
  }

  getSnapshot() {
    return toSnapshot(this.state)
  }

  getState() {
    return this.state
  }

  onChange(listener: (snapshot: AppSettingsSnapshot) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async reload(options?: { persistNormalized?: boolean; allowDefaultsFallback?: boolean }) {
    const nextState = await this.readState(options)
    this.setState(nextState)
  }

  async write(value: { analyticsEnabled: boolean }) {
    return this.writePatch({ analyticsEnabled: value.analyticsEnabled })
  }

  async setCloudflareTunnel(patch: Partial<CloudflareTunnelSettings>) {
    if (patch.mode !== undefined && patch.mode !== "always-ask" && patch.mode !== "auto-expose") {
      throw new Error("Invalid cloudflareTunnel.mode")
    }
    return this.writePatch({ cloudflareTunnel: patch })
  }

  async setAuth(patch: Partial<AuthSettings>) {
    if (patch.sessionMaxAgeDays !== undefined) {
      const value = patch.sessionMaxAgeDays
      if (typeof value !== "number" || !Number.isFinite(value)
        || value < AUTH_SESSION_MAX_AGE_DAYS_MIN || value > AUTH_SESSION_MAX_AGE_DAYS_MAX) {
        throw new Error(`auth.sessionMaxAgeDays must be between ${AUTH_SESSION_MAX_AGE_DAYS_MIN} and ${AUTH_SESSION_MAX_AGE_DAYS_MAX}`)
      }
    }
    return this.writePatch({ auth: patch })
  }

  async setUploads(patch: Partial<UploadSettings>) {
    if (patch.maxFileSizeMb !== undefined) {
      const value = patch.maxFileSizeMb
      if (typeof value !== "number" || !Number.isFinite(value)
        || value < UPLOAD_MAX_FILE_SIZE_MB_MIN || value > UPLOAD_MAX_FILE_SIZE_MB_MAX) {
        throw new Error(`uploads.maxFileSizeMb must be between ${UPLOAD_MAX_FILE_SIZE_MB_MIN} and ${UPLOAD_MAX_FILE_SIZE_MB_MAX}`)
      }
    }
    return this.writePatch({ uploads: patch })
  }

  async setClaudeDriver(patch: {
    preference?: ClaudeDriverPreference
    lifecycle?: Partial<ClaudePtyLifecycleSettings>
  }) {
    if (patch.preference !== undefined && !isClaudeDriverPreference(patch.preference)) {
      throw new Error(`claudeDriver.preference must be "sdk" or "pty"`)
    }
    if (patch.lifecycle?.idleTimeoutMs !== undefined) {
      const value = patch.lifecycle.idleTimeoutMs
      if (typeof value !== "number" || !Number.isFinite(value)
        || value < CLAUDE_PTY_IDLE_TIMEOUT_MS_MIN || value > CLAUDE_PTY_IDLE_TIMEOUT_MS_MAX) {
        throw new Error(`claudeDriver.lifecycle.idleTimeoutMs must be between ${CLAUDE_PTY_IDLE_TIMEOUT_MS_MIN} and ${CLAUDE_PTY_IDLE_TIMEOUT_MS_MAX}`)
      }
    }
    if (patch.lifecycle?.maxConcurrent !== undefined) {
      const value = patch.lifecycle.maxConcurrent
      if (typeof value !== "number" || !Number.isFinite(value)
        || value < CLAUDE_PTY_MAX_CONCURRENT_MIN || value > CLAUDE_PTY_MAX_CONCURRENT_MAX) {
        throw new Error(`claudeDriver.lifecycle.maxConcurrent must be between ${CLAUDE_PTY_MAX_CONCURRENT_MIN} and ${CLAUDE_PTY_MAX_CONCURRENT_MAX}`)
      }
    }
    return this.writePatch({ claudeDriver: patch })
  }

  async setGlobalPromptAppend(text: string) {
    if (typeof text !== "string") {
      throw new Error("globalPromptAppend must be a string")
    }
    if (text.length > GLOBAL_PROMPT_APPEND_MAX_CHARS) {
      throw new Error(`globalPromptAppend must be ${GLOBAL_PROMPT_APPEND_MAX_CHARS} chars or fewer`)
    }
    return this.writePatch({ globalPromptAppend: text })
  }

  async setClaudeAuth(patch: Partial<ClaudeAuthSettings>) {
    if (patch.tokens !== undefined && !Array.isArray(patch.tokens)) {
      throw new Error("claudeAuth.tokens must be an array")
    }
    if (patch.concurrencyDefault !== undefined) {
      const v = patch.concurrencyDefault
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error("claudeAuth.concurrencyDefault must be a number")
      }
      if (v < OAUTH_TOKEN_MAX_CONCURRENT_MIN || v > OAUTH_TOKEN_MAX_CONCURRENT_MAX) {
        throw new Error(
          `claudeAuth.concurrencyDefault must be between ${OAUTH_TOKEN_MAX_CONCURRENT_MIN} and ${OAUTH_TOKEN_MAX_CONCURRENT_MAX}`,
        )
      }
    }
    return this.writePatch({ claudeAuth: patch })
  }

  async mutateTokenStatus(id: string, patch: StatusPatch) {
    const tokens = this.state.claudeAuth.tokens.map((t) => t.id === id ? { ...t, ...patch } : t)
    return this.setClaudeAuth({ tokens })
  }

  async createSubagent(input: SubagentInput): Promise<SubagentValidationError | Subagent> {
    try {
      const snapshot = await this.writePatch({ subagents: { create: input } })
      return snapshot.subagents[snapshot.subagents.length - 1]
        ?? { code: "NOT_FOUND", message: "Created subagent not found" }
    } catch (error) {
      if (error instanceof SubagentValidationException) {
        return error.validationError
      }
      throw error
    }
  }

  async updateSubagent(id: string, patch: SubagentPatch): Promise<SubagentValidationError | Subagent> {
    try {
      const snapshot = await this.writePatch({ subagents: { update: { id, patch } } })
      return snapshot.subagents.find((subagent) => subagent.id === id)
        ?? { code: "NOT_FOUND", message: `Subagent ${id} not found` }
    } catch (error) {
      if (error instanceof SubagentValidationException) {
        return error.validationError
      }
      throw error
    }
  }

  async deleteSubagent(id: string): Promise<void> {
    await this.writePatch({ subagents: { delete: { id } } })
  }

  async writePatch(patch: AppSettingsPatch) {
    const nextState = {
      ...applyPatch(this.state, patch),
      warning: null,
      filePathDisplay: formatDisplayPath(this.filePath),
    }
    await mkdirRecursive(path.dirname(this.filePath))
    await atomicWriteJson(this.filePath, `${JSON.stringify(toFilePayload(nextState), null, 2)}\n`)
    this.setState(nextState)
    return toSnapshot(nextState)
  }

  private async readState(options?: { persistNormalized?: boolean; allowDefaultsFallback?: boolean }) {
    try {
      const text = await readBunFileText(this.filePath)
      const hasText = text.trim().length > 0
      const normalized = normalizeAppSettings(hasText ? JSON.parse(text) : undefined, this.filePath)
      if (options?.persistNormalized && (!hasText || normalized.shouldWrite)) {
            await atomicWriteJson(this.filePath, `${JSON.stringify(toFilePayload(normalized.payload), null, 2)}\n`)
      }
      return {
        ...normalized.payload,
        warning: !hasText ? "Settings file was empty. Using defaults." : normalized.warning,
      } satisfies AppSettingsState
    } catch (error) {
      if (!(isErrnoException(error) && error.code === "ENOENT") && !(error instanceof SyntaxError)) {
        throw error
      }

      // Only fall back to defaults at initialization. After init, a transient
      // SyntaxError (mid-write read from another process, partial flush, etc.)
      // must NOT clobber in-memory state — otherwise the next mutateTokenStatus
      // call would persist those defaults and permanently drop user data.
      if (!options?.allowDefaultsFallback) {
        throw error
      }
      const normalized = normalizeAppSettings(undefined, this.filePath)
      if (options?.persistNormalized) {
            await atomicWriteJson(this.filePath, `${JSON.stringify(toFilePayload(normalized.payload), null, 2)}\n`)
      }
      return {
        ...normalized.payload,
        warning: error instanceof SyntaxError ? "Settings file is invalid JSON. Using defaults." : null,
      } satisfies AppSettingsState
    }
  }

  private setState(state: AppSettingsState) {
    this.state = state
    const snapshot = toSnapshot(state)
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

}
