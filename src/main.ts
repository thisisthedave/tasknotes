import { Notice, Plugin, TFile, WorkspaceLeaf, normalizePath, Platform } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import { 
	TaskNotesSettings, 
	DEFAULT_SETTINGS, 
	TaskNotesSettingTab 
} from './settings/settings';
import { 
	CALENDAR_VIEW_TYPE, 
	NOTES_VIEW_TYPE, 
	TASK_LIST_VIEW_TYPE,
	AGENDA_VIEW_TYPE,
	POMODORO_VIEW_TYPE,
	TimeInfo,
	TaskInfo,
	TimeEntry,
	EVENT_DATE_SELECTED,
	EVENT_TAB_CHANGED,
	EVENT_DATA_CHANGED,
	EVENT_TASK_UPDATED
} from './types';
import { CalendarView } from './views/CalendarView';
import { TaskListView } from './views/TaskListView';
import { NotesView } from './views/NotesView';
import { AgendaView } from './views/AgendaView';
import { PomodoroView } from './views/PomodoroView';
import { TaskCreationModal } from './modals/TaskCreationModal';
import { PomodoroService } from './services/PomodoroService';
import { 
	ensureFolderExists, 
	generateDailyNoteTemplate,
	updateYamlFrontmatter,
	extractTaskInfo,
	updateTaskProperty,
	formatTime,
	calculateTotalTimeSpent,
	getActiveTimeEntry
} from './utils/helpers';
import { EventEmitter } from './utils/EventEmitter';
import { FileIndexer } from './utils/FileIndexer';
import { YAMLCache } from './utils/YAMLCache';
import { CacheManager } from './utils/CacheManager';
import { RequestDeduplicator, PredictivePrefetcher } from './utils/RequestDeduplicator';
import { DOMReconciler, UIStateManager } from './utils/DOMReconciler';
import { perfMonitor } from './utils/PerformanceMonitor';
import { FieldMapper } from './services/FieldMapper';
import { StatusManager } from './services/StatusManager';
import { PriorityManager } from './services/PriorityManager';

export default class TaskNotesPlugin extends Plugin {
	settings: TaskNotesSettings;
	
	// Shared state between views
	selectedDate: Date = new Date();
	
	// Event emitter for view communication
	emitter = new EventEmitter();
	
	// File indexer for efficient file access (legacy support)
	fileIndexer: FileIndexer;
	
	// Unified cache manager
	cacheManager: CacheManager;
	
	// Performance optimization utilities
	requestDeduplicator: RequestDeduplicator;
	predictivePrefetcher: PredictivePrefetcher;
	domReconciler: DOMReconciler;
	uiStateManager: UIStateManager;
	
	// Pomodoro service
	pomodoroService: PomodoroService;
	
	// Customization services
	fieldMapper: FieldMapper;
	statusManager: StatusManager;
	priorityManager: PriorityManager;
	
