import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path"

export interface RelocationResult {
  relativePath: string
  relocated: boolean
}

export const RELOCATED_OUTPUT_DIR = ".kanna/outputs"

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function pickNonCollidingPath(destDir: string, fileName: string): string {
  const ext = extname(fileName)
  const stem = ext ? fileName.slice(0, -ext.length) : fileName
  let candidate = join(destDir, fileName)
  let counter = 1
  while (existsSync(candidate)) {
    candidate = join(destDir, `${stem}-${counter}${ext}`)
    counter += 1
  }
  return candidate
}

/**
 * If `rawPath` is an absolute path resolving outside `projectRoot`, copy the
 * file into `<projectRoot>/.kanna/outputs/<basename>` and return the new
 * project-relative path. Otherwise return the input untouched.
 *
 * Best-effort: returns the input unchanged on copy failure so a missing
 * source file does not break the caller's tool-result emission. Sync because
 * the codex notification handler is sync and any await would reorder events.
 */
export function relocateExternalFileIntoProject(
  rawPath: string,
  projectRoot: string,
): RelocationResult {
  if (!rawPath) return { relativePath: rawPath, relocated: false }
  if (!isAbsolute(rawPath)) return { relativePath: rawPath, relocated: false }

  const resolvedProjectRoot = resolve(projectRoot)
  const resolvedSource = resolve(rawPath)
  if (isInside(resolvedProjectRoot, resolvedSource)) {
    return { relativePath: rawPath, relocated: false }
  }

  const destDir = join(resolvedProjectRoot, RELOCATED_OUTPUT_DIR)
  const fileName = basename(resolvedSource)
  if (!fileName) return { relativePath: rawPath, relocated: false }

  try {
    mkdirSync(destDir, { recursive: true })
    const destAbsolute = pickNonCollidingPath(destDir, fileName)
    copyFileSync(resolvedSource, destAbsolute)
    const projectRelative = relative(resolvedProjectRoot, destAbsolute).split(sep).join("/")
    return { relativePath: projectRelative, relocated: true }
  } catch {
    return { relativePath: rawPath, relocated: false }
  }
}
