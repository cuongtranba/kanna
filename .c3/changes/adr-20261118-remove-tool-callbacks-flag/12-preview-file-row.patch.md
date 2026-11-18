---
target: c3-226
scope: block
base: c3-226#n13707@v1:sha256:557676b6c3cc1b472d4ad78774fd1e7aafbcd2c901de7f2a83f2fd6ee70b54e4
---
| preview_file tool | OUT | Takes a path argument (and a label to title the card); resolveWorkspaceFile applies the same path-safety as offer_download, infers MIME via inferAttachmentContentType, and gates on isPreviewableMime (accepts text/, image/, audio/, video/, application/json, application/pdf after stripping mime params; rejects others with a "use offer_download" hint). Builds the content URL via buildLocalFileContentUrl (/api/local-file?path=<abs>) so files written in a worktree chat resolve — NOT the project-scoped URL. Returns a {kind:"file_preview", contentUrl, relativePath, fileName, displayName, size, mimeType} result that hydrates through c3-303 into a tap-to-open preview card (FilePreviewSheet, origin=preview_file, Share only, no download). Read-only: does not touch the durable approval protocol | c3-303 | src/server/kanna-mcp.ts, src/server/uploads.ts |
