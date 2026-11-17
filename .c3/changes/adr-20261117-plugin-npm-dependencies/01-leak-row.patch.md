---
target: c3-238
scope: block
base: c3-238#n14427@v1:sha256:89bc6b3411c0fd1b6d8ba8103260af868732fcdcf636aba109e119b7a50b0ad1
---
| A server-only import leaks into a client bundle | A package or builtin that needs Node imported from a non-\*.server file, or the client build bundling an import made by a \*.server file instead of stubbing it | Two SECURITY assertions and the P13 client-bundle case in the acceptance suite | bun test --conditions production src/server/plugin-system-acceptance.test.tsx |
