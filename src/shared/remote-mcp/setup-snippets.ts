export type RemoteMcpClientId = "claude-desktop" | "claude-code" | "codex" | "chatgpt"

export interface RemoteMcpSetupSnippet {
  readonly id: string
  readonly client: RemoteMcpClientId
  readonly title: string
  readonly instructions: string
  readonly snippet: string
}

export interface RemoteMcpSetupInput {
  readonly publicOrigin: string | null
  readonly passwordConfigured: boolean
}

export const PASSWORD_PLACEHOLDER = "<your Kanna password>"
export const ORIGIN_PLACEHOLDER = "https://<your-public-kanna-url>"

const PASSWORD_REQUIRED_NOTE = "Start Kanna with --password first; the remote MCP server is off without it. "
const PUBLIC_HTTPS_NOTE = "The URL must be https and reachable from the internet (a Cloudflare tunnel or --share)."

function endpointOf(origin: string): string {
  return `${origin}/mcp`
}

export function buildRemoteMcpSetupSnippets({ publicOrigin, passwordConfigured }: RemoteMcpSetupInput): RemoteMcpSetupSnippet[] {
  const endpoint = endpointOf(publicOrigin ?? ORIGIN_PLACEHOLDER)
  const prefix = passwordConfigured ? "" : PASSWORD_REQUIRED_NOTE
  return [
    {
      id: "claude-code",
      client: "claude-code",
      title: "Claude Code",
      instructions: `${prefix}Add the server with your Kanna password as a bearer header, or add it without one and sign in through OAuth.`,
      snippet: [
        `claude mcp add --transport http kanna ${endpoint} --header "Authorization: Bearer ${PASSWORD_PLACEHOLDER}"`,
        "",
        `claude mcp add --transport http kanna ${endpoint}`,
        "# then run /mcp inside Claude Code and choose Authenticate to sign in with OAuth",
      ].join("\n"),
    },
    {
      id: "codex",
      client: "codex",
      title: "Codex",
      instructions: `${prefix}Put the block in ~/.codex/config.toml and export your Kanna password as KANNA_PASSWORD, or sign in through OAuth instead.`,
      snippet: [
        "[mcp_servers.kanna]",
        `url = "${endpoint}"`,
        'bearer_token_env_var = "KANNA_PASSWORD"',
        "",
        "# OAuth alternative: drop bearer_token_env_var and run",
        "codex mcp login kanna",
      ].join("\n"),
    },
    {
      id: "claude-desktop",
      client: "claude-desktop",
      title: "Claude Desktop and claude.ai",
      instructions: `${prefix}Open Settings, Connectors, Add custom connector and enter the URL. Add the request header below, or leave it empty to sign in through OAuth. ${PUBLIC_HTTPS_NOTE}`,
      snippet: [`URL: ${endpoint}`, `Header: Authorization: Bearer ${PASSWORD_PLACEHOLDER}`].join("\n"),
    },
    {
      id: "chatgpt",
      client: "chatgpt",
      title: "ChatGPT",
      instructions: `${prefix}Open chatgpt.com/plugins, select the plus button, then Add custom MCP server; enter the URL and choose OAuth as the authentication. ${PUBLIC_HTTPS_NOTE}`,
      snippet: [`URL: ${endpoint}`, "Authentication: OAuth"].join("\n"),
    },
  ]
}
