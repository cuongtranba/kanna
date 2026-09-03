import { CircleCheck, CircleSlash, Hand, TriangleAlert } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"
import { TruncatedText } from "../ui/truncated-text"
import type { ProcessedLoopDisarmedMessage } from "./types"

interface Props {
  message: ProcessedLoopDisarmedMessage
}

interface DisarmCopy {
  Icon: LucideIcon
  iconClass: string
  title: string
  detail: string | null
}

/**
 * Keyed over the reason union so a new reason is a typecheck failure rather
 * than a card that renders a blank headline.
 */
const DISARM_COPY: Record<ProcessedLoopDisarmedMessage["reason"], DisarmCopy> = {
  user_send: {
    Icon: Hand,
    iconClass: "text-muted-foreground",
    title: "Loop stopped by your message",
    detail:
      "Your message took over the armed loop and disarmed it — sending a message never resumes a loop, it stops one. It will not pick itself back up.",
  },
  repeated_failures: {
    Icon: TriangleAlert,
    iconClass: "text-destructive",
    title: "Loop stopped after repeated failures",
    detail:
      "Kanna disarmed the loop because its iterations kept failing. Read the failed approaches in the tracking file before re-arming it.",
  },
  goal_met: {
    Icon: CircleCheck,
    iconClass: "text-muted-foreground",
    title: "Loop finished",
    detail: "The goal was met, so the loop disarmed itself.",
  },
  chat_deleted: {
    Icon: CircleSlash,
    iconClass: "text-muted-foreground",
    title: "Loop disarmed",
    detail: "The chat was deleted.",
  },
}

/**
 * A loop leaves this card behind when it is disarmed. Any user message
 * disarms an armed loop, and that used to happen with no transcript entry at
 * all — the chat simply went quiet, so a user who typed "resume" to restart a
 * stalled loop had in fact killed it and had no way to tell.
 *
 * The tracking file and workdir are shown whenever the disarm recorded them: a
 * review that has to guess reads the wrong plan in the wrong worktree.
 */
export function LoopDisarmedMessage({ message }: Props) {
  const { Icon, iconClass, title, detail } = DISARM_COPY[message.reason]
  const hasLocation = message.trackingFileRel !== undefined || message.workdirAbs !== undefined

  return (
    <div className="px-0.5">
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{title}</div>

          {detail ? <p className="mt-1 text-sm text-foreground/90">{detail}</p> : null}

          {hasLocation ? (
            <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {message.trackingFileRel !== undefined ? (
                <TruncatedText tooltip={message.trackingFileRel} inline>
                  <span>
                    Plan <span className="font-mono">{message.trackingFileRel}</span>
                  </span>
                </TruncatedText>
              ) : null}
              {message.workdirAbs !== undefined ? (
                <TruncatedText tooltip={message.workdirAbs} inline>
                  <span>
                    Worktree <span className="font-mono">{message.workdirAbs}</span>
                  </span>
                </TruncatedText>
              ) : null}
            </div>
          ) : null}

          {message.resumable ? (
            <p className="mt-2 text-xs text-muted-foreground">
              This loop can be re-armed with the <span className="font-mono">resume_loop</span> tool.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
