import { settlesLiveBlock, type LiveBlock } from "../shared/live-block"
import type { TranscriptEntry } from "../shared/types"

export type LiveBlockSink = (chatId: string, block: LiveBlock | null) => void

export interface LiveBlockPublisher {
  show(block: LiveBlock): void
  settle(kind: TranscriptEntry["kind"]): void
  clear(): void
}

export function createLiveBlockPublisher(
  chatId: string,
  ownsChat: () => boolean,
  sink: LiveBlockSink | undefined,
): LiveBlockPublisher {
  let published = false
  const clear = () => {
    if (!published) return
    published = false
    sink?.(chatId, null)
  }
  return {
    show: (block) => {
      if (!sink || !ownsChat()) return
      published = true
      sink(chatId, block)
    },
    settle: (kind) => {
      if (settlesLiveBlock(kind)) clear()
    },
    clear,
  }
}
