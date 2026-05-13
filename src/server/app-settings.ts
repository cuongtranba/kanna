import { randomUUID } from "node:crypto"
import { watch, type FSWatcher } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { getSettingsFilePath, LOG_PREFIX } from "../shared/branding"
import {
  AUTH_DEFAULTS,
  AUTH_SESSION_MAX_AGE_DAYS_MAX,
  AUTH_SESSION_MAX_AGE_DAYS_MIN,
  CLAUDE_AUTH_DEFAULTS,
  CLOUDFLARE_TUNNEL_DEFAULTS,
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  normalizeClaudeContextWindow,
  normalizeClaudeModelId,
  normalizeCodexModelId,
  OAUTH_TOKEN_LABEL_MAX,
  OAUTH_TOKEN_VALUE_MAX,
  supportsClaudeMaxReasoningEffort,
  UPLOAD_DEFAULTS,
  UPLOAD_MAX_FILE_SIZE_MB_MAX,
  UPLOAD_MAX_FILE_SIZE_MB_MIN,
  type AppSettingsPatch,
  type AppSettingsSnapshot,
  type AppThemePreference,
  type AuthSettings,
  type ChatProviderPreferences,
  type ChatSoundId,
  type ChatSoundPreference,
  type ClaudeAuthSettings,
  type ClaudeModelOptions,
  type CloudflareTunnelSettings,
  type CodexModelOptions,
  type DefaultProviderPreference,
  type EditorPreset,
  type OAuthTokenEntry,
  type OAuthTokenStatus,
  type ProviderPreference,
  type UploadSettings,
} from "../shared/types"

type StatusPatch = Partial<Pick<OAuthTokenEntry,
  "status" | "limitedUntil" | "lastUsedAt" | "lastErrorAt" | "lastErrorMessage"
>>

interface AppSettingsFile {
  analyticsEnabled?: unknown
  analyticsUserId?: unknown
  browserSettingsMigrated?: unknown
  theme?: unknown
  chatSoundPreference?: unknown
  chatSoundId?: unknown
  terminal?: {
    scrollbackLines?: unknown
    minColumnWidth?: unknown
  }
  editor?: {
    preset?: unknown
    commandTemplate?: unknown
  }
  defaultProvider?: unknown
  providerDefaults?: {
    claude?: Partial<ProviderPreference<Partial<ClaudeModelOptions>>> & { effort?: unknown }
    codex?: Partial<ProviderPreference<Partial<CodexModelOptions>>> & { effort?: unknown }
  }
  cloudflareTunnel?: unknown
  auth?: unknown
  claudeAuth?: unknown
  uploads?: unknown
}

interface AppSettingsState extends AppSettingsSnapshot {
  analyticsUserId: string
}

interface NormalizedAppSettings {
  payload: AppSettingsState
  warning: string | null
  shouldWrite: boolean
}

const DEFAULT_TERMINAL_SCROLLBACK = 1_000
const MIN_TERMINAL_SCROLLBACK = 500
const MAX_TERMINAL_SCROLLBACK = 5_000
const DEFAULT_TERMINAL_MIN_COLUMN_WIDTH = 450
const MIN_TERMINAL_MIN_COLUMN_WIDTH = 250
const MAX_TERMINAL_MIN_COLUMN_WIDTH = 900
const DEFAULT_EDITOR_PRESET: EditorPreset = "cursor"
const DEFAULT_CHAT_SOUND_PREFERENCE: ChatSoundPreference = "always"
const DEFAULT_CHAT_SOUND_ID: ChatSoundId = "funk"

async function atomicWriteJson(filePath: string, content: string) {
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmpPath, content, "utf8")
  await rename(tmpPath, filePath)
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
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, Math.round(numberValue)))
}

function normalizeTheme(value: unknown): AppThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system"
}

function normalizeChatSoundPreference(value: unknown): ChatSoundPreference {
  return value === "never" || value === "unfocused" || value === "always" ? value : DEFAULT_CHAT_SOUND_PREFERENCE
}

function normalizeChatSoundId(value: unknown): ChatSoundId {
  switch (value) {
    case "blow":
    case "bottle":
    case "frog":
    case "funk":
    case "glass":
    case "ping":
    case "pop":
    case "purr":
    case "tink":
      return value
    default:
      return DEFAULT_CHAT_SOUND_ID
  }
}

function normalizeDefaultProvider(value: unknown): DefaultProviderPreference {
  return value === "claude" || value === "codex" || value === "last_used" ? value : "last_used"
}

