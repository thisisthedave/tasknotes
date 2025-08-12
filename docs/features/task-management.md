# Task Management

TaskNotes provides a system for managing tasks, which is built on the principle of "one note per task." This approach allows you to create, edit, and organize your tasks with a set of properties, while maintaining the portability and extensibility of plain text files.

## Creating and Editing Tasks

You can create and edit tasks in a variety of ways. The primary method is through the **Task Creation Modal**, which can be accessed via the "Create new task" command or by clicking on dates or time slots in the calendar views. This modal provides an interface for setting all available task properties, including title, status, priority, and due dates.

TaskNotes also supports **Natural Language Creation**, which allows you to create tasks by typing descriptions in plain English. The built-in parser can extract structured data from phrases like "Buy groceries tomorrow at 3pm @home #errands high priority."

### Auto-Suggestions in Natural Language Input

The natural language input field includes auto-suggestion functionality that activates when typing specific trigger characters:

- **@** - Shows available contexts from existing tasks
- **#** - Shows available tags from existing tasks  
- **+** - Shows files from your vault as project suggestions

#### Project Suggestions

When typing `+` in the natural language input, you'll see up to 20 suggestions from your vault's markdown files. The suggestions display additional information to help identify files:

```
project-alpha [title: Alpha Project Development | aliases: alpha, proj-alpha]
meeting-notes [title: Weekly Team Meeting Notes]
simple-project
work-file [aliases: work, office-tasks]
```

Project suggestions search across:
- File names (basename without extension)
- Frontmatter titles (using your configured field mapping)
- Frontmatter aliases

Selecting a project suggestion inserts it as `+[[filename]]`, creating a wikilink to the file while maintaining the `+` project marker that the natural language parser recognizes.

Additionally, you can convert any line type in your notes to TaskNotes using the **Instant Conversion** feature. This works with checkboxes, bullet points, numbered lists, blockquotes, headers, and plain text lines.

## Task Properties

Each task in TaskNotes is a Markdown file with a YAML frontmatter block that stores its properties. The core properties include:

- **Title**: The main description of the task.
- **Status**: The current state of the task (e.g., "Open," "In Progress," "Done").
- **Priority**: The importance of the task (e.g., "Low," "Normal," "High").
- **Due Date**: The date by which the task must be completed.
- **Scheduled Date**: The date on which you plan to work on the task.
- **Contexts**: Location or tool-based groupings (e.g., "@home", "@work").
- **Projects**: Links to project notes in your vault that the task belongs to.
- **Tags**: Standard Obsidian tags for categorization.
- **Time Estimate**: The estimated time required to complete the task, in minutes.
- **Recurrence**: The pattern for repeating tasks, using the RRule standard.
- **Time Entries**: An array of recorded work sessions, with start and stop times.
- **Reminders**: Custom reminders to notify you before or at specific times related to the task.

You can also add your own custom fields to the YAML frontmatter, and use the **Field Mapping** feature to map them to TaskNotes' internal properties.

## Projects

TaskNotes supports organizing tasks into projects using note-based linking. Projects are represented as links to actual notes in your vault, allowing you to leverage Obsidian's linking and backlinking features for project management.

### Project Assignment

Tasks can be assigned to one or more projects through the task creation or editing interface. When creating or editing a task, click the "Add Project" button to open the project selection modal. This modal provides fuzzy search functionality to quickly find and select project notes from your vault.

### Project Links

Projects are stored as wikilinks in the task's frontmatter (e.g., `projects: ["[[Project A]]", "[[Project B]]"]`). These links are clickable in the task interface and will navigate directly to the project notes when clicked. Any note in your vault can serve as a project note simply by being linked from a task's projects field.

### Organization and Filtering

Tasks can be filtered and grouped by their associated projects in all task views. The FilterBar includes project-specific filters, and tasks can be grouped by project in the Task List and Kanban views. Tasks assigned to multiple projects will appear in each relevant project group, providing flexibility in project-based organization.

### Project Indicators

TaskCards display visual indicators when tasks are used as projects. These indicators help identify which tasks have other tasks linked to them as subtasks, making project hierarchy visible at a glance.

### Subtask Creation

Tasks can have subtasks created directly from their context menu. When viewing a task that serves as a project, you can select "Create subtask" to create a new task automatically linked to the current project.

### Template Integration

Projects support template variables for automated workflows. The `{{parentNote}}` variable inserts the parent note as a properly formatted markdown link. For project organization, it's recommended to use it as a YAML list item (e.g., `project:\n  - {{parentNote}}`) to align with the projects system behavior when creating tasks from project notes through instant conversion.

## File Management and Templates

