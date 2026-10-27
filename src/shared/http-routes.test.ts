import { describe, expect, test } from "vite-plus/test"
import { buildRoutePath, HTTP_ROUTES, listHttpRoutes, matchRoutePath } from "./http-routes"

describe("http route inventory paths", () => {
  test("a built path encodes each parameter and matches back to the same values", () => {
    const params = { projectId: "my project/id", storedName: "a b#c?.txt" }

    const built = buildRoutePath(HTTP_ROUTES.uploadContent.path, params)

    expect(built).toBe("/api/projects/my%20project%2Fid/uploads/a%20b%23c%3F.txt/content")
    expect(matchRoutePath(HTTP_ROUTES.uploadContent.path, built)).toEqual(params)
  })

  test("a splat parameter keeps the slashes of a nested file path and round-trips odd segments", () => {
    const params = { projectId: "p1", filePath: "src/some dir/100%.ts" }

    const built = buildRoutePath(HTTP_ROUTES.projectFileContent.path, params)

    expect(built).toBe("/api/projects/p1/files/src/some%20dir/100%25.ts/content")
    expect(matchRoutePath(HTTP_ROUTES.projectFileContent.path, built)).toEqual(params)
  })

  test("a path of another route, a missing segment or broken percent escapes does not match", () => {
    const upload = HTTP_ROUTES.uploadContent.path

    expect(matchRoutePath(upload, "/api/projects/p1/files/a.txt/content")).toBeNull()
    expect(matchRoutePath(upload, "/api/projects/p1/uploads//content")).toBeNull()
    expect(matchRoutePath(upload, "/api/projects/p1/uploads/a.txt")).toBeNull()
    expect(matchRoutePath(upload, "/api/projects/p1/uploads/%E0%A4%A/content")).toBeNull()
  })

  test("every inventory entry explains itself and names a method", () => {
    for (const route of listHttpRoutes()) {
      expect(route.path.startsWith("/")).toBe(true)
      expect(route.methods.length).toBeGreaterThan(0)
      expect(route.purpose.trim().length).toBeGreaterThan(0)
      if (route.remote.kind === "excluded") expect(route.remote.reason.trim().length).toBeGreaterThan(0)
    }
  })
})
