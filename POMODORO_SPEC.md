# Pomodoro Timer Feature Specification

## Overview

This specification describes the addition of a Pomodoro timer feature to the TaskNotes plugin (formerly ChronoSync). The Pomodoro technique is a time management method where work is broken into intervals (typically 25 minutes) separated by short breaks (5 minutes), with longer breaks (15-30 minutes) after every 4 intervals.

## Core Requirements

### 1. Timer Functionality
- **Work intervals**: Default 25 minutes (configurable)
- **Short breaks**: Default 5 minutes (configurable)
- **Long breaks**: Default 15 minutes (configurable)
- **Long break frequency**: After every 4 pomodoros (configurable)
- **Timer precision**: Update every second
- **State persistence**: Timer state should persist across Obsidian restarts

### 2. Integration with Tasks
- Timer can be started from any task in the TaskListView
- Time spent during pomodoros should be tracked and added to task's `timeSpent`
- Support multiple time sessions per task
- Option to automatically start timer when clicking on a task

### 3. User Interface

#### 3.1 Timer Widget
- **Location**: Floating widget or status bar integration
- **Display**: Shows current time remaining (MM:SS format)
- **States**: 
  - Idle (no timer running)
  - Working (during pomodoro)
  - Short Break
  - Long Break
- **Controls**:
  - Start/Pause button
  - Stop/Reset button
  - Skip to next phase button

#### 3.2 Task Integration
- Add pomodoro icon next to existing time tracking icon in TaskListView
- Visual indicator when a task has an active pomodoro
- Quick-start pomodoro from task context menu

#### 3.3 Pomodoro View (New View)
- New view type: `POMODORO_VIEW_TYPE = 'pomodoro-view'`
- Shows current timer state
- Daily pomodoro statistics
- Weekly/monthly statistics
- Task being worked on (if any)

### 4. Settings

Add to `TaskNotesSettings`:
```typescript
pomodoroWorkDuration: number; // minutes, default 25
pomodoroShortBreakDuration: number; // minutes, default 5
pomodoroLongBreakDuration: number; // minutes, default 15
pomodoroLongBreakInterval: number; // after X pomodoros, default 4
pomodoroAutoStartBreaks: boolean; // default true
pomodoroAutoStartWork: boolean; // default false
pomodoroNotifications: boolean; // default true
pomodoroSoundEnabled: boolean; // default true
pomodoroSoundVolume: number; // 0-100, default 50
```

### 5. Data Model

#### 5.1 Pomodoro Session
```typescript
interface PomodoroSession {
    id: string;
    taskPath?: string; // optional, can run timer without task
    startTime: string; // ISO datetime
    endTime?: string; // ISO datetime when completed
    duration: number; // planned duration in minutes
    type: 'work' | 'short-break' | 'long-break';
    completed: boolean;
    interrupted?: boolean;
}
```

#### 5.2 Timer State
```typescript
interface PomodoroState {
    isRunning: boolean;
    currentSession?: PomodoroSession;
    timeRemaining: number; // seconds
    pomodorosCompleted: number; // today's count
    currentStreak: number; // consecutive pomodoros
}
```

### 6. Events

New events for the EventEmitter:
- `EVENT_POMODORO_START`
- `EVENT_POMODORO_COMPLETE`
- `EVENT_POMODORO_INTERRUPT`
- `EVENT_POMODORO_TICK` (every second update)

### 7. Implementation Details

#### 7.1 Timer Service
Create `src/services/PomodoroService.ts`:
- Manages timer state
- Handles interval logic
- Persists state to plugin data
- Integrates with task time tracking
- Handles notifications

#### 7.2 UI Components
- **PomodoroView**: Main view for timer display and controls
- **PomodoroWidget**: Floating/status bar widget
- **PomodoroButton**: Task list integration

#### 7.3 Storage
- Timer state stored in plugin data (not in task files)
- Completed sessions stored for statistics
- Integration with existing `timeEntries` in tasks

### 8. User Workflows

#### 8.1 Basic Pomodoro
1. User clicks pomodoro button on a task
2. 25-minute timer starts
3. Notification when complete
4. 5-minute break starts automatically
5. After break, user can start next pomodoro

#### 8.2 Statistics Tracking
1. User opens Pomodoro View
2. Sees today's completed pomodoros
3. Can view weekly/monthly charts
4. Can see most productive times

#### 8.3 Task Time Integration
1. Complete a pomodoro on a task
2. 25 minutes added to task's `timeSpent`
3. New entry added to task's `timeEntries`
4. Progress visible in TaskListView

### 9. Notifications

- **Desktop notifications** (if enabled)
- **Sound alerts** (configurable)
- **Visual indicators** in Obsidian
- Options:
  - Work session complete
  - Break complete
  - Reminder to take break
  - Daily goal achieved

### 10. Future Enhancements

- Pomodoro planning: Estimate tasks in pomodoros
- Daily/weekly goals
- Integration with calendar view
- Productivity analytics
- Custom timer presets
- White noise/focus sounds during work
- Block distracting websites/apps (requires external integration)

### 11. Technical Considerations

- Use `setInterval` for timer updates
- Handle Obsidian workspace events (close, switch)
- Ensure timer continues when switching views
- Memory-efficient timer implementation
- Proper cleanup on plugin unload

### 12. Migration Notes

- No breaking changes to existing functionality
- New feature is opt-in
- Existing time tracking remains unchanged
- Can use both traditional time tracking and pomodoros

## Implementation Priority

1. **Phase 1**: Core timer functionality with basic UI
2. **Phase 2**: Task integration and time tracking
3. **Phase 3**: Statistics and analytics
4. **Phase 4**: Advanced features (goals, sounds, etc.)