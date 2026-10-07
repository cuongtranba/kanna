import { AlertTriangle } from "lucide-react"
import {
  claudeApiErrorLinksStatusPage,
  describeClaudeApiError,
  type ClaudeApiErrorDescription,
} from "../../../shared/claude-api-error-classification"
import type { ProcessedApiErrorMessage } from "./types"

interface Props {
  message: ProcessedApiErrorMessage
}

const STATUS_PAGE_URL = "https://status.claude.com"

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

function statusLabel(status: number): string {
  return status > 0 ? `${status} ${describeStatus(status)}` : "API Error"
}

function DescribedErrorBody({ description, rawText }: { description: ClaudeApiErrorDescription; rawText: string }) {
  return (
    <>
      <div className="text-sm break-words text-foreground/90 space-y-1">
        <p>{description.explanation}</p>
        <p>{description.remedy}</p>
      </div>
      <div className="text-xs whitespace-pre-wrap break-words text-muted-foreground">
        {rawText}
      </div>
    </>
  )
}

export function ApiErrorMessage({ message }: Props) {
  const description = describeClaudeApiError(message.apiErrorReason)
  const label = description?.headline ?? statusLabel(message.status)
  const linksStatusPage = claudeApiErrorLinksStatusPage(message.status)
  return (
    <div className="w-full max-w-[70ch]">
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-medium text-destructive-text">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className=" tracking-wide">{label}</span>
        </div>
        {description ? (
          <DescribedErrorBody description={description} rawText={message.text} />
        ) : (
          <div className="text-sm whitespace-pre-wrap break-words text-foreground/90">
            {message.text}
          </div>
        )}
        {(message.requestId || linksStatusPage) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-0.5">
            {linksStatusPage && (
              <a href={STATUS_PAGE_URL} target="_blank" rel="noreferrer" className="hover:underline">
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
