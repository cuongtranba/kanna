---
target: rule-zustand-store
scope: block
base: rule-zustand-store#n8585@v1:sha256:f536c925c758fe21a0067bc5aa0748c76976782ac9fc8794e7a5e6fbd09fa142
---
The frozen `useState` allowlist — client tests (`src/client/**/*.test.ts(x)`), `src/client/components/ui/**` primitives, and the fixed hooks `useIsMobile`, `useNow`, `useStickyState`, `useTheme`, `useIsStandalone` — where `useState` remains correct; everywhere else new `useState` fails the `no-react-usestate` ast-grep gate
