import { InboxAgentReadCard } from "./InboxAgentReadCard"
import { InboxConversation } from "./InboxConversation"
import { InboxDetailHeader, type InboxDetailHeaderProps } from "./InboxDetailHeader"
import { InboxProposalCard } from "./InboxProposalCard"
import { InboxReplyComposer } from "./InboxReplyComposer"

export function InboxThreadDetail({ thread, prevId, nextId, onOpenThread, onBack, onArchived, onSnoozed }: InboxDetailHeaderProps) {
  return (
    <article aria-label={`Thread from ${thread.sender}`} className="flex min-h-0 flex-1 flex-col bg-background">
      <InboxDetailHeader
        thread={thread}
        prevId={prevId}
        nextId={nextId}
        onOpenThread={onOpenThread}
        onBack={onBack}
        onArchived={onArchived}
        onSnoozed={onSnoozed}
      />
      <InboxConversation thread={thread} />
      <div className="max-h-[60%] shrink-0 overflow-y-auto border-t border-border bg-background">
        <div className="mx-auto w-full max-w-[720px] space-y-3 px-4 py-3">
          <InboxAgentReadCard thread={thread} />
          <InboxProposalCard thread={thread} />
          <InboxReplyComposer thread={thread} />
        </div>
      </div>
    </article>
  )
}
