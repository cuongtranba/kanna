import { describe, expect, test } from "vite-plus/test"
import { normalizeRemoteMcpPublicUrl } from "./remote-mcp"

describe("normalizeRemoteMcpPublicUrl", () => {
  test("keeps the origin of an https url and strips path, query, hash and trailing slash", () => {
    expect(normalizeRemoteMcpPublicUrl("https://kanna.example.dev/a/b?x=1#h")).toBe("https://kanna.example.dev")
    expect(normalizeRemoteMcpPublicUrl("https://kanna.example.dev:8443/")).toBe("https://kanna.example.dev:8443")
  })

  test("accepts http only on loopback hosts", () => {
    expect(normalizeRemoteMcpPublicUrl("http://127.0.0.1:3210/mcp")).toBe("http://127.0.0.1:3210")
    expect(normalizeRemoteMcpPublicUrl("http://localhost:3210")).toBe("http://localhost:3210")
    expect(normalizeRemoteMcpPublicUrl("http://192.168.1.5:3210")).toBeNull()
    expect(normalizeRemoteMcpPublicUrl("http://kanna.example.dev")).toBeNull()
  })

  test("rejects garbage and other schemes", () => {
    expect(normalizeRemoteMcpPublicUrl("not a url")).toBeNull()
    expect(normalizeRemoteMcpPublicUrl("ftp://kanna.example.dev")).toBeNull()
    expect(normalizeRemoteMcpPublicUrl(null)).toBeNull()
  })
})
