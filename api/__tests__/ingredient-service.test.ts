import { IngredientRepository } from "@/database/ingredient-repository"
import { getDatabase } from "@/database/database"
import { IngredientService } from "@/api/ingredient-service"
import { Ingredient } from "@/types/Ingredient"
import * as SQLite from "expo-sqlite"
import { DbQueryError, ValidationError } from "@/api/common/error-types"
import { Result } from "@/api/common/result"

// Mock the repository
jest.mock("@/database/ingredient-repository")
const MockIngredientRepository = IngredientRepository as jest.MockedClass<
  typeof IngredientRepository
>

// Mock the database
jest.mock("@/database/database", () => ({
  getDatabase: jest.fn(),
}))

describe("IngredientService", () => {
  let service: IngredientService
  let mockRepository: jest.Mocked<IngredientRepository>

  beforeEach(() => {
    // Clear mocks
    jest.clearAllMocks()

    // Create a mock repository instance
    mockRepository = {
      getAll: jest.fn(),
      getById: jest.fn(),
      add: jest.fn(),
      update: jest.fn(),
      updateCompletion: jest.fn(),
      updateName: jest.fn(),
      remove: jest.fn(),
      reorderIngredients: jest.fn(),
    } as unknown as jest.Mocked<IngredientRepository>

    // Set up the mock
    MockIngredientRepository.mockImplementation(() => mockRepository)

    // Mock getDatabase
    const mockDb = {} as SQLite.SQLiteDatabase
    ;(getDatabase as jest.Mock).mockReturnValue(mockDb)

    // Create a new service instance for each test
    service = new IngredientService()
  })

  describe("GetIngredients", () => {
    it("should get ingredients from the repository", async () => {
      // Set up mock data
      const mockIngredients: Ingredient[] = [
        {
          id: "1",
          name: "Milk",
          completed: false,
          created_at: 1000,
          updated_at: 1000,
        },
        {
          id: "2",
          name: "Eggs",
          completed: true,
          created_at: 2000,
          updated_at: 2000,
        },
      ]

      // Set up repository mock
      mockRepository.getAll.mockResolvedValue(Result.ok(mockIngredients))

      // Call the method
      const result = await service.GetIngredients()

      // Verify repository was called
      expect(mockRepository.getAll).toHaveBeenCalledTimes(1)

      // Verify result
      expect(result.success).toBe(true)
      expect(result.getValue()).toEqual(mockIngredients)
    })
  })

  describe("AddIngredients", () => {
    it("should add an ingredient using the repository", async () => {
      // Set up mock data
      const ingredientName = "Milk"
      const nowMock = 1000

      // Mock Date.now
      jest.spyOn(Date, "now").mockReturnValue(nowMock)

      // Configure repository to return success
      mockRepository.add.mockResolvedValue(Result.ok(undefined))

      // Call the method
      const result = await service.AddIngredients(ingredientName)

      // Verify repository was called
      expect(mockRepository.add).toHaveBeenCalledTimes(1)

      // Verify the correct ingredient was added
      const addedIngredient = mockRepository.add.mock.calls[0][0]
      expect(addedIngredient.name).toBe(ingredientName)
      expect(addedIngredient.completed).toBe(false)
      expect(addedIngredient.id).toBeDefined() // Should have an ID
      expect(addedIngredient.created_at).toBe(nowMock)
      expect(addedIngredient.updated_at).toBe(nowMock)

      // Verify result
      expect(result.success).toBe(true)
    })

    it("should return error for empty ingredient name", async () => {
      // Call the method with empty name
      const result = await service.AddIngredients("")

      // Verify repository was not called
      expect(mockRepository.add).not.toHaveBeenCalled()

      // Verify error result
      expect(result.success).toBe(false)
      expect(result.getError()).toBeInstanceOf(ValidationError)
      expect(result.getError()?.message).toBe("Ingredient name can't be empty")
    })
  })

  describe("updateCompletion", () => {
    it("should call repository updateCompletion and update cache", async () => {
      const ingredientId = "1"
      const completed = true
      const initialIngredients: Ingredient[] = [
        {
          id: "1",
          name: "Milk",
          completed: false,
          created_at: 1,
          updated_at: 1,
        },
      ]
      service.ingredients = initialIngredients // Set initial cache

      const nowMock = 1000
      jest.spyOn(Date, "now").mockReturnValue(nowMock)

      // Configure repository to return success
      mockRepository.updateCompletion.mockResolvedValue(Result.ok(undefined))

      const result = await service.updateCompletion(ingredientId, completed)

      expect(mockRepository.updateCompletion).toHaveBeenCalledTimes(1)
      expect(mockRepository.updateCompletion).toHaveBeenCalledWith(
        ingredientId,
        completed
      )

      expect(result.success).toBe(true)

      // Verify cache update
      expect(service.ingredients[0].completed).toBe(completed)
      expect(service.ingredients[0].updated_at).toBe(nowMock)
    })

    it("should return error if repository fails", async () => {
      const ingredientId = "1"
      const completed = true
      const errorMessage = "DB error"
      const dbError = new DbQueryError(
        errorMessage,
        "updateCompletion",
        "Ingredient"
      )

      mockRepository.updateCompletion.mockResolvedValue(Result.fail(dbError))

      const result = await service.updateCompletion(ingredientId, completed)

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("updateName", () => {
    it("should call repository updateName and update cache", async () => {
      const ingredientId = "1"
      const newName = "Almond Milk"
      const initialIngredients: Ingredient[] = [
        {
          id: "1",
          name: "Milk",
          completed: false,
          created_at: 1,
          updated_at: 1,
        },
      ]
      service.ingredients = initialIngredients // Set initial cache

      const nowMock = 1000
      jest.spyOn(Date, "now").mockReturnValue(nowMock)

      // Configure repository to return success
      mockRepository.updateName.mockResolvedValue(Result.ok(undefined))

      const result = await service.updateName(ingredientId, newName)

      expect(result.success).toBe(true)

      expect(mockRepository.updateName).toHaveBeenCalledTimes(1)
      expect(mockRepository.updateName).toHaveBeenCalledWith(
        ingredientId,
        newName
      )

      // Verify cache update
      expect(service.ingredients[0].name).toBe(newName)
      expect(service.ingredients[0].updated_at).toBe(nowMock)
    })

    it("should return error if repository fails", async () => {
      const ingredientId = "1"
      const newName = "Almond Milk"
      const errorMessage = "DB error"
      const dbError = new DbQueryError(errorMessage, "updateName", "Ingredient")

      mockRepository.updateName.mockResolvedValue(Result.fail(dbError))

      const result = await service.updateName(ingredientId, newName)

      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })

  describe("error handling", () => {
    it("should handle repository errors gracefully", async () => {
      // Set up repository to return an error result
      const errorMessage = "Database error"
      const dbError = new DbQueryError(errorMessage, "getAll", "Ingredient")
      mockRepository.getAll.mockResolvedValue(Result.fail(dbError))

      // Call the method
      const result = await service.GetIngredients()

      // Verify we get a failed result with the error
      expect(result.success).toBe(false)
      expect(result.getError()).toBe(dbError)
    })
  })
})
