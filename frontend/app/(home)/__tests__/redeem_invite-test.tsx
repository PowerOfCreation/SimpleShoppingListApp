import { fireEvent, screen, waitFor } from "@testing-library/react-native"
import { renderRouter } from "expo-router/testing-library"

import RedeemInvite from "../redeem_invite"
import { Result } from "@/api/common/result"
import { SharingError } from "@/api/common/error-types"
import { useAuth } from "@/api/auth/AuthProvider"
import { sharingClient } from "@/api/sharing/sharing-client"
import { useSyncEngine } from "@/api/sync/SyncProvider"

jest.mock("@/api/auth/AuthProvider")

// The client itself is covered by sharing-client.test.ts; here it stands in
// for the backend so the screen's own behaviour is what's under test.
jest.mock("@/api/sharing/sharing-client", () => {
  const actual = jest.requireActual("@/api/sharing/sharing-client")
  return {
    ...actual,
    sharingClient: {
      redeemInvite: jest.fn(),
    },
  }
})

jest.mock("@/api/sync/SyncProvider", () => ({
  useSyncEngine: jest.fn(),
}))

jest.mock("@/database/list-sync-settings-repository", () => ({
  ListSyncSettingsRepository: jest.fn().mockImplementation(() => ({
    setEnabled: jest.fn().mockResolvedValue(undefined),
  })),
}))

jest.mock("@/database/database", () => ({
  getDatabase: jest.fn(),
}))

const mockedUseAuth = useAuth as jest.Mock
const mockRedeemInvite = sharingClient.redeemInvite as jest.Mock
const mockedUseSyncEngine = useSyncEngine as jest.Mock

function mockAuth(status: "loading" | "signedIn" | "signedOut") {
  mockedUseAuth.mockReturnValue({
    status,
    user: null,
    error: null,
    busy: false,
    login: jest.fn(),
    logout: jest.fn(),
  })
}

function renderRedeemScreen() {
  return renderRouter(
    { redeem_invite: RedeemInvite },
    { initialUrl: "/redeem_invite" }
  )
}

describe("RedeemInvite", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth("signedIn")
    mockedUseSyncEngine.mockReturnValue({
      pullList: jest.fn().mockResolvedValue(undefined),
    })
    mockRedeemInvite.mockResolvedValue(
      Result.ok({ listId: "list-1", role: "member", alreadyMember: false })
    )
  })

  it("redeems the pasted token and shows success", async () => {
    renderRedeemScreen()

    fireEvent.changeText(
      screen.getByTestId("redeem-token-input"),
      "app.test://invite?token=plaintext-token"
    )
    fireEvent.press(screen.getByTestId("redeem-join"))

    await waitFor(() => {
      expect(mockRedeemInvite).toHaveBeenCalledWith("plaintext-token")
    })
    await waitFor(() => {
      expect(screen.getByTestId("redeem-go-to-list")).toBeTruthy()
    })
  })

  it("treats pasted input without a token param as a raw token", async () => {
    renderRedeemScreen()

    fireEvent.changeText(screen.getByTestId("redeem-token-input"), "raw-code")
    fireEvent.press(screen.getByTestId("redeem-join"))

    await waitFor(() => {
      expect(mockRedeemInvite).toHaveBeenCalledWith("raw-code")
    })
  })

  it("shows a distinct message when already a member", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.ok({ listId: "list-1", role: "member", alreadyMember: true })
    )

    renderRedeemScreen()

    fireEvent.changeText(screen.getByTestId("redeem-token-input"), "a-token")
    fireEvent.press(screen.getByTestId("redeem-join"))

    await waitFor(() => {
      expect(screen.getByText(/already a member/i)).toBeTruthy()
    })
  })

  it("shows an error message for an invalid or expired invite", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.fail(new SharingError("nope", "inviteGone"))
    )

    renderRedeemScreen()

    fireEvent.changeText(screen.getByTestId("redeem-token-input"), "a-token")
    fireEvent.press(screen.getByTestId("redeem-join"))

    await waitFor(() => {
      expect(screen.getByTestId("redeem-error")).toHaveTextContent(
        /invalid, was revoked, or has expired/i
      )
    })
  })

  it("asks the user to sign in and stays off the network when signed out", async () => {
    mockAuth("signedOut")

    renderRedeemScreen()

    await waitFor(() => {
      expect(screen.getByTestId("redeem-unavailable")).toBeTruthy()
    })
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })

  it("waits for the session to be restored before judging it", async () => {
    mockAuth("loading")

    renderRedeemScreen()

    await waitFor(() => {
      expect(screen.getByTestId("redeem-auth-loading")).toBeTruthy()
    })
    expect(screen.queryByTestId("redeem-unavailable")).toBeNull()
  })

  it("disables the join button until something is entered", async () => {
    renderRedeemScreen()

    await waitFor(() => {
      expect(screen.getByTestId("redeem-join")).toBeTruthy()
    })
    fireEvent.press(screen.getByTestId("redeem-join"))
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })
})
