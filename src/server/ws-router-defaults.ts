/**
 * ws-router-defaults.ts
 *
 * Pure helpers and fallback-factory functions used by createWsRouter when
 * optional dependencies (diffStore, llmProvider, appSettings) are absent.
 *
 * All exports are side-effect-free (no IO, no process.env reads).
 * Extracted from ws-router.ts.
 */
import { randomUUID } from "node:crypto"
import {
  AUTH_DEFAULTS,
  CLAUDE_AUTH_DEFAULTS,
  CLAUDE_DRIVER_DEFAULTS,
  CLAUDE_PTY_LIFECYCLE_DEFAULTS,
  CLOUDFLARE_TUNNEL_DEFAULTS,
  DEFAULT_OPENROUTER_SDK_MODEL,
  UPLOAD_DEFAULTS,
} from "../shared/types"
import type {
  AppSettingsPatch,
  AppSettingsSnapshot,
  LlmProviderSnapshot,
  LlmProviderValidationResult,
  Subagent,
} from "../shared/types"
import type { AppSettingsManager } from "./app-settings"

// ---------------------------------------------------------------------------
// mergeAppSettingsPatch — pure transform
// ---------------------------------------------------------------------------

/**
 * Apply an `AppSettingsPatch` onto an existing `AppSettingsSnapshot`.
 * Pure function — does not mutate the input snapshot.
 */
export function mergeAppSettingsPatch(
  snapshot: AppSettingsSnapshot,
  patch: AppSettingsPatch,
): AppSettingsSnapshot {
  let subagents = snapshot.subagents
  if (patch.subagents?.create) {
    const now = Date.now()
    subagents = [...subagents, {
      id: randomUUID(),
      ...patch.subagents.create,
      name: patch.subagents.create.name.trim(),
      triggerMode: patch.subagents.create.triggerMode ?? "auto",
      createdAt: now,
      updatedAt: now,
    }]
  } else if (patch.subagents?.update) {
    subagents = subagents.map((subagent): Subagent => subagent.id === patch.subagents?.update?.id
      ? {
          ...subagent,
          ...patch.subagents.update.patch,
          name: patch.subagents.update.patch.name?.trim() ?? subagent.name,
          description: patch.subagents.update.patch.description === null
            ? undefined
            : patch.subagents.update.patch.description ?? subagent.description,
          modelOptions: <Subagent["modelOptions"]>{ ...subagent.modelOptions, ...(patch.subagents.update.patch.modelOptions ?? {}) },
          workingDir: patch.subagents.update.patch.workingDir === null
            ? undefined
            : patch.subagents.update.patch.workingDir ?? subagent.workingDir,
          allowedPaths: patch.subagents.update.patch.allowedPaths === null
            ? undefined
            : patch.subagents.update.patch.allowedPaths ?? subagent.allowedPaths,
          maxTurns: patch.subagents.update.patch.maxTurns === null
            ? undefined
            : patch.subagents.update.patch.maxTurns ?? subagent.maxTurns,
          updatedAt: Date.now(),
        }
      : subagent)
  } else if (patch.subagents?.delete) {
    subagents = subagents.filter((subagent) => subagent.id !== patch.subagents?.delete?.id)
  }

  return {
    ...snapshot,
    ...patch,
    terminal: {
      ...snapshot.terminal,
      ...patch.terminal,
    },
    editor: {
      ...snapshot.editor,
      ...patch.editor,
    },
    providerDefaults: {
      claude: {
        ...snapshot.providerDefaults.claude,
        ...patch.providerDefaults?.claude,
        modelOptions: {
          ...snapshot.providerDefaults.claude.modelOptions,
          ...patch.providerDefaults?.claude?.modelOptions,
        },
      },
      codex: {
        ...snapshot.providerDefaults.codex,
        ...patch.providerDefaults?.codex,
        modelOptions: {
          ...snapshot.providerDefaults.codex.modelOptions,
          ...patch.providerDefaults?.codex?.modelOptions,
        },
      },
      openrouter: {
        ...snapshot.providerDefaults.openrouter,
        ...patch.providerDefaults?.openrouter,
        modelOptions: {},
      },
    },
    cloudflareTunnel: {
      ...snapshot.cloudflareTunnel,
      ...patch.cloudflareTunnel,
    },
    auth: {
      ...snapshot.auth,
      ...patch.auth,
    },
    claudeAuth: {
      tokens: patch.claudeAuth?.tokens ?? snapshot.claudeAuth.tokens,
      concurrencyDefault: patch.claudeAuth?.concurrencyDefault ?? snapshot.claudeAuth.concurrencyDefault,
    },
    uploads: {
      ...snapshot.uploads,
      ...patch.uploads,
    },
    subagents,
    customMcpServers: snapshot.customMcpServers,
    customModels: snapshot.customModels,
    textSnippets: snapshot.textSnippets,
    claudeDriver: {
      preference: patch.claudeDriver?.preference ?? snapshot.claudeDriver.preference,
      lifecycle: {
        ...snapshot.claudeDriver.lifecycle,
        ...patch.claudeDriver?.lifecycle,
      },
    },
    subagentRuntime: {
      runTimeoutMs: patch.subagentRuntime?.runTimeoutMs ?? snapshot.subagentRuntime.runTimeoutMs,
      defaultLoopSubagentId: patch.subagentRuntime?.defaultLoopSubagentId !== undefined
        ? patch.subagentRuntime.defaultLoopSubagentId
        : snapshot.subagentRuntime.defaultLoopSubagentId,
    },
  }
}