function normalizeEditorPreset(value: unknown): EditorPreset {
  return value === "vscode" || value === "xcode" || value === "windsurf" || value === "custom" || value === "cursor"
    ? value
    : DEFAULT_EDITOR_PRESET
}

function normalizeEditorCommandTemplate(value: unknown, preset: EditorPreset) {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed || getDefaultEditorCommandTemplate(preset)
}

function normalizeClaudePreference(value?: {
  model?: unknown
  effort?: unknown
  modelOptions?: Partial<Record<keyof ClaudeModelOptions, unknown>>
  planMode?: unknown
}): ProviderPreference<ClaudeModelOptions> {
  const model = normalizeClaudeModelId(typeof value?.model === "string" ? value.model : undefined)
  const reasoningEffort = value?.modelOptions?.reasoningEffort
  const normalizedEffort = isClaudeReasoningEffort(reasoningEffort)
    ? reasoningEffort
    : isClaudeReasoningEffort(value?.effort)
      ? value.effort
      : DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort

  return {
    model,
    modelOptions: {
      reasoningEffort: !supportsClaudeMaxReasoningEffort(model) && normalizedEffort === "max" ? "high" : normalizedEffort,
      contextWindow: normalizeClaudeContextWindow(model, value?.modelOptions?.contextWindow),
    },
    planMode: value?.planMode === true,
  }
}

function normalizeCodexPreference(value?: {
  model?: unknown
  effort?: unknown
  modelOptions?: Partial<Record<keyof CodexModelOptions, unknown>>
  planMode?: unknown
}): ProviderPreference<CodexModelOptions> {
  const reasoningEffort = value?.modelOptions?.reasoningEffort
  return {
    model: normalizeCodexModelId(typeof value?.model === "string" ? value.model : undefined),
    modelOptions: {
      reasoningEffort: isCodexReasoningEffort(reasoningEffort)
        ? reasoningEffort
        : isCodexReasoningEffort(value?.effort)
          ? value.effort
          : DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort,
      fastMode: typeof value?.modelOptions?.fastMode === "boolean"
        ? value.modelOptions.fastMode
        : DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
    },
    planMode: value?.planMode === true,
  }
}

function normalizeProviderDefaults(value: AppSettingsFile["providerDefaults"] | undefined): ChatProviderPreferences {
  const defaults = createDefaultProviderDefaults()
  return {
    claude: normalizeClaudePreference(value?.claude ?? defaults.claude),
    codex: normalizeCodexPreference(value?.codex ?? defaults.codex),
  }
}

function normalizeCloudflareTunnel(value: unknown, warnings: string[]): CloudflareTunnelSettings {
  const tunnelSource = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
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

  if (tunnelSource?.mode !== undefined) {
    warnings.push(`cloudflareTunnel.mode is no longer supported; tunnels are always proposed via the expose_port tool`)
  }

  return { enabled, cloudflaredPath }
}

function normalizeAuthSettings(value: unknown, warnings: string[]): AuthSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
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

function normalizeUploadSettings(value: unknown, warnings: string[]): UploadSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
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

function normalizeOAuthTokenStatus(value: unknown): OAuthTokenStatus {
  return value === "limited" || value === "error" ? value : "active"
}

function normalizeTokenEntry(value: unknown, warnings: string[]): OAuthTokenEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const src = value as Record<string, unknown>
  const id = typeof src.id === "string" && src.id.trim() ? src.id.trim() : null
  const token = typeof src.token === "string" ? src.token : ""
  if (!id || !token) {
    warnings.push("claudeAuth.tokens entry missing id or token")
    return null
  }
  const label = typeof src.label === "string" && src.label.trim()
    ? src.label.trim().slice(0, OAUTH_TOKEN_LABEL_MAX)
    : id
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
  }
}

function normalizeClaudeAuth(value: unknown, warnings: string[]): ClaudeAuthSettings {
  if (value === undefined) return { ...CLAUDE_AUTH_DEFAULTS }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push("claudeAuth must be an object")
    return { ...CLAUDE_AUTH_DEFAULTS }
  }
  const src = value as { tokens?: unknown }
  if (src.tokens !== undefined && !Array.isArray(src.tokens)) {
    warnings.push("claudeAuth.tokens must be an array")
    return { ...CLAUDE_AUTH_DEFAULTS }
  }
  const tokens: OAuthTokenEntry[] = []
  for (const raw of (src.tokens ?? []) as unknown[]) {
    const entry = normalizeTokenEntry(raw, warnings)
    if (entry) tokens.push(entry)
  }
  return { tokens }
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
  }
}

