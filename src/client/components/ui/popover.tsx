import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "../../lib/utils"
import { FOCUS_FALLBACK_IGNORE_ATTRIBUTE, RESTORE_CHAT_INPUT_FOCUS_EVENT } from "../../app/chatFocusPolicy"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      {...{ [FOCUS_FALLBACK_IGNORE_ATTRIBUTE]: "" }}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        window.dispatchEvent(new Event(RESTORE_CHAT_INPUT_FOCUS_EVENT))
        props.onCloseAutoFocus?.(event)
      }}
      className={cn(
        "z-50 w-72 rounded-xl border border-border bg-background p-4 shadow-lg outline-hidden animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent }
