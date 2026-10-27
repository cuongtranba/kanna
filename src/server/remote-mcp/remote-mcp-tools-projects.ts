import { z } from "zod"
import type { JsonObject } from "../../shared/json"
import { toJsonValue } from "../json-boundary"
import { fail } from "../kanna-mcp-tool"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { commandTool, mcpOnlyTool, topicTool, type RemoteTool } from "./remote-mcp-tool-spec"
import {
  chatRows,
  jsonResult,
  projectRows,
  readChat,
  readProjectTitles,
  readSidebar,
  type ChatRow,
  type ProjectRow,
} from "./remote-mcp-views"

const CHAT_PREFIX = "chat:"
const PROJECT_PREFIX = "project:"
const FETCH_RECENT_LIMIT = 200
const SNIPPET_CHARS = 120

interface SearchHit {
  id: string
  title: string
  url: string
  snippet?: string
}

function matches(query: string, ...fields: string[]): boolean {
  const needle = query.toLowerCase()
  return fields.some((field) => field.toLowerCase().includes(needle))
}

function projectHit(project: ProjectRow): SearchHit {
  return { id: `${PROJECT_PREFIX}${project.projectId}`, title: project.title, url: "kanna://projects", snippet: project.localPath }
}

function chatHit(chat: ChatRow, projectTitle: string): SearchHit {
  return {
    id: `${CHAT_PREFIX}${chat.chatId}`,
    title: chat.title,
    url: `kanna://chats/${chat.chatId}`,
    snippet: `${projectTitle} - ${chat.status}`.slice(0, SNIPPET_CHARS),
  }
}

export const projectTools: readonly RemoteTool[] = [
  topicTool({
    name: "list_projects",
    title: "List projects",
    description: "List the projects in the Kanna sidebar with their ids, paths and chat counts, plus any stacks.",
    annotations: { readOnlyHint: true },
    topic: "sidebar",
    input: z.object({}),
    handle: (_args, { host }) => {
      const sidebar = readSidebar(host)
      if (!sidebar) return fail("The sidebar snapshot is unavailable.")
      return jsonResult({ projects: projectRows(sidebar, readProjectTitles(host)), stacks: toJsonValue(sidebar.stacks) })
    },
  }),
  commandTool({
    name: "open_project",
    title: "Open a project",
    description: "Register an existing folder on the Kanna host as a project and return its projectId.",
    command: "project.open",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "project.open", ...args }),
  }),
  commandTool({
    name: "create_project",
    title: "Create a project",
    description: "Create a new project folder on the Kanna host and register it; returns its projectId.",
    command: "project.create",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "project.create", ...args }),
  }),
  topicTool({
    name: "list_chats",
    title: "List chats",
    description: "List chats with id, project, title, status, last activity and unread flag, optionally for one project.",
    annotations: { readOnlyHint: true },
    topic: "sidebar",
    input: z.object({
      projectId: z.string().optional().describe("Only chats of this project"),
      includeArchived: z.boolean().optional().describe("Also list archived chats (default false)"),
    }),
    handle: ({ projectId, includeArchived }, { host }) => {
      const sidebar = readSidebar(host)
      if (!sidebar) return fail("The sidebar snapshot is unavailable.")
      return jsonResult({ chats: chatRows(sidebar, { projectId, includeArchived }) })
    },
  }),
  mcpOnlyTool({
    name: "search",
    title: "Search chats and projects",
    description: "Case-insensitive search over chat titles and project titles or paths. Returns ids usable with fetch.",
    annotations: { readOnlyHint: true },
    reason: "The search contract connectors such as ChatGPT expect; it filters the sidebar rows in the server and has no command.",
    input: z.object({ query: z.string().describe("Text to look for") }),
    handle: ({ query }, { host }) => {
      const sidebar = readSidebar(host)
      if (!sidebar) return fail("The sidebar snapshot is unavailable.")
      const projects = projectRows(sidebar, readProjectTitles(host))
      const titles = new Map(projects.map((project) => [project.projectId, project.title]))
      const results: SearchHit[] = [
        ...projects.filter((project) => matches(query, project.title, project.localPath)).map(projectHit),
        ...chatRows(sidebar, { includeArchived: true })
          .filter((chat) => matches(query, chat.title))
          .map((chat) => chatHit(chat, titles.get(chat.projectId) ?? "")),
      ]
      return jsonResult({ results })
    },
  }),
  mcpOnlyTool({
    name: "fetch",
    title: "Fetch a chat or project",
    description: "Fetch the full text of a search result: a chat transcript (id chat:<chatId>) or a project summary (id project:<projectId>).",
    annotations: { readOnlyHint: true },
    reason: "The fetch contract connectors such as ChatGPT expect; it renders a search id as text and has no command.",
    input: z.object({ id: z.string().describe("An id returned by search") }),
    handle: ({ id }, { host }) => {
      if (id.startsWith(CHAT_PREFIX)) return fetchChat(host, id.slice(CHAT_PREFIX.length), id)
      if (id.startsWith(PROJECT_PREFIX)) return fetchProject(host, id.slice(PROJECT_PREFIX.length), id)
      return fail(`Unknown id "${id}". Use an id from search.`)
    },
  }),
]

function fetchChat(host: RemoteMcpHost, chatId: string, id: string) {
  const snapshot = readChat(host, chatId, FETCH_RECENT_LIMIT)
  if (!snapshot) return fail(`Chat ${chatId} was not found.`)
  const lines: string[] = []
  for (const entry of snapshot.messages) {
    if (entry.kind === "user_prompt") lines.push(`User: ${entry.content}`)
    if (entry.kind === "assistant_text") lines.push(`Assistant: ${entry.text}`)
  }
  const metadata: JsonObject = {
    chatId,
    projectId: snapshot.runtime.projectId,
    status: snapshot.runtime.status,
    provider: snapshot.runtime.provider,
  }
  return jsonResult({ id, title: snapshot.runtime.title, text: lines.join("\n\n"), url: `kanna://chats/${chatId}`, metadata })
}

function fetchProject(host: RemoteMcpHost, projectId: string, id: string) {
  const sidebar = readSidebar(host)
  const project = sidebar ? projectRows(sidebar, readProjectTitles(host)).find((row) => row.projectId === projectId) : undefined
  if (!sidebar || !project) return fail(`Project ${projectId} was not found.`)
  const chats = chatRows(sidebar, { projectId })
  const text = [
    `Project ${project.title} at ${project.localPath}`,
    ...chats.map((chat) => `- ${chat.title} (${chat.chatId}, ${chat.status})`),
  ].join("\n")
  const metadata: JsonObject = { projectId, localPath: project.localPath, chatCount: project.chatCount }
  return jsonResult({ id, title: project.title, text, url: "kanna://projects", metadata })
}
