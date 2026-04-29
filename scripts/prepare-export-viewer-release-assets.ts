import path from "node:path"
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import pkg from "../package.json"

const EXPORT_VIEWER_DIR = path.resolve(import.meta.dir, "..", "dist", "export-viewer")
const RELEASE_ASSETS_DIR = path.resolve(import.meta.dir, "..", "dist", "export-viewer-release-assets")
const MANIFEST_ASSET_NAME = "export-viewer-manifest.json"
const INDEX_CACHE_CONTROL = "public, max-age=300"
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".manifest": "application/manifest+json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
}

interface ExportViewerReleaseManifest {
  viewerVersion: string
  releaseTag: string
  generatedAt: string
  files: Record<string, {
    assetName: string
    cacheControl: string
    contentType: string
  }>
}

async function main() {
  const viewerVersion = pkg.version
  const releaseTag = `v${viewerVersion.replace(/^v/u, "")}`

  await assertPathExists(EXPORT_VIEWER_DIR, "Export viewer bundle not found. Run `bun run build:export-viewer` first.")
  await rm(RELEASE_ASSETS_DIR, { recursive: true, force: true })
  await mkdir(RELEASE_ASSETS_DIR, { recursive: true })

  const viewerFiles = await listFiles(EXPORT_VIEWER_DIR)
  const manifest: ExportViewerReleaseManifest = {
    viewerVersion,
    releaseTag,
    generatedAt: new Date().toISOString(),
    files: {},
  }

  for (const filePath of viewerFiles) {
    const relativePath = path.relative(EXPORT_VIEWER_DIR, filePath).split(path.sep).join("/")
    const assetName = toReleaseAssetName(relativePath)
    await cp(filePath, path.join(RELEASE_ASSETS_DIR, assetName))
    manifest.files[relativePath] = {
      assetName,
      cacheControl: relativePath.endsWith(".html") ? INDEX_CACHE_CONTROL : ASSET_CACHE_CONTROL,
      contentType: getContentTypeForPath(relativePath),
    }
  }

  await writeFile(
    path.join(RELEASE_ASSETS_DIR, MANIFEST_ASSET_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  )

  console.log(`Prepared ${viewerFiles.length + 1} export-viewer release assets for ${releaseTag}.`)
}

async function listFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath))
      continue
    }

    if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

function toReleaseAssetName(relativePath: string) {
  return `export-viewer__${relativePath.split("/").join("__")}`
}

function getContentTypeForPath(relativePath: string) {
  return CONTENT_TYPES_BY_EXTENSION[path.extname(relativePath).toLowerCase()] ?? "application/octet-stream"
}

async function assertPathExists(targetPath: string, errorMessage: string) {
  try {
    await stat(targetPath)
  } catch {
    throw new Error(errorMessage)
  }
}

await main()
