/**
 * IO leaf for the structured-document tools: read / write a document's raw
 * bytes. Format-agnostic — all parsing lives in the pure engine
 * (`src/shared/structured-doc/`). Side-effect seal exempt via the
 * `.adapter.ts` filename convention.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

/** Read a document; returns null when the file does not exist. */
export async function readDoc(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8")
  } catch {
    return null
  }
}

/** Write a document, creating parent directories as needed. */
export async function writeDoc(absPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, content, { encoding: "utf8" })
}
