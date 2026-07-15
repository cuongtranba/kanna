import { useCallback } from "react"
import { Boxes, Plus } from "lucide-react"
import type { OrchRunDetail, OrchRunInput } from "../../shared/orchestration-types"
import type { KannaSocket } from "./socket"
import { useOrchRunsStore, selectOrchRuns } from "../stores/orchRunsStore"
import { OrchestrationSectionWithDetail } from "./OrchestrationSection"
import { OrchNewRunDialog, type OrchRunSubmitResult } from "./OrchNewRunDialog"
import { OrchestrationPanelStore } from "./OrchestrationPanel.store"
import { Button } from "../components/ui/button"

/**
 * Chat-footer container for the orchestration panel: the live run list (global,
 * from the `orch-runs` topic) + a "New run" trigger. Self-contained — reads the
 * global store and dispatches WS commands via the socket. Renders nothing when
 * there are no runs and no chat to start one from.
 */
export function OrchestrationPanel(props: { socket: KannaSocket; chatId: string | null }) {
  return (
    <OrchestrationPanelStore.Provider init={undefined}>
      <OrchestrationPanelInner {...props} />
    </OrchestrationPanelStore.Provider>
  )
}

function OrchestrationPanelInner({ socket, chatId }: { socket: KannaSocket; chatId: string | null }) {
  const runs = useOrchRunsStore(selectOrchRuns)
  const dialogOpen = OrchestrationPanelStore.useScopedStore((s) => s.dialogOpen)
  const setDialogOpen = OrchestrationPanelStore.useScopedStore((s) => s.setDialogOpen)

  const getRunDetail = useCallback(
    (runId: string) => socket.command<OrchRunDetail | null>({ type: "orch.getRun", runId }),
    [socket],
  )
  const onCancelRun = useCallback(
    (runId: string) => { void socket.command({ type: "orch.cancelRun", runId }).catch(() => {}) },
    [socket],
  )
  const onSubmit = useCallback(
    async (input: OrchRunInput): Promise<OrchRunSubmitResult> => {
      if (!chatId) return { ok: false, errors: ["No active chat to start a run from."] }
      return socket.command<OrchRunSubmitResult>({ type: "orch.run", chatId, input })
    },
    [socket, chatId],
  )

  if (runs.length === 0 && !chatId) return null

  return (
    <div className="flex flex-col gap-2" data-testid="orchestration-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Boxes className="size-3.5" aria-hidden />
          Orchestration
        </span>
        {chatId ? (
          <Button
            variant="outline"
            size="sm"
            data-testid="orch-new-run"
            onClick={() => setDialogOpen(true)}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Plus className="size-3.5" aria-hidden />
            New run
          </Button>
        ) : null}
      </div>
      {runs.length > 0 ? (
        <OrchestrationSectionWithDetail runs={runs} getRunDetail={getRunDetail} onCancelRun={onCancelRun} />
      ) : null}
      <OrchNewRunDialog open={dialogOpen} onOpenChange={setDialogOpen} onSubmit={onSubmit} />
    </div>
  )
}
