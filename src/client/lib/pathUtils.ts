/**
 * Path utilities for stripping workspace prefixes in display.
 * Supports both local paths (from localPath) and sandbox paths (/home/user/workspace).
 */

export interface ParsedLocalFileLink {
  path: string
  line?: number
  column?: number
}

const EDITOR_OPEN_EXTENSIONS = new Set([
  ".c", ".cc", ".cfg", ".conf", ".cpp", ".cs", ".css", ".diff", ".env", ".go", ".graphql", ".h",
  ".hpp", ".html", ".ini", ".java", ".js", ".json", ".jsonc", ".jsx", ".kt", ".log", ".lua",
  ".md", ".mjs", ".patch", ".php", ".pl", ".properties", ".py", ".rb", ".rs", ".scss", ".sh",
  ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml", ".zsh",
])

const EDITOR_OPEN_FILENAMES = new Set([
  ".gitignore",
  ".npmrc",
  ".prettierrc",
  ".python-version",
  ".ruby-version",
  ".tool-versions",
  "Dockerfile",
  "Gemfile",
  "Makefile",
  "Procfile",
])

interface ParsedFileTarget {
  path: string
  line?: number
  column?: number
}

function toPositiveInteger(value: string | undefined) {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseAbsoluteFileTarget(target: string): ParsedFileTarget | null {
  const hashMatch = /^(?<path>\/.+?)#L(?<line>\d+)(?:C(?<column>\d+))?$/.exec(target)
  if (hashMatch?.groups?.path) {
    return {
      path: hashMatch.groups.path,
      line: toPositiveInteger(hashMatch.groups.line),
      column: toPositiveInteger(hashMatch.groups.column),
    }
  }

  const suffixMatch = /^(?<path>\/.+?):(?<line>\d+)(?::(?<column>\d+))?$/.exec(target)
  if (suffixMatch?.groups?.path) {
    return {
      path: suffixMatch.groups.path,
      line: toPositiveInteger(suffixMatch.groups.line),
      column: toPositiveInteger(suffixMatch.groups.column),
    }
  }

  if (target.startsWith("/")) {
    return { path: target }
  }

  return null
}

export function parseLocalFileLink(target: string | undefined | null): ParsedLocalFileLink | null {
  if (!target) return null
  const trimmed = target.trim()
  if (!trimmed || /^(mailto:|ftp:|file:)/i.test(trimmed)) return null

  if (/^https?:/i.test(trimmed)) {
    if (typeof window === "undefined") {
      return null
    }
    try {
      const url = new URL(trimmed)
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/")) {
        return null
      }
      return parseAbsoluteFileTarget(`${url.pathname}${url.hash}`)
    } catch {
      return null
    }
  }

  return parseAbsoluteFileTarget(trimmed)
}

export function shouldOpenLocalFileLinkInEditor(filePath: string) {
  const segments = filePath.split(/[\\/]/)
  while (segments.length > 0 && segments[segments.length - 1] === "") {
    segments.pop()
  }
  const fileName = segments.length > 0 ? segments[segments.length - 1] : filePath
  if (EDITOR_OPEN_FILENAMES.has(fileName)) return true
  const extensionIndex = fileName.lastIndexOf(".")
  if (extensionIndex < 0) {
    return true
  }
  const extension = fileName.slice(extensionIndex).toLowerCase()
  return EDITOR_OPEN_EXTENSIONS.has(extension)
}


const ABSOLUTE_LOCAL_PATH_PREFIXES = ["/Users/", "/home/", "/private/", "/tmp/", "/var/", "/opt/", "/root/"]

export function isAbsoluteLocalFilePath(value: string): boolean {
  if (!value) return false
  if (value.startsWith("file://")) return true
  return ABSOLUTE_LOCAL_PATH_PREFIXES.some((prefix) => value.startsWith(prefix))
}

export function toLocalFileUrl(value: string): string {
  let absolute = value
  if (absolute.startsWith("file://")) {
    try {
      absolute = decodeURIComponent(new URL(absolute).pathname)
    } catch {
      absolute = absolute.slice("file://".length)
    }
  }
  return `/api/local-file?path=${encodeURIComponent(absolute)}`
}

/**
 * Strip workspace prefix for display.
 * e.g., "/home/user/workspace/src/foo.ts" → "src/foo.ts"
 * e.g., "/Users/jake/Projects/my-app/src/foo.ts" → "src/foo.ts" (when localPath is set)
 */
export function stripWorkspacePath(path: string | undefined, localPath: string | undefined | null): string {
  if (!path) return ""
  // Try localPath first (with or without trailing slash)
  if (localPath) {
    const withSlash = localPath.endsWith("/") ? localPath : `${localPath}/`
    if (path.startsWith(withSlash)) return path.slice(withSlash.length)
    if (path === localPath) return ""
  }
  // Fallback to sandbox path
  return path.replace(/^\/home\/user\/workspace\//, "")
}

/**
 * Strip outputs prefix for API paths.
 * e.g., "/home/user/workspace/outputs/foo/bar.csv" → "/foo/bar.csv"
 */
export function stripOutputsPath(path: string | undefined, localPath: string | undefined | null): string | undefined {
  if (!path) return undefined
  if (localPath) {
    const outputsPrefix = `${localPath}/outputs`
    if (path.startsWith(outputsPrefix)) return path.slice(outputsPrefix.length)
  }
  return path.replace(/^\/home\/user\/workspace\/outputs/, "") || undefined
}
