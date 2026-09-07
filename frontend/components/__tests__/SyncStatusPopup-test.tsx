import React from "react"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { Text } from "react-native"
import { SyncStatusPopup } from "../SyncStatusPopup"

jest.mock("@/hooks/useThemeColor", () => ({ useThemeColor: () => "black" }))

it("opens sync details from the icon and closes the popup", () => {
  render(
    <SyncStatusPopup offline>
      <Text>Icon</Text>
    </SyncStatusPopup>
  )
  expect(screen.queryByText("Sync information")).toBeNull()
  fireEvent.press(screen.getByLabelText("Show sync information"))
  expect(screen.getByText("Sync information")).toBeTruthy()
  expect(screen.getByText(/Last sync attempt:/)).toHaveTextContent(/Not yet/)
  expect(screen.getByText(/Last successful sync:/)).toHaveTextContent(/Not yet/)
  expect(screen.getByText("Offline")).toBeTruthy()
  fireEvent.press(screen.getByText("Close"))
  expect(screen.queryByText("Sync information")).toBeNull()
})
