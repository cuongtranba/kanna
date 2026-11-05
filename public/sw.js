// Kanna service worker. Plain JS — no bundling.
// Receives Web Push payloads, displays OS notifications grouped by project,
// and routes notification taps to the right chat. The payload-to-notification
// and click-to-action decisions live in sw-notifications.js so they stay testable.

importScripts("/sw-notifications.js")

self.addEventListener("push", (event) => {
  let payload
  try {
    payload = event.data ? event.data.json() : null
  } catch {
    return
  }
  if (!payload || payload.v !== 1) return

  const title = `Kanna • ${payload.projectTitle || "Project"}`
  event.waitUntil(self.registration.showNotification(title, kannaNotificationOptions(payload)))
})

async function openOrFocus(url) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  const hit = all.filter((c) => new URL(c.url).origin === self.location.origin)[0]
  if (hit) {
    await hit.focus()
    hit.postMessage({ type: "kanna.navigate", url })
  } else {
    await self.clients.openWindow(url)
  }
}

async function approveFromNotification(plan) {
  try {
    const response = await fetch(plan.endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plan.body),
    })
    return response.ok
  } catch {
    return false
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const plan = kannaNotificationPlan(event.notification.data, event.action)
  event.waitUntil((async () => {
    if (plan.kind === "approve") {
      if (await approveFromNotification(plan)) {
        await self.registration.showNotification("Kanna", { body: "Sent", tag: event.notification.tag, silent: true })
        return
      }
      await openOrFocus(plan.fallbackUrl)
      return
    }
    await openOrFocus(plan.url)
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
