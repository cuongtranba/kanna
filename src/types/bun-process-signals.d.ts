export {}

declare global {
  namespace NodeJS {
    interface Process {
      off(event: Signals, listener: SignalsListener): this
      removeListener(event: Signals, listener: SignalsListener): this
    }
  }
}
