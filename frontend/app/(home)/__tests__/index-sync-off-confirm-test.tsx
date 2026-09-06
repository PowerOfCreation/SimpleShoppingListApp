import { fireEvent, screen, waitFor } from "@testing-library/react-native"
import { renderRouter } from "expo-router/testing-library"

import Index from "../index"
import { Result } from "@/api/common/result"
import { useShoppingLists } from "@/hooks/useShoppingLists"
import { useAuth } from "@/api/auth/AuthProvider"
import { useSyncEngine } from "@/api/sync/SyncProvider"
import { useSharedSyncedLists } from "@/hooks/useSharedSyncedLists"
import { getShoppingListService } from "@/api/shopping-list-service"

/**
 * Unit tests for the "turn off sync" confirmation added to the list screen:
 * turning sync off for a list other people can still use must be confirmed
 * first, same as sign-out's shared-list warning (see
 * hooks/useSharedSyncedLists.ts). Heavy hooks are mocked so only that
 * gating logic is under test.
 */

jest.mock("@/hooks/useShoppingLists")
jest.mock("@/api/auth/AuthProvider")
jest.mock("@/api/sync/SyncProvider")
jest.mock("@/api/shopping-list-service")
jest.mock("@/hooks/useSharedSyncedLists", () => ({
  ...jest.requireActual("@/hooks/useSharedSyncedLists"),
  useSharedSyncedLists: jest.fn(),
}))
jest.mock("@/database/preferences-repository", () => ({
  getPreference: jest.fn().mockResolvedValue(null),
}))
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  router: { push: jest.fn(), replace: jest.fn() },
}))

async function renderIndex() {
  const result = renderRouter({ index: Index }, { initialUrl: "/" })
  await waitFor(() =>
    expect(screen.queryByAccessibilityHint("loading data")).toBeNull()
  )
  return result
}

const mockedUseShoppingLists = useShoppingLists as jest.Mock
const mockedUseAuth = useAuth as jest.Mock
const mockedUseSyncEngine = useSyncEngine as jest.Mock
const mockedUseSharedSyncedLists = useSharedSyncedLists as jest.Mock
const mockedGetShoppingListService = getShoppingListService as jest.Mock

const aList = { id: "list-1", name: "Camping trip", syncEnabled: true }

function mockLists(updateList: jest.Mock = jest.fn()) {
  mockedUseShoppingLists.mockReturnValue({
    lists: [aList],
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    updateList,
  })
}

function mockShared(sharedListIds: string[]) {
  const load = jest
    .fn()
    .mockImplementation((listId?: string) =>
      Promise.resolve(
        sharedListIds.includes(listId ?? "")
          ? [{ id: listId, name: aList.name }]
          : []
      )
    )
  mockedUseSharedSyncedLists.mockReturnValue({ load, isLoading: false })
  return load
}

describe("Index - turn off sync confirmation", () => {
  let setSyncEnabled: jest.Mock

  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ status: "signedIn" })
    mockedUseSyncEngine.mockReturnValue({ repairList: jest.fn() })
    setSyncEnabled = jest.fn().mockResolvedValue(Result.ok(undefined))
    mockedGetShoppingListService.mockReturnValue({ setSyncEnabled })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it("asks for confirmation before turning off sync for a shared list", async () => {
    mockLists()
    mockShared(["list-1"])

    await renderIndex()

    fireEvent(
      screen.getByTestId(`shopping-list-entry-${aList.id}`),
      "longPress"
    )

    fireEvent(
      screen.getByTestId(`shopping-list-context-sync-${aList.id}`),
      "valueChange",
      false
    )

    await waitFor(() =>
      expect(screen.getByText(/currently sharing "Camping trip"/i)).toBeTruthy()
    )
    expect(setSyncEnabled).not.toHaveBeenCalled()

    fireEvent.press(screen.getByTestId("sync-off-confirm-confirm"))
    await waitFor(() =>
      expect(setSyncEnabled).toHaveBeenCalledWith("list-1", false)
    )
  })

  it("turns off sync immediately when the list is not currently shared", async () => {
    mockLists()
    mockShared([])

    await renderIndex()

    fireEvent(
      screen.getByTestId(`shopping-list-entry-${aList.id}`),
      "longPress"
    )

    fireEvent(
      screen.getByTestId(`shopping-list-context-sync-${aList.id}`),
      "valueChange",
      false
    )

    await waitFor(() =>
      expect(setSyncEnabled).toHaveBeenCalledWith("list-1", false)
    )
    expect(screen.queryByText(/currently sharing/i)).toBeNull()
  })

  it("turning sync on never asks for confirmation", async () => {
    mockLists()
    const load = mockShared(["list-1"])

    await renderIndex()

    fireEvent(
      screen.getByTestId(`shopping-list-entry-${aList.id}`),
      "longPress"
    )

    fireEvent(
      screen.getByTestId(`shopping-list-context-sync-${aList.id}`),
      "valueChange",
      true
    )

    await waitFor(() =>
      expect(setSyncEnabled).toHaveBeenCalledWith("list-1", true)
    )
    expect(load).not.toHaveBeenCalled()
  })
})
