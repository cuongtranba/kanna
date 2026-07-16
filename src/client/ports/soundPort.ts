/**
 * SoundPort — typed interface for browser audio playback.
 *
 * Used by chatSounds.ts (new Audio(...).play()) so sound effects can
 * be tested or silenced without real Audio objects. The concrete
 * implementation is src/client/adapters/sound.adapter.ts.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

export interface SoundPort {
  /**
   * Start playing the audio resource at `src`.
   * Returns a Promise that resolves when playback starts (mirrors Audio.play()).
   */
  play(src: string): Promise<void>
}
