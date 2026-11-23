declare module "kanna-fixture-server-pkg" {
  export const SERVER_PKG_MARKER: string
  export class Compressor {
    roundTrip(text: string): string
  }
}

declare module "kanna-fixture-client-pkg" {
  export const CLIENT_PKG_MARKER: string
  export function shout(text: string): string
}
