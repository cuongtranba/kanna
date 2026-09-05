import type { ReactNode } from "react"
import { selectIsSpawning, useNewSessionStore } from "../../stores/newSessionStore"

/**
 * Beat 4 of the new-session sentence (§01): the composer arrives focused.
 *
 * The eye followed a row out of the sidebar and into the chat; this is what it
 * lands on, and it has to say "type here" without a label. Two parts — the
 * composer rising into place, and a coral rule sweeping its bottom edge.
 *
 * Lives in its own module rather than inline in `ChatInput`, which sits within
 * a few lines of its architecture-budget ceiling. That is the remedy the budget
 * prescribes: put the new code in a module that owns it.
 */

export interface ComposerArrival {
  /** Applied to the composer's input row. Empty when nothing is arriving. */
  className: string | undefined
  /** The focus sweep, or null. Render inside a `relative` container. */
  sweep: ReactNode
}

/**
 * Scoped to `chatId`, never to "any chat is spawning". Panes can show several
 * chats at once, and animating a composer someone is mid-sentence in — because
 * a DIFFERENT chat was just created — would be worse than not animating at all.
 */
export function useComposerArrival(chatId: string | null): ComposerArrival {
  const isSpawning = useNewSessionStore(selectIsSpawning(chatId))
  if (!isSpawning) return NOT_ARRIVING

  return {
    className: "kanna-composer-arrive",
    sweep: (
      /*
        Coral, and gone by the end of its own animation: it says "this one is
        live now", which is a state rather than a decoration. It is also the
        only element here with an `animation-fill-mode`, and that is safe
        precisely because its resting state is invisible — nothing is hidden
        by a sweep that never runs.
      */
      <span
        aria-hidden
        className="kanna-composer-sweep pointer-events-none absolute inset-x-0 bottom-0 h-[1.5px] rounded-full bg-logo"
      />
    ),
  }
}

const NOT_ARRIVING: ComposerArrival = { className: undefined, sweep: null }
