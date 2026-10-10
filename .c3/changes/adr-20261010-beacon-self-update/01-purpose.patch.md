---
target: c3-241
scope: block
base: c3-241#n13085@v1:sha256:c4bd7eac97f2064f25a53757d7abc8351e97d245f55d71c33e363ac7a2b28b0b
---
Owns the beacon daemon: pairing client, key and state storage, the authenticated transport, the filesystem and shell adapters that carry out a request only inside the scope the user granted, and the beacon's own update to the server's version from the fixed GitHub release. Non-goals: deciding scope or consent on the server, defining the wire protocol, accepting an update URL, version or binary from the server, and any remote-control capability beyond the granted scope.
