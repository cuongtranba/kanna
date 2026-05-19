import React from "react"
import { Link } from "react-router-dom"

// Parse server-formatted error/refusal text that embeds chat references as
// markdown links (`[title](/chat/<uuid>)`) and render the `/chat/<id>` ones
// as clickable react-router links. Plain text segments stay untouched.
// Source: AgentCoordinator.buildPoolUnavailableMessage.
const CHAT_LINK_RE = /\[([^\]]+)\]\(\/chat\/([0-9a-fA-F][0-9a-fA-F-]{7,})\)/g

export function renderChatLinks(text: string, linkClassName?: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0
  CHAT_LINK_RE.lastIndex = 0
  for (let match = CHAT_LINK_RE.exec(text); match !== null; match = CHAT_LINK_RE.exec(text)) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(
      <Link
        key={`chat-link-${key++}`}
        to={`/chat/${match[2]}`}
        className={linkClassName ?? "underline decoration-destructive/40 hover:decoration-destructive"}
      >
        {match[1]}
      </Link>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length === 0 ? text : parts
}
