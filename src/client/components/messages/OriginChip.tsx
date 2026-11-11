import { Link } from "react-router-dom"
import { originDetail, originLabel, type CommandOrigin } from "../../../shared/command-origin"
import { chatPath } from "../../lib/paneTree"
import { cn } from "../../lib/utils"
import { HoverHint } from "../ui/truncated-text"

const CHIP_CLASS = "min-w-0 max-w-full truncate text-xs text-muted-foreground opacity-70"

interface OriginChipProps {
  origin: CommandOrigin
  linked: boolean
}

export function OriginChip({ origin, linked }: OriginChipProps) {
  const label = originLabel(origin)
  return (
    <HoverHint label={originDetail(origin)}>
      {origin.kind === "peer_chat" && linked ? (
        <Link to={chatPath(origin.fromChatId)} className={cn(CHIP_CLASS, "hover:underline")}>{label}</Link>
      ) : (
        <span className={CHIP_CLASS}>{label}</span>
      )}
    </HoverHint>
  )
}
