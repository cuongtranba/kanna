import { stat } from "node:fs/promises"
import type { Stats } from "node:fs"
import type { AnyValue } from "../shared/errors"
import type { BunFile, Server } from "bun"

export type ServerFile = BunFile
export type ServerStats = Stats

export function getServerFile(p: string): ServerFile {
  return Bun.file(p)
}

export function statFile(p: string): Promise<Stats> {
  return stat(p)
}

export function serveHttp<T = AnyValue>(opts: Bun.Serve.Options<T>): Server<T> {
  return Bun.serve(opts)
}
