import { useBackgroundTasksStore } from "../stores/backgroundTasksStore"

/**
 * Fire a one-time boot toast when the server reports orphan processes were
 * recovered. The caller is responsible for ensuring this runs at most once
 * per session (the `orphanToastShown` guard in useKannaState).
 *
 * Sonner is imported lazily so test environments that transitively import
 * this module don't eagerly resolve sonner's ESM (Bun on Linux fails to
 * resolve the Toaster/toast exports from sonner@2.0.7).
 */
export async function fireOrphanRecoveryToast(count: number): Promise<void> {
  const { toast } = await import("sonner")
  const label = count === 1 ? "process" : "processes"
  toast(`${count} ${label} survived restart`, {
    description: "Review and stop them in Background tasks (⌘⇧B).",
    action: {
      label: "Review",
      onClick: () => useBackgroundTasksStore.getState().openDialog(),
    },
  })
}
