
import { describe, expect, test } from "vite-plus/test"
import { fetchAuthStatus, postAuthLogin, postAuthLogout } from "./auth"
import { makeFakeHttpPort } from "../adapters/testing/makeFakePorts"

describe("fetchAuthStatus", () => {
  test("returns payload when response is ok", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "GET",
      url: "/auth/status",
      response: { ok: true, status: 200, body: { enabled: true, authenticated: false } },
    })
    const result = await fetchAuthStatus(undefined, http)
    expect(result).toEqual({ kind: "ok", status: { enabled: true, authenticated: false } })
  })

  test("asks for a retry when response is not ok", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "GET",
      url: "/auth/status",
      response: { ok: false, status: 503, body: null },
    })
    const result = await fetchAuthStatus(undefined, http)
    expect(result).toEqual({ kind: "retry" })
  })

  test("asks for a retry when the server cannot be reached", async () => {
    const http = makeFakeHttpPort()
    const result = await fetchAuthStatus(undefined, http)
    expect(result).toEqual({ kind: "retry" })
  })

  test("calls GET /auth/status with no-store cache", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "GET", url: "/auth/status", response: { ok: true, status: 200, body: {} } })
    await fetchAuthStatus(undefined, http)
    expect(http.calls[0]).toEqual({ method: "GET", url: "/auth/status" })
  })
})

describe("postAuthLogin", () => {
  test("returns true when login succeeds", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "POST", url: "/auth/login", response: { ok: true, status: 200, body: { ok: true } } })
    const result = await postAuthLogin({ password: "secret" }, http)
    expect(result).toBe(true)
  })

  test("returns false when login fails", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "POST", url: "/auth/login", response: { ok: false, status: 401, body: null } })
    const result = await postAuthLogin({ password: "wrong" }, http)
    expect(result).toBe(false)
  })
})

describe("postAuthLogout", () => {
  test("calls POST /auth/logout", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "POST", url: "/auth/logout", response: { ok: true, status: 200, body: null } })
    await postAuthLogout(http)
    expect(http.calls[0]).toEqual({ method: "POST", url: "/auth/logout" })
  })
})
