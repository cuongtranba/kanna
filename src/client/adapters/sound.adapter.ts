
import type { SoundPort } from "../ports/soundPort"

export const soundAdapter: SoundPort = {
  play(src: string): Promise<void> {
    const audio = new Audio(src)
    audio.preload = "auto"
    return audio.play()
  },
}
