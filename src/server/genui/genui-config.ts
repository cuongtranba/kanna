export function isGenUIEnabled(): boolean {
  return process.env.KANNA_GENUI !== "disabled"
}
