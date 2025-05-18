## Obsidian Plugin Specification: "Chronosync" (or "Zenith Planner")

**Plugin Name Ideas:** Chronosync, Zenith Planner, Obsidian Task & Time Weaver, Daily Flow

**Author:** Callum Alpass

**Version:** 0.1.0 (Initial Release)

**Minimum Obsidian Version:** (To be determined based on API usage, likely 1.0.0+)

**Inspired By:** `diary-tui` by Callum Alpass

**1. Overview & Goal:**

Chronosync aims to integrate comprehensive diary, task, note, and time management directly within Obsidian, leveraging Obsidian's strengths in linking and Markdown. It will provide calendar views, robust task management with YAML frontmatter, daily timeblocking, and organized note-taking, mirroring the key functionalities of the `diary-tui` command-line application. The plugin will focus on enhancing daily planning, task tracking, and reflective journaling.

**2. Core Features:**

* **Enhanced Daily Notes:**
    * Automatic creation/navigation to daily notes.
    * YAML frontmatter for daily metadata (e.g., `pomodoros`, `workout`, `meditate`, `tags`, `important`).
    * Integrated Timeblock section within daily notes.
* **Advanced Task Management:**
    * Tasks as individual Markdown notes with rich YAML frontmatter.
    * Task properties: title, due date, priority, status, contexts, tags, recurrence, details.
    * Dedicated Task views and filtering.
* **Note Organization:**
    * View non-task notes associated with specific dates (based on `dateCreated` or a custom field).
    * Easy internal linking and navigation.
* **Calendar Views:**
    * Month, Week, and Year views integrated into the Obsidian workspace.
    * Visual cues on calendar dates for entries, due tasks, and metadata.
* **Flexible Layouts:**
    * Side-by-side view (Calendar/List on one side, File Preview/Editor on the other).
    * Full-pane views for focused work.
* **Data Integrity & Performance:**
    * Efficient indexing and caching of task/note metadata.
    * Robust YAML parsing and updating.

**3. User Interface (UI) & Interaction:**

* **Ribbon Icon:**
    * An icon to open a primary Chronosync view (e.g., a dashboard showing calendar and upcoming tasks).
* **Command Palette Commands:**
    * `Chronosync: Open Dashboard/Calendar View`
    * `Chronosync: Create New Task`
    * `Chronosync: Go to Today's Note`
    * `Chronosync: Open Home Note`
    * `Chronosync: Search Diary/Notes`
    * `Chronosync: Filter Tasks by Context`
    * `Chronosync: Toggle Daily Metadata (Meditate, Workout, Important)`
    * `Chronosync: Increment Daily Pomodoros`
    * `Chronosync: Show Weekly/Monthly Stats`
    * `Chronosync: Re-index Tasks & Notes`