	async onload() {
		await this.loadSettings();
		
		// Initialize customization services
		this.fieldMapper = new FieldMapper(this.settings.fieldMapping);
		this.statusManager = new StatusManager(this.settings.customStatuses);
		this.priorityManager = new PriorityManager(this.settings.customPriorities);
		
		// Initialize performance optimization utilities
		this.requestDeduplicator = new RequestDeduplicator();
		this.predictivePrefetcher = new PredictivePrefetcher(this.requestDeduplicator);
		this.domReconciler = new DOMReconciler();
		this.uiStateManager = new UIStateManager();
		
		// Initialize unified cache manager
		this.cacheManager = new CacheManager(
			this.app.vault,
			this.settings.taskTag,
			this.settings.excludedFolders,
			this.settings.dailyNotesFolder,
			this.settings.dailyNoteTemplate,
			this.fieldMapper
		);
		
		// Initialize the file indexer (legacy support)
		this.fileIndexer = new FileIndexer(
			this.app.vault, 
			this.settings.taskTag,
			this.settings.excludedFolders,
			this.settings.dailyNotesFolder,
			this.settings.dailyNoteTemplate,
			this.fieldMapper
		);
		
		// Initialize cache asynchronously
		perfMonitor.measure('cache-initialization', async () => {
			await this.cacheManager.initializeCache();
		});
		
		// Initialize Pomodoro service
		this.pomodoroService = new PomodoroService(this);
		await this.pomodoroService.initialize();
		
		// Inject dynamic styles for custom statuses and priorities
		this.injectCustomStyles();

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
		this.registerView(
			AGENDA_VIEW_TYPE,
			(leaf) => new AgendaView(leaf, this)
		);
		this.registerView(
			POMODORO_VIEW_TYPE,
			(leaf) => new PomodoroView(leaf, this)
		);
		
		// Add ribbon icon
		this.addRibbonIcon('calendar-days', 'Open calendar', async () => {
			await this.activateLinkedViews();
		});
		
		// Add ribbon icon for a side-by-side layout
		this.addRibbonIcon('layout-grid', 'Open grid layout', async () => {
			await this.createGridLayout();
		});
		
		// Add ribbon icon for a tabs layout
		this.addRibbonIcon('layout-tabs', 'Open tabs layout', async () => {
			await this.createTabsLayout();
		});

		// Add commands
		this.addCommands();

		// Add settings tab
		this.addSettingTab(new TaskNotesSettingTab(this.app, this));
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
		// Clear cache entries for unified cache manager
		if (filePath) {
			this.cacheManager.clearCacheEntry(filePath);
			
			// Legacy support - clear file indexer cache
			if (this.fileIndexer) {
				this.fileIndexer.clearCachedInfo(filePath);
				if (force) {
					this.fileIndexer.rebuildIndex();
				}
			}
			
			// Clear YAML parsing cache
			YAMLCache.clearCacheEntry(filePath);
		} else if (force) {
			// Full cache clear if forcing
			this.cacheManager.clearAllCaches();
			if (this.fileIndexer) {
				this.fileIndexer.rebuildIndex();
			}
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
		// Clean up performance monitoring
		const cacheStats = perfMonitor.getStats('cache-initialization');
		if (cacheStats && cacheStats.count > 0) {
			perfMonitor.logSummary();
		}
		
		// Clean up Pomodoro service
		if (this.pomodoroService) {
			this.pomodoroService.cleanup();
		}
		
		// Clean up unified cache manager
		if (this.cacheManager) {
			this.cacheManager.destroy();
		}
		
		// Clean up request deduplicator
		if (this.requestDeduplicator) {
			this.requestDeduplicator.cancelAll();
		}
		
		// Clean up the file indexer (legacy)
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
		
		// Update customization services with new settings
		if (this.fieldMapper) {
			this.fieldMapper.updateMapping(this.settings.fieldMapping);
		}
		if (this.statusManager) {
			this.statusManager.updateStatuses(this.settings.customStatuses);
		}
		if (this.priorityManager) {
			this.priorityManager.updatePriorities(this.settings.customPriorities);
		}
		
		// Update the file indexer with new settings if relevant
		if (this.fileIndexer) {
			// Update template path and field mapper without recreating the entire indexer
			this.fileIndexer.updateDailyNoteTemplatePath(this.settings.dailyNoteTemplate);
			this.fileIndexer.updateFieldMapper(this.fieldMapper);
			
			// Only recreate indexer if core settings changed
			const coreSettingsChanged = this.fileIndexer.taskTag !== this.settings.taskTag || 
				this.fileIndexer.excludedFolders.join(',') !== this.settings.excludedFolders;
			
			if (coreSettingsChanged) {
				// Properly destroy the old indexer first
				this.fileIndexer.destroy();
				
				// Create a new indexer with updated settings
				this.fileIndexer = new FileIndexer(
					this.app.vault, 
					this.settings.taskTag,
					this.settings.excludedFolders,
					this.settings.dailyNotesFolder,
					this.settings.dailyNoteTemplate,
					this.fieldMapper
				);
			}
		}
		
		// Update custom styles
		this.injectCustomStyles();
		
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
			id: 'open-agenda-view',
			name: 'Open agenda view',
			callback: async () => {
				await this.activateAgendaView();
			}
		});
		
