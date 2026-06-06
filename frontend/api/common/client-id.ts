import * as Device from "expo-device"

export function getClientId(): string {
  return Device.deviceName ?? "unknown"
}
