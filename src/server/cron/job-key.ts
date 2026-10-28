const KEY_SEPARATOR = "\u0000"

export function cronJobKeyPrefix(chatId: string): string {
  return `${chatId}${KEY_SEPARATOR}`
}

export function cronJobKey(chatId: string, jobId: string): string {
  return `${cronJobKeyPrefix(chatId)}${jobId}`
}
