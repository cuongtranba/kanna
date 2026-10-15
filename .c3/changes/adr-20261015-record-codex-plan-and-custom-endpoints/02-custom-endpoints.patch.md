---
target: c3-212
scope: insert
base: c3-212#n12018@v1:sha256:b8f1be6094dedb73729f2568ca1c7a52d14ea4375b32978bb6b43ebffaca4f71
---
| Custom Anthropic-compatible endpoints | IN/OUT | A model id provider-id/vendor-model resolves to an SdkEndpoint carrying its own base URL, API key, alias model and context window, and the session is respawned when that fingerprint changes | Credentials come from the settings custom providers list; a snapshot carries only a short API key hint, never the key | src/server/sdk-endpoint.ts |
