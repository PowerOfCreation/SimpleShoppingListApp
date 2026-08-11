import { screen, fireEvent, waitFor } from "@testing-library/react-native"
import { renderRouter } from "expo-router/testing-library"
import NewShoppingList from "../new_shopping_list"
import { getDatabase } from "@/database/database"
import { initializeAndMigrateDatabase } from "@/database/data-migration"
import { useAuth } from "@/api/auth/AuthProvider"
import { router } from "expo-router"

// Mock router.replace() to prevent navigation errors in tests, matching
// the pattern used by the other (home) screen tests.
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  router: {
    replace: jest.fn(),
  },
}))

// Auth is mocked (unit-style) while the database stays real
// (integration-style, matching new_ingredient-test.tsx) - wrapping a real
// AuthProvider around renderRouter's screen tree isn't straightforward
// with expo-router's testing-library, and the auth *value* is all this
// screen actually depends on.
jest.mock("@/api/auth/AuthProvider")
const mockedUseAuth = useAuth as jest.Mock

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

function renderNewShoppingList() {
  return renderRouter(
    { new_shopping_list: NewShoppingList },
    { initialUrl: "/new_shopping_list" }
  )
}

async function cleanupDatabase(db: ReturnType<typeof getDatabase>) {
  await db.execAsync(`DELETE FROM ingredient_lists;`)
  await db.execAsync(`DELETE FROM domain_events;`)
  await db.execAsync(`DELETE FROM event_outbox;`)
  await db.execAsync(`DELETE FROM list_sync_settings;`)
}

describe("<NewShoppingList /> Component Tests", () => {
  let db: ReturnType<typeof getDatabase>

  beforeAll(async () => {
    db = getDatabase()
    const result = await initializeAndMigrateDatabase(db)
    if (!result.success) {
      throw result.getError()
    }
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    await cleanupDatabase(db)
  })

  describe("layout", () => {
    it("renders the list name label, input, sync row, and create button", () => {
      mockAuth("signedOut")
      renderNewShoppingList()

      expect(screen.getByText(/list name/i)).toBeTruthy()
      expect(screen.getByPlaceholderText("Shopping list name")).toBeTruthy()
      expect(screen.getByText("Sync with account")).toBeTruthy()
      expect(screen.getByTestId("sync-with-account-switch")).toBeTruthy()
      expect(screen.getByTestId("create-list-button")).toBeTruthy()
    })
  })

  describe("sync toggle when signed out", () => {
    it("is disabled, off, and explains that sign-in is required", () => {
      mockAuth("signedOut")
      renderNewShoppingList()

      const toggle = screen.getByTestId("sync-with-account-switch")
      expect(toggle.props.disabled).toBe(true)
      expect(toggle.props.value).toBe(false)
      expect(
        screen.getByText("Sign in to sync lists across devices")
      ).toBeTruthy()
    })
  })

  describe("sync toggle when signed in", () => {
    it("is enabled, off by default, and explains cross-device availability", () => {
      mockAuth("signedIn")
      renderNewShoppingList()

      const toggle = screen.getByTestId("sync-with-account-switch")
      expect(toggle.props.disabled).toBe(false)
      expect(toggle.props.value).toBe(false)
      expect(
        screen.getByText("Available on all devices, shareable with others")
      ).toBeTruthy()
    })

    it("can be toggled on", () => {
      mockAuth("signedIn")
      renderNewShoppingList()

      const toggle = screen.getByTestId("sync-with-account-switch")
      fireEvent(toggle, "valueChange", true)

      expect(screen.getByTestId("sync-with-account-switch").props.value).toBe(
        true
      )
    })
  })

  describe("creating a list", () => {
    it("creates a list without sync when signed out, and does not enqueue it", async () => {
      mockAuth("signedOut")
      renderNewShoppingList()

      fireEvent.changeText(
        screen.getByPlaceholderText("Shopping list name"),
        "Rewe"
      )
      fireEvent.press(screen.getByTestId("create-list-button"))

      await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1))

      const list = await db.getFirstAsync<{ id: string; name: string }>(
        `SELECT id, name FROM ingredient_lists`
      )
      expect(list?.name).toBe("Rewe")

      const setting = await db.getFirstAsync<{ enabled: number }>(
        `SELECT enabled FROM list_sync_settings WHERE list_id = ?`,
        list!.id
      )
      // Sync was never toggled on, so there's no row at all - not a row
      // with enabled = 0.
      expect(setting).toBeNull()

      const outboxCount = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM event_outbox`
      )
      expect(outboxCount?.c).toBe(0)
    })

    it("creates a list with sync enabled when signed in and toggled on, and enqueues it", async () => {
      mockAuth("signedIn")
      renderNewShoppingList()

      fireEvent.changeText(
        screen.getByPlaceholderText("Shopping list name"),
        "Ikea"
      )
      fireEvent(
        screen.getByTestId("sync-with-account-switch"),
        "valueChange",
        true
      )
      fireEvent.press(screen.getByTestId("create-list-button"))

      await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1))

      const list = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM ingredient_lists WHERE name = 'Ikea'`
      )
      const setting = await db.getFirstAsync<{ enabled: number }>(
        `SELECT enabled FROM list_sync_settings WHERE list_id = ?`,
        list!.id
      )
      expect(setting?.enabled).toBe(1)

      const outboxCount = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM event_outbox`
      )
      // Only todo_list.created is enqueued - sync on/off is a device-local
      // setting and never sent to the server (see
      // list-sync-settings-repository.ts).
      expect(outboxCount?.c).toBe(1)
    })

    it("navigates to the new list", async () => {
      mockAuth("signedOut")
      renderNewShoppingList()

      fireEvent.changeText(
        screen.getByPlaceholderText("Shopping list name"),
        "Lidl"
      )
      fireEvent.press(screen.getByTestId("create-list-button"))

      await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1))
      const [destination] = (router.replace as jest.Mock).mock.calls[0]
      expect(destination).toMatch(/^\/view_shopping_list\?listId=/)
    })

    it("shows an error and does not navigate when the name is empty", async () => {
      mockAuth("signedOut")
      renderNewShoppingList()

      fireEvent.press(screen.getByTestId("create-list-button"))

      await waitFor(() =>
        expect(
          screen.getByText("Shopping list name can't be empty")
        ).toBeTruthy()
      )
      expect(router.replace).not.toHaveBeenCalled()
    })

    it("clears the error message once the user starts typing", async () => {
      mockAuth("signedOut")
      renderNewShoppingList()

      fireEvent.press(screen.getByTestId("create-list-button"))
      await waitFor(() =>
        expect(
          screen.getByText("Shopping list name can't be empty")
        ).toBeTruthy()
      )

      fireEvent.changeText(
        screen.getByPlaceholderText("Shopping list name"),
        "R"
      )

      expect(screen.queryByText("Shopping list name can't be empty")).toBeNull()
    })
  })
})
