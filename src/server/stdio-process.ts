import type { Readable, Writable } from "node:stream"

export interface StdioProcess {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  killed?: boolean
  kill(signal?: NodeJS.Signals | number): void
  on(event: "close", listener: (code: number | null) => void): this
  on(event: "error", listener: (error: Error) => void): this
  once(event: "close", listener: (code: number | null) => void): this
  once(event: "error", listener: (error: Error) => void): this
}
