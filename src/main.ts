import { Notice, Plugin, TFile, WorkspaceLeaf, normalizePath, Platform } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import { 
	ChronoSyncSettings, 
	DEFAULT_SETTINGS, 
	ChronoSyncSettingTab 
} from './settings/settings';
import { 
	CALENDAR_VIEW_TYPE, 
	NOTES_VIEW_TYPE, 
	TASK_LIST_VIEW_TYPE,
	TimeInfo,
	TaskInfo,
	EVENT_DATE_SELECTED,
	EVENT_TAB_CHANGED,
	EVENT_DATA_CHANGED,
	EVENT_TASK_UPDATED
} from './types';
import { CalendarView } from './views/CalendarView';
import { TaskListView } from './views/TaskListView';
import { NotesView } from './views/NotesView';
import { TaskCreationModal } from './modals/TaskCreationModal';
import { 
	ensureFolderExists, 
	generateDailyNoteTemplate,
	parseTime,
	updateYamlFrontmatter,
	extractTaskInfo
} from './utils/helpers';
import { EventEmitter } from './utils/EventEmitter';
import { FileIndexer } from './utils/FileIndexer';
import { YAMLCache } from './utils/YAMLCache';

export default class ChronoSyncPlugin extends Plugin {
	settings: ChronoSyncSettings;
	
	// Shared state between views
	selectedDate: Date = new Date();
	
	// Event emitter for view communication
	emitter = new EventEmitter();
	
	// File indexer for efficient file access
	fileIndexer: FileIndexer;
	
	async onload() {
		await this.loadSettings();
		
		// Initialize the file indexer
		this.fileIndexer = new FileIndexer(
			this.app.vault, 
			this.settings.taskTag,
			this.settings.excludedFolders,
			this.settings.dailyNotesFolder
		);

		// Register view types
		this.registerView(
			CALENDAR_VIEW_TYPE,
			(leaf) => new CalendarView(leaf, this)
		);
		this.registerView(
			TASK_LIST_VIEW_TYPE,
			(leaf) => new TaskListView(leaf, this)
		);
		this.registerView(
			NOTES_VIEW_TYPE,
			(leaf) => new NotesView(leaf, this)
		);
		
		// Add ribbon icon
		this.addRibbonIcon('calendar-days', 'ChronoSync', async () => {
			await this.activateLinkedViews();
		});
		
		// Add ribbon icon for a side-by-side layout
		this.addRibbonIcon('layout-grid', 'ChronoSync Grid Layout', async () => {
			await this.createGridLayout();
		});
		
		// Add ribbon icon for a tabs layout
		this.addRibbonIcon('layout-tabs', 'ChronoSync Tabs Layout', async () => {
			await this.createTabsLayout();
		});

		// Add commands
		this.addCommands();

		// Add settings tab
		this.addSettingTab(new ChronoSyncSettingTab(this.app, this));
	}
	
	// Methods for updating shared state and emitting events
	
	/**
	 * Update the selected date and notify all views
	 */
	setSelectedDate(date: Date): void {
		this.selectedDate = date;
		this.emitter.emit(EVENT_DATE_SELECTED, date);
	}
	
	/**
	 * Notify views that data has changed and views should refresh
	 * @param filePath Optional path of the file that changed (for targeted cache invalidation)
	 * @param force Whether to force a full cache rebuild
	 * @param triggerRefresh Whether to trigger a full UI refresh (default true)
	 */
	notifyDataChanged(filePath?: string, force: boolean = false, triggerRefresh: boolean = true): void {
		// If we know which file changed, clear its cached info specifically
		if (filePath) {
			// Clear file index cache
			if (this.fileIndexer) {
				// Clear specific file's cache
				this.fileIndexer.clearCachedInfo(filePath);
				
				// If force is true, rebuild the entire cache
				if (force) {
					this.fileIndexer.rebuildIndex();
				}
			}
			
			// Clear YAML parsing cache
			YAMLCache.clearCacheEntry(filePath);
		} else if (force && this.fileIndexer) {
			// If force is true and no specific file, rebuild the entire cache
			this.fileIndexer.rebuildIndex();
		}
		
		// Only emit refresh event if triggerRefresh is true
		if (triggerRefresh) {
			// Use a short delay before notifying to allow UI changes to be visible
			setTimeout(() => {
				this.emitter.emit(EVENT_DATA_CHANGED);
			}, 100);
		}
	}

