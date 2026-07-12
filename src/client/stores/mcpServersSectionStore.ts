import { create } from "zustand"
import type { McpServerConfig, McpServerTransport } from "../../shared/types"

// Stable empty ref to avoid fresh Set on every setState
const EMPTY_TESTING_IDS: ReadonlySet<string> = new Set()

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
  submitting: boolean
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
    submitting: false,
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
  // McpServersSettingsBranch
  editing: EditingState

  // McpRow per-server test-in-progress tracking (replaces per-row useState(false))
  testingServerIds: ReadonlySet<string>

  // McpServerEditor form state (all 16 useState calls)
  editorForm: EditorFormState

  // Actions
  setEditing: (editing: EditingState) => void
  setServerTesting: (id: string, testing: boolean) => void
  resetEditorForm: (initial: McpServerConfig | null) => void
  setEditorName: (name: string) => void
  setEditorTransport: (transport: McpServerTransport) => void
  setEditorCommand: (command: string) => void
  setEditorArgsText: (argsText: string) => void
  setEditorEnvText: (envText: string) => void
  setEditorCwd: (cwd: string) => void
  setEditorUrl: (url: string) => void
  setEditorHeadersText: (headersText: string) => void
  setEditorError: (error: string | null) => void
  setEditorSubmitting: (submitting: boolean) => void
  setEditorOauthEnabled: (enabled: boolean) => void
  setEditorAuthFlowUrl: (url: string | null) => void
  setEditorCallbackInput: (input: string) => void
  setEditorOauthError: (error: string | null) => void
  setEditorAuthenticating: (authenticating: boolean) => void
  setEditorCompleting: (completing: boolean) => void
}

export const useMcpServersSectionStore = create<McpServersSectionState>()((set) => ({
  editing: { kind: "list" },
  testingServerIds: EMPTY_TESTING_IDS,
  editorForm: createEditorFormFromInitial(null),

  setEditing: (editing) => set({ editing }),

  setServerTesting: (id, testing) =>
    set((state) => {
      const next = new Set(state.testingServerIds)
      if (testing) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return { testingServerIds: next.size === 0 ? EMPTY_TESTING_IDS : next }
    }),

  resetEditorForm: (initial) => set({ editorForm: createEditorFormFromInitial(initial) }),

  setEditorName: (name) =>
    set((state) => ({ editorForm: { ...state.editorForm, name } })),
  setEditorTransport: (transport) =>
    set((state) => ({ editorForm: { ...state.editorForm, transport } })),
  setEditorCommand: (command) =>
    set((state) => ({ editorForm: { ...state.editorForm, command } })),
  setEditorArgsText: (argsText) =>
    set((state) => ({ editorForm: { ...state.editorForm, argsText } })),
  setEditorEnvText: (envText) =>
    set((state) => ({ editorForm: { ...state.editorForm, envText } })),
  setEditorCwd: (cwd) =>
    set((state) => ({ editorForm: { ...state.editorForm, cwd } })),
  setEditorUrl: (url) =>
    set((state) => ({ editorForm: { ...state.editorForm, url } })),
  setEditorHeadersText: (headersText) =>
    set((state) => ({ editorForm: { ...state.editorForm, headersText } })),
  setEditorError: (error) =>
    set((state) => ({ editorForm: { ...state.editorForm, error } })),
  setEditorSubmitting: (submitting) =>
    set((state) => ({ editorForm: { ...state.editorForm, submitting } })),
  setEditorOauthEnabled: (oauthEnabled) =>
    set((state) => ({ editorForm: { ...state.editorForm, oauthEnabled } })),
  setEditorAuthFlowUrl: (authFlowUrl) =>
    set((state) => ({ editorForm: { ...state.editorForm, authFlowUrl } })),
  setEditorCallbackInput: (callbackInput) =>
    set((state) => ({ editorForm: { ...state.editorForm, callbackInput } })),
  setEditorOauthError: (oauthError) =>
    set((state) => ({ editorForm: { ...state.editorForm, oauthError } })),
  setEditorAuthenticating: (authenticating) =>
    set((state) => ({ editorForm: { ...state.editorForm, authenticating } })),
  setEditorCompleting: (completing) =>
    set((state) => ({ editorForm: { ...state.editorForm, completing } })),
}))
