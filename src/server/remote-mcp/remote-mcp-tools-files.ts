import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { fail } from "../kanna-mcp-tool"
import { isWithinRoot, resolveProjectFilePath } from "../project-file-path"
import { getServerFile, realPathOrNull, statFile } from "../server-io.adapter"
import { inferProjectFileContentType, persistProjectUpload } from "../uploads"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { jsonResult } from "./remote-mcp-views"

const BYTES_PER_MB = 1024 * 1024
const BASE64_EXPANSION = 4 / 3
const DEFAULT_READ_BYTES = 64 * 1024
const MAX_READ_BYTES = 1024 * 1024

function hasNullByte(bytes: Uint8Array): boolean {
  return bytes.includes(0)
}

export function registerFileTools(server: McpServer, host: RemoteMcpHost): void {
  server.registerTool(
    "upload_attachment",
    {
      title: "Upload an attachment",
      description: "Store a file in a project's upload folder and return an attachment object to pass in send_message.attachments.",
      inputSchema: {
        projectId: z.string().describe("Id of the project that receives the file"),
        fileName: z.string().describe("File name, without a directory"),
        contentBase64: z.string().describe("File content, base64 encoded"),
        contentType: z.string().optional().describe("MIME type, used when it cannot be detected from the bytes"),
      },
    },
    async ({ projectId, fileName, contentBase64, contentType }) => {
      const project = host.store.getProject(projectId)
      if (!project) return fail(`Project ${projectId} was not found.`)
      const maxBytes = host.appSettings.getSnapshot().uploads.maxFileSizeMb * BYTES_PER_MB
      if (contentBase64.length > Math.ceil(maxBytes * BASE64_EXPANSION) + 4) {
        return fail(`The file is larger than the ${host.appSettings.getSnapshot().uploads.maxFileSizeMb} MB upload limit.`)
      }
      const bytes = Buffer.from(contentBase64, "base64")
      if (bytes.byteLength > maxBytes) {
        return fail(`The file is larger than the ${host.appSettings.getSnapshot().uploads.maxFileSizeMb} MB upload limit.`)
      }
      const attachment = await persistProjectUpload({
        projectId,
        localPath: project.localPath,
        fileName,
        bytes,
        fallbackMimeType: contentType,
      })
      return jsonResult({ attachments: [attachment] })
    },
  )

  server.registerTool(
    "read_project_file",
    {
      title: "Read a project file",
      description: "Read a file inside a project folder. Text comes back as text; binary files come back base64 encoded. Paths outside the project are refused.",
      inputSchema: {
        projectId: z.string().describe("Id of the project"),
        path: z.string().describe("Path relative to the project folder"),
        maxBytes: z.number().int().min(1).max(MAX_READ_BYTES).optional().describe(`Most bytes to read (default ${DEFAULT_READ_BYTES}, max ${MAX_READ_BYTES})`),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, path: requestedPath, maxBytes }) => {
      const project = host.store.getProject(projectId)
      if (!project) return fail(`Project ${projectId} was not found.`)
      const resolved = resolveProjectFilePath(project.localPath, requestedPath)
      if (!resolved) return fail("Invalid project file path.")
      const [realRoot, realFile] = await Promise.all([realPathOrNull(project.localPath), realPathOrNull(resolved.filePath)])
      if (realRoot === null || realFile === null) return fail(`File ${resolved.relativePath} was not found.`)
      if (!isWithinRoot(realRoot, realFile)) return fail("Invalid project file path.")
      const info = await statFile(realFile).catch(() => null)
      if (!info?.isFile()) return fail(`File ${resolved.relativePath} was not found.`)
      const limit = Math.min(maxBytes ?? DEFAULT_READ_BYTES, MAX_READ_BYTES)
      const file = getServerFile(realFile)
      const bytes = new Uint8Array(await file.slice(0, limit).arrayBuffer())
      const base = {
        path: resolved.relativePath,
        contentType: inferProjectFileContentType(resolved.relativePath, file.type),
        size: info.size,
        truncated: info.size > limit,
      }
      return jsonResult(
        hasNullByte(bytes)
          ? { ...base, base64: Buffer.from(bytes).toString("base64") }
          : { ...base, text: new TextDecoder().decode(bytes) },
      )
    },
  )
}
