---
target: c3-302
scope: block
base: c3-302#n13223@v1:sha256:c5699b14ca36ddf3c14370bdf7fdcfd58b2156a857e7a22753044800e4cc51db
---
| Beacon frames | IN/OUT | Protocol 2: ready carries the server's protocol version; refused, scope, set-scope and unpair frames; a beacon sends set-scope or unpair only to a server at SCOPE_SYNC_PROTOCOL or later. Protocol 3 adds file transfer. Protocol 4 adds the field-less update frame, the update_status frame and an optional serverVersion on ready and incompatible; a beacon sends update_status only to a server at UPDATE_PROTOCOL or later, because an older server closes the socket on a frame it cannot parse | c3-241 | src/shared/beacon-protocol.ts |
