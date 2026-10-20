import { create } from "zustand"
import type { ConnectionDraft, ConsumerDraft, EmbeddedDraft, StreamDraft } from "../lib/serviceBusDraft"

export type ConsumerEditorTarget = { kind: "new" } | { kind: "edit"; durableName: string }

interface ConsumerEditor {
  target: ConsumerEditorTarget
  draft: ConsumerDraft
}

interface ServiceBusSectionState {
  connection: ConnectionDraft | null
  stream: StreamDraft | null
  embedded: EmbeddedDraft | null
  consumerEditor: ConsumerEditor | null
  resetConfirm: boolean
  error: string | null
  editConnection: (base: ConnectionDraft, patch: Partial<ConnectionDraft>) => void
  discardConnection: () => void
  editStream: (base: StreamDraft, patch: Partial<StreamDraft>) => void
  discardStream: () => void
  editEmbedded: (base: EmbeddedDraft, patch: Partial<EmbeddedDraft>) => void
  discardEmbedded: () => void
  openConsumerEditor: (target: ConsumerEditorTarget, draft: ConsumerDraft) => void
  editConsumer: (patch: Partial<ConsumerDraft>) => void
  closeConsumerEditor: () => void
  askResetConfirm: () => void
  cancelResetConfirm: () => void
  setError: (error: string | null) => void
}

export const useServiceBusSectionStore = create<ServiceBusSectionState>()((set) => ({
  connection: null,
  stream: null,
  embedded: null,
  consumerEditor: null,
  resetConfirm: false,
  error: null,
  editConnection: (base, patch) => set((state) => ({ connection: { ...(state.connection ?? base), ...patch } })),
  discardConnection: () => set({ connection: null }),
  editStream: (base, patch) => set((state) => ({ stream: { ...(state.stream ?? base), ...patch } })),
  discardStream: () => set({ stream: null }),
  editEmbedded: (base, patch) => set((state) => ({ embedded: { ...(state.embedded ?? base), ...patch } })),
  discardEmbedded: () => set({ embedded: null }),
  openConsumerEditor: (target, draft) => set({ consumerEditor: { target, draft } }),
  editConsumer: (patch) =>
    set((state) => (state.consumerEditor === null ? state : { consumerEditor: { ...state.consumerEditor, draft: { ...state.consumerEditor.draft, ...patch } } })),
  closeConsumerEditor: () => set({ consumerEditor: null }),
  askResetConfirm: () => set({ resetConfirm: true }),
  cancelResetConfirm: () => set({ resetConfirm: false }),
  setError: (error) => set({ error }),
}))
