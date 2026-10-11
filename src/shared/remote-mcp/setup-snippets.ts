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
      instructions: `${prefix}Export your Kanna password as KANNA_PASSWORD, then run the command, or put the equivalent block in ~/.codex/config.toml. For OAuth, leave out the bearer variable and run codex mcp login kanna.`,
      snippet: [
        `codex mcp add kanna --url ${endpoint} --bearer-token-env-var KANNA_PASSWORD`,
        "",
        "# or in ~/.codex/config.toml",
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
      instructions: `${prefix}Open Customize, Connectors, Add custom connector and enter the URL. For OAuth, choose Register automatically as the OAuth client. If your account shows Request headers, you can instead choose No sign-in and add the header below. ${PUBLIC_HTTPS_NOTE}`,
      snippet: [
        `MCP server URL: ${endpoint}`,
        "OAuth client: Register automatically",
        `Request header (No sign-in only): authorization = Bearer ${PASSWORD_PLACEHOLDER}`,
      ].join("\n"),
    },
    {
      id: "claude-desktop-local",
      client: "claude-desktop",
      title: "Claude Desktop, local bridge",
      instructions: `${prefix}Needs Node.js. In Claude Desktop open Settings, Developer, Edit Config, add the block to claude_desktop_config.json and restart Claude. The bridge runs on your computer, so a localhost URL works and no public URL is needed.`,
      snippet: JSON.stringify(
        {
          mcpServers: {
            kanna: {
              command: "npx",
              args: ["-y", "mcp-remote", endpoint, "--header", `Authorization:\${KANNA_AUTH}`],
              env: { KANNA_AUTH: `Bearer ${PASSWORD_PLACEHOLDER}` },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "chatgpt",
      client: "chatgpt",
      title: "ChatGPT",
      instructions: `${prefix}Turn on Settings, Apps, Advanced settings, Developer mode, then choose Create app. Enter the URL, choose OAuth and leave the client ID empty so ChatGPT registers itself. ${PUBLIC_HTTPS_NOTE}`,
      snippet: [`MCP server URL: ${endpoint}`, "Authentication: OAuth (leave the client ID empty)"].join("\n"),
    },
  ]
}
