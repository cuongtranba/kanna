import { describe, expect, test } from "bun:test"
import { closeHttpServer, createHttpServer } from "./http-server.adapter"

describe("createHttpServer", () => {
  test("disables socket reaping so long-lived SSE streams survive idle", async () => {
    const server = createHttpServer((_req, res) => {
      res.statusCode = 204
      res.end()
    })
    try {
      expect(server.requestTimeout).toBe(0)
      expect(server.timeout).toBe(0)
      expect(server.keepAliveTimeout).toBe(0)
    } finally {
      await closeHttpServer(server)
    }
  })
})
