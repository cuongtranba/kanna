export function isGenUIEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KANNA_GENUI !== "disabled"
}
