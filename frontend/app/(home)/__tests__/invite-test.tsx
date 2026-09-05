import { fireEvent, screen, waitFor } from "@testing-library/react-native"
import { renderRouter } from "expo-router/testing-library"

import Invite from "../invite"
import { Result } from "@/api/common/result"
import { SharingError } from "@/api/common/error-types"
import { useAuth } from "@/api/auth/AuthProvider"
import { sharingClient } from "@/api/sharing/sharing-client"

jest.mock("@/api/auth/AuthProvider")

jest.mock("@/api/sharing/sharing-client", () => {
  const actual = jest.requireActual("@/api/sharing/sharing-client")
  return {
    ...actual,
    sharingClient: {
      redeemInvite: jest.fn(),
    },
  }
})

const mockedUseAuth = useAuth as jest.Mock
const mockRedeemInvite = sharingClient.redeemInvite as jest.Mock

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

function renderInviteScreen(url = "/invite?token=plaintext-token") {
  return renderRouter({ invite: Invite }, { initialUrl: url })
}

describe("Invite", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth("signedIn")
  })

  it("asks to join and redeems the token from the link", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.ok({ listId: "list-1", role: "member", alreadyMember: false })
    )

    renderInviteScreen()

    fireEvent.press(screen.getByTestId("invite-join"))

    await waitFor(() => {
      expect(mockRedeemInvite).toHaveBeenCalledWith("plaintext-token")
    })
    await waitFor(() => {
      expect(screen.getByTestId("invite-success")).toHaveTextContent(
        /joined this list/i
      )
    })
  })

  it("tells an already-joined member instead of claiming a fresh join", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.ok({ listId: "list-1", role: "member", alreadyMember: true })
    )

    renderInviteScreen()

    fireEvent.press(screen.getByTestId("invite-join"))

    await waitFor(() => {
      expect(screen.getByTestId("invite-success")).toHaveTextContent(
        /already a member/i
      )
    })
  })

  it("reports a redeem the server refused", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.fail(new SharingError("nope", "inviteGone"))
    )

    renderInviteScreen()

    fireEvent.press(screen.getByTestId("invite-join"))

    await waitFor(() => {
      expect(screen.getByTestId("invite-error")).toHaveTextContent(
        /revoked or has expired/i
      )
    })
    expect(screen.queryByTestId("invite-success")).toBeNull()
  })

  it("explains a link with no token instead of trying to redeem it", async () => {
    renderInviteScreen("/invite")

    await waitFor(() => {
      expect(screen.getByTestId("invite-unavailable")).toBeTruthy()
    })
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })

  it("asks the user to sign in and stays off the network when signed out", async () => {
    mockAuth("signedOut")

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-unavailable")).toHaveTextContent(
        /sign in/i
      )
    })
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })

  it("waits for the session to be restored before judging it", async () => {
    mockAuth("loading")

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-auth-loading")).toBeTruthy()
    })
    expect(screen.queryByTestId("invite-unavailable")).toBeNull()
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })
})
