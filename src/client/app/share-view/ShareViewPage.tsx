import { useMemo } from "react"
import { Flower } from "lucide-react"
import type { ChatSnapshot } from "../../../shared/session-share/types"
import { GenUIHostProvider } from "../../components/genui/host"
import { TranscriptRenderOptionsProvider } from "../../components/messages/render-context"
import { processTranscriptMessages } from "../../lib/parseTranscript"
import { TranscriptRowFrame } from "../ChatPage/TranscriptRowFrame"
import { getLatestToolIds } from "../derived"
import { buildResolvedTranscriptRows } from "../KannaTranscript"
import { DEFAULT_TRANSCRIPT_ACTIONS, TranscriptActionsProvider } from "../transcriptActionsContext"
import { buildTranscriptGapClassMap } from "../transcriptSpacing"
import { createShareGenUIHost } from "./shareGenUIHost"
import { ShareViewStore } from "./ShareView.store"
import { snapshotDatasets, snapshotTranscriptEntries } from "./snapshotEntries"

export interface ShareViewPageProps {
  snapshot: ChatSnapshot
}

const SHARE_VIEW_RENDER_OPTIONS = { readonly: true, localLinkMode: "text" } as const

function ShareViewPageInner({ snapshot }: ShareViewPageProps) {
  const { chatMeta } = snapshot
  const toolGroupExpanded = ShareViewStore.useScopedStore((s) => s.toolGroupExpanded)
  const setToolGroupExpanded = ShareViewStore.useScopedStore((s) => s.setToolGroupExpanded)

  const rows = useMemo(() => {
    const messages = processTranscriptMessages(snapshotTranscriptEntries(snapshot))
    return buildResolvedTranscriptRows(messages, { isLoading: false, latestToolIds: getLatestToolIds(messages) })
  }, [snapshot])
  const gapClassByRowId = useMemo(() => buildTranscriptGapClassMap(rows), [rows])
  const genuiHost = useMemo(() => createShareGenUIHost(snapshotDatasets(snapshot)), [snapshot])
  const actions = useMemo(
    () => ({ ...DEFAULT_TRANSCRIPT_ACTIONS, onToolGroupExpandedChange: setToolGroupExpanded }),
    [setToolGroupExpanded],
  )

  return (
    <TranscriptRenderOptionsProvider value={SHARE_VIEW_RENDER_OPTIONS}>
      <TranscriptActionsProvider value={actions}>
        <GenUIHostProvider value={genuiHost}>
          <main className="h-[100dvh] overflow-y-auto overscroll-contain bg-background text-foreground">
            <header className="sticky top-0 z-10 border-b border-border bg-background">
              <div className="mx-auto flex w-full max-w-[800px] items-center gap-3 px-4 py-3 sm:px-6">
                <Flower className="h-5 w-5 text-logo shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-sm font-semibold text-foreground">{chatMeta.title}</h1>
                  <p className="truncate text-xs text-muted-foreground">
                    Read-only · model {chatMeta.model}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium tracking-wide text-muted-foreground">
                  Shared
                </span>
              </div>
            </header>
            <div className="px-3 pb-12 pt-4 sm:px-6">
              {rows.map((row) => (
                <div key={row.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_120px]">
                  <TranscriptRowFrame
                    row={row}
                    gapClass={gapClassByRowId.get(row.id) ?? "pt-4"}
                    arriveIndex={undefined}
                    toolGroupExpanded={row.kind === "tool-group" ? (toolGroupExpanded[row.id] ?? false) : undefined}
                    runTree={null}
                  />
                </div>
              ))}
              {rows.length === 0 ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">
                  This shared chat has no messages.
                </p>
              ) : null}
            </div>
          </main>
        </GenUIHostProvider>
      </TranscriptActionsProvider>
    </TranscriptRenderOptionsProvider>
  )
}

export function ShareViewPage({ snapshot }: ShareViewPageProps) {
  return (
    <ShareViewStore.Provider init={{}}>
      <ShareViewPageInner snapshot={snapshot} />
    </ShareViewStore.Provider>
  )
}
