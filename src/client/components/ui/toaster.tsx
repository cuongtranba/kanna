import { lazy, Suspense } from "react"

const Sonner = lazy(() => import("sonner").then((m) => ({ default: m.Toaster })))

/**
 * Thin wrapper around sonner's Toaster.
 * Placed once in App.tsx. Position follows DESIGN.md:
 * bottom-right on desktop, top-center on mobile.
 *
 * Sonner is loaded lazily so test environments that import App.tsx do not
 * eagerly resolve the sonner ESM module (Bun on Linux fails to resolve the
 * Toaster export from sonner@2.0.7).
 */
export function Toaster() {
  return (
    <Suspense fallback={null}>
      <Sonner
        position="bottom-right"
        theme="system"
        closeButton
        duration={6000}
      />
    </Suspense>
  )
}
