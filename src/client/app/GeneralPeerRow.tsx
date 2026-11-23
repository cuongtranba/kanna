import { SettingsRow } from "../components/settings/SettingsList"
import { DEFAULT_PEER_INBOUND_MODE, type PeerInboundMode } from "../../shared/peer-messaging/inbound"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { PendingSegmentedControl } from "./PendingSegmentedControl"
import type { KannaState } from "./useKannaState"
import { useAppSettingsWriter } from "./useAppSettingsWriter"

const OPTIONS: { value: PeerInboundMode; label: string }[] = [
  { value: "accept", label: "Accept" },
  { value: "refuse", label: "Refuse" },
]

export function GeneralPeerRow({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { writeAsync } = useAppSettingsWriter(state)
  const mode = useAppSettingsStore((s) => s.settings?.peerMessagesInbound ?? DEFAULT_PEER_INBOUND_MODE)

  return (
    <div className="border-b border-border">
      <SettingsRow
        title="Messages from other chats"
        description="Let agents in other chats, in any project, send messages to agents in your chats. Each chat can override this from its sidebar menu."
        bordered={false}
      >
        <PendingSegmentedControl
          pendingKey="settings.peerMessagesInbound"
          value={mode}
          onValueChange={async (next) => {
            await writeAsync({ peerMessagesInbound: next })
          }}
          options={OPTIONS}
          size="sm"
        />
      </SettingsRow>
    </div>
  )
}