	onunload() {
		// Properly detach all the views created by this plugin
		const { workspace } = this.app;
		
		// Detach all leaves of the view types we registered
		workspace.detachLeavesOfType(CALENDAR_VIEW_TYPE);
		workspace.detachLeavesOfType(TASK_LIST_VIEW_TYPE);
		workspace.detachLeavesOfType(NOTES_VIEW_TYPE);
		
		// Clean up the file indexer
		if (this.fileIndexer) {
			this.fileIndexer.destroy();
		}
		
		// Clean up the event emitter
		this.emitter.removeAllListeners();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		// Update the file indexer with new settings if relevant
		if (this.fileIndexer) {
			// Properly destroy the old indexer first
			this.fileIndexer.destroy();
			
			// Create a new indexer with updated settings
			this.fileIndexer = new FileIndexer(
				this.app.vault, 
				this.settings.taskTag,
				this.settings.excludedFolders,
				this.settings.dailyNotesFolder
			);
		}
		
		// If settings have changed, notify views to refresh their data
		this.notifyDataChanged();
	}

	addCommands() {
		// View commands
		this.addCommand({
			id: 'open-calendar-view',
			name: 'Open calendar view',
			callback: async () => {
				await this.activateCalendarView();
			}
		});
		
		this.addCommand({
			id: 'open-tasks-view',
			name: 'Open tasks view',
			callback: async () => {
				await this.activateTasksView();
			}
		});
		
		this.addCommand({
			id: 'open-notes-view',
			name: 'Open notes view',
			callback: async () => {
				await this.activateNotesView();
			}
		});
		
		this.addCommand({
			id: 'open-linked-views',
			name: 'Open calendar with task view',
			callback: async () => {
				await this.activateLinkedViews();
			}
		});
		
		this.addCommand({
			id: 'open-grid-layout',
			name: 'Open ChronoSync in grid layout',
			callback: async () => {
				await this.createGridLayout();
			}
		});
		
		this.addCommand({
			id: 'open-tabs-layout',
			name: 'Open ChronoSync in tabs layout',
			callback: async () => {
				await this.createTabsLayout();
			}
		});
		
		// Popout window commands (desktop only)
		if (this.app.workspace.openPopoutLeaf !== undefined) {
			this.addCommand({
				id: 'open-calendar-popout',
				name: 'Open calendar in new window',
				callback: async () => {
					await this.openViewInPopout(CALENDAR_VIEW_TYPE);
				}
			});
			
			this.addCommand({
				id: 'open-tasks-popout',
				name: 'Open tasks in new window',
				callback: async () => {
					await this.openViewInPopout(TASK_LIST_VIEW_TYPE);
				}
			});
			
			this.addCommand({
				id: 'open-notes-popout',
				name: 'Open notes in new window',
				callback: async () => {
					await this.openViewInPopout(NOTES_VIEW_TYPE);
				}
			});
		}

		// Task commands
		this.addCommand({
			id: 'create-new-task',
			name: 'Create new task',
			callback: () => {
				this.openTaskCreationModal();
			}
		});

		// Note commands
		this.addCommand({
			id: 'go-to-today',
			name: 'Go to today\'s note',
			callback: async () => {
				await this.navigateToCurrentDailyNote();
			}
		});

		// Daily note metadata commands
		this.addCommand({
			id: 'increment-pomodoros',
			name: 'Increment daily pomodoros',
			callback: async () => {
				await this.incrementPomodoros();
			}
		});

		this.addCommand({
			id: 'toggle-workout',
			name: 'Toggle daily workout',
			callback: async () => {
				await this.toggleDailyMetadata('workout');
			}
		});

		this.addCommand({
			id: 'toggle-meditate',
			name: 'Toggle daily meditation',
			callback: async () => {
				await this.toggleDailyMetadata('meditate');
			}
		});
	}

