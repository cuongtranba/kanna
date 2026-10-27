import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

const SECRET_FILE_MODE = 0o600

export interface SecretJsonStore<Item> {
  load(): Promise<Item[]>
  save(items: readonly Item[]): Promise<void>
}

export function createSecretJsonStore<Item>(
  dataDir: string,
  fileName: string,
  key: string,
  parse: (text: string) => Item[],
): SecretJsonStore<Item> {
  const path = join(dataDir, fileName)
  const tempPath = `${path}.tmp`
  return {
    async load() {
      try {
        return parse(await readFile(path, "utf8"))
      } catch {
        return []
      }
    },
    async save(items) {
      await mkdir(dataDir, { recursive: true })
      await writeFile(tempPath, JSON.stringify({ [key]: items }, null, 2), { mode: SECRET_FILE_MODE })
      await chmod(tempPath, SECRET_FILE_MODE)
      await rename(tempPath, path)
    },
  }
}
