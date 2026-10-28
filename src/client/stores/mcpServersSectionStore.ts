import { create } from "zustand"
import type { McpServerConfig } from "../../shared/types"
import { mcpServerToDraft, type McpServerDraft } from "../lib/mcpServerDraft"
import { LIST_EDITING, type SectionEditing } from "../lib/sectionEditing"

export interface EditorFormState extends McpServerDraft {
  error: string | null
  oauthEnabled: boolean
  authFlowUrl: string | null
  callbackInput: string
  oauthError: string | null
  authenticating: boolean
  completing: boolean
}

function createEditorFormFromInitial(initial: McpServerConfig | null): EditorFormState {
  return {
    ...mcpServerToDraft(initial),
    error: null,
    oauthEnabled:
      initial !== null && initial.transport !== "stdio"
        ? (initial.oauth?.enabled ?? false)
        : false,
    authFlowUrl: null,
    callbackInput: "",
    oauthError: null,
    authenticating: false,
    completing: false,
  }
}

interface McpServersSectionState {
  editing: SectionEditing

  editorForm: EditorFormState

  setEditing: (editing: SectionEditing) => void
  resetEditorForm: (initial: McpServerConfig | null) => void
  patchEditorForm: (patch: Partial<EditorFormState>) => void
}

export const useMcpServersSectionStore = create<McpServersSectionState>()((set) => ({
  editing: LIST_EDITING,
  editorForm: createEditorFormFromInitial(null),

  setEditing: (editing) => set({ editing }),

  resetEditorForm: (initial) => set({ editorForm: createEditorFormFromInitial(initial) }),

  patchEditorForm: (patch) =>
    set((state) => ({ editorForm: { ...state.editorForm, ...patch } })),
}))
