import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { EventRepository } from "@/database/event-repository"
import { OutboxRepository } from "@/database/outbox-repository"
import { IngredientListProjection } from "@/database/ingredient-list-projection"
import { getDatabase } from "@/database/database"
import { ShoppingListService } from "@/api/shopping-list-service"
import * as SQLite from "expo-sqlite"
import { Result } from "@/api/common/result"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"

jest.mock("@/database/ingredient-list-repository")
const MockIngredientListRepository =
  IngredientListRepository as jest.MockedClass<typeof IngredientListRepository>

jest.mock("@/database/event-repository")
const MockEventRepository = EventRepository as jest.MockedClass<
  typeof EventRepository
>

jest.mock("@/database/outbox-repository")
const MockOutboxRepository = OutboxRepository as jest.MockedClass<
  typeof OutboxRepository
>

jest.mock("@/database/ingredient-list-projection")
const MockIngredientListProjection =
  IngredientListProjection as jest.MockedClass<typeof IngredientListProjection>

jest.mock("@/database/database", () => ({
  getDatabase: jest.fn(),
}))

jest.mock("@/api/common/client-id", () => ({
  getClientId: jest.fn(() => "test-device"),
}))

describe("ShoppingListService", () => {
  let service: ShoppingListService
  let mockRepository: jest.Mocked<IngredientListRepository>
  let mockEventRepository: jest.Mocked<EventRepository>
  let mockOutboxRepository: jest.Mocked<OutboxRepository>
  let mockProjection: jest.Mocked<IngredientListProjection>

  beforeEach(() => {
    jest.clearAllMocks()

    mockRepository = {
      getAllWithCounts: jest.fn(),
      getAll: jest.fn(),
      getById: jest.fn(),
    } as unknown as jest.Mocked<IngredientListRepository>

    mockEventRepository = {
      append: jest.fn(),
      appendWithProjection: jest.fn(),
      appendAll: jest.fn().mockResolvedValue(Result.ok(undefined)),
      enqueueExistingForSync: jest.fn().mockResolvedValue(Result.ok(undefined)),
      getByListId: jest.fn(),
      getByAggregateType: jest.fn(),
      getAll: jest.fn(),
    } as unknown as jest.Mocked<EventRepository>

    mockOutboxRepository = {
      cancelForList: jest.fn().mockResolvedValue(Result.ok(undefined)),
    } as unknown as jest.Mocked<OutboxRepository>

    mockProjection = {
      handleCreated: jest.fn(),
      handleUpdated: jest.fn(),
      handleDeleted: jest.fn(),
      handleSyncEnabled: jest.fn(),
      handleSyncDisabled: jest.fn(),
      rebuild: jest.fn(),
    } as unknown as jest.Mocked<IngredientListProjection>

    MockIngredientListRepository.mockImplementation(() => mockRepository)
    MockEventRepository.mockImplementation(() => mockEventRepository)
    MockOutboxRepository.mockImplementation(() => mockOutboxRepository)
    MockIngredientListProjection.mockImplementation(() => mockProjection)

    const mockDb = {} as SQLite.SQLiteDatabase
    ;(getDatabase as jest.Mock).mockReturnValue(mockDb)

    service = new ShoppingListService()
  })

  describe("createList", () => {
    it("without sync: appends only todo_list.created, and does not enqueue it", async () => {
      const result = await service.createList("Rewe")

      expect(result.success).toBe(true)
      expect(mockEventRepository.appendAll).toHaveBeenCalledTimes(1)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      expect(entries).toHaveLength(1)
      expect(entries[0].event.event_type).toBe(EventTypes.TODO_LIST_CREATED)
      expect(entries[0].enqueueForSync).toBeFalsy()
    })

    it("with sync: appends todo_list.created (enqueued) and todo_list.sync_enabled (not enqueued)", async () => {
      const result = await service.createList("Rewe", true)

      expect(result.success).toBe(true)
      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      expect(entries).toHaveLength(2)

      expect(entries[0].event.event_type).toBe(EventTypes.TODO_LIST_CREATED)
      expect(entries[0].enqueueForSync).toBe(true)

      // On creation the sync_enabled event stays local - todo_list.created
      // already signals the list to the server. Sync state changes later go
      // through setSyncEnabled, which does enqueue them.
      expect(entries[1].event.event_type).toBe(
        EventTypes.TODO_LIST_SYNC_ENABLED
      )
      expect(entries[1].enqueueForSync).toBeFalsy()
    })

    it("both events share the same aggregate id", async () => {
      await service.createList("Rewe", true)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      expect(entries[0].event.aggregate_id).toBe(entries[1].event.aggregate_id)
    })

    it("runs the created projection through appendAll's project callback", async () => {
      await service.createList("Rewe")

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      const dbStub = {} as SQLite.SQLiteDatabase
      await entries[0].project?.(dbStub)

      expect(mockProjection.handleCreated).toHaveBeenCalledWith(
        dbStub,
        entries[0].event
      )
    })

    it("rejects an empty name without touching the event repository", async () => {
      const result = await service.createList("   ")

      expect(result.success).toBe(false)
      expect(mockEventRepository.appendAll).not.toHaveBeenCalled()
    })
  })

  describe("setSyncEnabled", () => {
    const makeHistoryEvent = (
      overrides: Partial<DomainEventRow>
    ): DomainEventRow => ({
      event_id: "evt",
      event_type: EventTypes.TODO_LIST_CREATED,
      aggregate_id: "list-1",
      aggregate_type: "todo_list",
      list_id: "list-1",
      occurred_at: 1000,
      client_id: "test-device",
      payload: "{}",
      seq: null,
      ...overrides,
    })

    it("enabling replays only syncable history into the outbox", async () => {
      mockEventRepository.getByListId.mockResolvedValue(
        Result.ok([
          makeHistoryEvent({
            event_id: "e1",
            event_type: EventTypes.TODO_LIST_CREATED,
          }),
          makeHistoryEvent({
            event_id: "e2",
            event_type: EventTypes.TODO_LIST_SYNC_ENABLED,
          }),
          makeHistoryEvent({
            event_id: "e3",
            event_type: EventTypes.TODO_LIST_UPDATED,
          }),
        ])
      )

      const result = await service.setSyncEnabled("list-1", true)

      expect(result.success).toBe(true)
      expect(mockEventRepository.enqueueExistingForSync).toHaveBeenCalledTimes(
        1
      )
      const [replayed] =
        mockEventRepository.enqueueExistingForSync.mock.calls[0]
      expect(replayed.map((e: DomainEventRow) => e.event_id)).toEqual([
        "e1",
        "e2",
        "e3",
      ])
    })

    it("enabling replays the list's ingredient.* history too, not just todo_list.*", async () => {
      mockEventRepository.getByListId.mockResolvedValue(
        Result.ok([
          makeHistoryEvent({
            event_id: "e1",
            event_type: EventTypes.TODO_LIST_CREATED,
          }),
          makeHistoryEvent({
            event_id: "e2",
            event_type: EventTypes.INGREDIENT_CREATED,
            aggregate_id: "ing-1",
            aggregate_type: "ingredient",
          }),
        ])
      )

      await service.setSyncEnabled("list-1", true)

      const [replayed] =
        mockEventRepository.enqueueExistingForSync.mock.calls[0]
      expect(replayed.map((e: DomainEventRow) => e.event_id)).toEqual([
        "e1",
        "e2",
      ])
      expect(mockEventRepository.getByListId).toHaveBeenCalledWith("list-1")
    })

    it("enabling appends and enqueues a todo_list.sync_enabled event", async () => {
      mockEventRepository.getByListId.mockResolvedValue(Result.ok([]))

      await service.setSyncEnabled("list-1", true)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      expect(entries[0].event.event_type).toBe(
        EventTypes.TODO_LIST_SYNC_ENABLED
      )
      expect(entries[0].enqueueForSync).toBe(true)
    })

    it("disabling cancels pending outbox rows for the whole list but re-queues the sync_disabled event", async () => {
      const result = await service.setSyncEnabled("list-1", false)

      expect(result.success).toBe(true)
      expect(mockOutboxRepository.cancelForList).toHaveBeenCalledWith("list-1")
      expect(mockEventRepository.getByListId).not.toHaveBeenCalled()

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      expect(entries[0].event.event_type).toBe(
        EventTypes.TODO_LIST_SYNC_DISABLED
      )
      expect(entries[0].enqueueForSync).toBe(true)

      // cancelForList wipes the pending sync_disabled row, so it is
      // re-queued afterwards to keep the backend informed.
      expect(mockEventRepository.enqueueExistingForSync).toHaveBeenCalledTimes(
        1
      )
      const [requeued] =
        mockEventRepository.enqueueExistingForSync.mock.calls[0]
      expect(requeued).toHaveLength(1)
      expect(requeued[0].event_type).toBe(EventTypes.TODO_LIST_SYNC_DISABLED)
    })
  })
})
