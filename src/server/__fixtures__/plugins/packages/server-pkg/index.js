import { gunzipSync, gzipSync } from "node:zlib"

export const SERVER_PKG_MARKER = "SERVER_PKG_MARKER_MUST_NOT_REACH_BROWSER"

export class Compressor {
  roundTrip(text) {
    return gunzipSync(gzipSync(text)).toString("utf8")
  }
}
