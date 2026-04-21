export type ShareMode = false | "quick" | {
  kind: "token"
  token: string
}

export type ShareCliFlag = "--share" | "--cloudflared"

export function isShareEnabled(share: ShareMode): share is Exclude<ShareMode, false> {
  return share !== false
}

export function isTokenShareMode(share: ShareMode): share is { kind: "token"; token: string } {
  return typeof share === "object" && share !== null && share.kind === "token"
}

export function getShareCliFlag(share: Exclude<ShareMode, false>): ShareCliFlag {
  return isTokenShareMode(share) ? "--cloudflared" : "--share"
}

export function assertNoHostOverride(shareFlag: ShareCliFlag, sawHost: boolean, sawRemote: boolean) {
  if (sawHost) {
    throw new Error(`${shareFlag} cannot be used with --host`)
  }
  if (sawRemote) {
    throw new Error(`${shareFlag} cannot be used with --remote`)
  }
}