TaskNotes provides a system for managing your task files. You can specify a **Default Tasks Folder** where all new tasks will be created, and you can choose from a variety of **Filename Generation** patterns, including title-based, timestamp-based, and Zettelkasten-style.

TaskNotes also supports **Templates** for both the YAML frontmatter and the body of your task notes. You can use templates to pre-fill common values, add boilerplate text, and create a consistent structure for your tasks. Templates can also include variables, such as `{{title}}`, `{{date}}`, and `{{parentNote}}` (which inserts the parent note as a properly formatted markdown link), which will be automatically replaced with the appropriate values when a new task is created.

## Recurring Tasks

TaskNotes provides sophisticated recurring task management using the RFC 5545 RRule standard with enhanced DTSTART support and dynamic scheduled dates. The system separates recurring pattern behavior from individual occurrence scheduling, giving you complete control over both aspects.

### Core Concepts

Recurring tasks in TaskNotes operate on two independent levels:

1. **Recurring Pattern**: Defines when pattern instances appear (controlled by DTSTART in the recurrence rule)
2. **Next Occurrence**: The specific date/time when you plan to work on the next instance (controlled by the scheduled field)

This separation allows for flexible scheduling where you can reschedule individual occurrences without affecting the overall pattern.

### Setting Up Recurring Tasks

#### Creating Recurrence Patterns

You can create recurring tasks through:

1. **Recurrence Context Menu**: Right-click the recurrence field in any task modal to access preset patterns or custom recurrence options
2. **Preset Options**: Quick selections like "Daily," "Weekly on [current day]," "Monthly on the [current date]"
3. **Custom Recurrence Modal**: Advanced editor with date picker, time picker, and full RRule configuration

#### Required Components

Recurring tasks require:
- **Recurrence Rule**: An RRule string with DTSTART defining the pattern
- **Scheduled Date**: The next occurrence date (can be independent from the pattern)

#### DTSTART Integration

All recurrence rules now include DTSTART (start date and optionally time):
- **Date-only**: `DTSTART:20250804;FREQ=DAILY` (pattern instances appear all-day)
- **Date and time**: `DTSTART:20250804T090000Z;FREQ=DAILY` (pattern instances appear at 9:00 AM)

### Recurrence Pattern Examples

TaskNotes supports the full RFC 5545 RRule standard with DTSTART:

```
DTSTART:20250804T090000Z;FREQ=DAILY
→ Daily at 9:00 AM, starting August 4, 2025

DTSTART:20250804T140000Z;FREQ=WEEKLY;BYDAY=MO,WE,FR
→ Monday, Wednesday, Friday at 2:00 PM, starting August 4, 2025

DTSTART:20250815;FREQ=MONTHLY;BYMONTHDAY=15
→ 15th of each month (all-day), starting August 15, 2025

DTSTART:20250801T100000Z;FREQ=MONTHLY;BYDAY=-1FR
→ Last Friday of each month at 10:00 AM, starting August 1, 2025
```

### Visual Hierarchy in Calendar Views

The Advanced Calendar View displays recurring tasks with distinct visual styling:

#### Next Scheduled Occurrence
- **Solid border** with full opacity
- Shows at the date/time specified in the `scheduled` field
- Can appear on any date, even outside the recurring pattern
- Dragging updates only the `scheduled` field (manual reschedule)

#### Pattern Instances  
- **Dashed border** with reduced opacity (70%)
- Shows preview of when future recurring instances will appear
- Generated from the DTSTART date/time and recurrence rule
- Dragging updates the DTSTART time (changes all future pattern instances)

### Dynamic Scheduled Dates

The `scheduled` field automatically updates to show the next uncompleted occurrence:

1. **When creating**: Initially set to the DTSTART date
2. **When completing**: Automatically advances to the next uncompleted occurrence
3. **When rule changes**: Recalculates based on the new pattern
4. **Manual reschedule**: Can be set to any date independently

#### Example Behavior

```yaml
# Initial state

recurrence: "DTSTART:20250804T090000Z;FREQ=DAILY"
scheduled: "2025-08-04T09:00"
complete_instances: []

# After completing Aug 4th

recurrence: "DTSTART:20250804T090000Z;FREQ=DAILY"  # unchanged
scheduled: "2025-08-05T09:00"  # auto-updated to next day
complete_instances: ["2025-08-04"]

# After manually rescheduling next occurrence

recurrence: "DTSTART:20250804T090000Z;FREQ=DAILY"  # unchanged
scheduled: "2025-08-05T14:30"  # manually set to 2:30 PM
complete_instances: ["2025-08-04"]

# Calendar view shows:

# - Aug 5 at 2:30 PM: Next occurrence (solid border)
# - Aug 6+ at 9:00 AM: Pattern instances (dashed border)
```

### Drag and Drop Behavior

#### Dragging Next Scheduled Occurrence (Solid Border)

