# ChronoSync for Obsidian

ChronoSync is a comprehensive diary, task, note, and time management plugin for Obsidian. It integrates calendar views, task management, daily notes, and timeblocking into a seamless workflow.

## Features

- **Enhanced Daily Notes**
  - Automatic creation and navigation to daily notes
  - YAML frontmatter for daily metadata (pomodoros, workout, meditate, tags, important)
  - Integrated timeblock section within daily notes

- **Advanced Task Management**
  - Tasks as individual Markdown notes with rich YAML frontmatter
  - Task properties: title, due date, priority, status, contexts, tags, recurrence, details
  - Dedicated task views and filtering

- **Calendar Views**
  - Month, Week, and Year views integrated into the Obsidian workspace
  - Visual cues on calendar dates for entries, due tasks, and metadata
  - Easy navigation to daily notes

- **Timeblocking**
  - Structured timeblock tables in daily notes
  - Easy creation and editing of timeblocks
  - Configurable time intervals and ranges

- **Flexible Layouts**
  - Side-by-side view (Calendar/List on one side, File Preview/Editor on the other)
  - Tabbed interface for switching between tasks, notes, and timeblocks

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings
2. Go to Community Plugins and turn off Safe Mode
3. Click Browse and search for "ChronoSync"
4. Install the plugin and enable it

### Manual Installation

1. Download the latest release from the GitHub releases page
2. Extract the files to your Obsidian vault's plugins folder: `<vault>/.obsidian/plugins/chronosync/`
3. Reload Obsidian
4. Go to Settings > Community Plugins and enable "ChronoSync"

## Usage

### Getting Started

1. After installation, click the calendar icon in the ribbon to open the ChronoSync dashboard
2. Configure the plugin settings in Settings > ChronoSync
3. Create your first task or navigate to today's daily note

### Commands

ChronoSync adds several commands to Obsidian's command palette:

- **Open Dashboard/Calendar View**: Opens the main ChronoSync dashboard
- **Create New Task**: Opens a modal to create a new task
- **Go to Today's Note**: Navigates to or creates today's daily note
- **Open Home Note**: Navigates to or creates your home note
- **Increment Daily Pomodoros**: Adds 1 to the pomodoro count in today's note
- **Toggle Daily Workout**: Toggles the workout flag in today's note
- **Toggle Daily Meditation**: Toggles the meditation flag in today's note
- **Toggle Daily Important Flag**: Toggles the important flag in today's note

### Folder Structure

ChronoSync uses the following folder structure by default (configurable in settings):

- `ChronoSync/Daily/`: Daily notes (YYYY-MM-DD.md)
- `ChronoSync/Tasks/`: Task files
- `ChronoSync/Notes/`: General notes
- `ChronoSync/Home.md`: Home note

## Configuration

In the plugin settings, you can configure:

- Folder paths for daily notes, tasks, and general notes
- Default task properties (priority, status)
- Timeblock settings (start/end times, interval)
- Indexing options

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