* **Custom Views/Panes (as new Obsidian View Types):**
    * **Calendar View:**
        * Switchable between Month, Week, Year.
        * Clicking a date navigates to the daily note or shows a summary.
        * Visual indicators on dates (dots/icons) for:
            * Existing daily note.
            * Tasks due.
            * Specific metadata (e.g., 'important' tag).
    * **Task List View:**
        * Displays all tasks, filterable by status (open, in-progress, done, all, archive), context, due date, priority.
        * Sortable by due date, priority, title.
        * Clicking a task opens it in the editor or a preview pane.
        * Context menu/buttons for actions: toggle status, change priority, edit, delete, archive.
    * **Notes View:**
        * Displays non-task notes, filterable by date created (matching selected calendar date) or tags.
        * Clicking a note opens it.
    * **File Preview Pane:**
        * When a task or note is selected in a list view, its content is previewed (similar to Obsidian's linked pane).
* **Modals:**
    * **Task Creation Modal:**
        * Fields: Title (required), Details (Markdown), Due Date (date picker), Priority (dropdown: low, normal, high), Context Tags (comma-separated text input), Extra Tags (comma-separated text input), Recurrence Frequency (dropdown: none, daily, weekly, monthly, yearly), Day of Month (text input, visible if monthly/yearly), Days of Week (checkboxes, visible if weekly).
        * Input validation for dates and required fields.
        * Confirmation step before creating the task file.
    * **Quick Add Note Modal (for daily notes):**
        * Simple text input to append a timestamped note to the current daily note.
    * **Timeblock Entry Modal:**
        * Input for activity for a selected time slot in the daily note's timeblock.
    * **Search/Filter Modals:**
        * Input fields for search queries, tag filters, context filters.
    * **Confirmation Dialogs:** For deletions, etc.
* **Settings Tab:**
    * Configure folder paths (Daily Notes, Tasks, General Notes, Home Note).
    * Default task properties.
    * Editor preferences (though Obsidian's internal editor will be primary).
    * Timeblock template settings.
    * Indexing options (e.g., auto-reindex frequency).
    * Appearance settings for calendar indicators.

**4. Data Management & Storage:**

* **Folders:**
    * `Daily Notes Folder`: (User-configurable, e.g., `Chronosync/Daily/`) - Files named `YYYY-MM-DD.md`.
    * `Tasks Folder`: (User-configurable, e.g., `Chronosync/Tasks/`) - Task files.
    * `Notes Folder`: (User-configurable, e.g., `Chronosync/Notes/` or root) - For general notes.
    * `Home Note Path`: (User-configurable, e.g., `Chronosync/Home.md`).
* **File Naming for Tasks:**
    * `YYYYMMDD<random_suffix>.md` (e.g., `250323abc.md`) to ensure uniqueness and sortability by creation.
* **YAML Frontmatter (Daily Notes):**
    * `date: YYYY-MM-DD`
    * `pomodoros: number`
    * `workout: boolean`
    * `meditate: boolean`
    * `tags: [tag1, tag2]`
    * `important: boolean` (or could be a tag)
    * (Other user-defined metadata)
* **YAML Frontmatter (Task Notes):**
    * `title: "Task Title"`
    * `zettelid: "YYYYMMDD<random_suffix>"` (matches filename base)
    * `dateCreated: "YYYY-MM-DDTHH:MM:SS"`
    * `dateModified: "YYYY-MM-DDTHH:MM:SS"`
    * `status: "open" | "in-progress" | "done"`
    * `due: "YYYY-MM-DD"` (optional)
    * `tags: ["task", "extra_tag1", "archive"]` (always includes "task")
    * `priority: "low" | "normal" | "high"`
    * `contexts: ["context1", "context2"]` (optional)
    * `recurrence:` (optional object)
        * `frequency: "daily" | "weekly" | "monthly" | "yearly"`
        * `days_of_week: ["mon", "tue"]` (if weekly)
        * `day_of_month: number` (if monthly/yearly)
    * `complete_instances: ["YYYY-MM-DD", "YYYY-MM-DD"]` (for recurring tasks)
* **YAML Frontmatter (General Notes):**
    * `title: "Note Title"`
    * `dateCreated: "YYYY-MM-DDTHH:MM:SS"`
    * `dateModified: "YYYY-MM-DDTHH:MM:SS"`
    * `tags: [tag1, tag2]`
* **Timeblocks:**
    * Stored as a Markdown table within the body of daily notes (e.g., under a `## Timeblock` heading).
    * Structure: `| Time | Activity |`
    * Default template will be configurable.
* **Indexing:**
    * An `index_state.json` file (similar to `diary-tui`) in the plugin's data directory (`.obsidian/plugins/chronosync/data/`) to store file modification times/hashes for efficient re-indexing.
    * Background process for indexing tasks and notes.

**5. Key Functionalities (Detailed):**

* **Daily Note Enhancement:**
    * On plugin load or daily, check/create today's note.
    * Commands to toggle boolean metadata (`workout`, `meditate`, `important`) and increment `pomodoros` in the current daily note's frontmatter.
    * Command to add a default timeblock table to the daily note if not present.
    * Ability to edit timeblock entries directly in the Markdown table or via a modal.
* **Task Creation & Management:**
    * **Creation:** Via Modal. File saved to Tasks Folder.
    * **Status Toggle:** `open` -> `in-progress` -> `done` -> `open`. For recurring tasks, marks the current instance as complete in `complete_instances` if due today.
    * **Priority Cycle:** `low` -> `normal` -> `high` -> `low`.
    * **Recurrence:**
        * When a recurring task instance is marked "done" for the `current_date`, add `YYYY-MM-DD` to `complete_instances`.
        * Task list will show recurring tasks as "open" if they are due for the `current_date` and not in `complete_instances`.
    * **Editing:** Opens the task note in Obsidian editor.
    * **Deletion:** Deletes the task file (with confirmation).
    * **Archiving:** Adds/removes an "archive" tag in the task's frontmatter. Archived tasks are hidden by default but viewable with a filter.
* **Note Listing (Non-Task):**
    * In Notes View, list all notes from the `Notes Folder` (or entire vault, configurable) where `dateCreated` matches the selected calendar date. Exclude notes tagged "task".
* **Calendar Views:**
    * Render calendar. Highlight today's date. Highlight selected date.
    * Mark dates with existing daily notes.
    * Mark dates with tasks due (color-coded by highest priority if multiple tasks).
    * Mark dates if the daily note has `important: true` or a specific "important" tag.
* **Search & Filtering:**
    * **Global Search:** Input query, search content of all diary and note files. Results update calendar highlighting and can be navigated.
    * **Tag Filter (Diary):** Input tag, filter daily notes. Updates calendar.
    * **Context Filter (Tasks):** Input context, filter task list.
* **Stats:**
    * Commands to show a modal with weekly/monthly stats (pomodoros, workouts, meditation days) aggregated from daily note frontmatter.

**6. Configuration Options (Settings Tab):**

* **General:**
    * `Daily Notes Folder Path` (text input, default: `Chronosync/Daily`)
    * `Tasks Folder Path` (text input, default: `Chronosync/Tasks`)
    * `General Notes Folder Path` (text input, default: `/` for vault root, or e.g., `Chronosync/Notes`)
    * `Home Note Path` (text input, default: `Chronosync/Home.md`)
* **Tasks:**
    * `Default Task Priority` (dropdown: low, normal, high)
    * `Default Task Status` (dropdown: open)
* **Timeblocks:**
    * `Default Timeblock Start Time` (e.g., "05:00")
    * `Default Timeblock End Time` (e.g., "23:30")
    * `Timeblock Interval` (dropdown: 30 minutes, 1 hour)
    * `Automatically add Timeblock to new Daily Notes` (toggle)
* **Appearance:**
    * `Calendar: Daily Note Indicator` (e.g., dot color, icon)
    * `Calendar: Task Due Indicator` (e.g., dot color, icon - potentially different for priorities)
    * `Calendar: Important Day Indicator` (e.g., dot color, icon)
* **Indexing:**
    * `Enable Background Indexing` (toggle, default: true)
    * `Re-index on Startup` (toggle, default: true)

**7. Dependencies & Potential Integrations:**

* **Dataview Plugin (Optional but Recommended):** Could be leveraged for advanced querying and dynamic list generation, potentially simplifying some custom view logic if the user has it installed. The plugin should aim to function without it for core features.
* **Obsidian Tasks Plugin (Potential Integration):** For task rendering and potentially some actions, explore compatibility or an option to use its format/queries if available. This would be a more advanced integration.
* **Calendar Plugin (Potential Integration):** Check if existing calendar plugins offer APIs that could be used or if this plugin's calendar should remain standalone.
* **Moment.js (Bundled with Obsidian):** For date/time manipulations.

**8. Future Enhancements (Post v0.1.0):**

* More sophisticated recurrence options (e.g., "every 2nd Tuesday").
* Kanban board view for tasks.
* Gantt chart view for tasks with durations.
* Directly link tasks to timeblock slots.
* Notifications/reminders for due tasks (if Obsidian API allows).
* Habit tracking features integrated with daily notes.
* Customizable dashboard view.
* Mobile compatibility improvements.
* Templating support for new tasks/notes beyond frontmatter.

**9. Technical Considerations:**

* **Performance:** Efficient file reading and YAML parsing is critical. Caching metadata and diff-based indexing (checking mod times/hashes) will be essential.
* **API Usage:** Rely on stable Obsidian API features.
* **Error Handling:** Graceful handling of missing files, malformed YAML, and other potential issues.
* **State Management:** Carefully manage the state of selected dates, filters, scroll positions, etc.

This spec should give you a solid blueprint, Callum. Given you wrote the original TUI, you'll have a great head start on the logic! Good luck with the development if you decide to pursue it!

