import React from "react"
import { fireEvent, render, screen } from "@testing-library/react-native"

import AccountScreen from "../index"
import { useAuth } from "@/api/auth/AuthProvider"

jest.mock("@/api/auth/AuthProvider")

const mockedUseAuth = useAuth as jest.Mock

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

describe("AccountScreen", () => {
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

    fireEvent.press(screen.getByTestId("account-logout"))
    expect(auth.logout).toHaveBeenCalled()
  })

  it("renders an error message when one is set", () => {
    mockAuth({ error: "Login failed: boom" })

    render(<AccountScreen />)

    expect(screen.getByTestId("account-error")).toHaveTextContent(
      "Login failed: boom"
    )
  })
})
