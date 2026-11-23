import { basename } from "node:path"
import { Compressor, SERVER_PKG_MARKER } from "kanna-fixture-server-pkg"

const compressor = new Compressor()

export function roundTrip({ text }: { text: string }) {
  return { text: compressor.roundTrip(text), marker: basename(`/fixture/${SERVER_PKG_MARKER}`) }
}
