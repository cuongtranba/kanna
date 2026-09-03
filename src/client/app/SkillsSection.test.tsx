import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SkillsSection } from "./SkillsSection"

describe("SkillsSection", () => {
  test("renders installed and discover sections", () => {
    const html = renderToStaticMarkup(
      <SkillsSection
        state={{
          connectionStatus: "connected",
          socket: {
            command: async () => ({ skills: [] }),
          } as never,
        }}
      />
    )

    expect(html).toContain("Installed")
    expect(html).toContain("Discover")
    expect(html).toContain("Search skills")
  })

  test("renders Check button in the header", () => {
    const html = renderToStaticMarkup(
      <SkillsSection
        state={{
          connectionStatus: "connected",
          socket: { command: async () => ({ skills: [] }) } as never,
        }}
      />
    )
    expect(html).toContain("Check")
  })
})