// ---------------------------------------------------------------------------
// buildInitialAppSettingsSnapshot — the out-of-the-box fallback snapshot
// ---------------------------------------------------------------------------

export function buildInitialAppSettingsSnapshot(): AppSettingsSnapshot {
  return {
    analyticsEnabled: true,
    browserSettingsMigrated: false,
    theme: "system",
    chatSoundPreference: "always",
    chatSoundId: "funk",
    terminal: {
      scrollbackLines: 1_000,
      minColumnWidth: 450,
    },
    editor: {
      preset: "cursor",
      commandTemplate: "cursor {path}",
    },
    defaultProvider: "last_used",
    providerDefaults: {
      claude: {
        model: "claude-opus-4-7",
        modelOptions: {
          reasoningEffort: "high",
          contextWindow: "200k",
        },
        planMode: false,
      },
      codex: {
        model: "gpt-5.5",
        modelOptions: {
          reasoningEffort: "high",
          fastMode: false,
        },
        planMode: false,
      },
      openrouter: {
        model: DEFAULT_OPENROUTER_SDK_MODEL,
        modelOptions: {},
        planMode: false,
      },
    },
    warning: null,
    filePathDisplay: "~/.kanna/data/settings.json",
    cloudflareTunnel: CLOUDFLARE_TUNNEL_DEFAULTS,
    auth: AUTH_DEFAULTS,
    claudeAuth: CLAUDE_AUTH_DEFAULTS,
    uploads: UPLOAD_DEFAULTS,
    subagents: [],
    customMcpServers: [],
    customModels: [],
    textSnippets: [],
    claudeDriver: { ...CLAUDE_DRIVER_DEFAULTS, lifecycle: { ...CLAUDE_PTY_LIFECYCLE_DEFAULTS } },
    globalPromptAppend: "",
    shareDefaultTtlHours: 24,
    subagentRuntime: { runTimeoutMs: 600_000, defaultLoopSubagentId: null },
  }
}

// ---------------------------------------------------------------------------
// buildFallbackDiffStore — noop DiffStore for when diffStore arg is absent
// ---------------------------------------------------------------------------

