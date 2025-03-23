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
- AsyncStorage for persistent data storage
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
- `/common`: Common utilities for API services

#### `/components`
Reusable UI components.
- `ActionButton.tsx`: Floating action button
- `Entry.tsx`: Individual ingredient entry component
- `ThemedText.tsx`: Text component with theme support
- `ThemedTextInput.tsx`: Text input with theme support
- `ThemedView.tsx`: View component with theme support

#### `/hooks`
Custom React hooks.
- `useThemeColor.ts`: Hook for accessing theme colors
- `useColorScheme.ts`: Hook for detecting device color scheme

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
- `api/ingredient-service.tsx`: Service class that handles:
  - Loading ingredients from persistent storage
  - Saving ingredients
  - Adding new ingredients with validation
  - Updating existing ingredients

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