		this.addCommand({
			id: 'open-pomodoro-view',
			name: 'Open pomodoro timer',
			callback: async () => {
				await this.activatePomodoroView();
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
			name: 'Open in grid layout',
			callback: async () => {
				await this.createGridLayout();
			}
		});
		
		this.addCommand({
			id: 'open-tabs-layout',
			name: 'Open in tabs layout',
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
			
			this.addCommand({
				id: 'open-agenda-popout',
				name: 'Open agenda in new window',
				callback: async () => {
					await this.openViewInPopout(AGENDA_VIEW_TYPE);
				}
			});
			
			this.addCommand({
				id: 'open-pomodoro-popout',
				name: 'Open pomodoro timer in new window',
				callback: async () => {
					await this.openViewInPopout(POMODORO_VIEW_TYPE);
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
		
		// Pomodoro commands
		this.addCommand({
			id: 'start-pomodoro',
			name: 'Start pomodoro timer',
			callback: async () => {
				await this.pomodoroService.startPomodoro();
			}
		});
		
		this.addCommand({
			id: 'stop-pomodoro',
			name: 'Stop pomodoro timer',
			callback: async () => {
				await this.pomodoroService.stopPomodoro();
			}
		});
		
		this.addCommand({
			id: 'pause-pomodoro',
			name: 'Pause/resume pomodoro timer',
			callback: async () => {
				const state = this.pomodoroService.getState();
				if (state.isRunning) {
					await this.pomodoroService.pausePomodoro();
				} else if (state.currentSession) {
					await this.pomodoroService.resumePomodoro();
				}
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
	
	async activateAgendaView() {
		return this.activateView(AGENDA_VIEW_TYPE);
	}
	
	async activatePomodoroView() {
		return this.activateView(POMODORO_VIEW_TYPE);
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
		workspace.detachLeavesOfType(AGENDA_VIEW_TYPE);
		workspace.detachLeavesOfType(POMODORO_VIEW_TYPE);
		
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
		
		// Create an agenda view in a new tab
		const agendaLeaf = workspace.getLeaf('tab');
		await agendaLeaf.setViewState({
			type: AGENDA_VIEW_TYPE
		});
		
		// Group these leaves together for synchronized date selection
		const groupName = 'tasknotes-views';
		calendarLeaf.setGroup(groupName);
		tasksLeaf.setGroup(groupName);
		notesLeaf.setGroup(groupName);
		agendaLeaf.setGroup(groupName);
		
		// Make calendar the active view
		workspace.setActiveLeaf(calendarLeaf, { focus: true });
		
		new Notice('Views created. You can drag and rearrange these tabs as needed.');
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
		const groupName = 'tasknotes-grid';
		calendarLeaf.setGroup(groupName);
		tasksLeaf.setGroup(groupName);
		notesLeaf.setGroup(groupName);
		
		// Set calendar as active at the end
		workspace.setActiveLeaf(calendarLeaf, { focus: true });
		
		// Show a notice to let the user know they can rearrange the tabs
		new Notice('Views created in grid layout. You can drag and rearrange these tabs freely.');
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
		const groupName = 'tasknotes-tabs';
		firstLeaf.setGroup(groupName);
		secondLeaf.setGroup(groupName);
		thirdLeaf.setGroup(groupName);
		
		// Make the calendar view active 
		workspace.setActiveLeaf(firstLeaf, { focus: true });
		
		new Notice('Tabs created. You can now freely drag and rearrange these tabs.');
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
		const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
		let noteWasCreated = false;
		
		if (!file) {
			// Create the daily notes folder if it doesn't exist
			await ensureFolderExists(this.app.vault, this.settings.dailyNotesFolder);
			
			// Create daily note with default content
			const content = await this.generateDailyNoteTemplate(date);
			await this.app.vault.create(dailyNotePath, content);
			noteWasCreated = true;
		}
		
		// Open the daily note
		const dailyNoteFile = this.app.vault.getAbstractFileByPath(dailyNotePath);
		if (dailyNoteFile instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(dailyNoteFile);
			
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


async generateDailyNoteTemplate(date: Date): Promise<string> {
	// Check if a custom template is specified
	if (this.settings.dailyNoteTemplate && this.settings.dailyNoteTemplate.trim()) {
		try {
			// Normalize the template path and ensure it has .md extension
			let templatePath = normalizePath(this.settings.dailyNoteTemplate.trim());
			if (!templatePath.endsWith('.md')) {
				templatePath += '.md';
			}
			
			// Try to load the template file
			const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
			if (templateFile instanceof TFile) {
				const templateContent = await this.app.vault.read(templateFile);
				return generateDailyNoteTemplate(date, templateContent);
			} else {
				// Template file not found, show notice and use default
				new Notice(`Daily note template not found: ${templatePath}`);
			}
		} catch (error) {
			// Error reading template, show notice and use default
			console.error('Error reading daily note template:', error);
			new Notice(`Error reading daily note template: ${this.settings.dailyNoteTemplate}`);
		}
	}
	
	// Use default template
	return generateDailyNoteTemplate(date);
}

/**
 * Inject dynamic CSS for custom statuses and priorities
 */
private injectCustomStyles(): void {
	// Remove existing custom styles
	const existingStyle = document.getElementById('tasknotes-custom-styles');
	if (existingStyle) {
		existingStyle.remove();
	}
	
	// Generate new styles
	const statusStyles = this.statusManager.getStatusStyles();
	const priorityStyles = this.priorityManager.getPriorityStyles();
	
	// Create style element
	const styleEl = document.createElement('style');
	styleEl.id = 'tasknotes-custom-styles';
	styleEl.textContent = `
		${statusStyles}
		${priorityStyles}
	`;
	
	// Inject into document head
	document.head.appendChild(styleEl);
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
				if (this.statusManager.isCompletedStatus(value)) {
					updatedTask.completedDate = format(new Date(), 'yyyy-MM-dd');
				} else {
					updatedTask.completedDate = undefined;
				}
			}
			
			// Read current content and use field mapping to update
			const content = await this.app.vault.read(file);
			const propertyUpdates: Partial<TaskInfo> = {};
			(propertyUpdates as any)[property] = value;
			
			// Special handling for status changes - update completedDate
			if (property === 'status' && !task.recurrence) {
				if (this.statusManager.isCompletedStatus(value)) {
					propertyUpdates.completedDate = format(new Date(), 'yyyy-MM-dd');
				} else {
					propertyUpdates.completedDate = undefined;
				}
			}
			
			// Use field mapping to update the content
			const updatedContent = updateTaskProperty(content, propertyUpdates, this.fieldMapper);
			await this.app.vault.modify(file, updatedContent);
			
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
	async toggleRecurringTaskComplete(task: TaskInfo, date?: Date): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
			// Use the provided date or fall back to the currently selected date
			const targetDate = date || this.selectedDate;
			const dateStr = format(targetDate, 'yyyy-MM-dd');
			
			// Check current completion status for this date
			const completeInstances = Array.isArray(task.complete_instances) ? task.complete_instances : [];
			const currentComplete = completeInstances.includes(dateStr);
			const newComplete = !currentComplete;
			
			// Create a local modified copy for immediate UI feedback
			const updatedTask = { ...task };
			
			// Process the frontmatter - follow time tracking pattern
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// Ensure complete_instances array exists
				if (!frontmatter.complete_instances) {
					frontmatter.complete_instances = [];
				}
				
				const completeDates: string[] = frontmatter.complete_instances;
				
				if (newComplete) {
					// Add date to completed instances if not already present
					if (!completeDates.includes(dateStr)) {
						completeDates.push(dateStr);
					}
				} else {
					// Remove date from completed instances
					const index = completeDates.indexOf(dateStr);
					if (index > -1) {
						completeDates.splice(index, 1);
					}
				}
				
				// Update frontmatter
				frontmatter.complete_instances = completeDates;
				
				// Update the dateModified field using field mapping
				const dateModifiedField = this.fieldMapper.toUserField('dateModified');
				frontmatter[dateModifiedField] = format(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
				
				// Update local copy for immediate UI feedback
				updatedTask.complete_instances = [...completeDates];
			});
			
			// Update cache and rebuild index - follow time tracking pattern
			if (this.fileIndexer) {
				await this.fileIndexer.updateTaskInfoInCache(task.path, updatedTask);
				await this.fileIndexer.rebuildIndex();
			}
			
			// Clear YAML cache
			YAMLCache.clearCacheEntry(task.path);
			
			// Emit granular task update event
			this.emitter.emit(EVENT_TASK_UPDATED, { path: task.path, updatedTask });
			
			// Show success notice
			const displayDate = format(targetDate, 'MMM d, yyyy');
			new Notice(`Marked task as ${newComplete ? 'complete' : 'incomplete'} for ${displayDate}`);
			
		} catch (error) {
			console.error('Error toggling recurring task completion:', error);
			new Notice('Failed to update recurring task completion');
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
			
			// Read current content and use field mapping to update
			const content = await this.app.vault.read(file);
			const propertyUpdates: Partial<TaskInfo> = {
				archived: !task.archived
			};
			
			// Use field mapping to update the content
			const updatedContent = updateTaskProperty(content, propertyUpdates, this.fieldMapper);
			await this.app.vault.modify(file, updatedContent);
			
			// Show a notice
			new Notice(task.archived ? 'Task unarchived' : 'Task archived');
			
			// Add the updated task to the file indexer's cache
			if (this.fileIndexer) {
				// Use the updated task info with field mapping
				const taskInfo = extractTaskInfo(updatedContent, task.path, this.fieldMapper);
				
				// Find and update this file in the index
				await this.fileIndexer.updateTaskInfoInCache(task.path, taskInfo as TaskInfo);
				
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
			const newEntry: TimeEntry = {
				startTime: now,
				description: description || ''
			};
			
			// Create a local modified copy of the task to update UI immediately
			const updatedTask = { ...task };
			if (!updatedTask.timeEntries) {
				updatedTask.timeEntries = [];
			}
			updatedTask.timeEntries = [...updatedTask.timeEntries, newEntry];
			
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				if (!frontmatter.timeEntries) {
					frontmatter.timeEntries = [];
				}
				frontmatter.timeEntries.push(newEntry);
			});
			
			new Notice('Time tracking started');
			
			// Update the cache with the modified task
			if (this.fileIndexer) {
				await this.fileIndexer.updateTaskInfoInCache(task.path, updatedTask);
				await this.fileIndexer.rebuildIndex();
				YAMLCache.clearCacheEntry(task.path);
			}
			
			// Emit granular update event instead of full refresh
			this.emitter.emit(EVENT_TASK_UPDATED, { path: task.path, updatedTask });
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
			
			// Create a local modified copy of the task to update UI immediately
			const updatedTask = { ...task };
			if (!updatedTask.timeEntries) {
				updatedTask.timeEntries = [];
			}
			
			// Update the time entry in our local copy
			updatedTask.timeEntries = updatedTask.timeEntries.map(entry => {
				if (entry.startTime === activeEntry.startTime && !entry.endTime) {
					return {
						...entry,
						endTime: now
					};
				}
				return entry;
			});
			
			
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				if (frontmatter.timeEntries) {
					const entryToUpdate = frontmatter.timeEntries.find((entry: any) => 
						(entry.start || entry.startTime) === activeEntry.startTime && !(entry.end || entry.endTime)
					);
					if (entryToUpdate) {
						// Support both old and new field names for compatibility
						if (entryToUpdate.start) {
							entryToUpdate.end = now;
							delete entryToUpdate.start; // Remove old field
							entryToUpdate.startTime = activeEntry.startTime; // Add new field
						} else {
							entryToUpdate.endTime = now;
						}
						// Remove duration if it exists (old format)
						delete entryToUpdate.duration;
					}
				}
			});
			
			new Notice('Time tracking stopped');
			
			// Update the cache with the modified task
			if (this.fileIndexer) {
				await this.fileIndexer.updateTaskInfoInCache(task.path, updatedTask);
				await this.fileIndexer.rebuildIndex();
				YAMLCache.clearCacheEntry(task.path);
			}
			
			// Emit granular update event instead of full refresh
			this.emitter.emit(EVENT_TASK_UPDATED, { path: task.path, updatedTask });
		} catch (error) {
			console.error('Error stopping time tracking:', error);
			new Notice('Failed to stop time tracking');
		}
	}
	
	/**
	 * Gets the active time tracking session for a task
	 */
	getActiveTimeSession(task: TaskInfo) {
		return getActiveTimeEntry(task.timeEntries || []);
	}
	
	/**
	 * Check if a recurring task is completed for a specific date
	 */
	isRecurringTaskCompleteForDate(task: TaskInfo, date: Date): boolean {
		if (!task.recurrence) return false;
		const dateStr = format(date, 'yyyy-MM-dd');
		const completeInstances = Array.isArray(task.complete_instances) ? task.complete_instances : [];
		return completeInstances.includes(dateStr);
	}
	
	/**
	 * Formats time in minutes to a readable string
	 */
	formatTime(minutes: number): string {
		return formatTime(minutes);
	}
}