import { Share, type ShareAction } from "react-native"
import { fireEvent, screen, waitFor } from "@testing-library/react-native"
import { renderRouter } from "expo-router/testing-library"

import ShareShoppingList from "../share_shopping_list"
import { Result } from "@/api/common/result"
import { SharingError } from "@/api/common/error-types"
import { useAuth } from "@/api/auth/AuthProvider"
import { sharingClient } from "@/api/sharing/sharing-client"
import { buildInviteLink } from "@/api/sharing/invite-link"

jest.mock("@/api/auth/AuthProvider")

// The client itself is covered by sharing-client.test.ts; here it stands in
// for the backend so the screen's own behaviour is what's under test.
jest.mock("@/api/sharing/sharing-client", () => {
  const actual = jest.requireActual("@/api/sharing/sharing-client")
  return {
    ...actual,
    sharingClient: {
      getInvites: jest.fn(),
      createInvite: jest.fn(),
      revokeInvite: jest.fn(),
    },
  }
})

jest.mock("@/api/sharing/invite-link", () => ({
  ...jest.requireActual("@/api/sharing/invite-link"),
  buildInviteLink: jest.fn(),
}))

const mockedUseAuth = useAuth as jest.Mock
const mockGetInvites = sharingClient.getInvites as jest.Mock
const mockCreateInvite = sharingClient.createInvite as jest.Mock
const mockRevokeInvite = sharingClient.revokeInvite as jest.Mock
const mockBuildInviteLink = buildInviteLink as jest.Mock

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

const anInvite = (overrides: Record<string, unknown> = {}) => ({
  inviteId: "invite-1",
  createdBy: "user-1",
  createdAt: Date.now() - 60_000,
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  ...overrides,
})

function renderShareScreen() {
  return renderRouter(
    { share_shopping_list: ShareShoppingList },
    { initialUrl: "/share_shopping_list?listId=list-1&listName=Rewe" }
  )
}

describe("ShareShoppingList", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth("signedIn")
    mockGetInvites.mockResolvedValue(Result.ok([]))
    mockCreateInvite.mockResolvedValue(
      Result.ok({
        inviteId: "invite-2",
        listId: "list-1",
        token: "plaintext-token",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000,
      })
    )
    mockRevokeInvite.mockResolvedValue(Result.ok(null))
    mockBuildInviteLink.mockReturnValue("app.test://invite?token=plaintext")
  })

  it("loads the active invites for the given list", async () => {
    mockGetInvites.mockResolvedValue(Result.ok([anInvite()]))

    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-entry-invite-1")).toBeTruthy()
    })
    expect(mockGetInvites).toHaveBeenCalledWith("list-1")
  })

  it("explains the empty state instead of showing nothing", async () => {
    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invites-empty")).toBeTruthy()
    })
  })

  // Sharing needs a session; asking the backend without one could only
  // produce a 401 dressed up as an error message.
  it("asks the user to sign in and stays off the network when signed out", async () => {
    mockAuth("signedOut")

    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("share-unavailable")).toBeTruthy()
    })
    expect(mockGetInvites).not.toHaveBeenCalled()
  })

  it("creates a link with the selected validity preset", async () => {
    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invites-empty")).toBeTruthy()
    })

    fireEvent.press(screen.getByTestId("invite-ttl-1h"))
    fireEvent.press(screen.getByTestId("create-invite"))

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith("list-1", "1h", "Rewe")
    })
  })

  it("defaults to the 7 day preset", async () => {
    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invites-empty")).toBeTruthy()
    })

    fireEvent.press(screen.getByTestId("create-invite"))

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith("list-1", "7d", "Rewe")
    })
  })

  // The plaintext token exists exactly once, in this response - so the
  // screen has to show it, and say that it won't come back.
  it("shows the new link once, with a warning that it cannot be recovered", async () => {
    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invites-empty")).toBeTruthy()
    })

    fireEvent.press(screen.getByTestId("create-invite"))

    await waitFor(() => {
      expect(screen.getByTestId("new-invite-link")).toHaveTextContent(
        "app.test://invite?token=plaintext"
      )
    })
    expect(screen.getByText(/cannot be recovered/i)).toBeTruthy()

    fireEvent.press(screen.getByTestId("dismiss-invite"))
    await waitFor(() => {
      expect(screen.queryByTestId("new-invite-card")).toBeNull()
    })
  })

  it("hands the link to the system share sheet", async () => {
    const shareSpy = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" } as ShareAction)

    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invites-empty")).toBeTruthy()
    })
    fireEvent.press(screen.getByTestId("create-invite"))
    await waitFor(() => {
      expect(screen.getByTestId("share-invite")).toBeTruthy()
    })

    fireEvent.press(screen.getByTestId("share-invite"))

    await waitFor(() => {
      expect(shareSpy).toHaveBeenCalledWith({
        message: "app.test://invite?token=plaintext",
      })
    })
    shareSpy.mockRestore()
  })

  it("revokes a link only after the confirmation is accepted", async () => {
    mockGetInvites.mockResolvedValue(Result.ok([anInvite()]))

    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-revoke-invite-1")).toBeTruthy()
    })

    fireEvent.press(screen.getByTestId("invite-revoke-invite-1"))
    expect(mockRevokeInvite).not.toHaveBeenCalled()

    fireEvent.press(
      screen.getByTestId("invite-revoke-confirm-invite-1-confirm")
    )

    await waitFor(() => {
      expect(mockRevokeInvite).toHaveBeenCalledWith("invite-1")
    })
  })

  // A revoke the server refuses must not look like one that worked: the row
  // stays, so something has to say why.
  it("reports a revoke the server refused", async () => {
    mockGetInvites.mockResolvedValue(Result.ok([anInvite()]))
    mockRevokeInvite.mockResolvedValue(
      Result.fail(new SharingError("nope", "notOwner"))
    )

    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-revoke-invite-1")).toBeTruthy()
    })
    fireEvent.press(screen.getByTestId("invite-revoke-invite-1"))
    fireEvent.press(
      screen.getByTestId("invite-revoke-confirm-invite-1-confirm")
    )

    await waitFor(() => {
      expect(screen.getByTestId("share-error")).toBeTruthy()
    })
  })

  // Ownership is enforced server-side and there is no membership endpoint to
  // ask beforehand, so a member has to learn it from the answer.
  it("explains a 403 as not being the list's owner", async () => {
    mockGetInvites.mockResolvedValue(
      Result.fail(new SharingError("nope", "notOwner"))
    )

    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("share-error")).toHaveTextContent(
        /only the owner/i
      )
    })
  })

  // "No active invite links" next to "you are not the owner" would read as
  // two different answers to the same question.
  it("does not claim there are no links when the load failed", async () => {
    mockGetInvites.mockResolvedValue(
      Result.fail(new SharingError("nope", "notOwner"))
    )

    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("share-error")).toBeTruthy()
    })
    expect(screen.queryByTestId("invites-empty")).toBeNull()
  })

  it("waits for the session to be restored before judging it", async () => {
    mockAuth("loading")

    renderShareScreen()

    await waitFor(() => {
      expect(screen.getByTestId("share-auth-loading")).toBeTruthy()
    })
    expect(screen.queryByTestId("share-unavailable")).toBeNull()
    expect(mockGetInvites).not.toHaveBeenCalled()
  })
})
