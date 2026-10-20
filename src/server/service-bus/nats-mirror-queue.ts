import type { BusEnvelope } from "../../shared/service-bus/envelope"

export const MIRROR_QUEUE_CAPACITY = 2000

export interface QueuedEnvelope {
  envelope: BusEnvelope
  retried: boolean
}

export interface MirrorQueue {
  push: (envelope: BusEnvelope) => void
  peek: () => QueuedEnvelope | undefined
  shift: () => QueuedEnvelope | undefined
  requeueHead: (item: QueuedEnvelope) => boolean
  size: () => number
  dropped: () => number
  noteDropped: () => void
  clear: () => void
}

export function createMirrorQueue(capacity = MIRROR_QUEUE_CAPACITY): MirrorQueue {
  const items: QueuedEnvelope[] = []
  let droppedTotal = 0

  return {
    push(envelope) {
      items.push({ envelope, retried: false })
      while (items.length > capacity) {
        items.shift()
        droppedTotal += 1
      }
    },
    peek: () => items[0],
    shift: () => items.shift(),
    requeueHead(item) {
      if (item.retried) return false
      items.unshift({ envelope: item.envelope, retried: true })
      return true
    },
    size: () => items.length,
    dropped: () => droppedTotal,
    noteDropped() {
      droppedTotal += 1
    },
    clear() {
      items.length = 0
    },
  }
}
