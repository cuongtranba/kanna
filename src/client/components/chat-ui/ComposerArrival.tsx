import type { ReactNode } from "react"
import { selectIsSpawning, useNewSessionStore } from "../../stores/newSessionStore"


export interface ComposerArrival {
  className: string | undefined
  sweep: ReactNode
}

export function useComposerArrival(chatId: string | null): ComposerArrival {
  const isSpawning = useNewSessionStore(selectIsSpawning(chatId))
  if (!isSpawning) return NOT_ARRIVING

  return {
    className: "kanna-composer-arrive",
    sweep: (
      <span
        aria-hidden
        className="kanna-composer-sweep pointer-events-none absolute inset-x-0 bottom-0 h-[1.5px] rounded-full bg-logo"
      />
    ),
  }
}

const NOT_ARRIVING: ComposerArrival = { className: undefined, sweep: null }
