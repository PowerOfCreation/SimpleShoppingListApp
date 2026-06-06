import { IngredientRepository } from "@/database/ingredient-repository"
import { EventRepository } from "@/database/event-repository"
import { IngredientProjection } from "@/database/ingredient-projection"
import { getDatabase } from "@/database/database"
import { IngredientService } from "@/api/ingredient-service"
import { Ingredient } from "@/types/Ingredient"
import * as SQLite from "expo-sqlite"
import { DbQueryError, ValidationError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"
import { EventTypes } from "@/types/DomainEvent"

jest.mock("@/database/ingredient-repository")
const MockIngredientRepository = IngredientRepository as jest.MockedClass<
  typeof IngredientRepository
>

jest.mock("@/database/event-repository")
const MockEventRepository = EventRepository as jest.MockedClass<
  typeof EventRepository
>

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

describe("IngredientService", () => {
  let service: IngredientService
  let mockRepository: jest.Mocked<IngredientRepository>
  let mockEventRepository: jest.Mocked<EventRepository>
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
      appendWithProjection: jest.fn().mockResolvedValue(Result.ok(undefined)),
      getByAggregateId: jest.fn(),
      getAll: jest.fn(),
      getByAggregateType: jest.fn(),
    } as unknown as jest.Mocked<EventRepository>

    mockProjection = {
      handleCreated: jest.fn(),
      handleUpdated: jest.fn(),
      handleDeleted: jest.fn(),
      rebuild: jest.fn(),
    } as unknown as jest.Mocked<IngredientProjection>

    MockIngredientRepository.mockImplementation(() => mockRepository)
    MockEventRepository.mockImplementation(() => mockEventRepository)
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
    it("should append an ingredient.created event via the event repository", async () => {
      const ingredientName = "Milk"
      const listId = "list-1"
      const nowMock = 1000
      jest.spyOn(Date, "now").mockReturnValue(nowMock)

      const result = await service.AddIngredients(ingredientName, listId)

      expect(mockEventRepository.appendWithProjection).toHaveBeenCalledTimes(1)

      const [event] = mockEventRepository.appendWithProjection.mock.calls[0]
      expect(event.event_type).toBe(EventTypes.INGREDIENT_CREATED)
      expect(event.aggregate_type).toBe("ingredient")
      expect(event.occurred_at).toBe(nowMock)
      const payload = JSON.parse(event.payload)
      expect(payload.name).toBe(ingredientName)
      expect(payload.listId).toBe(listId)

      expect(result.success).toBe(true)
    })

    it("should return error for empty ingredient name", async () => {
      const result = await service.AddIngredients("", "list-1")

      expect(mockEventRepository.appendWithProjection).not.toHaveBeenCalled()

      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(ValidationError)
      expect(result.getError().message).toBe("Ingredient name can't be empty")
    })
  })

  describe("updateCompletion", () => {
    it("should append an ingredient.updated event with completed payload", async () => {
      const ingredientId = "1"
      const completed = true

      const result = await service.updateCompletion(ingredientId, completed)

      expect(mockEventRepository.appendWithProjection).toHaveBeenCalledTimes(1)

      const [event] = mockEventRepository.appendWithProjection.mock.calls[0]
      expect(event.event_type).toBe(EventTypes.INGREDIENT_UPDATED)
      expect(event.aggregate_id).toBe(ingredientId)
      const payload = JSON.parse(event.payload)
      expect(payload.completed).toBe(completed)

      expect(result.success).toBe(true)
    })

    it("should return error if event repository fails", async () => {
      const dbError = new DbQueryError("DB error", "updateCompletion", "Ingredient")
      mockEventRepository.appendWithProjection.mockResolvedValue(Result.fail(dbError))

      const result = await service.updateCompletion("1", true)

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("updateName", () => {
    it("should append an ingredient.updated event with name payload", async () => {
      const ingredientId = "1"
      const newName = "Almond Milk"

      const result = await service.updateName(ingredientId, newName)

      expect(mockEventRepository.appendWithProjection).toHaveBeenCalledTimes(1)

      const [event] = mockEventRepository.appendWithProjection.mock.calls[0]
      expect(event.event_type).toBe(EventTypes.INGREDIENT_UPDATED)
      expect(event.aggregate_id).toBe(ingredientId)
      const payload = JSON.parse(event.payload)
      expect(payload.name).toBe(newName)

      expect(result.success).toBe(true)
    })

    it("should return error if event repository fails", async () => {
      const dbError = new DbQueryError("DB error", "updateName", "Ingredient")
      mockEventRepository.appendWithProjection.mockResolvedValue(Result.fail(dbError))

      const result = await service.updateName("1", "New Name")

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("deleteIngredient", () => {
    it("should append an ingredient.deleted event", async () => {
      const ingredientId = "1"

      const result = await service.deleteIngredient(ingredientId)

      expect(mockEventRepository.appendWithProjection).toHaveBeenCalledTimes(1)

      const [event] = mockEventRepository.appendWithProjection.mock.calls[0]
      expect(event.event_type).toBe(EventTypes.INGREDIENT_DELETED)
      expect(event.aggregate_id).toBe(ingredientId)

      expect(result.success).toBe(true)
    })

    it("should return error if event repository fails", async () => {
      const dbError = new DbQueryError("DB error", "deleteIngredient", "Ingredient")
      mockEventRepository.appendWithProjection.mockResolvedValue(Result.fail(dbError))

      const result = await service.deleteIngredient("1")

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
        { event_id: "e1", event_type: EventTypes.INGREDIENT_CREATED, aggregate_id: "i1" },
        { event_id: "e2", event_type: EventTypes.INGREDIENT_UPDATED, aggregate_id: "i1" },
      ]
      mockEventRepository.getByAggregateType.mockResolvedValue(Result.ok(mockEvents as any))
      mockProjection.rebuild.mockResolvedValue(undefined)

      const result = await service.rebuildProjection()

      expect(mockEventRepository.getByAggregateType).toHaveBeenCalledWith("ingredient")
      expect(mockProjection.rebuild).toHaveBeenCalledWith(mockEvents)
      expect(result.success).toBe(true)
    })

    it("should propagate error if getByAggregateType fails", async () => {
      const dbError = new DbQueryError("DB error", "getByAggregateType", "Ingredient")
      mockEventRepository.getByAggregateType.mockResolvedValue(Result.fail(dbError))

      const result = await service.rebuildProjection()

      expect(mockProjection.rebuild).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })

    it("should return DbQueryError if projection.rebuild throws", async () => {
      mockEventRepository.getByAggregateType.mockResolvedValue(Result.ok([] as any))
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
      expect(mockRepository.getCompletedIngredients).toHaveBeenCalledWith("list-1")

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
