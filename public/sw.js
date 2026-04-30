// Kanna service worker. Plain JS — no bundling.
// Receives Web Push payloads, displays OS notifications grouped by project,
// and routes notification taps to the right chat.

function bodyFor(payload) {
  const title = payload.chatTitle || "(untitled)"
  switch (payload.kind) {
    case "waiting_for_user":
      return `${title} — waiting for input`
    case "failed":
      return `${title} — failed`
    case "completed":
      return `${title} — done`
    default:
      return title
  }
}

self.addEventListener("push", (event) => {
  let payload
  try {
    payload = event.data ? event.data.json() : null
  } catch {
    return
  }
  if (!payload || payload.v !== 1) return

  const title = `Kanna • ${payload.projectTitle || "Project"}`
  event.waitUntil(self.registration.showNotification(title, {
    body: bodyFor(payload),
    tag: payload.projectLocalPath,
    renotify: false,
    data: { chatUrl: payload.chatUrl, ts: payload.ts },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.chatUrl) || "/"
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const sameOrigin = all.filter((c) => new URL(c.url).origin === self.location.origin)
    const hit = sameOrigin[0]
    if (hit) {
      await hit.focus()
      hit.postMessage({ type: "kanna.navigate", url })
    } else {
      await self.clients.openWindow(url)
    }
  })())
})

self.addEventListener("pushsubscriptionchange", () => {
  // The page will detect the missing/changed subscription on its next load
  // and re-subscribe. The SW cannot reach the Kanna WS directly.
})

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})