	// Helper method to create or activate a view of specific type
	async activateView(viewType: string) {
		const { workspace } = this.app;
		
		// Use existing view if it exists
		let leaf = this.getLeafOfType(viewType);
		
		if (!leaf) {
			// Simple approach - create a new tab
			// This is more reliable for tab behavior
			leaf = workspace.getLeaf('tab');
			
			// Set the view state for this leaf
			await leaf.setViewState({
				type: viewType,
				active: true,
			});
		}
		
		// Make this leaf active and ensure it's visible
		workspace.setActiveLeaf(leaf, { focus: true });
		workspace.revealLeaf(leaf);
		
		return leaf;
	}
	
	async activateCalendarView() {
		return this.activateView(CALENDAR_VIEW_TYPE);
	}
	
	async activateTasksView() {
		return this.activateView(TASK_LIST_VIEW_TYPE);
	}
	
	async activateNotesView() {
		return this.activateView(NOTES_VIEW_TYPE);
	}
	
	// Open a view in a popout window
	async openViewInPopout(viewType: string) {
		const { workspace } = this.app;
		
		// Check if we're on desktop (mobile doesn't support popout windows)
		if (Platform.isMobile) {
			new Notice('Popout windows are only available on desktop');
			return;
		}
		
		try {
			// Create a new popout window
			const popoutLeaf = workspace.openPopoutLeaf({
				size: { width: 800, height: 600 }
			});
			
			// Set the view state for the popout leaf
			await popoutLeaf.setViewState({
				type: viewType,
				active: true
			});
			
			// Make the popout leaf active
			workspace.setActiveLeaf(popoutLeaf, { focus: true });
		} catch (error) {
			console.error('Error opening popout window:', error);
			new Notice('Failed to open view in new window');
		}
	}
	
	async activateLinkedViews() {
		const { workspace } = this.app;
		
		// Clear existing views first
		workspace.detachLeavesOfType(CALENDAR_VIEW_TYPE);
		workspace.detachLeavesOfType(TASK_LIST_VIEW_TYPE);
		workspace.detachLeavesOfType(NOTES_VIEW_TYPE);
		
		// Create a calendar view
		const calendarLeaf = workspace.getLeaf('tab');
		await calendarLeaf.setViewState({
			type: CALENDAR_VIEW_TYPE,
			active: true
		});
		
		// Create a tasks view in a new tab
		const tasksLeaf = workspace.getLeaf('tab');
		await tasksLeaf.setViewState({
			type: TASK_LIST_VIEW_TYPE
		});
		
		// Create a notes view in a new tab
		const notesLeaf = workspace.getLeaf('tab');
		await notesLeaf.setViewState({
			type: NOTES_VIEW_TYPE
		});
		
		// Group these leaves together for synchronized date selection
		const groupName = 'chronosync-views';
		calendarLeaf.setGroup(groupName);
		tasksLeaf.setGroup(groupName);
		notesLeaf.setGroup(groupName);
		
		// Make calendar the active view
		workspace.setActiveLeaf(calendarLeaf, { focus: true });
		
		new Notice('ChronoSync views created. You can drag and rearrange these tabs as needed.');
	}
	
	/**
	 * Creates a grid layout with calendar, tasks, and notes views arranged side by side
	 * This creates a more complete workspace layout that users can then customize
	 */
	async createGridLayout() {
		const { workspace } = this.app;
		
		// First, detach any existing views to start fresh
		workspace.detachLeavesOfType(CALENDAR_VIEW_TYPE);
		workspace.detachLeavesOfType(TASK_LIST_VIEW_TYPE);
		workspace.detachLeavesOfType(NOTES_VIEW_TYPE);
		
		// Create the main calendar view in the root split
		// First, get a leaf in the main workspace area (this should be a tab)
		let calendarLeaf = workspace.getLeaf('tab');
		await calendarLeaf.setViewState({
			type: CALENDAR_VIEW_TYPE,
			active: true
		});
		
		// Create the tasks view in a horizontal split below the calendar
		workspace.setActiveLeaf(calendarLeaf, { focus: true });
		const tasksLeaf = workspace.splitActiveLeaf('horizontal');
		await tasksLeaf.setViewState({
			type: TASK_LIST_VIEW_TYPE
		});
		
		// Create the notes view in a vertical split next to the calendar
		workspace.setActiveLeaf(calendarLeaf, { focus: true });
		const notesLeaf = workspace.splitActiveLeaf('vertical');
		await notesLeaf.setViewState({
			type: NOTES_VIEW_TYPE
		});
		
		// Group these leaves together
		const groupName = 'chronosync-grid';
		calendarLeaf.setGroup(groupName);
		tasksLeaf.setGroup(groupName);
		notesLeaf.setGroup(groupName);
		
		// Set calendar as active at the end
		workspace.setActiveLeaf(calendarLeaf, { focus: true });
		
		// Show a notice to let the user know they can rearrange the tabs
		new Notice('ChronoSync views created in grid layout. You can drag and rearrange these tabs freely.');
	}
	
