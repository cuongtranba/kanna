import { OAUTH_CONSENT_PATH, OAUTH_LOGIN_PATH } from "./oauth-paths"

export interface OAuthLoginPageArgs {
  clientName: string
  oauthQuery: string
  error?: string
}

export interface OAuthConsentPageArgs {
  clientName: string
  redirectUri: string
  scopes: readonly string[]
  oauthQuery: string
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)
}

const PAGE_STYLE = `
:root {
  color-scheme: light dark;
  --background: oklch(99.5% 0.003 13);
  --foreground: oklch(16% 0.01 13);
  --card: oklch(99.5% 0.003 13);
  --muted-foreground: oklch(46% 0.013 13);
  --border: oklch(91% 0.008 13);
  --primary: oklch(20% 0.012 13);
  --primary-foreground: oklch(98% 0.005 13);
  --destructive-text: oklch(56% 0.18 13);
  --radius: 0.5rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: oklch(20% 0.01 13);
    --foreground: oklch(98% 0.003 13);
    --card: oklch(23% 0.01 13);
    --muted-foreground: oklch(72% 0.012 13);
    --border: oklch(29% 0.008 13);
    --primary: oklch(98% 0.003 13);
    --primary-foreground: oklch(18% 0.01 13);
    --destructive-text: oklch(78% 0.18 13);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: var(--background);
  color: var(--foreground);
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}
main {
  width: 100%;
  max-width: 24rem;
  padding: 1.5rem;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
p { margin: 0 0 1rem; color: var(--muted-foreground); }
strong { color: var(--foreground); }
ul { margin: 0 0 1rem; padding-left: 1.25rem; }
label { display: block; margin-bottom: 0.25rem; font-weight: 600; }
input[type="password"] {
  width: 100%;
  padding: 0.5rem 0.75rem;
  margin-bottom: 1rem;
  font: inherit;
  color: var(--foreground);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.actions { display: flex; gap: 0.5rem; }
button {
  flex: 1;
  padding: 0.5rem 1rem;
  font: inherit;
  font-weight: 600;
  color: var(--foreground);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
button.primary { color: var(--primary-foreground); background: var(--primary); border-color: var(--primary); }
.error { color: var(--destructive-text); font-weight: 600; }
.uri { overflow-wrap: anywhere; font-family: ui-monospace, monospace; font-size: 0.875rem; }
`

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="same-origin">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
}

export function renderOAuthLoginPage({ clientName, oauthQuery, error }: OAuthLoginPageArgs): string {
  const errorBlock = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>\n` : ""
  return renderPage("Sign in to Kanna", `<h1>Sign in to Kanna</h1>
<p><strong>${escapeHtml(clientName)}</strong> wants to connect to your Kanna server. Enter your Kanna password to continue.</p>
${errorBlock}<form method="post" action="${OAUTH_LOGIN_PATH}">
<input type="hidden" name="oauth_query" value="${escapeHtml(oauthQuery)}">
<label for="password">Password</label>
<input id="password" type="password" name="password" autocomplete="current-password" autofocus required>
<div class="actions"><button class="primary" type="submit">Sign in</button></div>
</form>`)
}

export function renderOAuthConsentPage({ clientName, redirectUri, scopes, oauthQuery }: OAuthConsentPageArgs): string {
  const scopeItems = scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("\n")
  const scopeBlock = scopes.length > 0 ? `<p>It is asking for these permissions:</p>\n<ul>\n${scopeItems}\n</ul>\n` : ""
  return renderPage("Authorize access to Kanna", `<h1>Authorize access</h1>
<p><strong>${escapeHtml(clientName)}</strong> wants to control Kanna on your behalf: read projects and chats, send prompts and change settings.</p>
${scopeBlock}<p class="uri">Returns to ${escapeHtml(redirectUri)}</p>
<form method="post" action="${OAUTH_CONSENT_PATH}">
<input type="hidden" name="oauth_query" value="${escapeHtml(oauthQuery)}">
<div class="actions">
<button type="submit" name="accept" value="false">Deny</button>
<button class="primary" type="submit" name="accept" value="true">Allow</button>
</div>
</form>`)
}
