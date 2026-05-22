import { AlertTriangle } from "lucide-react"
import type { ProcessedApiErrorMessage } from "./types"

interface Props {
  message: ProcessedApiErrorMessage
}

function describeStatus(status: number): string {
  if (status === 429) return "Rate Limited"
  if (status === 500) return "Internal Server Error"
  if (status === 502) return "Bad Gateway"
  if (status === 503) return "Service Unavailable"
  if (status === 529) return "Overloaded"
  if (status >= 500) return "Server Error"
  if (status >= 400) return "API Error"
  return "API Error"
}

function statusUrl(status: number): string | undefined {
  if (status === 0) return undefined
  return "https://status.claude.com"
}

export function ApiErrorMessage({ message }: Props) {
  const label = message.status > 0 ? `${message.status} ${describeStatus(message.status)}` : "API Error"
  const url = statusUrl(message.status)
  return (
    <div className="w-full max-w-[70ch]">
      <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive-foreground px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-medium text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-sm whitespace-pre-wrap break-words text-foreground/90">
          {message.text}
        </div>
        {(message.requestId || url) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-0.5">
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="hover:underline">
                Check status
              </a>
            )}
            {message.requestId && (
              <span>
                Request ID: <code className="text-xs">{message.requestId}</code>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