export function buildFallbackDiffStore() {
  return {
    getProjectSnapshot: (_projectId: string) => ({
      status: "unknown" as const,
      branchName: undefined,
      defaultBranchName: undefined,
      hasOriginRemote: undefined,
      originRepoSlug: undefined,
      hasUpstream: undefined,
      aheadCount: undefined,
      behindCount: undefined,
      lastFetchedAt: undefined,
      files: [],
      branchHistory: { entries: [] },
    }),
    refreshSnapshot: async (_projectId: string) => false as const,
    initializeGit: async () => ({ ok: true as const, branchName: undefined, snapshotChanged: false }),
    getGitHubPublishInfo: async () => ({
      ghInstalled: false,
      authenticated: false,
      activeAccountLogin: undefined,
      owners: [],
      suggestedRepoName: "my-repo",
    }),
    checkGitHubRepoAvailability: async () => ({ available: false, message: "Unavailable" }),
    publishToGitHub: async () => ({
      ok: false,
      title: "Publish failed",
      message: "Unavailable",
      snapshotChanged: false,
    }),
    listBranches: async () => ({
      recent: [],
      local: [],
      remote: [],
      pullRequests: [],
      pullRequestsStatus: "unavailable" as const,
    }),
    previewMergeBranch: async () => ({
      currentBranchName: undefined,
      targetBranchName: "",
      targetDisplayName: "",
      status: "error" as const,
      commitCount: 0,
      hasConflicts: false,
      message: "Merge preview unavailable.",
    }),
    mergeBranch: async () => ({
      ok: false as const,
      title: "Merge failed",
      message: "Merge unavailable.",
      snapshotChanged: false,
    }),
    syncBranch: async () => ({
      ok: true as const,
      action: "fetch" as const,
      branchName: undefined,
      snapshotChanged: false,
    }),
    checkoutBranch: async () => ({ ok: true as const, branchName: undefined, snapshotChanged: false }),
    createBranch: async () => ({ ok: true as const, branchName: "main", snapshotChanged: false }),
    generateCommitMessage: async () => ({
      subject: "Update selected files",
      body: "",
      usedFallback: true,
      failureMessage: null,
    }),
    commitFiles: async () => ({
      ok: true as const,
      mode: "commit_only" as const,
      branchName: undefined,
      pushed: false,
      snapshotChanged: false,
    }),
    discardFile: async () => ({ snapshotChanged: false }),
    ignoreFile: async () => ({ snapshotChanged: false }),
    readPatch: async () => ({ patch: "" }),
  }
}

// ---------------------------------------------------------------------------
// buildFallbackLlmProvider — noop LlmProvider for when llmProvider arg is absent
// ---------------------------------------------------------------------------

export function buildFallbackLlmProvider() {
  return {
    read: async (): Promise<LlmProviderSnapshot> => ({
      provider: "openai" as const,
      apiKey: "",
      model: "gpt-5.4-mini",
      baseUrl: "",
      resolvedBaseUrl: "https://api.openai.com/v1",
      enabled: false,
      warning: null,
      filePathDisplay: "~/.kanna/llm-provider.json",
    }),
    write: async ({
      provider,
      apiKey,
      model,
      baseUrl,
    }: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">): Promise<LlmProviderSnapshot> => {
      let resolvedBaseUrl: string
      if (provider === "openrouter") {
        resolvedBaseUrl = "https://openrouter.ai/api/v1"
      } else if (provider === "custom") {
        resolvedBaseUrl = baseUrl
      } else {
        resolvedBaseUrl = "https://api.openai.com/v1"
      }
      return {
        provider,
        apiKey,
        model,
        baseUrl,
        resolvedBaseUrl,
        enabled: false,
        warning: null,
        filePathDisplay: "~/.kanna/llm-provider.json",
      }
    },
    validate: async (
      _value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">,
    ): Promise<LlmProviderValidationResult> => ({
      ok: false,
      error: {
        type: "config_error",
        message: "LLM provider validation unavailable.",
      },
    }),
  }
}

// ---------------------------------------------------------------------------
// buildResolvedAppSettings — wraps optional AppSettingsManager with in-memory
// fallback, enabling all callers to treat settings as always-present.
// ---------------------------------------------------------------------------

type AppSettingsManagerSubset = Pick<AppSettingsManager,
  "getSnapshot" | "write"
