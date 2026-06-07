import { ShieldAlert } from "lucide-react"
import type { ProcessedPolicyRefusalMessage } from "./types"

interface Props {
  message: ProcessedPolicyRefusalMessage
}

const USAGE_POLICY_URL = "https://www.anthropic.com/legal/aup"

// Claude prefixes even a deliberate policy refusal with "API Error:". Strip it
// for display: the card already frames this as a policy block, not a transport
// error, and the prefix is exactly the mislabel this component exists to fix.
function stripApiErrorPrefix(text: string): string {
  return text.replace(/^API Error:\s*/i, "")
}

// A model refusal is an attention state, not a system failure — warning (amber)
// register, distinct from the destructive (coral) ApiErrorMessage card it sits
// beside. See adr-20260607-surface-policy-refusal-entry.
export function PolicyRefusalMessage({ message }: Props) {
  const body = stripApiErrorPrefix(message.text)
  return (
    <div className="w-full max-w-[70ch]">
      <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-medium text-warning">
          <ShieldAlert className="h-3.5 w-3.5" />
          <span className="uppercase tracking-wide">Blocked by Usage Policy</span>
        </div>
        <div className="text-sm whitespace-pre-wrap break-words text-foreground/90">
          {body}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-0.5">
          <a href={USAGE_POLICY_URL} target="_blank" rel="noreferrer" className="hover:underline">
            Usage Policy
          </a>
          {message.requestId && (
            <span>
              Request ID: <code className="text-xs">{message.requestId}</code>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
