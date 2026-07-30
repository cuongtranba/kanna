---
target: c3-214
scope: block
base: c3-214#n7116@v1:sha256:36989e736eeed9263c7cfe79a5a65414f8a0e1d9ecc3fcbd418871eed443292a
---
Stale entries | User does not manually re-trigger a rescan | UI lists outdated/deleted projects until the user re-imports | Manual rescan smoke; grep -rn "fs.watch\|chokidar" src/server/discovery.adapter.ts confirms no filesystem watch exists
