// Bun test preload. Runs before any test module loads.
//
// Bun normally sets NODE_ENV=test for `bun test`, but a shell that exports
// NODE_ENV=production (a common dev quirk) overrides that. When React loads
// with NODE_ENV=production it omits the `act` test API, which breaks every
// test that imports `act` from "react". Force NODE_ENV back to "test" so
// React loads its development bundle.
if (process.env.NODE_ENV === "production") {
  process.env.NODE_ENV = "test"
}
