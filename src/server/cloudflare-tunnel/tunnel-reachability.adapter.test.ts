import { expect, test } from "vite-plus/test"
import { createReachabilityProbe } from "./tunnel-reachability.adapter"

function fakeEdge(dnsAnswers: Response[]) {
  const seen = { dns: 0, origin: 0 }
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      if (new URL(request.url).pathname === "/dns-query") {
        seen.dns += 1
        return dnsAnswers[Math.min(seen.dns, dnsAnswers.length) - 1].clone()
      }
      seen.origin += 1
      return new Response(null, { status: seen.origin <= 2 ? 530 : 200 })
    },
  })
  const probe = createReachabilityProbe({
    intervalMs: 10,
    deadlineMs: 5000,
    dnsOverHttpsUrl: `http://localhost:${server.port}/dns-query`,
  })
  return { seen, server, probe, url: `http://localhost:${server.port}/` }
}

test("waits for the hostname in public DNS before touching it, then past edge 530s", async () => {
  const nxdomain = Response.json({ Status: 3 })
  const published = Response.json({ Status: 0, Answer: [{ type: 1, data: "104.16.230.132" }] })
  const edge = fakeEdge([nxdomain, nxdomain, published])
  try {
    await edge.probe(edge.url, new AbortController().signal)
    expect(edge.seen).toEqual({ dns: 3, origin: 3 })
  } finally {
    await edge.server.stop(true)
  }
})

test("an unreachable DNS-over-HTTPS resolver does not block the origin probe", async () => {
  const edge = fakeEdge([new Response(null, { status: 503 })])
  try {
    await edge.probe(edge.url, new AbortController().signal)
    expect(edge.seen).toEqual({ dns: 1, origin: 3 })
  } finally {
    await edge.server.stop(true)
  }
})
