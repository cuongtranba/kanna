import { Loader2 } from "lucide-react"
import { cn } from "../../lib/utils"

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("size-3.5 shrink-0 animate-spin", className)} />
}
