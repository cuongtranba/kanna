import type { ChatOp } from "../shared/chat-ops"

interface ChatOpLogState {
  seq: number
  ring: Array<{ seq: number; op: ChatOp }>
}

export interface ChatOpBatch {
  ops: ChatOp[]
  fromSeq: number
  toSeq: number
}

const DEFAULT_CAP = 512

export class ChatOpLog {
  private readonly byChat = new Map<string, ChatOpLogState>()

  constructor(private readonly cap: number = DEFAULT_CAP) {}

  record(chatId: string, op: ChatOp): number {
    let state = this.byChat.get(chatId)
    if (!state) {
      state = { seq: 0, ring: [] }
      this.byChat.set(chatId, state)
    }
    state.seq += 1
    state.ring.push({ seq: state.seq, op })
    if (state.ring.length > this.cap) {
      state.ring.splice(0, state.ring.length - this.cap)
    }
    return state.seq
  }

  currentSeq(chatId: string): number {
    return this.byChat.get(chatId)?.seq ?? 0
  }

  since(chatId: string, afterSeq: number): ChatOpBatch | null {
    const state = this.byChat.get(chatId)
    const seq = state?.seq ?? 0
    if (afterSeq >= seq) {
      return { ops: [], fromSeq: afterSeq + 1, toSeq: seq }
    }
    const ring = state!.ring
    const oldestCovered = ring.length > 0 ? ring[0]!.seq : seq + 1
    if (afterSeq < oldestCovered - 1) {
      return null
    }
    return {
      ops: ring.filter((item) => item.seq > afterSeq).map((item) => item.op),
      fromSeq: afterSeq + 1,
      toSeq: seq,
    }
  }

  clear(chatId: string): void {
    this.byChat.delete(chatId)
  }
}
