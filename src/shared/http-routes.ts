import type { CommandType } from "./commands"

export type HttpMethod = "GET" | "HEAD" | "POST" | "PATCH" | "DELETE" | "OPTIONS"

export type HttpRouteRemote =
  | { readonly kind: "mcp-tool"; readonly tool: string }
  | { readonly kind: "command"; readonly type: CommandType }
  | { readonly kind: "excluded"; readonly reason: string }

export interface HttpRoute<Path extends string = string> {
  readonly methods: readonly HttpMethod[]
  readonly path: Path
  readonly purpose: string
  readonly remote: HttpRouteRemote
}

function defineRoute<const Path extends string>(route: HttpRoute<Path>): HttpRoute<Path> {
  return route
}

const MCP_OWNS_ITS_AUTH =
  "The remote MCP server authenticates with its own bearer token or OAuth, so a session login or logout has no MCP counterpart."

export const HTTP_ROUTES = {
  websocket: defineRoute({
    methods: ["GET"],
    path: "/ws",
    purpose: "WebSocket transport that carries every registry command and every snapshot subscription.",
    remote: {
      kind: "excluded",
      reason: "It is the transport itself; MCP reaches the same command handlers through kanna_command and the snapshots through kanna_read.",
    },
  }),
  authStatus: defineRoute({
    methods: ["GET"],
    path: "/auth/status",
    purpose: "Whether a password is required and whether the browser session is signed in; also the server readiness probe after an update.",
    remote: { kind: "excluded", reason: MCP_OWNS_ITS_AUTH },
  }),
  authLogin: defineRoute({
    methods: ["POST"],
    path: "/auth/login",
    purpose: "Sign the browser in with the password and set the session cookie.",
    remote: { kind: "excluded", reason: MCP_OWNS_ITS_AUTH },
  }),
  authLogout: defineRoute({
    methods: ["POST"],
    path: "/auth/logout",
    purpose: "Clear the browser session cookie.",
    remote: { kind: "excluded", reason: MCP_OWNS_ITS_AUTH },
  }),
  shareSnapshot: defineRoute({
    methods: ["GET"],
    path: "/api/share/:token",
    purpose: "Public read-only page of a shared chat snapshot, addressed by its share token.",
    remote: {
      kind: "excluded",
      reason: "A public page for people without access to Kanna; an MCP client reads chats directly through get_chat and kanna_read.",
    },
  }),
  localFile: defineRoute({
    methods: ["GET", "HEAD"],
    path: "/api/local-file",
    purpose: "Serve a file by absolute path on the host so a chat link to a local file can preview or download it.",
    remote: {
      kind: "excluded",
      reason: "It serves any absolute path on the host, which is out of scope for a remote client until the owner decides otherwise.",
    },
  }),
  projectFileContent: defineRoute({
    methods: ["GET", "HEAD"],
    path: "/api/projects/:projectId/files/*filePath/content",
    purpose: "Bytes of one file inside a project, for previews and downloads.",
    remote: { kind: "mcp-tool", tool: "read_project_file" },
  }),
  uploadContent: defineRoute({
    methods: ["GET", "HEAD"],
    path: "/api/projects/:projectId/uploads/:storedName/content",
    purpose: "Bytes of one stored upload of a project; uploads live under .kanna/uploads inside the project, so read_project_file reads them by that path.",
    remote: { kind: "mcp-tool", tool: "read_project_file" },
  }),
  uploadTus: defineRoute({
    methods: ["POST", "OPTIONS"],
    path: "/api/projects/:projectId/uploads/tus",
    purpose: "Create a resumable tus upload of an attachment into a project; the tus client continues with HEAD, PATCH and DELETE on the Location URL beneath this path.",
    remote: { kind: "mcp-tool", tool: "upload_attachment" },
  }),
  pluginClientBundle: defineRoute({
    methods: ["GET"],
    path: "/api/plugins/:pluginId/client.js",
    purpose: "JavaScript bundle of a plugin that the browser evaluates to add UI.",
    remote: {
      kind: "excluded",
      reason: "Code a browser executes; a remote client manages plugins through the plugins.list and plugins.reload commands instead.",
    },
  }),
} as const

type PathSegments<Path extends string> = Path extends `${infer Head}/${infer Rest}` ? Head | PathSegments<Rest> : Path

type ParamName<Segment extends string> = Segment extends `:${infer Name}`
  ? Name
  : Segment extends `*${infer Name}`
    ? Name
    : never

export type RouteParams<Path extends string> = { readonly [Name in ParamName<PathSegments<Path>>]: string }

type RouteArgs<Path extends string> = [ParamName<PathSegments<Path>>] extends [never] ? [] : [params: RouteParams<Path>]

function encodePathSegments(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/")
}

export function buildRoutePath<const Path extends string>(path: Path, ...args: RouteArgs<Path>): string
export function buildRoutePath(path: string, params: Readonly<Record<string, string>> = {}): string {
  return expandRoutePath(path, params)
}

export function expandRoutePath(path: string, params: Readonly<Record<string, string>>): string {
  return path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) return encodeURIComponent(params[segment.slice(1)] ?? "")
      if (segment.startsWith("*")) return encodePathSegments(params[segment.slice(1)] ?? "")
      return segment
    })
    .join("/")
}

export function matchRoutePath<const Path extends string>(path: Path, pathname: string): RouteParams<Path> | null
export function matchRoutePath(path: string, pathname: string): Readonly<Record<string, string>> | null {
  try {
    return matchSegments(path, pathname)
  } catch (error) {
    if (error instanceof URIError) return null
    throw error
  }
}

function matchSegments(path: string, pathname: string): Readonly<Record<string, string>> | null {
  const pattern = path.split("/")
  const actual = pathname.split("/")
  const params: Record<string, string> = {}
  let at = 0
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index] ?? ""
    if (segment.startsWith("*")) {
      const trailing = pattern.length - index - 1
      const taken = actual.length - at - trailing
      if (taken < 1) return null
      params[segment.slice(1)] = decodeSegments(actual.slice(at, at + taken))
      at += taken
      continue
    }
    const candidate = actual[at]
    if (candidate === undefined) return null
    at += 1
    if (segment.startsWith(":")) {
      if (candidate === "") return null
      params[segment.slice(1)] = decodeSegments([candidate])
      continue
    }
    if (segment !== candidate) return null
  }
  return at === actual.length ? params : null
}

function decodeSegments(segments: readonly string[]): string {
  return segments.map(decodeURIComponent).join("/")
}

export function listHttpRoutes(): readonly HttpRoute[] {
  return Object.values(HTTP_ROUTES)
}
