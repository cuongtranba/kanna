---
target: c3-104
scope: insert
base: c3-104#n10792@v1:sha256:987a5561f7066d889dc98c3a08fb7c55fcd2214c2d52fc3244f8714c75d64b3a
---
| Tab width preference | IN | How narrow a tab may get before the strip scrolls is a server-backed setting (AppSettingsSnapshot.panes.tabMinWidth), read as a scalar so the selector is reference-stable. Its bounds and default live once in src/shared/pane-tab-width.ts, which app-settings clamps against and the strip floors against — a local copy is how the settings range and the layout floor would drift apart. The phone floor still wins over it, since a touch strip cannot rely on hover tooltips to tell icon-only tabs apart | c3-110 | src/shared/pane-tab-width.ts |
