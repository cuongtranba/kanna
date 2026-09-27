import { describe, expect, test } from "bun:test"
import { projectProcessEnv } from "./project-process-env"

describe("projectProcessEnv", () => {
  test("drops the NODE_ENV Kanna itself runs under", () => {
    const env = projectProcessEnv({ NODE_ENV: "production", PATH: "/usr/bin" })

    expect("NODE_ENV" in env).toBe(false)
  })

  test("keeps every other variable as it was", () => {
    const env = projectProcessEnv({ NODE_ENV: "production", PATH: "/usr/bin", HOME: "/home/me" })

    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/me" })
  })

  test("leaves the environment it was given untouched", () => {
    const base = { NODE_ENV: "production", PATH: "/usr/bin" }

    projectProcessEnv(base)

    expect(base).toEqual({ NODE_ENV: "production", PATH: "/usr/bin" })
  })
})