- **Updates**: Only the `scheduled` field
- **Effect**: Reschedules just that specific occurrence  
- **Pattern**: Remains unchanged
- **Use case**: "I need to do today's workout at 2 PM instead of 9 AM"

#### Dragging Pattern Instances (Dashed Border)  

- **Updates**: DTSTART time in the recurrence rule
- **Effect**: Changes when all future pattern instances appear
- **Next occurrence**: Remains independently scheduled
- **Use case**: "I want to change my daily workout from 9 AM to 2 PM going forward"

### Completion Tracking

#### Individual Instance Completion
Each occurrence can be completed independently through:
- Task cards (completes for current date)
- Calendar context menu (completes for specific date)
- Task edit modal completion calendar

Completed instances are stored in the `complete_instances` array:
```yaml
complete_instances: ["2025-08-04", "2025-08-06", "2025-08-08"]
```

#### Automatic Scheduled Date Updates

When completing occurrences:
- The `scheduled` field automatically updates to the next uncompleted occurrence
- Uses UTC anchor principle for consistent timezone handling
- Skips already completed dates when calculating the next occurrence

### Flexible Scheduling

#### Next Occurrence Independence

The next scheduled occurrence can be set to any date, including:
- **Before DTSTART**: Schedule the next occurrence before the pattern officially begins
- **Outside pattern**: Schedule Tuesday's occurrence for a weekly Monday pattern  
- **Different time**: Next occurrence at 2 PM while pattern instances remain at 9 AM
- **Far future**: Schedule weeks ahead while pattern continues normally

#### Examples of Flexible Scheduling

**Example 1: Early Start**
```yaml
recurrence: "DTSTART:20250810T090000Z;FREQ=WEEKLY;BYDAY=MO"  # Mondays at 9 AM
scheduled: "2025-08-07T14:00"  # Next occurrence on preceding Thursday
```
Shows next occurrence Thursday 2 PM, pattern instances on Mondays 9 AM.

**Example 2: Off-Pattern Day**
```yaml
recurrence: "DTSTART:20250804T090000Z;FREQ=WEEKLY;BYDAY=MO"  # Mondays at 9 AM  
scheduled: "2025-08-06T15:30"  # Next occurrence on Wednesday
```
Shows next occurrence Wednesday 3:30 PM, pattern instances on Mondays 9 AM.

### Completion Calendar

The task edit modal includes a completion calendar for recurring tasks:
- Click any date to toggle completion status for that specific occurrence
- Changing completions automatically updates the scheduled date to the next uncompleted occurrence
- Visual indicators show which dates are part of the recurring pattern vs completed

### Timezone Handling

All recurring task logic uses the UTC Anchor principle:
- Pattern generation uses UTC dates for consistency
- DTSTART dates are interpreted as UTC anchors
- Display adapts to user's local timezone
- Prevents off-by-one date errors across timezone boundaries

### Backward Compatibility

TaskNotes maintains full backward compatibility:
- **Legacy RRule strings** without DTSTART continue to work using scheduled date as anchor
- **Legacy recurrence objects** are automatically converted to RRule format
- **Existing tasks** gain new functionality without requiring migration
- **Mixed formats** are handled transparently

### Advanced Configuration

#### Custom Recurrence Modal

Access advanced options through the custom recurrence modal:
- **Start date picker**: Set the DTSTART date
- **Start time picker**: Set the DTSTART time (optional)
- **Frequency options**: Daily, weekly, monthly, yearly
- **Advanced patterns**: Complex RRule configurations
- **End conditions**: Until date, count limits, or never-ending

#### Time Independence

Pattern time (DTSTART) and next occurrence time (scheduled) are completely independent:
- Pattern instances can appear at 9 AM while next occurrence is at 2 PM
- Dragging pattern instances changes the pattern time for all future instances
- Dragging next occurrence only affects that specific instance
- Users have complete control over both timing aspects

## Task Reminders

TaskNotes provides a reminder system that allows you to set notifications for your tasks. The reminder system uses the iCalendar VALARM specification and supports both relative reminders (based on due or scheduled dates) and absolute reminders (specific date and time).

### Reminder Types

#### Relative Reminders

Relative reminders are triggered relative to a task's due date or scheduled date. These are useful for consistent notification patterns across different tasks.

**Examples:**
- 15 minutes before due date
- 1 hour before scheduled date
- 2 days before due date
- 30 minutes after scheduled date

#### Absolute Reminders

Absolute reminders are triggered at a specific date and time, regardless of the task's due or scheduled dates. These are useful for time-sensitive notifications or follow-up actions.

**Examples:**

- October 26, 2025 at 9:00 AM
- Tomorrow at 2:30 PM
- Next Monday at 10:00 AM

