import { Link2 } from "lucide-react"
import { Button } from "../ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

export interface ShareButtonProps {
  chatId: string
  onOpenPopover: (chatId: string) => void
}

export function ShareButton({ chatId, onOpenPopover }: ShareButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="none"
          aria-label="Public link"
          onClick={() => onOpenPopover(chatId)}
          className="border border-border/0 hover:!border-border/0 px-1.5 h-9 hover:!bg-transparent"
        >
          <Link2 strokeWidth={2} className="h-4.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Mint a public read-only link</TooltipContent>
    </Tooltip>
  )
}
