import React from "react"
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"

import AccountScreen from "../index"
import { useAuth } from "@/api/auth/AuthProvider"
import { useSharedSyncedLists } from "@/hooks/useSharedSyncedLists"

jest.mock("@/api/auth/AuthProvider")
jest.mock("@/hooks/useSharedSyncedLists")

const mockedUseAuth = useAuth as jest.Mock
const mockedUseSharedSyncedLists = useSharedSyncedLists as jest.Mock

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  const value = {
    status: "signedOut" as const,
    user: null,
    error: null,
    busy: false,
    login: jest.fn(),
    logout: jest.fn(),
    ...overrides,
  }
  mockedUseAuth.mockReturnValue(value)
  return value
}

function mockSharedSyncedLists(lists: { id: string; name: string }[] = []) {
  const load = jest.fn().mockResolvedValue(lists)
  mockedUseSharedSyncedLists.mockReturnValue({ load, isLoading: false })
  return load
}

describe("AccountScreen", () => {
  beforeEach(() => {
    mockSharedSyncedLists()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it("shows a spinner while the session is being restored", () => {
    mockAuth({ status: "loading" })

    render(<AccountScreen />)

    expect(screen.getByTestId("account-loading")).toBeTruthy()
    expect(screen.queryByTestId("account-login")).toBeNull()
  })

  it("offers login and explains that it is optional when signed out", () => {
    const auth = mockAuth()

    render(<AccountScreen />)

    expect(screen.getByText("Not signed in")).toBeTruthy()
    expect(screen.getByText(/stored on this device/i)).toBeTruthy()

    fireEvent.press(screen.getByTestId("account-login"))
    expect(auth.login).toHaveBeenCalled()
  })

  it("shows the profile and a sign out button when signed in", () => {
    const auth = mockAuth({
      status: "signedIn",
      user: {
        subject: "user-1",
        username: "niklas",
        name: "Niklas",
        email: "niklas@example.com",
      },
    })

    render(<AccountScreen />)

    expect(screen.getByTestId("account-user")).toHaveTextContent("Niklas")
    expect(screen.getByText("niklas@example.com")).toBeTruthy()
    expect(auth.logout).not.toHaveBeenCalled()
  })

  it("asks for confirmation before signing out, without a shared-list warning when nothing is shared", async () => {
    const auth = mockAuth({ status: "signedIn" })
    mockSharedSyncedLists([])

    render(<AccountScreen />)

    fireEvent.press(screen.getByTestId("account-logout"))
    await waitFor(() =>
      expect(screen.getByTestId("account-logout-confirm-confirm")).toBeTruthy()
    )
    expect(auth.logout).not.toHaveBeenCalled()
    expect(screen.queryByText(/currently sharing/i)).toBeNull()

    fireEvent.press(screen.getByTestId("account-logout-confirm-confirm"))
    expect(auth.logout).toHaveBeenCalled()
  })

  it("warns about lists that stay usable by others when currently shared lists exist", async () => {
    mockAuth({ status: "signedIn" })
    mockSharedSyncedLists([{ id: "list-1", name: "Camping trip" }])

    render(<AccountScreen />)

    fireEvent.press(screen.getByTestId("account-logout"))

    await waitFor(() =>
      expect(screen.getByText(/currently sharing "Camping trip"/i)).toBeTruthy()
    )
  })

  it("cancelling the confirmation does not sign out", async () => {
    const auth = mockAuth({ status: "signedIn" })
    mockSharedSyncedLists([])

    render(<AccountScreen />)

    fireEvent.press(screen.getByTestId("account-logout"))
    await waitFor(() =>
      expect(screen.getByTestId("account-logout-confirm-cancel")).toBeTruthy()
    )

    fireEvent.press(screen.getByTestId("account-logout-confirm-cancel"))
    expect(auth.logout).not.toHaveBeenCalled()
  })

  it("renders an error message when one is set", () => {
    mockAuth({ error: "Login failed: boom" })

    render(<AccountScreen />)

    expect(screen.getByTestId("account-error")).toHaveTextContent(
      "Login failed: boom"
    )
  })
})
