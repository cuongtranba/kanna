import { toast } from "sonner"
import { useBackgroundTasksStore } from "../stores/backgroundTasksStore"

/**
 * Fire a one-time boot toast when the server reports orphan processes were
 * recovered. The caller is responsible for ensuring this runs at most once
 * per session (the `orphanToastShown` guard in useKannaState).
 */
export function fireOrphanRecoveryToast(count: number): void {
  const label = count === 1 ? "process" : "processes"
  toast(`${count} ${label} survived restart`, {
    description: "Review and stop them in Background tasks (⌘⇧B).",
    action: {
      label: "Review",
      onClick: () => useBackgroundTasksStore.getState().openDialog(),
    },
  })
}
