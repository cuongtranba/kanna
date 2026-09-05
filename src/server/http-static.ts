import path from "node:path"
import { APP_NAME } from "../shared/branding"
import { getServerFile } from "./server-io.adapter"

export function isAssetRequest(requestedPath: string): boolean {
  const lastSegment = requestedPath.slice(requestedPath.lastIndexOf("/") + 1)
  const dot = lastSegment.lastIndexOf(".")
  if (dot <= 0) return false
  return lastSegment.slice(dot).toLowerCase() !== ".html"
}

export function getStaticHeaders(requestedPath: string): Record<string, string> | undefined {
  if (requestedPath.endsWith(".html")) {
    return { "Cache-Control": "no-store" }
  }
  return undefined
}

export async function serveStatic(distDir: string, pathname: string): Promise<Response> {
  const requestedPath = pathname === "/" ? "/index.html" : pathname
  const filePath = path.join(distDir, requestedPath)
  const indexPath = path.join(distDir, "index.html")

  const file = getServerFile(filePath)
  if (await file.exists()) {
    return new Response(file, { headers: getStaticHeaders(requestedPath) })
  }

  if (isAssetRequest(requestedPath)) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    })
  }

  const indexFile = getServerFile(indexPath)
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })
  }

  return new Response(
    `${APP_NAME} client bundle not found. Run \`bun run build\` inside workbench/ first.`,
    { status: 503 },
  )
}
