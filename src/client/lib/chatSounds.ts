import type { ChatSoundId, ChatSoundPreference } from "../stores/chatSoundPreferencesStore"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"

const CHAT_SOUND_SRC: Record<ChatSoundId, string> = {
  blow: "/chat-sounds/Blow.mp3",
  bottle: "/chat-sounds/Bottle.mp3",
  frog: "/chat-sounds/Frog.mp3",
  funk: "/chat-sounds/Funk.mp3",
  glass: "/chat-sounds/Glass.mp3",
  ping: "/chat-sounds/Ping.mp3",
  pop: "/chat-sounds/Pop.mp3",
  purr: "/chat-sounds/Purr.mp3",
  tink: "/chat-sounds/Tink.mp3",
}

export function isBrowserUnfocused(dom: DomPort = domAdapter) {
  return dom.getVisibilityState() !== "visible" || !dom.hasFocus()
}

function playSingleChatSound(soundId: ChatSoundId) {
  const audio = new Audio(CHAT_SOUND_SRC[soundId])
  audio.preload = "auto"
  return audio.play()
}

export async function playChatNotificationSound(
  soundId: ChatSoundId,
  count: number,
  timer: TimerPort = timerAdapter,
) {
  if (count <= 0) {
    return
  }

  const tasks = Array.from({ length: count }, (_, index) => new Promise<void>((resolve) => {
    timer.setTimeout(() => {
      void playSingleChatSound(soundId).catch(() => undefined).finally(() => resolve())
    }, index * 90)
  }))

  await Promise.all(tasks)
}

export function shouldPlayChatSound(
  preference: ChatSoundPreference,
  dom: DomPort = domAdapter,
) {
  if (preference === "never") return false
  if (preference === "always") return true
  return isBrowserUnfocused(dom)
}
