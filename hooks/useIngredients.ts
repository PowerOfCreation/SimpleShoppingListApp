import React from "react"
import { Ingredient } from "@/types/Ingredient"
import { ingredientService } from "@/api/ingredient-service"

// --- State Definition ---
interface IngredientsState {
  ingredients: Ingredient[]
  isLoading: boolean
  error: string | null
}

// --- Action Definitions ---
type IngredientsAction =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; payload: Ingredient[] }
  | { type: "FETCH_ERROR"; payload: string }
  | { type: "OPTIMISTIC_UPDATE"; payload: Ingredient[] }
  // UPDATE_SUCCESS might be useful later if we need to confirm backend success beyond just not having an error
  // | { type: 'UPDATE_SUCCESS' }
  | {
      type: "UPDATE_ERROR_ROLLBACK"
      payload: { originalIngredients: Ingredient[]; error: string }
    }
  | { type: "CLEAR_ERROR" }

// --- Reducer Implementation ---
function ingredientsReducer(
  state: IngredientsState,
  action: IngredientsAction
): IngredientsState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, isLoading: true, error: null }
    case "FETCH_SUCCESS":
      return {
        ...state,
        isLoading: false,
        ingredients: action.payload,
        error: null,
      }
    case "FETCH_ERROR":
      return { ...state, isLoading: false, error: action.payload }
    case "OPTIMISTIC_UPDATE":
      return { ...state, ingredients: action.payload, error: null } // Clear previous errors on new action
    // case 'UPDATE_SUCCESS':
    //   return { ...state, error: null }; // Or potentially just return state if no change needed
    case "UPDATE_ERROR_ROLLBACK":
      return {
        ...state,
        ingredients: action.payload.originalIngredients,
        error: action.payload.error,
      }
    case "CLEAR_ERROR":
      return { ...state, error: null }
    default:
      return state
  }
}

// --- Custom Hook ---
export function useIngredients() {
  const [state, dispatch] = React.useReducer(ingredientsReducer, {
    ingredients: [],
    isLoading: true,
    error: null,
  })

  // Fetch initial ingredients
  React.useEffect(() => {
    const fetchIngredients = async () => {
      dispatch({ type: "FETCH_START" })
      try {
        const result = await ingredientService.GetIngredients()

        if (result.success) {
          dispatch({ type: "FETCH_SUCCESS", payload: result.getValue() || [] })
        } else {
          const error = result.getError()
          dispatch({
            type: "FETCH_ERROR",
            payload: `Failed to load ingredients: ${error?.message || "Unknown error"}`,
          })
        }
      } catch (err: unknown) {
        let errorMessage = "Unknown error"
        if (err instanceof Error) {
          errorMessage = err.message
        }
        dispatch({
          type: "FETCH_ERROR",
          payload: `Failed to load ingredients: ${errorMessage}`,
        })
      }
    }

    fetchIngredients()
  }, [])

  // Action: Toggle completion
  const toggleIngredientCompletion = async (id: string) => {
    const originalIngredients = [...state.ingredients] // Keep original state for potential rollback
    const ingredientToUpdate = originalIngredients.find((ing) => ing.id === id)

    if (!ingredientToUpdate) {
      dispatch({
        type: "UPDATE_ERROR_ROLLBACK",
        payload: {
          originalIngredients,
          error: `Failed to update completion: Ingredient not found`,
        },
      })
      return
    }

    const updatedIngredients = state.ingredients.map((element) => {
      if (element.id === id) {
        return { ...element, completed: !element.completed }
      }
      return element
    })

    dispatch({ type: "OPTIMISTIC_UPDATE", payload: updatedIngredients }) // Optimistic update

    try {
      const result = await ingredientService.updateCompletion(
        id,
        !ingredientToUpdate.completed
      )

      if (!result.success) {
        const error = result.getError()
        dispatch({
          type: "UPDATE_ERROR_ROLLBACK",
          payload: {
            originalIngredients,
            error: `Failed to update completion: ${error?.message || "Unknown error"}`,
          },
        })
      }
      // If successful, we keep the optimistic update
    } catch (err: unknown) {
      // Fallback for unexpected errors
      let errorMessage = "Unknown error"
      if (err instanceof Error) {
        errorMessage = err.message
      }
      dispatch({
        type: "UPDATE_ERROR_ROLLBACK",
        payload: {
          originalIngredients,
          error: `Failed to update completion: ${errorMessage}`,
        },
      })
    }
  }

  // Action: Change name
  const changeIngredientName = async (id: string, newName: string) => {
    const originalIngredients = [...state.ingredients] // Keep original state for potential rollback
    const updatedIngredients = state.ingredients.map((element) => {
      if (element.id === id) {
        return { ...element, name: newName }
      }
      return element
    })

    dispatch({ type: "OPTIMISTIC_UPDATE", payload: updatedIngredients }) // Optimistic update

    try {
      const result = await ingredientService.updateName(id, newName)

      if (!result.success) {
        const error = result.getError()
        dispatch({
          type: "UPDATE_ERROR_ROLLBACK",
          payload: {
            originalIngredients,
            error: `Failed to change name: ${error?.message || "Unknown error"}`,
          },
        })
      }
      // If successful, we keep the optimistic update
    } catch (err: unknown) {
      // Fallback for unexpected errors
      let errorMessage = "Unknown error"
      if (err instanceof Error) {
        errorMessage = err.message
      }
      dispatch({
        type: "UPDATE_ERROR_ROLLBACK",
        payload: {
          originalIngredients,
          error: `Failed to change name: ${errorMessage}`,
        },
      })
    }
  }

  return {
    ...state, // Expose ingredients, isLoading, error
    toggleIngredientCompletion,
    changeIngredientName,
  }
}
