---
target: c3-241
scope: insert
base: c3-241#n13091@v1:sha256:ec7b016896564b79b080c46480c7c757aefae9f686e4d1c6f540c72251a8620d
---
| adr-20261010-beacon-self-update | adr | The beacon pulls its own release from the fixed GitHub repository at the server's version, checked against the release checksum file and a version smoke test | must follow | The server never supplies a URL, a version or a binary; update_status goes only to a protocol 4 server |