	/**
	 * Creates a tabs-only layout with all views as tabs in the same container
	 * This provides better tab draggability as they're all native Obsidian tabs
	 */
	async createTabsLayout() {
		const { workspace } = this.app;
		
		// First, detach any existing views to start fresh
		workspace.detachLeavesOfType(CALENDAR_VIEW_TYPE);
		workspace.detachLeavesOfType(TASK_LIST_VIEW_TYPE);
		workspace.detachLeavesOfType(NOTES_VIEW_TYPE);
		
		// Create tabs for each view type in the main workspace
		const firstLeaf = workspace.getLeaf('tab');
		await firstLeaf.setViewState({
			type: CALENDAR_VIEW_TYPE,
			active: true
		});
		
		// We need to wait for the first tab to be created completely
		// before creating new tabs
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Create the second tab
		const secondLeaf = workspace.getLeaf('tab');
		await secondLeaf.setViewState({
			type: TASK_LIST_VIEW_TYPE,
		});
		
		// Wait again before creating the third tab
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Create the third tab
		const thirdLeaf = workspace.getLeaf('tab');
		await thirdLeaf.setViewState({
			type: NOTES_VIEW_TYPE,
		});
		
		// Group these views for synchronized date selection
		const groupName = 'chronosync-tabs';
		firstLeaf.setGroup(groupName);
		secondLeaf.setGroup(groupName);
		thirdLeaf.setGroup(groupName);
		
		// Make the calendar view active 
		workspace.setActiveLeaf(firstLeaf, { focus: true });
		
		new Notice('ChronoSync tabs created. You can now freely drag and rearrange these tabs.');
	}

