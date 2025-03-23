# ShoList Feature Roadmap

## Overview
This roadmap outlines the plan to evolve ShoList from a simple shopping list app into a smarter application that learns from user behavior. The key improvements include:

1. Migrating from AsyncStorage to SQLite
2. Implementing event tracking for shopping list items
3. Adding smart ordering based on completion patterns
4. Creating predictive suggestions based on usage frequency

## Milestone 1: Database Migration (AsyncStorage to SQLite)

### Goal
Replace the current AsyncStorage implementation with a SQLite database to enable more complex data operations and relationships.

### Tasks
- Set up SQLite database using `expo-sqlite`
- Create database schema for ingredients table
- Migrate existing data from AsyncStorage to SQLite
- Update `ingredient-service.tsx` to use SQLite instead of AsyncStorage
- Implement database versioning for future migrations
- Add unit tests for database operations

### Technical Changes
- Add `expo-sqlite` dependency
- Create a database service layer
- Update existing CRUD operations to use SQL queries
- Implement transaction support for data integrity

## Milestone 2: Event Tracking System

### Goal
Implement an event tracking system to record user interactions with shopping list items.

### Tasks
- Design and create events table in SQLite
- Define event types (add, complete, rename, delete)
- Update ingredient service to log events when actions are performed
- Create a service for querying and analyzing events
- Implement data retention policy for events

### Technical Changes
- Add event types definition in `/types` directory
- Create `event-service.tsx` for managing events
- Modify UI components to capture relevant events
- Add timestamps and metadata to event records

## Milestone 3: Intelligent Item Ordering

### Goal
Use completion patterns to intelligently order shopping list items based on how users typically complete them.

### Tasks
- Implement algorithm to analyze completion order patterns
- Create a "suggested order" scoring system based on historical data
- Update the UI to display items in the suggested order
- Allow manual overrides of the suggested order
- Add a "reset to suggested order" feature

### Technical Changes
- Create an ordering service that analyzes event data
- Modify `index.tsx` to sort items based on the suggested order
- Update FlatList implementation to handle the new ordering
- Add visualization for order suggestion strength

## Milestone 4: Predictive Item Suggestions

### Goal
Analyze usage patterns to suggest items that are regularly purchased on a schedule.

### Tasks
- Implement frequency analysis for item additions
- Create algorithm to detect periodic purchasing patterns
- Build a suggestion system based on historical patterns
- Design UI for suggested items
- Add ability to accept/reject suggestions

### Technical Changes
- Create a suggestions service to analyze periodic patterns
- Implement notification system for suggestions
- Add a suggestion UI component to the main screen
- Create settings to control suggestion frequency and sensitivity

## Milestone 5: Enhanced Analytics and User Insights

### Goal
Provide users with insights about their shopping habits and potential optimizations.

### Tasks
- Create a dashboard showing shopping patterns
- Implement visualizations for frequently purchased items
- Add spending tracking functionality (optional)
- Generate reports on potential shopping optimizations
- Create export functionality for shopping data

### Technical Changes
- Add a new analytics screen
- Implement data visualization components
- Create reporting service
- Extend database schema for additional metrics

## Implementation Notes

### Data Migration Strategy
When migrating from AsyncStorage to SQLite, implement a one-time migration process that:
1. Checks if this is first run with SQLite
2. Reads all data from AsyncStorage
3. Writes it to the new SQLite database
4. Marks migration as complete

### Event Storage Considerations
- Keep event data reasonably sized by implementing aggregation for older events
- Consider privacy implications and add user controls for data collection
- Implement data export and deletion functions

### Performance Considerations
- Implement database indexes for frequently queried fields
- Use batch operations for event logging to minimize performance impact
- Consider moving complex analyses to background tasks
- Cache suggestion results to improve UI responsiveness
