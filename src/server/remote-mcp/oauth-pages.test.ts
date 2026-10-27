import { describe, expect, test } from "vite-plus/test"
import { renderOAuthConsentPage, renderOAuthLoginPage } from "./oauth-pages"

const HOSTILE = `<script>alert("x")</script>&'`

describe("OAuth pages", () => {
  test("the login page escapes the client name and error and carries the signed query as a hidden field", () => {
    const html = renderOAuthLoginPage({ clientName: HOSTILE, oauthQuery: 'a=1&sig="x"', error: HOSTILE })

    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;")
    expect(html).toContain('<input type="hidden" name="oauth_query" value="a=1&amp;sig=&quot;x&quot;">')
    expect(html).toContain('method="post" action="/oauth/login"')
    expect(html).toContain('type="password" name="password"')
  })

  test("the login page omits the error block when there is no error", () => {
    expect(renderOAuthLoginPage({ clientName: "Test", oauthQuery: "q" })).not.toContain('role="alert"')
  })

  test("the consent page offers Allow and Deny as accept values and escapes every interpolation", () => {
    const html = renderOAuthConsentPage({
      clientName: HOSTILE,
      redirectUri: `http://x/cb?a="1"&b=<2>`,
      scopes: ["kanna", HOSTILE],
      oauthQuery: "q&1",
    })

    expect(html).not.toContain("<script>")
    expect(html).toContain('name="accept" value="true"')
    expect(html).toContain('name="accept" value="false"')
    expect(html).toContain('action="/oauth/consent"')
    expect(html).toContain('name="oauth_query" value="q&amp;1"')
    expect(html).toContain("http://x/cb?a=&quot;1&quot;&amp;b=&lt;2&gt;")
    expect(html).toContain("<li>kanna</li>")
  })
})
