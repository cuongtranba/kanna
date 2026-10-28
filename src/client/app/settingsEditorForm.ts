import { errorMessage } from "../../shared/errors"

export interface EditorSubmitState {
  error?: string | null
}

export async function submitEditorForm(args: {
  patch: (patch: EditorSubmitState) => void
  save: () => Promise<void>
  onDone: () => void
}): Promise<void> {
  args.patch({ error: null })
  try {
    await args.save()
    args.onDone()
  } catch (cause) {
    args.patch({ error: errorMessage(cause) })
  }
}

export function editorSubmitLabel(args: {
  submitting: boolean
  isEdit: boolean
  addLabel: string
}): string {
  if (args.submitting) return "Saving…"
  return args.isEdit ? "Save changes" : args.addLabel
}
