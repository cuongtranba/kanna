import { forwardRef } from "react"
import { Link2 } from "lucide-react"
import { Button } from "../ui/button"

export type ShareButtonProps = React.ComponentPropsWithoutRef<typeof Button>

export const ShareButton = forwardRef<HTMLButtonElement, ShareButtonProps>(
  (props, ref) => {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="none"
        aria-label="Public link"
        {...props}
        className={
          props.className ??
          "border border-border/0 hover:!border-border/0 px-1.5 h-9 hover:!bg-transparent"
        }
      >
        <Link2 strokeWidth={2} className="h-4.5" />
      </Button>
    )
  },
)
