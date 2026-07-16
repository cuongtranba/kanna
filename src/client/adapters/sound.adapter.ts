/**
 * sound.adapter.ts — Browser Audio implementation of SoundPort.
 *
 * Creates and plays a real Audio element. Audio objects are not reused
 * (each call creates a fresh one), which matches the existing chatSounds.ts
 * behaviour.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

import type { SoundPort } from "../ports/soundPort"

export const soundAdapter: SoundPort = {
  play(src: string): Promise<void> {
    const audio = new Audio(src)
    audio.preload = "auto"
    return audio.play()
  },
}
