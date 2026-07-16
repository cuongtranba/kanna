/**
 * Tests for api/projects.ts — verifies the project paths queryFn.
 */

import { describe, expect, test } from "bun:test"
import { fetchProjectPaths } from "./projects"
import { makeFakeHttpPort } from "../adapters/testing/makeFakePorts"

describe("fetchProjectPaths", () => {
  test("returns path list on success", async () => {
    const http = makeFakeHttpPort()
    const paths = [
      { path: "src/index.ts", kind: "file" as const },
      { path: "src/", kind: "dir" as const },
    ]
    http.routes.push({
      method: "GET",
      url: "/api/projects/proj1/paths",
      response: { ok: true, status: 200, body: { paths } },
    })
    const result = await fetchProjectPaths("proj1", "src", { http })
    expect(result).toEqual(paths)
  })

  test("returns empty array on non-ok response", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "GET",
      url: "/api/projects/proj1/paths",
      response: { ok: false, status: 404, body: null },
    })
    const result = await fetchProjectPaths("proj1", "x", { http })
    expect(result).toEqual([])
  })

  test("returns empty array on network error", async () => {
    // No routes registered — throws inside, swallowed by the catch
    const http = makeFakeHttpPort()
    const result = await fetchProjectPaths("proj1", "y", { http })
    expect(result).toEqual([])
  })

  test("encodes projectId in URL", async () => {
    const http = makeFakeHttpPort()
    const encodedId = encodeURIComponent("my project/id")
    http.routes.push({
      method: "GET",
      url: `/api/projects/${encodedId}/paths`,
      response: { ok: true, status: 200, body: { paths: [] } },
    })
    const result = await fetchProjectPaths("my project/id", "q", { http })
    expect(result).toEqual([])
    expect(http.calls[0]?.url).toContain(encodedId)
  })
})
