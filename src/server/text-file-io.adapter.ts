import { readFile } from "node:fs/promises"

export function readTextFileOrThrow(p: string): Promise<string> {
  return readFile(p, "utf8")
}
