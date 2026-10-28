import { useMemo } from "react"
import { TABLE_PREVIEW_COLUMN_LIMIT, parseDelimitedPreview } from "../../attachmentPreview"
import { useTextBodyContent } from "./textLoader"
import { TextBodyFrame } from "./TextBodyFrame"
import type { PreviewSource } from "../types"

export function TableBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  const delimiter = source.mimeType === "text/tab-separated-values" ? "\t" : ","
  const table = useMemo(
    () => (state.status === "ready" ? parseDelimitedPreview(state.content, delimiter) : null),
    [state, delimiter],
  )
  const extraNotices = table === null ? [] : [
    table.truncatedRows ? `Showing first ${table.rows.length} of ${table.rowCount} rows.` : null,
    table.truncatedColumns ? `Showing first ${TABLE_PREVIEW_COLUMN_LIMIT} of ${table.columnCount} columns.` : null,
  ].filter((notice): notice is string => notice !== null)

  return (
    <TextBodyFrame state={state} shell={<table className="sr-only" />} extraNotices={extraNotices}>
      {() => {
        const [header, ...body] = table?.rows ?? []
        return (
          <div className="overflow-x-auto rounded-xl border border-border bg-background">
            <table className="min-w-full border-collapse text-xs">
              {header ? (
                <thead className="sticky top-0 bg-muted">
                  <tr>{header.map((c, i) => <th key={i} className="border-b border-border px-3 py-2 text-left font-medium">{c || " "}</th>)}</tr>
                </thead>
              ) : null}
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri} className="odd:bg-background even:bg-muted/20">
                    {row.map((c, ci) => <td key={ci} className="max-w-[320px] border-b border-border px-3 py-2 align-top"><div className="whitespace-pre-wrap break-words">{c || " "}</div></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }}
    </TextBodyFrame>
  )
}
