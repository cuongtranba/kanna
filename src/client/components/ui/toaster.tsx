import { Toaster as Sonner } from "sonner"

/**
 * Thin wrapper around sonner's Toaster.
 * Placed once in App.tsx. Position follows DESIGN.md:
 * bottom-right on desktop, top-center on mobile.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      theme="system"
      closeButton
      duration={6000}
    />
  )
}
