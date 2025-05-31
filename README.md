# TaskNotes for Obsidian

TaskNotes is a comprehensive task and note management plugin for Obsidian with integrated calendar views and daily notes.

## Why TaskNotes?

With the introduction of Obsidian's new Bases core plugin, structured YAML frontmatter has become a standard way to manage data in Obsidian. TaskNotes uses YAML metadata extensively to store task properties, daily note information, and time tracking data. This means all your tasks and notes remain as plain Markdown files with structured frontmatter that can be queried and viewed in Bases tables.

TaskNotes focuses on time-based organization and task management, storing all data as YAML properties. While Bases provides database views of your notes, TaskNotes handles the day-to-day workflow of creating tasks, tracking time, managing recurring items, and organizing your daily activities. The structured data TaskNotes creates can then be analyzed and visualized using Bases or other data query tools.

## Features

### Task Management
- Tasks stored as individual Markdown files with YAML frontmatter
- Task properties include: title, status, priority, due date, contexts, tags, time estimates, and time tracking data
- Support for recurring tasks (daily, weekly, monthly, yearly) with completion instance tracking
- Built-in time tracking with multiple sessions per task
- Archive functionality using tags to hide completed tasks while preserving history
- Task filtering by status, context, due date, and grouping options

### Calendar Integration
- Month view with agenda display showing tasks and notes
- Visual indicators for daily notes and due tasks
- Keyboard navigation and date selection synchronized across all views
- Color coding based on priority, note presence, or daily activities

### Daily Notes
- Automatic creation with configurable templates
- YAML frontmatter tracking: date, tags, important flag

### Time Management
- Integrated time tracking for tasks with start/stop functionality
- Time entries stored in YAML with timestamps and durations
- Time estimates vs actual time spent comparison
- Multiple tracking sessions per task with descriptions

### Views and Layouts
- **Grid Layout**: Side-by-side views with calendar/list on one side, file preview on the other
- **Tabs Layout**: All views (Calendar, Tasks, Notes) as switchable tabs
- **Popout Windows**: Desktop support for detaching views into separate windows
- Synchronized date selection across all views

### Notes Organization
- Separate notes view for non-task files
- Date-based filtering to show notes created on specific days
- Configurable folder exclusions
- Integration with calendar for date-specific note viewing

### Data Structure
All data is stored as YAML frontmatter in Markdown files, making it:
- Compatible with Obsidian's Bases plugin for database views
- Searchable and queryable using Dataview or similar tools
- Portable and future-proof as plain text files
- Version control friendly

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings
2. Go to Community Plugins and turn off Safe Mode
3. Click Browse and search for "TaskNotes"
4. Install the plugin and enable it

### Manual Installation

1. Download the latest release from the GitHub releases page
2. Extract the files to your Obsidian vault's plugins folder: `<vault>/.obsidian/plugins/tasknotes/`
3. Reload Obsidian
4. Go to Settings > Community Plugins and enable "TaskNotes"

## Usage

### Getting Started

1. After installation, click the calendar icon in the ribbon to open the TaskNotes dashboard
2. Configure the plugin settings in Settings > TaskNotes
3. Create your first task or navigate to today's daily note

### Task Management and Interaction

TaskNotes provides intuitive controls to interact with your tasks directly from the task list view:

- Change a task's status (Open, In Progress, Done) using the status dropdown
- Adjust task priority (High, Normal, Low) using the priority dropdown
- Set or change due dates using the date picker
- Click on a task's title to open it for detailed editing

### Task Archiving

TaskNotes allows you to archive tasks to keep your task list clean while preserving task history:

- To archive a task, click the "Archive" button in the task controls
- Archived tasks are tagged with the "archive" tag in their YAML frontmatter
- Archived tasks are hidden from regular task views and only appear when "Archived" is selected from the status filter
- Archived tasks still appear in the calendar heatmap for historical reference
- To unarchive a task, select "Archived" from the status filter and click the "Unarchive" button on the task

### Commands

TaskNotes adds several commands to Obsidian's command palette:

- **Open Dashboard/Calendar View**: Opens the main TaskNotes dashboard
- **Create New Task**: Opens a modal to create a new task
- **Go to Today's Note**: Navigates to or creates today's daily note

### Folder Structure

TaskNotes uses the following folder structure by default (configurable in settings):

- `TaskNotes/Daily/`: Daily notes (YYYY-MM-DD.md)
- `TaskNotes/Tasks/`: Task files
- `TaskNotes/Notes/`: General notes
- `TaskNotes/Home.md`: Home note

## YAML Structure Examples

### Task File
```yaml
title: "Complete project documentation"
zettelid: "20240115a8f3"
dateCreated: "2024-01-15T10:30:00"
dateModified: "2024-01-15T14:45:00"
status: "in-progress"
due: "2024-01-20"
tags: ["task", "documentation"]
priority: "high"
contexts: ["work", "writing"]
timeEstimate: 120
timeSpent: 45
timeEntries:
  - startTime: "2024-01-15T10:30:00"
    endTime: "2024-01-15T11:15:00"
    duration: 45
    description: "Initial outline"
```

### Daily Note
```yaml
date: "2024-01-15"
tags: ["daily"]
important: false
```

### Recurring Task
```yaml
title: "Weekly team meeting"
status: "open"
tags: ["task", "meetings"]
recurrence:
  frequency: "weekly"
  days_of_week: ["mon"]
complete_instances: ["2024-01-08", "2024-01-15"]
```

## Configuration

In the plugin settings, you can configure:

- Folder paths for daily notes, tasks, and general notes
- Default task properties (priority, status)
- Task identification tag (default: "task")
- Archive tag (default: "archive")
- Excluded folders for notes view

## Development

### Prerequisites

- [NodeJS](https://nodejs.org/) v16 or later
- [npm](https://www.npmjs.com/)

### Setup

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start the development build process

### Building

- `npm run dev`: Builds the plugin and watches for changes
- `npm run build`: Builds the plugin for production

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Inspired by `diary-tui` by Callum Alpass
- Built with the [Obsidian API](https://github.com/obsidianmd/obsidian-api)
