import { create } from "zustand"
import { DISABLED_SERVICE_BUS_STATUS, type ServiceBusStatus } from "../../shared/service-bus/jetstream-config"

interface ServiceBusState {
  status: ServiceBusStatus
  setStatus: (status: ServiceBusStatus) => void
}

export const useServiceBusStore = create<ServiceBusState>()((set) => ({
  status: DISABLED_SERVICE_BUS_STATUS,
  setStatus: (status) => set({ status }),
}))

export const selectServiceBusStatus = (state: ServiceBusState): ServiceBusStatus => state.status
