# ShoList Project Overview

## Project Description
ShoList is a mobile application built with React Native and Expo that helps users create and manage shopping lists. The app allows users to add ingredients, mark them as complete, edit ingredient names, and provides a clean, intuitive user interface.

## Technology Stack

### Core Technologies
- **React Native**: Cross-platform mobile application framework
- **Expo**: Development platform for React Native
- **TypeScript**: Strongly typed programming language that builds on JavaScript
- **React Navigation/Expo Router**: Navigation management

### State Management & Data Storage
- Local state management with React hooks
- SQLite (via `expo-sqlite`) for persistent data storage
- UUID for generating unique identifiers

### UI Components
- Custom themed components (ThemedText, ThemedTextInput, ThemedView)
- Responsive design with React Native's StyleSheet
- Support for light/dark themes

### Testing
- Jest for unit and component testing
- React Native Testing Library

## Project Structure

### Main Directories

#### `/app`
Contains the main screens and application layout using Expo Router.
- `index.tsx`: Main ingredient list screen
- `new_ingredient.tsx`: Screen for adding new ingredients
- `_layout.tsx`: Layout configuration for the app

#### `/api`
Services for data management.
- `ingredient-service.tsx`: Service for CRUD operations on ingredients
- `/common`: Common utilities for API services (logger, errors, result type)

#### `/components`
Reusable UI components.
- `ActionButton.tsx`: Floating action button
- `Entry.tsx`: Individual ingredient entry component
- `ThemedText.tsx`: Text component with theme support
- `ThemedTextInput.tsx`: Text input with theme support
- `ThemedView.tsx`: View component with theme support

#### `/database`
Handles SQLite database operations, migrations, and data persistence.
- `database.ts`: Core database connection and version management.
- `migrations.ts`: Defines database schema and migration steps.
- `data-migration.ts`: Orchestrates initialization and migration execution.
- `base-repository.ts`: Abstract base class for repositories, providing common logic (error handling, transactions).
- `ingredient-repository.ts`: Repository for ingredient-specific database operations (extends `BaseRepository`).

#### `/hooks`
Custom React hooks.
- `useThemeColor.ts`: Hook for accessing theme colors
- `useColorScheme.ts`: Hook for detecting device color scheme (native)
- `useColorScheme.web.ts`: Hook for detecting device color scheme (web)
- `useIngredients.ts`: Hook for managing ingredient data and state.

#### `/assets`
Static assets like images and fonts.

#### `/constants`
Application constants.

## Key Files and Their Functions

### App Structure
- `app/_layout.tsx`: Configures the navigation stack and global theme
- `app/index.tsx`: Main screen displaying the list of ingredients with functionality to toggle completion status and edit items
- `app/new_ingredient.tsx`: Screen for adding new ingredients with validation

### Data Management
- `api/ingredient-service.tsx`: Service class that orchestrates ingredient operations, interacting with the `IngredientRepository`.
- `api/common/*`: Contains shared utilities like `logger`, custom `Error` types, and the `Result` type for consistent error handling.

### Database Layer (`/database`)
- `database.ts`: Manages the SQLite connection and database versioning.
- `migrations.ts` & `data-migration.ts`: Handle schema creation and data migration, including migrating from potential older storage methods (like AsyncStorage) on first run.
- `base-repository.ts`: Provides a foundation for all data repositories, encapsulating common database interaction patterns like transaction handling, error logging, and returning standardized `Result` objects.
- `ingredient-repository.ts`: Implements specific CRUD operations for ingredients against the database, leveraging the `BaseRepository` for consistency and reduced boilerplate.

### Core Components
- `components/Entry.tsx`: Displays an individual ingredient with toggle and edit capabilities
- `components/ActionButton.tsx`: Floating action button for navigating to add new ingredients
- `components/ThemedText.tsx`: Text component that adapts to the current theme
- `components/ThemedTextInput.tsx`: Input component that adapts to the current theme

