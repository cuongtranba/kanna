import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { NoticeBanner } from "./notice-banner"

describe("NoticeBanner", () => {
  test("renders children inside a status role strip", () => {
    const html = renderToStaticMarkup(
      <NoticeBanner variant="warning">PTY driver active.</NoticeBanner>,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain("PTY driver active.")
  })

  test("applies warning tone via --warning dot + bg-warning tint", () => {
    const html = renderToStaticMarkup(
      <NoticeBanner variant="warning">msg</NoticeBanner>,
    )
    expect(html).toContain("var(--warning)")
    expect(html).toContain("bg-warning/[0.06]")
  })

  test("applies info tone", () => {
    const html = renderToStaticMarkup(
      <NoticeBanner variant="info">msg</NoticeBanner>,
    )
    expect(html).toContain("var(--info)")
    expect(html).toContain("bg-info/[0.06]")
  })

  test("applies success tone", () => {
    const html = renderToStaticMarkup(
      <NoticeBanner variant="success">msg</NoticeBanner>,
    )
    expect(html).toContain("var(--success)")
    expect(html).toContain("bg-success/[0.06]")
  })

  test("applies error tone via destructive token", () => {
    const html = renderToStaticMarkup(
      <NoticeBanner variant="error">msg</NoticeBanner>,
    )
    expect(html).toContain("var(--destructive)")
    expect(html).toContain("bg-destructive/[0.06]")
  })

  test("omits the dot when dot=false", () => {
    const html = renderToStaticMarkup(
      <NoticeBanner variant="info" dot={false}>
        msg
      </NoticeBanner>,
    )
    expect(html).not.toContain("var(--info)")
    expect(html).toContain("msg")
  })

  test("merges extra className onto the wrapper", () => {
    const html = renderToStaticMarkup(
      <NoticeBanner variant="warning" className="custom-banner">
        msg
      </NoticeBanner>,
    )
    expect(html).toContain("custom-banner")
  })
})
