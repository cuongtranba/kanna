// Sanctioned console chokepoint. This is the ONLY module allowed to call
// `console` (see eslint.config.js `no-console: off` override). Everywhere else
// imports `log` instead so `no-console` stays enforced repo-wide.

type LogArg = string | number | boolean | null | undefined | object | unknown

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