	getLeafOfType(viewType: string): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(viewType);
		return leaves.length > 0 ? leaves[0] : null;
	}
	
	getCalendarLeaf(): WorkspaceLeaf | null {
		return this.getLeafOfType(CALENDAR_VIEW_TYPE);
	}

	async navigateToCurrentDailyNote() {
		const date = new Date();
		await this.navigateToDailyNote(date);
	}

	async navigateToDailyNote(date: Date) {
		const dailyNoteFileName = format(date, 'yyyy-MM-dd') + '.md';
		const dailyNotePath = normalizePath(`${this.settings.dailyNotesFolder}/${dailyNoteFileName}`);
		
		// Check if the daily note exists, if not create it
		const fileExists = await this.app.vault.adapter.exists(dailyNotePath);
		let noteWasCreated = false;
		
		if (!fileExists) {
			// Create the daily notes folder if it doesn't exist
			await ensureFolderExists(this.app.vault, this.settings.dailyNotesFolder);
			
			// Create daily note with default content
			const content = this.generateDailyNoteTemplate(date);
			await this.app.vault.create(dailyNotePath, content);
			noteWasCreated = true;
		}
		
		// Open the daily note
		const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
		if (file instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(file);
			
			// If we created a new daily note, force a rebuild of the calendar cache
			// for this month to ensure it shows up immediately in the calendar view
			if (noteWasCreated && this.fileIndexer) {
				// Get the year and month from the date
				const year = date.getFullYear();
				const month = date.getMonth();
				
				// Rebuild the daily notes cache for this month
				this.fileIndexer.rebuildDailyNotesCache(year, month)
					.then(() => {
						// Notify views that data has changed to trigger a UI refresh
						this.notifyDataChanged(dailyNotePath, false, true);
					})
					.catch(e => {
						console.error('Error rebuilding daily notes cache:', e);
					});
			}
		}
	}

	async incrementPomodoros() {
		await this.updateDailyNoteMetadata('pomodoros', (val) => {
			const current = typeof val === 'number' ? val : 0;
			return current + 1;
		});
	}

	async toggleDailyMetadata(key: 'workout' | 'meditate') {
		await this.updateDailyNoteMetadata(key, (val) => {
			return typeof val === 'boolean' ? !val : true;
		});
	}

	async updateDailyNoteMetadata(key: string, updateFn: (val: any) => any) {
		// Get the current daily note file
		const date = new Date();
		const dailyNoteFileName = format(date, 'yyyy-MM-dd') + '.md';
		const dailyNotePath = normalizePath(`${this.settings.dailyNotesFolder}/${dailyNoteFileName}`);
		
		// Check if the daily note exists, if not create it
		const fileExists = await this.app.vault.adapter.exists(dailyNotePath);
		
		if (!fileExists) {
			await this.navigateToCurrentDailyNote();
		}
		
		// Get the file and update its metadata
		const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
		if (file instanceof TFile) {
			try {
				// Process the frontmatter using FileManager.processFrontMatter for safer modification
				await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
					frontmatter[key] = updateFn(frontmatter[key]);
				});
				
				// Show notice
				new Notice(`Updated ${key} in daily note`);
			} catch (error) {
				console.error('Error updating daily note metadata:', error);
				new Notice('Error updating daily note metadata');
			}
		}
	}

	generateDailyNoteTemplate(date: Date): string {
		const startTime = parseTime(this.settings.timeblockStartTime);
		const endTime = parseTime(this.settings.timeblockEndTime);
		const intervalMinutes = parseInt(this.settings.timeblockInterval);
		
		if (!startTime || !endTime) {
			return 'Error: Invalid timeblock settings';
		}
		
		return generateDailyNoteTemplate(
			date,
			startTime,
			endTime,
			intervalMinutes,
			this.settings.autoAddTimeblock
		);
	}

	generateTimeblockTable(): string {
		// Create a timeblock table based on settings
		const startTime = parseTime(this.settings.timeblockStartTime);
		const endTime = parseTime(this.settings.timeblockEndTime);
		const intervalMinutes = parseInt(this.settings.timeblockInterval);
		
		if (!startTime || !endTime) return '';

		let table = '| Time | Activity |\n| ---- | -------- |\n';
		
		const startMinutes = startTime.hours * 60 + startTime.minutes;
		const endMinutes = endTime.hours * 60 + endTime.minutes;
		
		for (let minutes = startMinutes; minutes <= endMinutes; minutes += intervalMinutes) {
			const hours = Math.floor(minutes / 60);
			const mins = minutes % 60;
			const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
			table += `| ${timeStr} | |\n`;
		}
		
		return table;
	}

	async updateTaskProperty(task: TaskInfo, property: string, value: any, options: { silent?: boolean } = {}): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
			// Create a local modified copy of the task to update UI immediately
			const updatedTask = { ...task } as Record<string, any>;
			updatedTask[property] = value;
			
			// Special handling for status changes - update completedDate in local copy
			if (property === 'status' && !task.recurrence) {
				if (value === 'done') {
					updatedTask.completedDate = format(new Date(), 'yyyy-MM-dd');
				} else if (value === 'open' || value === 'in-progress') {
					updatedTask.completedDate = undefined;
				}
			}
			
			// Process the frontmatter
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// Update the property
				frontmatter[property] = value;
				
				// Special handling for status changes - update completedDate
				if (property === 'status' && !task.recurrence) {
					if (value === 'done') {
						// Set completedDate to today when marking as done
						frontmatter.completedDate = format(new Date(), 'yyyy-MM-dd');
					} else if (value === 'open' || value === 'in-progress') {
						// Clear completedDate when marking as open or in-progress
						delete frontmatter.completedDate;
					}
				}
			});
			
			// Show a notice (unless silent)
			if (!options.silent) {
				new Notice(`Updated task ${property}`);
			}
			
			// Add the updated task to the file indexer's cache
			if (this.fileIndexer) {
				// Use the manually constructed updated task like recurring tasks do
				await this.fileIndexer.updateTaskInfoInCache(task.path, updatedTask as TaskInfo);
				
				// Rebuild the file index to ensure all data is fresh like recurring tasks do
				await this.fileIndexer.rebuildIndex();
				
				// Clear the YAML cache for this file
				YAMLCache.clearCacheEntry(task.path);
			}
			
			// For simple property updates (priority, status, due), emit a granular update event
			// For more complex changes that affect task identity, keep using full refresh
			if (['priority', 'status', 'due'].includes(property)) {
				this.emitter.emit(EVENT_TASK_UPDATED, { path: task.path, updatedTask: updatedTask as TaskInfo });
			} else {
				// Notify views that data has changed and force a full refresh for other properties
				this.notifyDataChanged(task.path, true, true);
			}
			
			// Instead of a full refresh, we could implement a more targeted update
			// mechanism in the future that updates just the affected DOM elements
		} catch (error) {
			console.error('Error updating task property:', error);
			new Notice('Failed to update task property');
		}
	}
	
	/**
	 * Toggles a recurring task's completion status for the selected date
	 */
	async toggleRecurringTaskStatus(task: TaskInfo, date?: Date): Promise<void> {
		try {
			if (!task.recurrence) {
				// Not a recurring task - do regular status toggle
				const newStatus = task.status === 'done' ? 'open' : 'done';
				await this.updateTaskProperty(task, 'status', newStatus);
				return;
			}

			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
			// Use the provided date or fall back to the currently selected date
			const targetDate = date || this.selectedDate;
			const dateStr = format(targetDate, 'yyyy-MM-dd');
			
			// Create a local modified copy of the task to update UI immediately
			const updatedTask = { ...task };
			if (!updatedTask.complete_instances) {
				updatedTask.complete_instances = [];
			}
			
			let isCompleted = false;
			
			// Process the frontmatter
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// Make sure complete_instances array exists
				if (!frontmatter.complete_instances) {
					frontmatter.complete_instances = [];
				}
				
				// If the target date is in the array, remove it; otherwise add it
				const completeDates: string[] = frontmatter.complete_instances;
				const dateIndex = completeDates.indexOf(dateStr);
				
				// Format the date for display
				const displayDate = format(targetDate, 'MMM d, yyyy');
				
				if (dateIndex > -1) {
					// Remove date from the completed dates
					completeDates.splice(dateIndex, 1);
					new Notice(`Marked task as incomplete for ${displayDate}`);
					isCompleted = false;
				} else {
					// Add date to the completed dates
					completeDates.push(dateStr);
					new Notice(`Marked task as complete for ${displayDate}`);
					isCompleted = true;
				}
				
				frontmatter.complete_instances = completeDates;
				
				// Update the local task object with the new complete_instances values
				// This ensures getEffectiveTaskStatus will have the right data immediately
				updatedTask.complete_instances = [...completeDates];
			});
			
			// Add the updated task to the file indexer's cache
			if (this.fileIndexer) {
				// First update with our already-updated task object in the cache
				await this.fileIndexer.updateTaskInfoInCache(task.path, updatedTask);
				
				// Then rebuild the file index to ensure all data is fresh
				await this.fileIndexer.rebuildIndex();
				
				// Clear the YAML cache for this file
				YAMLCache.clearCacheEntry(task.path);
			}
			
			// Notify views that data has changed and force a full refresh of all views
			this.notifyDataChanged(task.path, true, true);
		} catch (error) {
			console.error('Error toggling recurring task status:', error);
			new Notice('Failed to update recurring task status');
		}
	}
	
	async toggleTaskArchive(task: TaskInfo): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
			// Create a local modified copy of the task to update UI immediately
			const updatedTask = { ...task };
			updatedTask.archived = !task.archived;
			
			// Process the frontmatter
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// Make sure tags array exists
				if (!frontmatter.tags) {
					frontmatter.tags = [];
				}
				
				// Convert to array if it's not already
				if (!Array.isArray(frontmatter.tags)) {
					frontmatter.tags = [frontmatter.tags];
				}
				
				// Toggle archive tag
				if (task.archived) {
					// Remove archive tag
					frontmatter.tags = frontmatter.tags.filter(
						(tag: string) => tag !== 'archive'
					);
				} else {
					// Add archive tag if not present
					if (!frontmatter.tags.includes('archive')) {
						frontmatter.tags.push('archive');
					}
				}
			});
			
			// Show a notice
			new Notice(task.archived ? 'Task unarchived' : 'Task archived');
			
			// Add the updated task to the file indexer's cache
			if (this.fileIndexer) {
				// Read the file to get the most up-to-date content
				const content = await this.app.vault.cachedRead(file);
				const taskInfo = extractTaskInfo(content, task.path);
				
				// Find and update this file in the index
				await this.fileIndexer.updateTaskInfoInCache(task.path, taskInfo);
				
				// Clear the YAML cache for this file
				YAMLCache.clearCacheEntry(task.path);
			}
			
			// For archived status changes, we do want a full UI refresh as the task
			// might need to be moved between sections or hidden completely
			this.notifyDataChanged(task.path, true, true);
		} catch (error) {
			console.error('Error toggling task archive status:', error);
			new Notice('Failed to update task archive status');
		}
	}
	
	openTaskCreationModal() {
		new TaskCreationModal(this.app, this).open();
	}
	
	/**
	 * Starts a time tracking session for a task
	 */
	async startTimeTracking(task: TaskInfo, description?: string): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
			// Check if there's already an active session
			const activeEntry = task.timeEntries?.find(entry => !entry.endTime);
			if (activeEntry) {
				new Notice('Time tracking is already active for this task');
				return;
			}
			
			const now = new Date().toISOString();
			const newEntry = {
				startTime: now,
				description: description || ''
			};
			
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				if (!frontmatter.timeEntries) {
					frontmatter.timeEntries = [];
				}
				frontmatter.timeEntries.push(newEntry);
			});
			
			new Notice('Time tracking started');
			this.notifyDataChanged(task.path, true, true);
		} catch (error) {
			console.error('Error starting time tracking:', error);
			new Notice('Failed to start time tracking');
		}
	}
	
	/**
	 * Stops the active time tracking session for a task
	 */
	async stopTimeTracking(task: TaskInfo): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
			const activeEntry = task.timeEntries?.find(entry => !entry.endTime);
			if (!activeEntry) {
				new Notice('No active time tracking session found');
				return;
			}
			
			const now = new Date().toISOString();
			const startTime = new Date(activeEntry.startTime);
			const endTime = new Date(now);
			const duration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60)); // Convert to minutes
			
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				if (frontmatter.timeEntries) {
					const entryToUpdate = frontmatter.timeEntries.find((entry: any) => 
						entry.startTime === activeEntry.startTime && !entry.endTime
					);
					if (entryToUpdate) {
						entryToUpdate.endTime = now;
						entryToUpdate.duration = duration;
					}
					
					// Update total time spent
					const totalTime = frontmatter.timeEntries.reduce((total: number, entry: any) => {
						return total + (entry.duration || 0);
					}, 0);
					frontmatter.timeSpent = totalTime;
				}
			});
			
			const hours = Math.floor(duration / 60);
			const minutes = duration % 60;
			const timeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
			
			new Notice(`Time tracking stopped. Session: ${timeText}`);
			this.notifyDataChanged(task.path, true, true);
		} catch (error) {
			console.error('Error stopping time tracking:', error);
			new Notice('Failed to stop time tracking');
		}
	}
	
	/**
	 * Gets the active time tracking session for a task
	 */
	getActiveTimeSession(task: TaskInfo) {
		return task.timeEntries?.find(entry => !entry.endTime);
	}
	
	/**
	 * Formats time in minutes to a readable string
	 */
	formatTime(minutes: number): string {
		if (minutes === 0) return '0m';
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (hours === 0) return `${mins}m`;
		if (mins === 0) return `${hours}h`;
		return `${hours}h ${mins}m`;
	}
}