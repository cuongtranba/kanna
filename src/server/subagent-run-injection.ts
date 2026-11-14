import { randomUUID } from "node:crypto"
import type { PeerChatOrigin } from "../shared/command-origin"
import { PEER_MID_TURN_LIMIT } from "../shared/peer-messaging/limits"
import { renderPeerPrompt } from "../shared/peer-messaging/render-prompt"
import { timestamped } from "../shared/transcript-entry"
import type { TranscriptEntry } from "../shared/types"

export interface UndeliveredPeerMessage {
  content: string
  origin: PeerChatOrigin
}

interface OpenTurn {
  pushPrompt(promptId: string, text: string): boolean
  onEntry(entry: TranscriptEntry): void
  pushed: number
}

export class RunInjection {
  private turn: OpenTurn | null = null
  private readonly pending = new Map<string, UndeliveredPeerMessage>()

  constructor(private readonly redeliver: (message: UndeliveredPeerMessage) => void) {}

  openTurn(pushPrompt: OpenTurn["pushPrompt"], onEntry: OpenTurn["onEntry"]): void {
    this.closeTurn()
    this.turn = { pushPrompt, onEntry, pushed: 0 }
  }

  push(content: string, origin: PeerChatOrigin): boolean {
    const turn = this.turn
    if (turn === null || turn.pushed >= PEER_MID_TURN_LIMIT) return false
    const promptId = randomUUID()
    this.pending.set(promptId, { content, origin })
    if (!turn.pushPrompt(promptId, renderPeerPrompt(content, origin))) {
      this.pending.delete(promptId)
      return false
    }
    turn.pushed += 1
    return true
  }

  delivered(promptId: string): void {
    const message = this.pending.get(promptId)
    if (message === undefined || this.turn === null) return
    this.pending.delete(promptId)
    this.turn.onEntry(timestamped({ kind: "user_prompt", content: message.content, attachments: [], origin: message.origin }))
  }

  hasPending(): boolean {
    return this.pending.size > 0
  }

  closeTurn(): void {
    this.turn = null
    const leftovers = [...this.pending.values()]
    this.pending.clear()
    for (const message of leftovers) this.redeliver(message)
  }
}