### Setting Up Reminders

#### Adding Reminders to Tasks

You can add reminders to tasks through several methods:

1. **Task Creation Modal**: When creating a new task, use the reminder field to access the reminder interface
2. **Task Edit Modal**: Edit existing tasks and manage their reminders
3. **Task Cards**: Click the bell icon on any task card to access quick reminder options
4. **Context Menu**: Right-click the reminder field for quick access to common options

#### Quick Reminder Options

The reminder context menu provides quick access to common reminder patterns:

**Before Due Date:**
- 5 minutes before
- 15 minutes before  
- 1 hour before
- 1 day before

**Before Scheduled Date:**
- 5 minutes before
- 15 minutes before
- 1 hour before  
- 1 day before

These quick options are only available when the task has the corresponding due or scheduled date set.

#### Reminder Modal

For advanced reminder management, use the Reminder Modal which provides:

- **Form-based reminder creation** with validation and real-time preview
- **Multiple reminder management** for complex notification needs
- **Custom descriptions** for personalized reminder messages
- **Visual indicators** showing task context (due date, scheduled date)
- **Editing and deletion** of existing reminders

### Reminder Data Format

Reminders are stored in the task's YAML frontmatter as an array using the following format:

#### Relative Reminder Structure

```yaml
reminders:
  - id: "rem_1678886400000_abc123xyz"
    type: "relative"
    relatedTo: "due"
    offset: "-PT15M"
    description: "Review task details"
```

#### Absolute Reminder Structure

```yaml
reminders:
  - id: "rem_1678886400001_def456uvw"
    type: "absolute" 
    absoluteTime: "2025-10-26T09:00:00"
    description: "Follow up with client"
```

#### Field Descriptions

- **id**: Unique identifier for UI management and updates
- **type**: Either "relative" or "absolute"
- **relatedTo** (relative only): Anchor date - either "due" or "scheduled"
- **offset** (relative only): ISO 8601 duration format (negative for before, positive for after)
- **absoluteTime** (absolute only): Full ISO 8601 timestamp
- **description** (optional): Custom notification message

### Visual Indicators

#### Task Card Bell Icons

Tasks with reminders display a bell icon on their task cards:
- **Solid bell**: Task has active reminders
- **Clickable**: Opens the reminder context menu for quick management
- **Positioned**: Properly spaced with other task indicators (priority, status, etc.)

#### Reminder Context Information

When managing reminders, the interface displays relevant task context:
- Current due date (if set)
- Current scheduled date (if set)
- Existing reminders count
- Task title for reference

### Default Reminders

TaskNotes supports configuring default reminders that automatically apply to new tasks. This feature eliminates the need to manually add common reminders to every task.

#### Configuring Default Reminders

Default reminders are configured in the TaskNotes settings under "Task Creation Defaults":

1. Navigate to Settings → TaskNotes → Task Defaults
2. Scroll to the "Default Reminders" section
3. Use the form to add new default reminders
4. Specify reminder type, timing, and optional descriptions

#### Default Reminder Application

Default reminders automatically apply to:

- **Manual task creation** through the task creation modal
- **Instant conversion** of existing content to tasks
- **Natural language task creation** using the parser

#### Default Reminder Examples

Common default reminder configurations:

- 15 minutes before due date (for all tasks with due dates)
- 1 hour before scheduled date (for time-sensitive tasks) 
- 1 day before due date (for project deadlines)
- Custom absolute reminders for recurring processes

### Integration with Task Workflows

#### Task Creation Integration

Reminders integrate with all task creation workflows:

- Default reminders apply automatically during creation
- Additional reminders can be added during the creation process

#### Task Editing Integration

The task editing process provides full reminder management:

- View all existing reminders
- Add, edit, or remove individual reminders
- Quick access through context menus
- Real-time validation and preview

#### Calendar View Integration

Reminders work alongside calendar features:

- Visual reminder indicators on task cards in calendar views
- Quick reminder management through calendar context menus
- Compatibility with drag-and-drop scheduling

### Field Mapping Support

The reminder system integrates with TaskNotes' field mapping functionality:

- **Custom Property Names**: Map reminders to custom frontmatter property names
- **Vault Compatibility**: Adapt to existing vault structures and naming conventions
- **Migration Support**: Maintain compatibility when changing field mappings

### Technical Implementation

#### iCalendar VALARM Compliance

TaskNotes reminder implementation follows the iCalendar VALARM specification:
- Standard duration formats (ISO 8601)
- Proper trigger mechanisms for relative and absolute reminders
- Compatible data structures for interoperability

#### Performance Considerations

The reminder system is designed for efficiency:
- Lazy loading of reminder data
- Minimal impact on task loading performance
- Efficient storage in YAML frontmatter format
