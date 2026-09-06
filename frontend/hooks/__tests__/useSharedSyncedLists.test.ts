import { act, renderHook } from "@testing-library/react-native"

import {
  sharedSyncWarning,
  useSharedSyncedLists,
} from "../useSharedSyncedLists"
import { sharingClient } from "@/api/sharing/sharing-client"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { Result } from "@/api/common/result"

jest.mock("@/database/database", () => ({
  getDatabase: jest.fn(() => ({})),
}))
jest.mock("@/database/ingredient-list-repository")
jest.mock("@/api/sharing/sharing-client", () => ({
  sharingClient: { listMyLists: jest.fn(), getInvites: jest.fn() },
}))

const MockIngredientListRepository =
  IngredientListRepository as jest.MockedClass<typeof IngredientListRepository>
const mockedListMyLists = sharingClient.listMyLists as jest.Mock
const mockedGetInvites = sharingClient.getInvites as jest.Mock

function mockLists(
  lists: { id: string; name: string; syncEnabled: boolean }[]
) {
  MockIngredientListRepository.mockImplementation(
    () =>
      ({
        getAll: jest.fn().mockResolvedValue(Result.ok(lists)),
      }) as unknown as IngredientListRepository
  )
}

describe("useSharedSyncedLists", () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it("includes lists the caller is a member of", async () => {
    mockLists([{ id: "a", name: "Groceries", syncEnabled: true }])
    mockedListMyLists.mockResolvedValue(
      Result.ok([{ listId: "a", role: "member" }])
    )

    const { result } = renderHook(() => useSharedSyncedLists())
    let shared: unknown
    await act(async () => {
      shared = await result.current.load()
    })

    expect(shared).toEqual([{ id: "a", name: "Groceries" }])
    expect(mockedGetInvites).not.toHaveBeenCalled()
  })

  it("includes owned lists only when they have an active invite link", async () => {
    mockLists([
      { id: "a", name: "Owned with link", syncEnabled: true },
      { id: "b", name: "Owned without link", syncEnabled: true },
    ])
    mockedListMyLists.mockResolvedValue(
      Result.ok([
        { listId: "a", role: "owner" },
        { listId: "b", role: "owner" },
      ])
    )
    mockedGetInvites.mockImplementation((listId: string) =>
      Promise.resolve(Result.ok(listId === "a" ? [{ inviteId: "i1" }] : []))
    )

    const { result } = renderHook(() => useSharedSyncedLists())
    let shared: unknown
    await act(async () => {
      shared = await result.current.load()
    })

    expect(shared).toEqual([{ id: "a", name: "Owned with link" }])
  })

  it("excludes lists that are not currently synced on this device", async () => {
    mockLists([{ id: "a", name: "Not synced", syncEnabled: false }])

    const { result } = renderHook(() => useSharedSyncedLists())
    let shared: unknown
    await act(async () => {
      shared = await result.current.load()
    })

    expect(shared).toEqual([])
    expect(mockedListMyLists).not.toHaveBeenCalled()
  })

  it("fails open (no warning) when the sharing API call fails", async () => {
    mockLists([{ id: "a", name: "Groceries", syncEnabled: true }])
    mockedListMyLists.mockResolvedValue(
      Result.fail(new Error("network") as never)
    )

    const { result } = renderHook(() => useSharedSyncedLists())
    let shared: unknown
    await act(async () => {
      shared = await result.current.load()
    })

    expect(shared).toEqual([])
  })

  it("restricts the check to a single list when listId is given", async () => {
    mockLists([
      { id: "a", name: "Groceries", syncEnabled: true },
      { id: "b", name: "Hardware", syncEnabled: true },
    ])
    mockedListMyLists.mockResolvedValue(
      Result.ok([
        { listId: "a", role: "member" },
        { listId: "b", role: "member" },
      ])
    )

    const { result } = renderHook(() => useSharedSyncedLists())
    let shared: unknown
    await act(async () => {
      shared = await result.current.load("b")
    })

    expect(shared).toEqual([{ id: "b", name: "Hardware" }])
  })
})

describe("sharedSyncWarning", () => {
  it("returns just the scope text when nothing is shared", () => {
    expect(sharedSyncWarning("Stops sync.", [])).toBe("Stops sync.")
  })

  it("names the single shared list with singular wording", () => {
    expect(sharedSyncWarning("Stops sync.", ["Groceries"])).toBe(
      `Stops sync.\n\nYou're currently sharing "Groceries". People who ` +
        `already have access can keep using it as before - you just won't ` +
        `see further changes on this device anymore.`
    )
  })

  it("names multiple shared lists with plural wording", () => {
    expect(sharedSyncWarning("Stops sync.", ["Groceries", "Hardware"])).toBe(
      `Stops sync.\n\nYou're currently sharing "Groceries", "Hardware". ` +
        `People who already have access can keep using them as before - ` +
        `you just won't see further changes on this device anymore.`
    )
  })
})
