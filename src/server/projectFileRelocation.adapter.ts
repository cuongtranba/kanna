import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { isPathInside } from "./path-containment"
import { projectKannaSubdir } from "./paths"

export interface RelocationResult {
  relativePath: string
  relocated: boolean
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

export function relocateExternalFileIntoProject(
  rawPath: string,
  projectRoot: string,
): RelocationResult {
  if (!rawPath) return { relativePath: rawPath, relocated: false }
  if (!isAbsolute(rawPath)) return { relativePath: rawPath, relocated: false }

  const resolvedProjectRoot = resolve(projectRoot)
  const resolvedSource = resolve(rawPath)
  if (isPathInside(resolvedProjectRoot, resolvedSource)) {
    return { relativePath: rawPath, relocated: false }
  }

  const destDir = projectKannaSubdir(resolvedProjectRoot, "outputs")
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
