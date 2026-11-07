import { runDetached } from "./runDetached"

export interface InboxToastRequest {
  title: string
  description?: string
  actionLabel: string
  onAction: () => void
}

export interface InboxToastPort {
  show(request: InboxToastRequest): void
}

export const sonnerInboxToastPort: InboxToastPort = {
  show(request) {
    runDetached(
      "inbox toast",
      import("sonner").then(({ toast }) => {
        toast(request.title, {
          ...(request.description === undefined ? {} : { description: request.description }),
          action: { label: request.actionLabel, onClick: request.onAction },
        })
      }),
    )
  },
}
