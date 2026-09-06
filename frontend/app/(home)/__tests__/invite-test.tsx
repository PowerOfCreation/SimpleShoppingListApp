import { screen, fireEvent, waitFor } from "@testing-library/react-native"
import { renderRouter } from "expo-router/testing-library"
import { router } from "expo-router"

import Invite from "../invite"
import { getDatabase } from "@/database/database"
import { initializeAndMigrateDatabase } from "@/database/data-migration"
import { Result } from "@/api/common/result"
import { SharingError } from "@/api/common/error-types"
import { useAuth } from "@/api/auth/AuthProvider"
import { sharingClient } from "@/api/sharing/sharing-client"
import { useSyncEngine } from "@/api/sync/SyncProvider"

// Mock router.replace() to prevent navigation errors in tests, matching
// the pattern used by the other (home) screen tests.
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  router: {
    replace: jest.fn(),
  },
}))

jest.mock("@/api/auth/AuthProvider")
const mockedUseAuth = useAuth as jest.Mock

// The client itself is covered by sharing-client.test.ts; here it stands in
// for the backend so the screen's own behaviour is what's under test.
jest.mock("@/api/sharing/sharing-client", () => ({
  ...jest.requireActual("@/api/sharing/sharing-client"),
  sharingClient: {
    previewInvite: jest.fn(),
    redeemInvite: jest.fn(),
  },
}))
const mockPreviewInvite = sharingClient.previewInvite as jest.Mock
const mockRedeemInvite = sharingClient.redeemInvite as jest.Mock

// pullList is a real SyncEngine method that talks to a real backend - out of
// scope here. What matters to this screen is only whether the list ends up
// in the (real) local database afterwards, which each test controls via the
// mock implementation below.
jest.mock("@/api/sync/SyncProvider", () => ({
  useSyncEngine: jest.fn(),
}))
const mockUseSyncEngine = useSyncEngine as jest.Mock

const defaultPreview = {
  listId: "list-1",
  listName: "Lidl",
  memberCount: 3,
  invitedByName: "Niklas",
  invitedByPictureURL: "https://example.com/niklas.png",
}

