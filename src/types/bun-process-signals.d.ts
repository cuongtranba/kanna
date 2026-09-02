export {}

// bun-types 1.4.0 declares `off` / `removeListener` directly on NodeJS.Process
// for its new "memoryPressure" event. A member declared on an interface hides
// the base's member outright — there is no overload merging across inheritance
// — so those two lost every signature EventEmitter gave them, and
// `process.off("SIGINT", h)` stopped compiling. `on` is unaffected because
// @types/node declares its own signal overloads on Process, which merge.
//
// Restores the two signatures bun shadowed. Delete once bun-types declares
// these as overloads rather than replacements.
declare global {
  namespace NodeJS {
    interface Process {
      off(event: Signals, listener: SignalsListener): this
      removeListener(event: Signals, listener: SignalsListener): this
    }
  }
}
