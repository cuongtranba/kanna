import type { ReactNode } from "react"
import { TEXT_PREVIEW_LIMIT_BYTES } from "../../attachmentPreview"
import { formatByteSize } from "../../../../lib/formatByteSize"
import type { TextLoadState } from "./textLoader"

interface TextBodyFrameProps {
  state: TextLoadState
  shell: ReactNode
  extraNotices?: readonly string[]
  readyClassName?: string
  children: (content: string) => ReactNode
}

export function TextBodyFrame({
  state,
  shell,
  extraNotices = [],
  readyClassName = "space-y-2 p-3",
  children,
}: TextBodyFrameProps) {
  if (state.status === "loading") {
    return <div className="p-4 text-sm text-muted-foreground">{shell} Loading…</div>
  }
  if (state.status === "error") {
    return <div className="p-4 text-sm text-destructive">{shell} {state.message}</div>
  }
  const notices = [
    state.truncated ? `Preview truncated to ${formatByteSize(TEXT_PREVIEW_LIMIT_BYTES)}.` : null,
    ...extraNotices,
  ].filter(Boolean)
  return (
    <div className={readyClassName}>
      {notices.length > 0 ? (
        <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
          {notices.join(" ")}
        </div>
      ) : null}
      {children(state.content)}
    </div>
  )
}

export const PREVIEW_PRE_CLASS = "whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3 text-xs"