### Type Definitions
- `types/Ingredient.ts`: Defines the structure of ingredient objects with:
  - id: Unique identifier
  - name: Ingredient name
  - completed: Completion status

## Application Flow
1. The app loads with `_layout.tsx` setting up the navigation and theme
2. The main screen (`index.tsx`) fetches and displays the list of ingredients
3. Users can:
   - Mark ingredients as complete/incomplete
   - Long-press to edit ingredient names
   - Add new ingredients via the ActionButton
4. When adding new ingredients:
   - Input validation ensures non-empty names
   - Successfully added ingredients appear at the top of the list

## Development Workflow
- Start the development server: `npm start`
- Run on Android: `npm run android`
- Run on iOS: `npm run ios`
- Run tests: `npm test`
- Reset project: `npm run reset-project`

## Testing Strategy
The project uses Jest and React Native Testing Library for testing components and functionality.

You can execute tests in non-interactive mode with

```bash
npm run test:ci
```

## Core Abstractions

### Result Pattern (`api/common/result.ts`)

The `Result<T, E>` type is a fundamental abstraction used throughout the application to handle operations that can succeed or fail, avoiding exceptions and providing typed error handling.

#### Key features:
- Generic type that wraps either a success value or an error
- Methods for safely transforming and accessing result values
- Support for both synchronous and asynchronous operations
- Static helpers for creating Results from Promises

#### Usage examples:

**Creating Results:**
```typescript
// Success case
const successResult = Result.ok<string, Error>("Success value")

// Error case
const errorResult = Result.fail<string, Error>(new Error("Something went wrong"))

// From a Promise
const asyncResult = await Result.fromPromise(fetchData())
```

**Working with Results:**
```typescript
// Safe value access with pattern matching
if (result.success) {
  const value = result.getValue() // Safe to call here
  // Handle success case
} else {
  const error = result.getError()
  // Handle error case
}

// Transforming values with map
const transformedResult = result.map(value => transformValue(value))

// Async transformations
const asyncTransformedResult = await result.asyncMap(async value => {
  return await someAsyncOperation(value)
})
```

**Best practices:**
- Always check `result.success` before accessing values
- Use the Result type for any operation that might fail
- Leverage the transformation methods to maintain the Result wrapper
- Avoid throwing exceptions in business logic; use Result instead

### Repository Pattern (`database/base-repository.ts`)

The `BaseRepository` abstract class provides a foundation for database interactions, encapsulating common patterns like error handling, logging, and transaction management.

#### Key features:
- Standardized error handling with the Result type
- Built-in transaction support
- Consistent logging
- Abstraction of SQL execution details

#### Usage example:

**Creating a new repository:**
```typescript
export class ProductRepository extends BaseRepository {
  protected readonly entityName = "product"

  constructor(db: SQLite.SQLiteDatabase) {
    super(db, "ProductRepository")
  }

  async getAll(): Promise<Result<Product[], DbQueryError>> {
    return this._executeQuery(async () => {
      const { rows } = await this.db.execAsync<Product>(`
        SELECT * FROM products ORDER BY name
      `)
      return rows._array
    }, "getAll")
  }

  async add(product: Product): Promise<Result<void, DbQueryError>> {
    return this._executeTransaction(async () => {
      await this.db.execAsync(`
        INSERT INTO products (id, name, price)
        VALUES (?, ?, ?)
      `, [product.id, product.name, product.price])
    }, "add")
  }
}
```

**Using repositories with Result pattern:**
```typescript
// In a service or hook
const result = await productRepository.getAll()

if (result.success) {
  const products = result.getValue()
  // Use products
} else {
  const error = result.getError()
  // Handle error, e.g., show user-friendly message
}
```

**Best practices:**
- Always extend BaseRepository for database access
- Use the protected _executeQuery and _executeTransaction methods
- Keep SQL queries in the repository layer only
- Return Results, never throw exceptions from repositories
- Use typed entities as the return values
