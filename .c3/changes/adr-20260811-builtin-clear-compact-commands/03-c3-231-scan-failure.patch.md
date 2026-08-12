---
target: c3-231
scope: block
base: c3-231#n9922@v1:sha256:f702176f96ca8ffe8bc3eccb287f3e16952f929fb59535c37cd324eed0881851
---
| Failure — scan throws | Error logged; the picker falls back to the builtins alone rather than an empty list, so `/clear` and `/compact` stay reachable when the disk scan fails | c3-208 |
