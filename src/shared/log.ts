
type LogArg = string | number | boolean | null | undefined | object

export const log = {
  debug(...args: LogArg[]): void {
    console.debug(...args)
  },
  info(...args: LogArg[]): void {
    console.info(...args)
  },
  warn(...args: LogArg[]): void {
    console.warn(...args)
  },
  error(...args: LogArg[]): void {
    console.error(...args)
  },
}