function mockAuth(status: "loading" | "signedOut" | "signedIn") {
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

describe("<Invite /> Component Tests", () => {
  let db: ReturnType<typeof getDatabase>
  let mockPullList: jest.Mock

  beforeAll(async () => {
    db = getDatabase()
    const result = await initializeAndMigrateDatabase(db)
    if (!result.success) {
      throw result.getError()
    }
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    await db.execAsync(`DELETE FROM ingredient_lists;`)
    await db.execAsync(`DELETE FROM list_sync_settings;`)
    mockAuth("signedIn")
    mockPreviewInvite.mockResolvedValue(Result.ok(defaultPreview))
    mockPullList = jest.fn().mockResolvedValue(undefined)
    mockUseSyncEngine.mockReturnValue({ pullList: mockPullList })
  })

  it("asks the user to sign in and never previews or redeems when signed out", async () => {
    mockAuth("signedOut")

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-login")).toBeTruthy()
    })
    expect(mockPreviewInvite).not.toHaveBeenCalled()
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })

  it("explains a link with no token instead of trying to preview it", async () => {
    renderInviteScreen("/invite")

    await waitFor(() => {
      expect(screen.getByTestId("invite-unavailable")).toBeTruthy()
    })
    expect(mockPreviewInvite).not.toHaveBeenCalled()
  })

  it("shows the invitation card with the inviter, list name, member count and avatar", async () => {
    renderInviteScreen()

    await waitFor(() => {
      expect(mockPreviewInvite).toHaveBeenCalledWith("plaintext-token")
    })
    await waitFor(() => {
      expect(screen.getByTestId("invite-heading")).toHaveTextContent(
        "Niklas invited you to join list Lidl"
      )
    })
    expect(screen.getByText("3 members")).toBeTruthy()
    expect(screen.getByTestId("invite-avatar")).toBeTruthy()
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })

  it("omits the avatar when the inviter has no picture", async () => {
    mockPreviewInvite.mockResolvedValue(
      Result.ok({ ...defaultPreview, invitedByPictureURL: null })
    )

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-heading")).toBeTruthy()
    })
    expect(screen.queryByTestId("invite-avatar")).toBeNull()
  })

  it("falls back to 'Someone' when the inviter has no name", async () => {
    mockPreviewInvite.mockResolvedValue(
      Result.ok({ ...defaultPreview, invitedByName: null })
    )

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-heading")).toHaveTextContent(
        "Someone invited you to join list Lidl"
      )
    })
  })

  it("shows a dead-invite message instead of a card when the preview fails", async () => {
    mockPreviewInvite.mockResolvedValue(
      Result.fail(new SharingError("nope", "inviteGone"))
    )

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-unavailable")).toHaveTextContent(
        /revoked or has expired/i
      )
    })
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })

  it("navigates home instead of joining when the user declines", async () => {
    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-join")).toBeTruthy()
    })
    fireEvent.press(screen.getByTestId("invite-decline"))

    expect(router.replace).toHaveBeenCalledWith("/(home)")
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })

  it("enables sync and opens the list once a pull lands its content locally", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.ok({ listId: "list-1", role: "member", alreadyMember: false })
    )
    mockPullList.mockImplementation(async () => {
      // Stands in for what a real pull + EventApplier would do: create the
      // list's projection from the server's history.
      await db.runAsync(
        `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        "list-1",
        "Rewe",
        Date.now(),
        Date.now()
      )
    })

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-join")).toBeTruthy()
    })
    fireEvent.press(screen.getByTestId("invite-join"))

    await waitFor(() => {
      expect(mockRedeemInvite).toHaveBeenCalledWith("plaintext-token")
    })
    await waitFor(() => {
      expect(screen.getByTestId("invite-joined")).toHaveTextContent(
        "You've joined the list."
      )
    })

    const setting = await db.getFirstAsync<{ enabled: number }>(
      `SELECT enabled FROM list_sync_settings WHERE list_id = ?`,
      "list-1"
    )
    expect(setting?.enabled).toBe(1)

    fireEvent.press(screen.getByTestId("invite-open-list"))
    expect(router.replace).toHaveBeenCalledWith(
      "/view_shopping_list?listId=list-1"
    )
  })

  it("says so when redeeming re-identifies an existing member", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.ok({ listId: "list-1", role: "member", alreadyMember: true })
    )
    mockPullList.mockImplementation(async () => {
      await db.runAsync(
        `INSERT INTO ingredient_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        "list-1",
        "Rewe",
        Date.now(),
        Date.now()
      )
    })

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-join")).toBeTruthy()
    })
    fireEvent.press(screen.getByTestId("invite-join"))

    await waitFor(() => {
      expect(screen.getByTestId("invite-joined")).toHaveTextContent(
        "You're already a member of this list."
      )
    })
  })

  // A pull can legitimately not land anything yet (offline, a transient
  // failure) - SyncCoordinator's own retries finish it later, so this isn't
  // an error.
  it("shows a pending state when the pull hasn't landed the list content yet", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.ok({ listId: "list-1", role: "member", alreadyMember: false })
    )
    // mockPullList resolves without inserting anything - as if offline.

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-join")).toBeTruthy()
    })
    fireEvent.press(screen.getByTestId("invite-join"))

    await waitFor(() => {
      expect(screen.getByTestId("invite-pending")).toBeTruthy()
    })

    const setting = await db.getFirstAsync<{ enabled: number }>(
      `SELECT enabled FROM list_sync_settings WHERE list_id = ?`,
      "list-1"
    )
    expect(setting?.enabled).toBe(1)

    fireEvent.press(screen.getByTestId("invite-go-to-lists"))
    expect(router.replace).toHaveBeenCalledWith("/(home)")
  })

  it("shows a retryable error and keeps the card when redeeming fails", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.fail(new SharingError("nope", "inviteGone"))
    )

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-join")).toBeTruthy()
    })
    fireEvent.press(screen.getByTestId("invite-join"))

    await waitFor(() => {
      expect(screen.getByTestId("invite-error")).toHaveTextContent(
        /revoked or has expired/i
      )
    })

    mockRedeemInvite.mockResolvedValue(
      Result.ok({ listId: "list-1", role: "member", alreadyMember: false })
    )
    fireEvent.press(screen.getByTestId("invite-retry"))

    await waitFor(() => {
      expect(mockRedeemInvite).toHaveBeenCalledTimes(2)
    })
  })
})
