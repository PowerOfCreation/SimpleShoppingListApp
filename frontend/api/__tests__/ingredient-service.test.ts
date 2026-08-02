import { IngredientRepository } from "@/database/ingredient-repository"
import { EventRepository } from "@/database/event-repository"
import { IngredientListRepository } from "@/database/ingredient-list-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { getDatabase } from "@/database/database"
import { IngredientService } from "@/api/ingredient-service"
import { Ingredient } from "@/types/Ingredient"
import * as SQLite from "expo-sqlite"
import { DbQueryError, ValidationError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { DomainEventRow, EventTypes } from "@/types/DomainEvent"
import { Priority } from "@/types/Priority"
import { notifyOutboxChanged } from "@/api/sync/outbox-events"

jest.mock("@/database/ingredient-repository")
const MockIngredientRepository = IngredientRepository as jest.MockedClass<
  typeof IngredientRepository
>

jest.mock("@/database/event-repository")
const MockEventRepository = EventRepository as jest.MockedClass<
  typeof EventRepository
>

jest.mock("@/database/ingredient-list-repository")
const MockIngredientListRepository =
  IngredientListRepository as jest.MockedClass<typeof IngredientListRepository>

jest.mock("@/database/ingredient-projection")
const MockIngredientProjection = IngredientProjection as jest.MockedClass<
  typeof IngredientProjection
>

jest.mock("@/database/database", () => ({
  getDatabase: jest.fn(),
}))

jest.mock("@/api/common/client-id", () => ({
  getClientId: jest.fn(() => "test-device"),
}))

jest.mock("@/api/sync/outbox-events", () => ({
  notifyOutboxChanged: jest.fn(),
}))

describe("IngredientService", () => {
  let service: IngredientService
  let mockRepository: jest.Mocked<IngredientRepository>
  let mockEventRepository: jest.Mocked<EventRepository>
  let mockListRepository: jest.Mocked<IngredientListRepository>
  let mockProjection: jest.Mocked<IngredientProjection>

  beforeEach(() => {
    jest.clearAllMocks()

    mockRepository = {
      getAll: jest.fn(),
      getById: jest.fn(),
      add: jest.fn(),
      update: jest.fn(),
      updateCompletion: jest.fn(),
      updateName: jest.fn(),
      remove: jest.fn(),
      reorderIngredients: jest.fn(),
      getCompletedIngredients: jest.fn(),
    } as unknown as jest.Mocked<IngredientRepository>

    mockEventRepository = {
      append: jest.fn(),
      appendWithProjection: jest.fn(),
      appendAll: jest.fn().mockResolvedValue(Result.ok(undefined)),
      getByAggregateId: jest.fn(),
      getByListId: jest.fn(),
      getAll: jest.fn(),
      getByAggregateType: jest.fn(),
    } as unknown as jest.Mocked<EventRepository>

    mockListRepository = {
      getById: jest.fn().mockResolvedValue(
        Result.ok({
          id: "list-1",
          name: "Rewe",
          created_at: 1000,
          updated_at: 1000,
          syncEnabled: false,
        })
      ),
    } as unknown as jest.Mocked<IngredientListRepository>

    mockProjection = {
      handleCreated: jest.fn(),
      handleUpdated: jest.fn(),
      handlePrioritySet: jest.fn(),
      handlePriorityCleared: jest.fn(),
      handleDeleted: jest.fn(),
      rebuild: jest.fn(),
    } as unknown as jest.Mocked<IngredientProjection>

    MockIngredientRepository.mockImplementation(() => mockRepository)
    MockEventRepository.mockImplementation(() => mockEventRepository)
    MockIngredientListRepository.mockImplementation(() => mockListRepository)
    MockIngredientProjection.mockImplementation(() => mockProjection)

    const mockDb = {} as SQLite.SQLiteDatabase
    ;(getDatabase as jest.Mock).mockReturnValue(mockDb)

    service = new IngredientService()
  })

  describe("GetIngredients", () => {
    it("should get only ingredients for the given list from the repository", async () => {
      const mockIngredients: Ingredient[] = [
        {
          id: "1",
          name: "Milk",
          completed: false,
          list_id: "list-1",
          created_at: 1000,
          updated_at: 1000,
        },
        {
          id: "2",
          name: "Eggs",
          completed: true,
          list_id: "list-1",
          created_at: 2000,
          updated_at: 2000,
        },
        {
          id: "3",
          name: "Bread",
          completed: false,
          list_id: "list-2",
          created_at: 3000,
          updated_at: 3000,
        },
      ]

      mockRepository.getAll.mockImplementation(async (listId: string) => {
        const filtered = mockIngredients.filter((i) => i.list_id === listId)
        return Result.ok(filtered)
      })

      const result = await service.GetIngredients("list-1")

      expect(mockRepository.getAll).toHaveBeenCalledTimes(1)

      const filtered = mockIngredients.filter((i) => i.list_id === "list-1")
      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual(filtered)
    })
  })

  describe("AddIngredients", () => {
    it("should append an ingredient.created event via the event repository, with list_id set", async () => {
      const ingredientName = "Milk"
      const listId = "list-1"
      const nowMock = 1000
      jest.spyOn(Date, "now").mockReturnValue(nowMock)

      const result = await service.AddIngredients(ingredientName, listId)

      expect(mockEventRepository.appendAll).toHaveBeenCalledTimes(1)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      const event = entries[0].event
      expect(event.event_type).toBe(EventTypes.INGREDIENT_CREATED)
      expect(event.aggregate_type).toBe("ingredient")
      expect(event.list_id).toBe(listId)
      expect(event.occurred_at).toBe(nowMock)
      const payload = JSON.parse(event.payload)
      expect(payload.name).toBe(ingredientName)
      expect(payload.listId).toBe(listId)

      expect(result.success).toBe(true)
    })

    it("should return error for empty ingredient name", async () => {
      const result = await service.AddIngredients("", "list-1")

      expect(mockEventRepository.appendAll).not.toHaveBeenCalled()

      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(ValidationError)
      expect(result.getError().message).toBe("Ingredient name can't be empty")
    })

    it("does not enqueue for sync when the parent list is not sync-enabled", async () => {
      mockListRepository.getById.mockResolvedValue(
        Result.ok({
          id: "list-1",
          name: "Rewe",
          created_at: 1000,
          updated_at: 1000,
          syncEnabled: false,
        })
      )

      await service.AddIngredients("Milk", "list-1")

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      expect(entries[0].enqueueForSync).toBe(false)
      expect(notifyOutboxChanged).not.toHaveBeenCalled()
    })

    it("enqueues for sync and notifies the outbox when the parent list is sync-enabled", async () => {
      mockListRepository.getById.mockResolvedValue(
        Result.ok({
          id: "list-1",
          name: "Rewe",
          created_at: 1000,
          updated_at: 1000,
          syncEnabled: true,
        })
      )

      await service.AddIngredients("Milk", "list-1")

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      expect(entries[0].enqueueForSync).toBe(true)
      expect(notifyOutboxChanged).toHaveBeenCalledTimes(1)
    })
  })

  describe("updateCompletion", () => {
    it("should append an ingredient.updated event with completed payload and list_id", async () => {
      const ingredientId = "1"
      const completed = true

      const result = await service.updateCompletion(
        ingredientId,
        "list-1",
        completed
      )

      expect(mockEventRepository.appendAll).toHaveBeenCalledTimes(1)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      const event = entries[0].event
      expect(event.event_type).toBe(EventTypes.INGREDIENT_UPDATED)
      expect(event.aggregate_id).toBe(ingredientId)
      expect(event.list_id).toBe("list-1")
      const payload = JSON.parse(event.payload)
      expect(payload.completed).toBe(completed)

      expect(result.success).toBe(true)
    })

    it("does not enqueue for sync when the parent list is not sync-enabled", async () => {
      mockListRepository.getById.mockResolvedValue(
        Result.ok({
          id: "list-1",
          name: "Rewe",
          created_at: 1000,
          updated_at: 1000,
          syncEnabled: false,
        })
      )

      await service.updateCompletion("1", "list-1", true)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      expect(entries[0].enqueueForSync).toBe(false)
      expect(notifyOutboxChanged).not.toHaveBeenCalled()
    })

    it("enqueues for sync and notifies the outbox when the parent list is sync-enabled", async () => {
      mockListRepository.getById.mockResolvedValue(
        Result.ok({
          id: "list-1",
          name: "Rewe",
          created_at: 1000,
          updated_at: 1000,
          syncEnabled: true,
        })
      )

      await service.updateCompletion("1", "list-1", true)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      expect(entries[0].enqueueForSync).toBe(true)
      expect(notifyOutboxChanged).toHaveBeenCalledTimes(1)
    })

    it("should return error if event repository fails", async () => {
      const dbError = new DbQueryError(
        "DB error",
        "updateCompletion",
        "Ingredient"
      )
      mockEventRepository.appendAll.mockResolvedValue(Result.fail(dbError))

      const result = await service.updateCompletion("1", "list-1", true)

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("updateName", () => {
    it("should append an ingredient.updated event with name payload and list_id", async () => {
      const ingredientId = "1"
      const newName = "Almond Milk"

      const result = await service.updateName(ingredientId, "list-1", newName)

      expect(mockEventRepository.appendAll).toHaveBeenCalledTimes(1)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      const event = entries[0].event
      expect(event.event_type).toBe(EventTypes.INGREDIENT_UPDATED)
      expect(event.aggregate_id).toBe(ingredientId)
      expect(event.list_id).toBe("list-1")
      const payload = JSON.parse(event.payload)
      expect(payload.name).toBe(newName)

      expect(result.success).toBe(true)
    })

    it("should return error if event repository fails", async () => {
      const dbError = new DbQueryError("DB error", "updateName", "Ingredient")
      mockEventRepository.appendAll.mockResolvedValue(Result.fail(dbError))

      const result = await service.updateName("1", "list-1", "New Name")

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("setPriority", () => {
    it("should append an ingredient.priority_set event with priority payload and list_id", async () => {
      const ingredientId = "1"

      const result = await service.setPriority(
        ingredientId,
        "list-1",
        Priority.DAYS_1_TO_3
      )

      expect(mockEventRepository.appendAll).toHaveBeenCalledTimes(1)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      const event = entries[0].event
      expect(event.event_type).toBe(EventTypes.INGREDIENT_PRIORITY_SET)
      expect(event.aggregate_id).toBe(ingredientId)
      expect(event.list_id).toBe("list-1")
      const payload = JSON.parse(event.payload)
      expect(payload.priority).toBe(Priority.DAYS_1_TO_3)

      expect(result.success).toBe(true)
    })

    it("should return error for an invalid priority", async () => {
      const result = await service.setPriority("1", "list-1", 999 as Priority)

      expect(mockEventRepository.appendAll).not.toHaveBeenCalled()

      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(ValidationError)
      expect(result.getError().message).toBe("Invalid priority")
    })

    it("should return error if event repository fails", async () => {
      const dbError = new DbQueryError("DB error", "setPriority", "Ingredient")
      mockEventRepository.appendAll.mockResolvedValue(Result.fail(dbError))

      const result = await service.setPriority("1", "list-1", Priority.NOW)

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("clearPriority", () => {
    it("should append an ingredient.priority_cleared event with list_id", async () => {
      const ingredientId = "1"

      const result = await service.clearPriority(ingredientId, "list-1")

      expect(mockEventRepository.appendAll).toHaveBeenCalledTimes(1)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      const event = entries[0].event
      expect(event.event_type).toBe(EventTypes.INGREDIENT_PRIORITY_CLEARED)
      expect(event.aggregate_id).toBe(ingredientId)
      expect(event.list_id).toBe("list-1")

      expect(result.success).toBe(true)
    })

    it("should return error if event repository fails", async () => {
      const dbError = new DbQueryError(
        "DB error",
        "clearPriority",
        "Ingredient"
      )
      mockEventRepository.appendAll.mockResolvedValue(Result.fail(dbError))

      const result = await service.clearPriority("1", "list-1")

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("deleteIngredient", () => {
    it("should append an ingredient.deleted event with list_id", async () => {
      const ingredientId = "1"

      const result = await service.deleteIngredient(ingredientId, "list-1")

      expect(mockEventRepository.appendAll).toHaveBeenCalledTimes(1)

      const [entries] = mockEventRepository.appendAll.mock.calls[0]
      const event = entries[0].event
      expect(event.event_type).toBe(EventTypes.INGREDIENT_DELETED)
      expect(event.aggregate_id).toBe(ingredientId)
      expect(event.list_id).toBe("list-1")

      expect(result.success).toBe(true)
    })

    it("should return error if event repository fails", async () => {
      const dbError = new DbQueryError(
        "DB error",
        "deleteIngredient",
        "Ingredient"
      )
      mockEventRepository.appendAll.mockResolvedValue(Result.fail(dbError))

      const result = await service.deleteIngredient("1", "list-1")

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("error handling", () => {
    it("should handle repository errors gracefully", async () => {
      const dbError = new DbQueryError("Database error", "getAll", "Ingredient")
      mockRepository.getAll.mockResolvedValue(Result.fail(dbError))

      const result = await service.GetIngredients("")

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("rebuildProjection", () => {
    it("should call rebuild on the projection with all ingredient events", async () => {
      const mockEvents = [
        {
          event_id: "e1",
          event_type: EventTypes.INGREDIENT_CREATED,
          aggregate_id: "i1",
        },
        {
          event_id: "e2",
          event_type: EventTypes.INGREDIENT_UPDATED,
          aggregate_id: "i1",
        },
      ]
      mockEventRepository.getByAggregateType.mockResolvedValue(
        Result.ok(mockEvents as DomainEventRow[])
      )
      mockProjection.rebuild.mockResolvedValue(undefined)

      const result = await service.rebuildProjection()

      expect(mockEventRepository.getByAggregateType).toHaveBeenCalledWith(
        "ingredient"
      )
      expect(mockProjection.rebuild).toHaveBeenCalledWith(mockEvents)
      expect(result.success).toBe(true)
    })

    it("should propagate error if getByAggregateType fails", async () => {
      const dbError = new DbQueryError(
        "DB error",
        "getByAggregateType",
        "Ingredient"
      )
      mockEventRepository.getByAggregateType.mockResolvedValue(
        Result.fail(dbError)
      )

      const result = await service.rebuildProjection()

      expect(mockProjection.rebuild).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })

    it("should return DbQueryError if projection.rebuild throws", async () => {
      mockEventRepository.getByAggregateType.mockResolvedValue(
        Result.ok([] as DomainEventRow[])
      )
      mockProjection.rebuild.mockRejectedValue(new Error("rebuild failed"))

      const result = await service.rebuildProjection()

      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(DbQueryError)
      expect(result.getError().message).toBe("Failed to rebuild projection")
    })
  })

  describe("getCompletedIngredients", () => {
    it("should get completed ingredients for the given list from the repository", async () => {
      const mockCompletedIngredients: Ingredient[] = [
        {
          id: "2",
          name: "Eggs",
          completed: true,
          list_id: "list-1",
          created_at: 2000,
          updated_at: 2000,
          completed_at: 2000,
        },
        {
          id: "4",
          name: "Butter",
          completed: true,
          list_id: "list-1",
          created_at: 4000,
          updated_at: 4000,
          completed_at: 4000,
        },
      ]

      mockRepository.getCompletedIngredients = jest
        .fn()
        .mockResolvedValue(Result.ok(mockCompletedIngredients))

      const result = await service.getCompletedIngredients("list-1")

      expect(mockRepository.getCompletedIngredients).toHaveBeenCalledTimes(1)
      expect(mockRepository.getCompletedIngredients).toHaveBeenCalledWith(
        "list-1"
      )

      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual(mockCompletedIngredients)
    })

    it("should return error if repository fails", async () => {
      const dbError = new DbQueryError(
        "DB error",
        "getCompletedIngredients",
        "Ingredient"
      )

      mockRepository.getCompletedIngredients = jest
        .fn()
        .mockResolvedValue(Result.fail(dbError))

      const result = await service.getCompletedIngredients("list-1")

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })
})
