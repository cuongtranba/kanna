---
target: rule-zustand-store
scope: insert
base: rule-zustand-store#n9072@v1:sha256:ff4e9b106de89c5bce760a8fb152d8ff60c6ab8ea80465d1ef5d70380527e9fa
---
| onClick={() => { setPanelOpen(false); setEditId(null) }} — two store writes composed in a JSX attribute | One named action: closeStackPanel: () => set({ stackCreatePanelOpen: false, stackEditId: null }), then onClick={closeStackPanel} | The transition is re-implemented at every call site, is unreachable from a store test, and drifts when one site is updated and the others are not |
| setExpandedIds((prev) => { ...derive next... }) — updater-shaped setter called from the view | toggleStackExpanded: (id) => set((state) => ...) deriving the previous value inside the store | An updater setter forces every caller to re-derive previous state in the component, which is the same defect the store was supposed to remove |
| Moving a useRef or a prop callback into the store to satisfy the gate | Extract a useCallback handler in the component; the ref stays a ref and props stay props | A ref is deliberately non-reactive; promoting it to store state adds render churn and breaks animation/guard logic that depends on not re-rendering |
