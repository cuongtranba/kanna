export interface OutboundTextRules {
  allowUrls: boolean
  maxChars: number
}

const URL_PATTERN = /https?:\/\/|\bwww\./i
const MARKDOWN_IMAGE_PATTERN = /!\[/
const MARKDOWN_LINK_PATTERN = /\]\(/
const HTML_TAG_PATTERN = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/i

export function outboundTextViolations(text: string, rules: OutboundTextRules): string[] {
  const violations: string[] = []
  if (!rules.allowUrls && URL_PATTERN.test(text)) violations.push("contains a URL")
  if (MARKDOWN_IMAGE_PATTERN.test(text)) violations.push("contains a markdown image")
  if (MARKDOWN_LINK_PATTERN.test(text)) violations.push("contains a markdown link")
  if (HTML_TAG_PATTERN.test(text)) violations.push("contains HTML")
  if (text.length > rules.maxChars) violations.push(`is longer than ${rules.maxChars} characters`)
  return violations
}
