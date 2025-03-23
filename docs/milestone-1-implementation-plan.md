# Milestone 1: Database Migration Implementation Plan

## Overview
This document outlines the specific implementation details for migrating ShoList from AsyncStorage to SQLite. This migration represents the foundation for future enhancements including event tracking, intelligent ordering, and predictive suggestions.

## Database Schema Design

### Ingredients Table
```sql
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Database Version Table
```sql
CREATE TABLE IF NOT EXISTS database_version (
  version INTEGER PRIMARY KEY,
  migration_date INTEGER NOT NULL
);
```

## Implementation Steps

### 1. Project Setup
- [X] Add `expo-sqlite` dependency to the project
  ```bash
  npm install expo-sqlite
  ```
- [X] Create a `/database` directory at the project root

### 2. Database Service Implementation

#### Create Core Database Files
- [X] Create `database/database.ts` for database initialization and connection management
- [X] Create `database/migrations.ts` to handle schema migrations
- [X] Create `database/ingredient-repository.ts` for ingredient-specific database operations

#### Database Connection Module
The `database.ts` file will:
- Initialize the SQLite database
- Provide connection management
- Implement database version checking
- Trigger migrations when needed

#### Migrations Module
The `migrations.ts` file will:
- Define schema creation scripts
- Handle upgrading between database versions
- Implement the one-time migration from AsyncStorage

### 3. Repository Layer Implementation

#### Ingredient Repository
The `ingredient-repository.ts` file will implement:
- `getAll()`: Get all ingredients
- `getById(id: string)`: Get ingredient by ID
- `add(ingredient: Ingredient)`: Add new ingredient
- `update(ingredient: Ingredient)`: Update existing ingredient
- `updateCompletion(id: string, completed: boolean)`: Toggle completion status
- `remove(id: string)`: Delete ingredient
- `reorderIngredients(orderedIds: string[])`: Update display order

### 4. Service Layer Updates

#### Update Ingredient Service
Modify `api/ingredient-service.tsx` to:
- Replace AsyncStorage calls with SQLite repository calls
- Maintain the same public interface for backward compatibility
- Add transaction support for operations that affect multiple records
- Implement proper error handling for database operations

### 5. Migration Utility

#### Create Migration Module
Create `database/data-migration.ts` to:
- Detect if migration from AsyncStorage is needed
- Read all data from AsyncStorage
- Convert and write to SQLite
- Mark migration as complete

#### Migration Process
The migration process will:
1. Check if this is the first run with SQLite
2. Load existing ingredients from AsyncStorage
3. Create new SQLite database tables
4. Insert ingredients with creation timestamps
5. Update database version
6. Mark AsyncStorage as migrated

### 6. UI Layer Updates

#### Modify Main List Screen
Update `app/index.tsx` to:
- Handle loading states during database operations
- Update data fetching to work with the new service
- Ensure proper re-renders when data changes

#### Update New Ingredient Screen
Update `app/new_ingredient.tsx` to:
- Work with the updated service layer
- Provide proper error handling
- Include created_at and updated_at timestamps

### 7. Testing Plan

#### Unit Tests
- [ ] Database initialization and connection
- [ ] Schema creation and migration
- [ ] CRUD operations on ingredients
- [ ] Data migration from AsyncStorage

#### Integration Tests
- [ ] End-to-end flow of adding, updating, completing ingredients
- [ ] Migration process from AsyncStorage to SQLite
- [ ] Handling of database errors

### 8. Refactoring Opportunities

#### Type Definitions
Update `types/Ingredient.tsx` to include:
```typescript
export interface Ingredient {
  id: string;
  name: string;
  completed: boolean;
  created_at: number;
  updated_at: number;
}
```

#### Error Handling
Implement standardized error handling:
- Create custom error types for database operations
- Add error recovery mechanisms
- Implement user-friendly error messages

## Testing Approach

### Database Layer Testing
- Test database connection and initialization
- Verify schema creation
- Test migrations between versions

### Repository Layer Testing
- Test CRUD operations on ingredients
- Verify proper error handling
- Test transaction support

### Migration Testing
- Test migration from AsyncStorage to SQLite
- Verify data integrity during migration
- Test handling of edge cases (empty data, malformed data)

## Deployment Considerations

### First Run Experience
- Add detection for first run with SQLite
- Show migration progress for users with existing data
- Handle migration failures gracefully

### Backward Compatibility
- Maintain backward compatibility with previous app versions
- Implement fallback mechanisms if database operations fail

## Timeline Estimate
- Environment setup and dependency addition: 0.5 day
- Database service implementation: 1 day
- Repository layer implementation: 1 day
- Service layer updates: 1 day
- Migration utility: 1 day
- UI updates: 0.5 day
- Testing and debugging: 1 day
- Documentation: 0.5 day

**Total Estimated Time: 6.5 days**