> & Partial<Pick<AppSettingsManager,
  "setCloudflareTunnel" | "setClaudeAuth" | "writePatch" | "onChange" |
  "createSubagent" | "updateSubagent" | "deleteSubagent"
>>

export function buildResolvedAppSettings(
  appSettings: AppSettingsManagerSubset | null | undefined,
) {
  let fallbackSnapshot: AppSettingsSnapshot = buildInitialAppSettingsSnapshot()

  const self = {
    getSnapshot: (): AppSettingsSnapshot =>
      appSettings?.getSnapshot() ?? fallbackSnapshot,

    write: async (value: { analyticsEnabled: boolean }): Promise<AppSettingsSnapshot> => {
      if (appSettings) return await appSettings.write(value)
      fallbackSnapshot = { ...fallbackSnapshot, analyticsEnabled: value.analyticsEnabled }
      return fallbackSnapshot
    },

    writePatch: async (patch: AppSettingsPatch): Promise<AppSettingsSnapshot> => {
      if (appSettings?.writePatch) return await appSettings.writePatch(patch)
      if (appSettings && patch.analyticsEnabled !== undefined && Object.keys(patch).length === 1) {
        return await appSettings.write({ analyticsEnabled: patch.analyticsEnabled })
      }
      fallbackSnapshot = mergeAppSettingsPatch(appSettings?.getSnapshot() ?? fallbackSnapshot, patch)
      return fallbackSnapshot
    },

    setCloudflareTunnel: async (
      patch: Partial<AppSettingsSnapshot["cloudflareTunnel"]>,
    ): Promise<AppSettingsSnapshot> => {
      if (appSettings?.setCloudflareTunnel) return await appSettings.setCloudflareTunnel(patch)
      fallbackSnapshot = mergeAppSettingsPatch(appSettings?.getSnapshot() ?? fallbackSnapshot, { cloudflareTunnel: patch })
      return fallbackSnapshot
    },

    setClaudeAuth: async (
      patch: Partial<AppSettingsSnapshot["claudeAuth"]>,
    ): Promise<AppSettingsSnapshot> => {
      if (appSettings?.setClaudeAuth) return await appSettings.setClaudeAuth(patch)
      fallbackSnapshot = mergeAppSettingsPatch(
        appSettings?.getSnapshot() ?? fallbackSnapshot,
        { claudeAuth: patch },
      )
      return fallbackSnapshot
    },

    createSubagent: async (
      input: Parameters<AppSettingsManager["createSubagent"]>[0],
    ): ReturnType<AppSettingsManager["createSubagent"]> => {
      if (appSettings?.createSubagent) return await appSettings.createSubagent(input)
      const snapshot = await self.writePatch({ subagents: { create: input } })
      return snapshot.subagents[snapshot.subagents.length - 1]
        ?? { code: "NOT_FOUND" as const, message: "Created subagent not found" }
    },

    updateSubagent: async (
      id: string,
      patch: Parameters<AppSettingsManager["updateSubagent"]>[1],
    ): ReturnType<AppSettingsManager["updateSubagent"]> => {
      if (appSettings?.updateSubagent) return await appSettings.updateSubagent(id, patch)
      const snapshot = await self.writePatch({ subagents: { update: { id, patch } } })
      return snapshot.subagents.find((subagent) => subagent.id === id)
        ?? { code: "NOT_FOUND" as const, message: `Subagent ${id} not found` }
    },

    deleteSubagent: async (id: string): ReturnType<AppSettingsManager["deleteSubagent"]> => {
      if (appSettings?.deleteSubagent) return await appSettings.deleteSubagent(id)
      await self.writePatch({ subagents: { delete: { id } } })
    },

    onChange: (
      listener: (snapshot: AppSettingsSnapshot) => void,
    ): (() => void) =>
      appSettings?.onChange?.(listener) ?? (() => {}),
  }

  return self
}

/** The inferred return type of buildResolvedAppSettings. */
export type ResolvedAppSettings = ReturnType<typeof buildResolvedAppSettings>
