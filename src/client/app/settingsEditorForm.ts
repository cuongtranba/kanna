/**
 * The submit lifecycle every Settings CRUD editor shares: mark the form busy and
 * clear the previous error atomically, save, leave the editor on success, and
 * surface the failure in the form itself rather than throwing at the user.
 */
export interface EditorSubmitState {
  submitting?: boolean
  error?: string | null
}

export async function submitEditorForm(args: {
  patch: (patch: EditorSubmitState) => void
  save: () => Promise<void>
  onDone: () => void
  fallbackMessage: string
}): Promise<void> {
  args.patch({ submitting: true, error: null })
  try {
    await args.save()
    args.onDone()
  } catch (cause) {
    args.patch({ error: cause instanceof Error ? cause.message : args.fallbackMessage })
  } finally {
    args.patch({ submitting: false })
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
