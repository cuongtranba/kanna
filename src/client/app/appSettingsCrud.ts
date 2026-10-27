import { useCallback, useMemo } from "react"
import type {
  AppSettingsPatch,
  CollectionPatch,
  CustomModelInput,
  CustomModelPatch,
  McpServerInput,
  McpServerPatch,
  TextSnippetInput,
  TextSnippetPatch,
} from "../../shared/types"
import type { CustomProviderInput, CustomProviderPatch } from "../../shared/custom-providers"
import type { McpSourceInput, McpSourcePatch } from "../../shared/mcp-sources/types"
import type { KannaState } from "./useKannaState"

interface CrudEntities {
  customMcpServers: { input: McpServerInput; patch: McpServerPatch }
  mcpSources: { input: McpSourceInput; patch: McpSourcePatch }
  customModels: { input: CustomModelInput; patch: CustomModelPatch }
  customProviders: { input: CustomProviderInput; patch: CustomProviderPatch }
  textSnippets: { input: TextSnippetInput; patch: TextSnippetPatch }
}

export type AppSettingsCrudKey = keyof CrudEntities
export type AppSettingsEnableKey = "customMcpServers" | "mcpSources"

type CrudBranch<K extends AppSettingsCrudKey> = CollectionPatch<CrudEntities[K]["input"], CrudEntities[K]["patch"]>

export interface AppSettingsCrudHandlers<Input, Patch> {
  onCreate: (input: Input) => Promise<void>
  onUpdate: (id: string, patch: Patch) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const CRUD_PATCH_BUILDERS: { [K in AppSettingsCrudKey]: (branch: CrudBranch<K>) => AppSettingsPatch } = {
  customMcpServers: (customMcpServers) => ({ customMcpServers }),
  mcpSources: (mcpSources) => ({ mcpSources }),
  customModels: (customModels) => ({ customModels }),
  customProviders: (customProviders) => ({ customProviders }),
  textSnippets: (textSnippets) => ({ textSnippets }),
}

const ENABLE_PATCH_BUILDERS: {
  [K in AppSettingsEnableKey]: (setEnabled: { id: string; enabled: boolean }) => AppSettingsPatch
} = {
  customMcpServers: (setEnabled) => ({ customMcpServers: { setEnabled } }),
  mcpSources: (setEnabled) => ({ mcpSources: { setEnabled } }),
}

export function useAppSettingsCrudHandlers<K extends AppSettingsCrudKey>(
  key: K,
  state: Pick<KannaState, "handleWriteAppSettings">,
): AppSettingsCrudHandlers<CrudEntities[K]["input"], CrudEntities[K]["patch"]> {
  return useMemo(() => {
    const build = CRUD_PATCH_BUILDERS[key]
    return {
      onCreate: async (input) => {
        await state.handleWriteAppSettings(build({ create: input }))
      },
      onUpdate: async (id, patch) => {
        await state.handleWriteAppSettings(build({ update: { id, patch } }))
      },
      onDelete: async (id) => {
        await state.handleWriteAppSettings(build({ delete: { id } }))
      },
    }
  }, [key, state])
}

export function useAppSettingsSetEnabled(
  key: AppSettingsEnableKey,
  state: Pick<KannaState, "handleWriteAppSettings">,
): (id: string, enabled: boolean) => Promise<void> {
  return useCallback(
    async (id, enabled) => {
      await state.handleWriteAppSettings(ENABLE_PATCH_BUILDERS[key]({ id, enabled }))
    },
    [key, state],
  )
}
