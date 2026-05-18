import { memo } from "react"
import { Flower } from "lucide-react"
import { APP_NAME } from "../../shared/branding"

interface AppBootstrapProps {
  label?: string
}

function AppBootstrapImpl({ label = "Preparing workspace" }: AppBootstrapProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[100dvh] w-full items-center justify-center bg-background px-6 animate-fade-in"
    >
      <div className="flex flex-col items-center gap-6">
        <div className="flex items-center gap-2.5">
          <Flower className="size-6 text-logo" aria-hidden />
          <span className="font-logo text-lg tracking-tight text-foreground">{APP_NAME}</span>
        </div>

        <div className="flex w-[220px] flex-col items-center gap-3">
          <div className="relative h-px w-full overflow-hidden rounded-full bg-border/60">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 block h-full w-1/3 bg-foreground/70 motion-safe:animate-kanna-bootstrap-sweep motion-reduce:left-0 motion-reduce:w-full motion-reduce:opacity-40"
            />
          </div>
          <p className="text-[12px] tabular-nums text-muted-foreground">{label}…</p>
        </div>
      </div>
    </div>
  )
}

export const AppBootstrap = memo(AppBootstrapImpl)
