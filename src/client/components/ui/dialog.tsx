import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "../../lib/utils"
import { FOCUS_FALLBACK_IGNORE_ATTRIBUTE, RESTORE_CHAT_INPUT_FOCUS_EVENT } from "../../app/chatFocusPolicy"
import type { DomPort } from "../../ports/domPort"
import { domAdapter } from "../../adapters/dom.adapter"
import { Button, type ButtonProps } from "./button"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogPortal = DialogPrimitive.Portal

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-overlay/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none",
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
}

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    size?: "sm" | "md" | "lg"
    ports?: { dom?: DomPort }
    restoreFocus?: "chat-input" | "trigger"
  }
>(({ className, children, size = "md", ports = {}, restoreFocus = "chat-input", ...props }, ref) => {
  const dom = ports.dom ?? domAdapter
  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      {...{ [FOCUS_FALLBACK_IGNORE_ATTRIBUTE]: "" }}
      onCloseAutoFocus={(event) => {
        if (restoreFocus === "chat-input") {
          event.preventDefault()
          dom.dispatchCustomWindowEvent(RESTORE_CHAT_INPUT_FOCUS_EVENT)
        }
        props.onCloseAutoFocus?.(event)
      }}
      className={cn(
        "fixed left-1/2 bottom-0 z-50 w-full -translate-x-1/2 rounded-t-lg bg-card duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none max-md:max-h-[calc(100dvh-1rem)] max-md:pb-[env(safe-area-inset-bottom)] md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:border-border",
        "max-h-[85vh] flex flex-col",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground md:right-2 md:top-2 md:h-8 md:w-8">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shrink-0 flex flex-col space-y-1.5 p-4 border-b border-border", className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-medium leading-none tracking-tight", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-3.5", className)} {...props} />
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 flex justify-end gap-2 border-t border-border bg-background p-2 rounded-b-xl",
        className,
      )}
      {...props}
    />
  )
}

function DialogPrimaryButton({ className, ...props }: ButtonProps) {
  return <Button className={className} {...props} />
}

function DialogGhostButton({ className, ...props }: ButtonProps) {
  return <Button variant="ghost" className={className} {...props} />
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogGhostButton,
}
