import { create } from "zustand"
import type { McpServerConfig, McpServerTransport } from "../../shared/types"


export type EditingState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string }

export interface EditorFormState {
  name: string
  transport: McpServerTransport
  command: string
  argsText: string
  envText: string
  cwd: string
  url: string
  headersText: string
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
    name: initial?.name ?? "",
    transport: initial?.transport ?? "stdio",
    command: initial?.transport === "stdio" ? initial.command : "",
    argsText: initial?.transport === "stdio" ? initial.args.join("\n") : "",
    envText:
      initial?.transport === "stdio"
        ? Object.entries(initial.env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : "",
    cwd: initial?.transport === "stdio" ? (initial.cwd ?? "") : "",
    url: initial !== null && initial.transport !== "stdio" ? initial.url : "",
    headersText:
      initial !== null && initial.transport !== "stdio"
        ? Object.entries(initial.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : "",
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
  editing: EditingState

  editorForm: EditorFormState

  setEditing: (editing: EditingState) => void
  resetEditorForm: (initial: McpServerConfig | null) => void
  patchEditorForm: (patch: Partial<EditorFormState>) => void
}

export const useMcpServersSectionStore = create<McpServersSectionState>()((set) => ({
  editing: { kind: "list" },
  editorForm: createEditorFormFromInitial(null),

  setEditing: (editing) => set({ editing }),

  resetEditorForm: (initial) => set({ editorForm: createEditorFormFromInitial(initial) }),

  patchEditorForm: (patch) =>
    set((state) => ({ editorForm: { ...state.editorForm, ...patch } })),
}))
