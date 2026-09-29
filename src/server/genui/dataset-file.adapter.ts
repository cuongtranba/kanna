import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { pathInsideAllowedRoots } from "../permission-gate"
import type { DatasetFileReader, ResolvedDatasetFile } from "./dataset-ports"

async function realpathOrNull(target: string): Promise<string | null> {
  return await realpath(target).catch(() => null)
}

export async function resolveDatasetFile(root: string, relativePath: string): Promise<ResolvedDatasetFile> {
  const realRoot = await realpathOrNull(root)
  if (!realRoot) return { ok: false, reason: "not_found" }
  const lexical = path.resolve(root, relativePath)
  if (!pathInsideAllowedRoots(lexical, [path.resolve(root)])) return { ok: false, reason: "outside_root" }
  const real = await realpathOrNull(lexical)
  if (!real) return { ok: false, reason: "not_found" }
  if (!pathInsideAllowedRoots(real, [realRoot])) return { ok: false, reason: "outside_root" }
  const info = await stat(real).catch(() => null)
  if (!info) return { ok: false, reason: "not_found" }
  if (!info.isFile()) return { ok: false, reason: "not_a_file" }
  return { ok: true, absolutePath: real, revision: `${info.mtimeMs}:${info.size}`, size: info.size }
}

export const datasetFileReader: DatasetFileReader = {
  resolve: resolveDatasetFile,
  readText: async (absolutePath) => await readFile(absolutePath, "utf8"),
}
