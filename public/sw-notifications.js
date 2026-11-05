const KANNA_APPROVE_ENDPOINT = "/api/inbox/proposals/approve"

function kannaSafeUrl(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/"
}

function kannaNotificationBody(payload) {
  if (typeof payload.body === "string" && payload.body.length > 0) return payload.body
  const title = payload.chatTitle || "(untitled)"
  switch (payload.kind) {
    case "waiting_for_user":
      return `${title} — waiting for input`
    case "failed":
      return `${title} — failed`
    case "completed":
      return `${title} — done`
    case "inbox":
    case "inbox_proposal":
      return `${title} — ${payload.projectTitle || "Inbox"}`
    default:
      return title
  }
}

function kannaNotificationOptions(payload) {
  const canApprove = typeof payload.threadId === "string" && typeof payload.proposalId === "string"
  const actions = canApprove && Array.isArray(payload.actions)
    ? payload.actions.filter((entry) => entry && entry.action === "send").map((entry) => ({ action: "send", title: String(entry.title || "Send") }))
    : []
  return {
    body: kannaNotificationBody(payload),
    tag: payload.threadId || payload.chatId,
    renotify: true,
    ...(actions.length > 0 ? { actions } : {}),
    data: {
      chatUrl: kannaSafeUrl(payload.chatUrl),
      ts: payload.ts,
      ...(canApprove ? { approve: { threadId: payload.threadId, proposalId: payload.proposalId } } : {}),
    },
  }
}

function kannaNotificationPlan(data, action) {
  const openUrl = kannaSafeUrl(data && data.chatUrl)
  const approve = data && data.approve
  if (action === "send" && approve && typeof approve.threadId === "string" && typeof approve.proposalId === "string") {
    return {
      kind: "approve",
      endpoint: KANNA_APPROVE_ENDPOINT,
      body: { threadId: approve.threadId, proposalId: approve.proposalId },
      fallbackUrl: openUrl,
    }
  }
  return { kind: "open", url: openUrl }
}