function normalizeAppSettings(
  value: unknown,
  filePath = getSettingsFilePath(homedir())
): NormalizedAppSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as AppSettingsFile
    : null
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
    providerDefaults: normalizeProviderDefaults(source?.providerDefaults),
    warning: null,
    filePathDisplay: formatDisplayPath(filePath),
    cloudflareTunnel,
    auth,
    claudeAuth,
    uploads,
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
  }
}

function applyPatch(state: AppSettingsState, patch: AppSettingsPatch): AppSettingsState {
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
    },
    uploads: {
      ...state.uploads,
      ...patch.uploads,
    },
  }, state.filePathDisplay).payload
}

export async function readAppSettingsSnapshot(filePath = getSettingsFilePath(homedir())) {
  try {
    const text = await readFile(filePath, "utf8")
    if (!text.trim()) {
      const normalized = normalizeAppSettings(undefined, filePath)
      return {
        ...toSnapshot(normalized.payload),
        warning: "Settings file was empty. Using defaults.",
      } satisfies AppSettingsSnapshot
    }

    return toSnapshot(normalizeAppSettings(JSON.parse(text), filePath).payload)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
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
  private watcher: FSWatcher | null = null
  private state: AppSettingsState
  private readonly listeners = new Set<(snapshot: AppSettingsSnapshot) => void>()
  // Suppress watcher reload for a short window after our own writes, so a
  // partial-read race cannot clobber in-memory state with normalized defaults
  // (which would then be re-persisted on the next mutateTokenStatus call and
  // permanently drop OAuth tokens, cloudflare config, etc.).
  private suppressReloadUntil = 0

  constructor(filePath = getSettingsFilePath(homedir())) {
    this.filePath = filePath
    this.state = normalizeAppSettings(undefined, filePath).payload
  }

  async initialize() {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await this.reload({ persistNormalized: true, allowDefaultsFallback: true })
    this.startWatching()
  }

  dispose() {
    this.watcher?.close()
    this.watcher = null
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

  async setClaudeAuth(patch: Partial<ClaudeAuthSettings>) {
    if (patch.tokens !== undefined && !Array.isArray(patch.tokens)) {
      throw new Error("claudeAuth.tokens must be an array")
    }
    return this.writePatch({ claudeAuth: patch })
  }

  async mutateTokenStatus(id: string, patch: StatusPatch) {
    const tokens = this.state.claudeAuth.tokens.map((t) => t.id === id ? { ...t, ...patch } : t)
    return this.setClaudeAuth({ tokens })
  }

  async writePatch(patch: AppSettingsPatch) {
    const nextState = {
      ...applyPatch(this.state, patch),
      warning: null,
      filePathDisplay: formatDisplayPath(this.filePath),
    }
    await mkdir(path.dirname(this.filePath), { recursive: true })
    this.suppressReloadUntil = Date.now() + 500
    await atomicWriteJson(this.filePath, `${JSON.stringify(toFilePayload(nextState), null, 2)}\n`)
    this.setState(nextState)
    return toSnapshot(nextState)
  }

  private async readState(options?: { persistNormalized?: boolean; allowDefaultsFallback?: boolean }) {
    const file = Bun.file(this.filePath)

    try {
      const text = await file.text()
      const hasText = text.trim().length > 0
      const normalized = normalizeAppSettings(hasText ? JSON.parse(text) : undefined, this.filePath)
      if (options?.persistNormalized && (!hasText || normalized.shouldWrite)) {
        this.suppressReloadUntil = Date.now() + 500
        await atomicWriteJson(this.filePath, `${JSON.stringify(toFilePayload(normalized.payload), null, 2)}\n`)
      }
      return {
        ...normalized.payload,
        warning: !hasText ? "Settings file was empty. Using defaults." : normalized.warning,
      } satisfies AppSettingsState
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
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
        this.suppressReloadUntil = Date.now() + 500
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

  private startWatching() {
    this.watcher?.close()
    try {
      this.watcher = watch(path.dirname(this.filePath), { persistent: false }, (_eventType, filename) => {
        if (filename && filename !== path.basename(this.filePath)) {
          return
        }
        if (Date.now() < this.suppressReloadUntil) {
          return
        }
        void this.reload().catch((error: unknown) => {
          if (error instanceof SyntaxError) {
            console.warn(`${LOG_PREFIX} Ignoring transient invalid JSON in settings file; keeping in-memory state.`)
            return
          }
          console.warn(`${LOG_PREFIX} Failed to reload settings:`, error)
        })
      })
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to watch settings file:`, error)
      this.watcher = null
    }
  }
}
