export const SLACK_BOT_SCOPES: readonly string[] = [
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "mpim:history",
  "chat:write",
  "reactions:write",
]

export const SLACK_BOT_TOKEN_PREFIX = "xoxb-"
export const SLACK_SIGNING_SECRET_MAX_CHARS = 200
export const SLACK_BOT_TOKEN_MAX_CHARS = 300
export const SLACK_MAX_ALLOWED_USERS = 10
export const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]{2,20}$/

export const SLACK_APP_MANIFEST = [
  "display_information:",
  "  name: Kanna",
  "features:",
  "  bot_user:",
  "    display_name: Kanna",
  "    always_online: true",
  "oauth_config:",
  "  scopes:",
  "    bot:",
  ...SLACK_BOT_SCOPES.map((scope) => `      - ${scope}`),
  "settings:",
  "  event_subscriptions:",
  "    bot_events:",
  "      - app_mention",
  "  org_deploy_enabled: false",
  "  socket_mode_enabled: false",
  "  token_rotation_enabled: false",
  "",
].join("\n")

export interface SlackHookFields {
  allowedUserIds?: readonly string[]
  signingSecret?: string
  botToken?: string
}

export interface SlackValidationOptions {
  requireSecrets: boolean
}

function validateSecrets(fields: SlackHookFields, requireSecrets: boolean): string[] {
  const errors: string[] = []
  const signingSecret = fields.signingSecret?.trim() ?? ""
  const botToken = fields.botToken?.trim() ?? ""
  if (signingSecret.length === 0) {
    if (requireSecrets) errors.push("Slack signing secret is required")
  } else if (signingSecret.length > SLACK_SIGNING_SECRET_MAX_CHARS) {
    errors.push(`Slack signing secret must be at most ${SLACK_SIGNING_SECRET_MAX_CHARS} characters`)
  }
  if (botToken.length === 0) {
    if (requireSecrets) errors.push("Slack bot token is required")
  } else if (!botToken.startsWith(SLACK_BOT_TOKEN_PREFIX) || botToken.length > SLACK_BOT_TOKEN_MAX_CHARS) {
    errors.push(`Slack bot token must start with ${SLACK_BOT_TOKEN_PREFIX}`)
  }
  return errors
}

function validateAllowedUsers(ids: readonly string[] | undefined): string[] {
  if (ids === undefined) return []
  if (ids.length === 0) return ["At least one allowed Slack user ID is required"]
  if (ids.length > SLACK_MAX_ALLOWED_USERS) {
    return [`At most ${SLACK_MAX_ALLOWED_USERS} Slack user IDs are allowed`]
  }
  const invalid = ids.filter((id) => !SLACK_USER_ID_PATTERN.test(id))
  return invalid.length > 0 ? [`Invalid Slack user ID: ${invalid[0]}`] : []
}

export function validateSlackHookFields(fields: SlackHookFields, options: SlackValidationOptions): string[] {
  const allowed = fields.allowedUserIds
  const usersErrors = allowed === undefined && options.requireSecrets
    ? ["At least one allowed Slack user ID is required"]
    : validateAllowedUsers(allowed)
  return [...usersErrors, ...validateSecrets(fields, options.requireSecrets)]
}
