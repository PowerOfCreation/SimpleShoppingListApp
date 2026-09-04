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
    redeemInvite: jest.fn(),
  },
}))
const mockRedeemInvite = sharingClient.redeemInvite as jest.Mock

// pullList is a real SyncEngine method that talks to a real backend - out of
// scope here. What matters to this screen is only whether the list ends up
// in the (real) local database afterwards, which each test controls via the
// mock implementation below.
jest.mock("@/api/sync/SyncProvider", () => ({
  useSyncEngine: jest.fn(),
}))
const mockUseSyncEngine = useSyncEngine as jest.Mock

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
    mockPullList = jest.fn().mockResolvedValue(undefined)
    mockUseSyncEngine.mockReturnValue({ pullList: mockPullList })
  })

  it("asks the user to sign in and never calls the backend when signed out", async () => {
    mockAuth("signedOut")

    renderInviteScreen()

    await waitFor(() => {
      expect(screen.getByTestId("invite-login")).toBeTruthy()
    })
    expect(mockRedeemInvite).not.toHaveBeenCalled()
  })

  it("explains a link with no token instead of trying to redeem it", async () => {
    renderInviteScreen("/invite")

    await waitFor(() => {
      expect(screen.getByTestId("invite-unavailable")).toBeTruthy()
    })
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

  it("shows a retryable error when the invite is gone", async () => {
    mockRedeemInvite.mockResolvedValue(
      Result.fail(new SharingError("nope", "inviteGone"))
    )

    renderInviteScreen()

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
