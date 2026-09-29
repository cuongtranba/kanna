import { useCallback, useEffect, useMemo } from "react"
import { JSONUIProvider, Renderer, useActions, type Spec } from "@json-render/react"
import { AlertTriangle, MessageSquareText, X } from "lucide-react"
import type { GenUISpec } from "../../../shared/genui"
import { probeFileUrl } from "../../api/files"
import { toLocalFileUrl } from "../../lib/pathUtils"
import { runDetached } from "../../lib/runDetached"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"
import { FilePreviewSheet } from "../messages/file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "../messages/file-preview/types"
import { Button } from "../ui/button"
import { createGenUIActionHandlers, type GenUIActionHandlers } from "./actions"
import { useGenUIHost } from "./host"
import { GENUI_REGISTRY, UnknownElement } from "./registry"
import { GenUIViewContextProvider } from "./view-context"
import { viewStateStore } from "./view-state-registry"
import { ELEMENT_KEY_PROP } from "./useElementUiState"
import { GenUIViewStore } from "./view-store"

function toRenderSpec(spec: GenUISpec): Spec {
  return {
    root: spec.root,
    elements: Object.fromEntries(Object.entries(spec.elements).map(([key, element]) => [key, {
      type: element.type,
      props: { ...element.props, [ELEMENT_KEY_PROP]: key },
      children: element.children,
      ...(element.visible !== undefined ? { visible: element.visible } : {}),
      ...(element.repeat ? { repeat: element.repeat } : {}),
      ...(element.on ? { on: element.on } : {}),
    }])),
    ...(spec.state ? { state: spec.state } : {}),
  }
}

function AgentConfirmStrip({ viewKey }: { viewKey: string }) {
  const host = useGenUIHost()
  const pendingMessage = GenUIViewStore.useScopedStore((state) => state.pendingAgentMessage)
  const cancel = GenUIViewStore.useScopedStore((state) => state.cancelAgentMessage)
  const showNotice = GenUIViewStore.useScopedStore((state) => state.showNotice)
  const key = pendingActionKey("genui.agent.send", viewKey)
  const sending = usePendingAction(key)
  const send = host.sendToAgent
  const handleSend = useCallback(() => {
    if (!pendingMessage || !send) return
    runPendingAction(key, async () => {
      try {
        await send(pendingMessage.message)
        cancel()
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "The message could not be sent")
        throw error
      }
    })
  }, [cancel, key, pendingMessage, send, showNotice])
  if (!pendingMessage) return null
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3" role="group" aria-label="Send to the agent">
      <div className="flex items-start gap-2 text-sm">
        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Send to the agent</p>
          <p className="break-words text-foreground">{pendingMessage.headline}</p>
          <p className="text-xs text-muted-foreground">The view's current numbers and data source go with it.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" pending={sending} onClick={handleSend}>Send</Button>
        <Button size="sm" variant="ghost" onClick={cancel} disabled={sending}>Cancel</Button>
      </div>
    </div>
  )
}

function ViewNotice() {
  const notice = GenUIViewStore.useScopedStore((state) => state.notice)
  const dismiss = GenUIViewStore.useScopedStore((state) => state.showNotice)
  if (!notice) return null
  return (
    <p className="flex items-center gap-1.5 text-xs text-destructive-text" role="alert">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{notice}</span>
      <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Dismiss" onClick={() => dismiss(null)}>
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </p>
  )
}

function basename(path: string): string {
  const index = path.lastIndexOf("/")
  return index >= 0 ? path.slice(index + 1) : path
}

function GenUIFilePreview() {
  const previewPath = GenUIViewStore.useScopedStore((state) => state.previewPath)
  const probe = GenUIViewStore.useScopedStore((state) => state.previewProbe)
  const setProbe = GenUIViewStore.useScopedStore((state) => state.setPreviewProbe)
  const closePreview = GenUIViewStore.useScopedStore((state) => state.closePreview)
  const showNotice = GenUIViewStore.useScopedStore((state) => state.showNotice)

  useEffect(() => {
    if (!previewPath) return
    const controller = new AbortController()
    runDetached("probe generated file link", probeFileUrl(toLocalFileUrl(previewPath), { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      if (result.kind === "ready") setProbe(result)
      else {
        closePreview()
        showNotice(`"${basename(previewPath)}" could not be opened`)
      }
    }))
    return () => controller.abort()
  }, [closePreview, previewPath, setProbe, showNotice])

  const source = useMemo(() => {
    if (!previewPath || probe?.kind !== "ready") return null
    const contentUrl = toLocalFileUrl(previewPath)
    return toPreviewSourceFromAttachment({
      id: `genui-file-${contentUrl}`,
      kind: "file",
      displayName: basename(previewPath),
      absolutePath: previewPath,
      relativePath: previewPath,
      contentUrl,
      mimeType: probe.mimeType,
      size: probe.size,
    }, "local_file_link")
  }, [previewPath, probe])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) closePreview()
  }, [closePreview])

  return <FilePreviewSheet source={source} open={source !== null} onOpenChange={handleOpenChange} />
}

function HandlerSync({ handlers }: { handlers: GenUIActionHandlers }) {
  const { registerHandler } = useActions()
  useEffect(() => {
    for (const [name, handler] of Object.entries(handlers)) registerHandler(name, handler)
  }, [handlers, registerHandler])
  return null
}

function GenUIViewContent({ spec, viewKey }: { spec: GenUISpec; viewKey: string }) {
  const host = useGenUIHost()
  const viewApi = GenUIViewStore.useScopedStoreApi()
  const store = useMemo(() => viewStateStore(viewKey, spec.state ?? {}), [viewKey, spec.state])
  const handlers = useMemo(
    () => createGenUIActionHandlers({ host: () => host, view: viewApi, spec, state: store }),
    [host, viewApi, spec, store],
  )
  const renderSpec = useMemo(() => toRenderSpec(spec), [spec])
  const context = useMemo(() => ({ spec, viewKey }), [spec, viewKey])

  return (
    <GenUIViewContextProvider value={context}>
      <section className="@container not-prose my-3 flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:p-4" aria-label={spec.title ?? "Generated view"}>
        {spec.title ? <h3 className="text-base font-medium text-foreground">{spec.title}</h3> : null}
        <JSONUIProvider registry={GENUI_REGISTRY} store={store} handlers={handlers}>
          <HandlerSync handlers={handlers} />
          <Renderer spec={renderSpec} registry={GENUI_REGISTRY} fallback={UnknownElement} />
        </JSONUIProvider>
        <ViewNotice />
        <AgentConfirmStrip viewKey={viewKey} />
        <GenUIFilePreview />
      </section>
    </GenUIViewContextProvider>
  )
}

export function GenUIView({ spec, viewKey }: { spec: GenUISpec; viewKey: string }) {
  return (
    <GenUIViewStore.Provider init={undefined}>
      <GenUIViewContent spec={spec} viewKey={viewKey} />
    </GenUIViewStore.Provider>
  )
}
