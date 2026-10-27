import type { McpServerConfig, McpServerInput, McpServerTransport } from "../../shared/types"

export interface McpServerDraft {
  name: string
  transport: McpServerTransport
  command: string
  argsText: string
  envText: string
  cwd: string
  url: string
  headersText: string
}

export function mcpServerToDraft(config: McpServerConfig | null): McpServerDraft {
  if (config === null) {
    return { name: "", transport: "stdio", command: "", argsText: "", envText: "", cwd: "", url: "", headersText: "" }
  }
  if (config.transport === "stdio") {
    return {
      name: config.name,
      transport: "stdio",
      command: config.command,
      argsText: config.args.join("\n"),
      envText: Object.entries(config.env)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
      cwd: config.cwd ?? "",
      url: "",
      headersText: "",
    }
  }
  return {
    name: config.name,
    transport: config.transport,
    command: "",
    argsText: "",
    envText: "",
    cwd: "",
    url: config.url,
    headersText: Object.entries(config.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n"),
  }
}

function parseKeyValueLines(text: string, separator: "=" | ":", trimValue: boolean): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const index = line.indexOf(separator)
    if (index <= 0) continue
    const value = line.slice(index + 1)
    entries[line.slice(0, index).trim()] = trimValue ? value.trim() : value
  }
  return entries
}

export function mcpServerInputFromDraft(draft: McpServerDraft): McpServerInput {
  if (draft.transport === "stdio") {
    return {
      name: draft.name,
      transport: "stdio",
      command: draft.command,
      args: draft.argsText
        .split("\n")
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0),
      env: parseKeyValueLines(draft.envText, "=", false),
      cwd: draft.cwd || undefined,
    }
  }
  return {
    name: draft.name,
    transport: draft.transport,
    url: draft.url,
    headers: parseKeyValueLines(draft.headersText, ":", true),
  }
}
