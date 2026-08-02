---
target: rule-zustand-store
scope: insert
base: rule-zustand-store#n9077@v1:sha256:f7a8729f19c600298529d4358d51324c5c4e6e63408d2d936eb092662fc01ebf
---
- Where transitions are written, not only where state is stored: every inline JSX-attribute handler under `src/client/**` that mutates store state, in both singleton and scoped stores
