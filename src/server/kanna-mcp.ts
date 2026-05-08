import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import path from "node:path"
import { stat } from "node:fs/promises"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import { inferProjectFileContentType } from "./uploads"

export interface OfferDownloadArgs {
  projectId: string
  localPath: string
}

export interface ResolvedOfferDownload {
  contentUrl: string
  relativePath: string
  fileName: string
  displayName: string
  size: number
  mimeType: string
}

export async function resolveOfferDownload(
  args: OfferDownloadArgs,
  input: { path: string; label?: string },
): Promise<{ ok: true; payload: ResolvedOfferDownload } | { ok: false; error: string }> {
  const rawPath = (input.path ?? "").trim()
  if (!rawPath) {
    return { ok: false, error: "path is required" }
  }

  const relativePath = path.posix.normalize(rawPath.replaceAll("\\", "/"))
  if (
    !relativePath
    || relativePath === "."
    || relativePath.startsWith("../")
    || relativePath.includes("/../")
    || path.posix.isAbsolute(relativePath)
  ) {
    return { ok: false, error: `Invalid project file path: ${input.path}` }
  }

  const projectRoot = path.resolve(args.localPath)
  const absolutePath = path.resolve(args.localPath, relativePath)
  if (absolutePath !== projectRoot && !absolutePath.startsWith(`${projectRoot}${path.sep}`)) {
    return { ok: false, error: "Path resolves outside the project root" }
  }

  let info
  try {
    info = await stat(absolutePath)
  } catch {
    return { ok: false, error: `File not found: ${relativePath}` }
  }
  if (!info.isFile()) {
    return { ok: false, error: `Not a file: ${relativePath}` }
  }

  const fileName = path.posix.basename(relativePath)
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  const mimeType = inferProjectFileContentType(fileName)

  return {
    ok: true,
    payload: {
      contentUrl: `/api/projects/${encodeURIComponent(args.projectId)}/files/${encodedPath}/content`,
      relativePath,
      fileName,
      displayName: input.label?.trim() || fileName,
      size: info.size,
      mimeType,
    },
  }
}

const OFFER_DOWNLOAD_DESCRIPTION = `Offer a file from the user's project workspace as an inline downloadable link in the Kanna chat UI.

Use this when you have created or generated a file the user is likely to want to download (build artifact, exported report, generated document, etc.).

Args:
- path: workspace-relative path to the file (must stay inside the project root)
- label: optional human-readable label shown next to the download link
`

export function createKannaMcpServer(args: OfferDownloadArgs) {
  return createSdkMcpServer({
    name: KANNA_MCP_SERVER_NAME,
    tools: [
      tool(
        "offer_download",
        OFFER_DOWNLOAD_DESCRIPTION,
        {
          path: z.string().describe("Workspace-relative path to the file to offer for download"),
          label: z.string().optional().describe("Optional human-readable label for the download link"),
        },
        async (input) => {
          const result = await resolveOfferDownload(args, input)
          if (!result.ok) {
            return {
              content: [{ type: "text" as const, text: result.error }],
              isError: true,
            }
          }
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ kind: "download_offer", ...result.payload }),
            }],
          }
        },
      ),
    ],
  })
}
