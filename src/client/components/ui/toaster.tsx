import { lazy, Suspense } from "react"

const Sonner = lazy(() => import("sonner").then((m) => ({ default: m.Toaster })))

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
