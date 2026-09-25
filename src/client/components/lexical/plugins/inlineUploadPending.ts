import { pendingActionKey, runPendingAction, usePendingActionsStore } from "../../../stores/pendingActionsStore"

const INLINE_UPLOAD_SCOPE = "composer.inlineUpload"

function inlineUploadPrefix(ownerId: string): string {
  return `${pendingActionKey(INLINE_UPLOAD_SCOPE, ownerId)}:`
}

export function runInlineUpload(ownerId: string, upload: () => Promise<void>): void {
  runPendingAction(pendingActionKey(INLINE_UPLOAD_SCOPE, ownerId, crypto.randomUUID()), upload)
}

export function useInlineUploadsPending(ownerId: string): boolean {
  const prefix = inlineUploadPrefix(ownerId)
  return usePendingActionsStore((state) => Object.keys(state.inFlight).some((key) => key.startsWith(prefix)))
}
