import { Notice, Plugin, TFile, WorkspaceLeaf, normalizePath, Editor, MarkdownView } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import { 
	TaskNotesSettings, 
	DEFAULT_SETTINGS, 
	TaskNotesSettingTab 
} from './settings/settings';
import { 
	MINI_CALENDAR_VIEW_TYPE, 
	ADVANCED_CALENDAR_VIEW_TYPE,
	NOTES_VIEW_TYPE, 
	TASK_LIST_VIEW_TYPE,
	AGENDA_VIEW_TYPE,
	POMODORO_VIEW_TYPE,
	POMODORO_STATS_VIEW_TYPE,
	KANBAN_VIEW_TYPE,
	TimeInfo,
	TaskInfo,
	TimeEntry,
	EVENT_DATE_SELECTED,
	EVENT_TAB_CHANGED,
	EVENT_DATA_CHANGED,
	EVENT_TASK_UPDATED
} from './types';
import { MiniCalendarView } from './views/MiniCalendarView';
import { AdvancedCalendarView } from './views/AdvancedCalendarView';
import { TaskListView } from './views/TaskListView';
import { NotesView } from './views/NotesView';
import { AgendaView } from './views/AgendaView';
import { PomodoroView } from './views/PomodoroView';
import { PomodoroStatsView } from './views/PomodoroStatsView';
import { KanbanView } from './views/KanbanView';
import { TaskCreationModal, TaskConversionOptions } from './modals/TaskCreationModal';
import { TaskEditModal } from './modals/TaskEditModal';
import { PomodoroService } from './services/PomodoroService';
import { 
	ensureFolderExists, 
	generateDailyNoteTemplate,
	extractTaskInfo,
	updateTaskProperty,
	formatTime,
	calculateTotalTimeSpent,
	getActiveTimeEntry
} from './utils/helpers';
import { EventEmitter } from './utils/EventEmitter';
import { YAMLCache } from './utils/YAMLCache';
import { CacheManager } from './utils/CacheManager';
import { RequestDeduplicator, PredictivePrefetcher } from './utils/RequestDeduplicator';
import { DOMReconciler, UIStateManager } from './utils/DOMReconciler';
import { perfMonitor } from './utils/PerformanceMonitor';
import { FieldMapper } from './services/FieldMapper';
import { StatusManager } from './services/StatusManager';
import { PriorityManager } from './services/PriorityManager';
import { TaskService } from './services/TaskService';
import { FilterService } from './services/FilterService';
import { ViewStateManager } from './services/ViewStateManager';
import { TasksPluginParser } from './utils/TasksPluginParser';
import { createTaskLinkOverlay, dispatchTaskUpdate } from './editor/TaskLinkOverlay';
import { DragDropManager } from './utils/DragDropManager';

export default class TaskNotesPlugin extends Plugin {
	settings: TaskNotesSettings;
	
	// Ready promise to signal when initialization is complete
	private readyPromise: Promise<void>;
	private resolveReady: () => void;
	
	// Shared state between views
	selectedDate: Date = new Date();
	
	// Event emitter for view communication
	emitter = new EventEmitter();
	
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
	
	// Business logic services
	taskService: TaskService;
	filterService: FilterService;
	viewStateManager: ViewStateManager;
	
	// Editor services  
	taskLinkDetectionService?: import('./services/TaskLinkDetectionService').TaskLinkDetectionService;
	instantTaskConvertService?: import('./services/InstantTaskConvertService').InstantTaskConvertService;
	
	// Drag and drop manager
	dragDropManager: DragDropManager;
	
	// Event listener cleanup
	private taskUpdateListenerForEditor: (() => void) | null = null;
	
	async onload() {
		// Create the promise and store its resolver
		this.readyPromise = new Promise(resolve => {
			this.resolveReady = resolve;
		});

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
		
		// Initialize unified cache manager FIRST
		this.cacheManager = new CacheManager(
			this.app.vault,
			this.settings.taskTag,
			this.settings.excludedFolders,
			this.settings.dailyNotesFolder,
			this.settings.dailyNoteTemplate,
			this.fieldMapper
		);
		
		// Initialize cache and wait for completion
		await perfMonitor.measure('cache-initialization', async () => {
			await this.cacheManager.initializeCache();
		});
		
		// Listen for delayed cache initialization completion
		this.cacheManager.subscribe('cache-initialized', (data) => {
			if (data.taskCount > 0) {
				// Notify all views to refresh
				this.notifyDataChanged();
			}
		});
		
		// Initialize business logic services AFTER cache manager
		this.taskService = new TaskService(this);
		
		// Initialize FilterService AFTER cache manager is ready
		this.filterService = new FilterService(
			this.cacheManager,
			this.statusManager,
			this.priorityManager
		);
		
		// Initialize FilterService and set up event listeners
		this.filterService.initialize();
		
		// Initialize ViewStateManager
		this.viewStateManager = new ViewStateManager();
		
		// Initialize Pomodoro service
		this.pomodoroService = new PomodoroService(this);
		await this.pomodoroService.initialize();
		
		// Initialize drag and drop manager
		this.dragDropManager = new DragDropManager(this);
		
		// Inject dynamic styles for custom statuses and priorities
		this.injectCustomStyles();

		// Register view types
		this.registerView(
			MINI_CALENDAR_VIEW_TYPE,
			(leaf) => new MiniCalendarView(leaf, this)
		);
		this.registerView(
			ADVANCED_CALENDAR_VIEW_TYPE,
			(leaf) => new AdvancedCalendarView(leaf, this)
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
		this.registerView(
			POMODORO_STATS_VIEW_TYPE,
			(leaf) => new PomodoroStatsView(leaf, this)
		);
		this.registerView(
			KANBAN_VIEW_TYPE,
			(leaf) => new KanbanView(leaf, this)
		);
		
		// Initialize editor services
		const { TaskLinkDetectionService } = await import('./services/TaskLinkDetectionService');
		this.taskLinkDetectionService = new TaskLinkDetectionService(this);
		
		const { InstantTaskConvertService } = await import('./services/InstantTaskConvertService');
		this.instantTaskConvertService = new InstantTaskConvertService(this);
		
		// Register editor extensions
		this.registerEditorExtension(createTaskLinkOverlay(this));
		
		const { createInstantConvertButtons } = await import('./editor/InstantConvertButtons');
		this.registerEditorExtension(createInstantConvertButtons(this));
		
		const { createTaskDropExtension } = await import('./editor/TaskDropExtension');
		this.registerEditorExtension(createTaskDropExtension(this));
		
		// Set up global event listener for task updates to refresh editor decorations
		this.taskUpdateListenerForEditor = this.emitter.on(EVENT_TASK_UPDATED, (data) => {
			// Trigger decoration refresh in all active markdown views using proper state effects
			this.app.workspace.iterateRootLeaves((leaf) => {
				if (leaf.view.getViewType() === 'markdown') {
					const editor = (leaf.view as any).editor;
					if (editor && editor.cm) {
						// Use the proper CodeMirror state effect pattern
						// The TaskService emits events with 'path' property, not 'taskPath'
						dispatchTaskUpdate(editor.cm, data?.path);
					}
				}
			});
		});
		
		// Note: Task drop handling is now done via CodeMirror extension
		
		// Add ribbon icon
		this.addRibbonIcon('calendar-days', 'Open calendar', async () => {
			await this.activateCalendarView();
		});

		// Add commands
		this.addCommands();

		// Add settings tab
		this.addSettingTab(new TaskNotesSettingTab(this.app, this));


		// At the very end of onload, resolve the promise to signal readiness
		this.resolveReady();
	}

	/**
	 * Public method for views to wait for readiness
	 */
	async onReady(): Promise<void> {
		// If readyPromise doesn't exist, plugin hasn't started onload yet
		if (!this.readyPromise) {
			throw new Error('Plugin not yet initialized');
		}
		
		await this.readyPromise;
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
			
			// Clear YAML parsing cache
			YAMLCache.clearCacheEntry(filePath);
			
			// Clear task link detection cache for this file
			if (this.taskLinkDetectionService) {
				this.taskLinkDetectionService.clearCacheForFile(filePath);
			}
		} else if (force) {
			// Full cache clear if forcing
			this.cacheManager.clearAllCaches();
			
			// Clear task link detection cache completely
			if (this.taskLinkDetectionService) {
				this.taskLinkDetectionService.clearCache();
			}
		}
		
		// Only emit refresh event if triggerRefresh is true
		if (triggerRefresh) {
			// Use requestAnimationFrame for better UI timing instead of setTimeout
			requestAnimationFrame(() => {
				this.emitter.emit(EVENT_DATA_CHANGED);
			});
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
		
		// Clean up FilterService
		if (this.filterService) {
			this.filterService.cleanup();
		}
		
		// Clean up TaskLinkDetectionService
		if (this.taskLinkDetectionService) {
			this.taskLinkDetectionService.cleanup();
		}
		
		// Clean up drag and drop manager
		if (this.dragDropManager) {
			this.dragDropManager.destroy();
		}
		
		// Clean up ViewStateManager
		if (this.viewStateManager) {
			this.viewStateManager.cleanup();
		}
		
		// Clean up unified cache manager
		if (this.cacheManager) {
			this.cacheManager.destroy();
		}
		
		// Clean up request deduplicator
		if (this.requestDeduplicator) {
			this.requestDeduplicator.cancelAll();
		}
		
		// Clean up DOM reconciler
		if (this.domReconciler) {
			this.domReconciler.destroy();
		}

		// Clean up UI state manager
		if (this.uiStateManager) {
			this.uiStateManager.destroy();
		}
		
		// Clean up performance monitor
		if (typeof perfMonitor !== 'undefined') {
			perfMonitor.destroy();
		}
		
		// Clean up task update listener for editor
		if (this.taskUpdateListenerForEditor) {
			this.taskUpdateListenerForEditor();
		}
		
		// Clean up the event emitter
		this.emitter.removeAllListeners();
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		
		// Deep merge settings with proper migration for nested objects
		this.settings = {
			...DEFAULT_SETTINGS,
			...loadedData,
			// Deep merge field mapping to ensure new fields get default values
			fieldMapping: {
				...DEFAULT_SETTINGS.fieldMapping,
				...(loadedData?.fieldMapping || {})
			},
			// Deep merge custom statuses array
			customStatuses: loadedData?.customStatuses || DEFAULT_SETTINGS.customStatuses,
			// Deep merge custom priorities array  
			customPriorities: loadedData?.customPriorities || DEFAULT_SETTINGS.customPriorities
		};
		
		// Check if we added any new field mappings and save if needed
		const hasNewFields = Object.keys(DEFAULT_SETTINGS.fieldMapping).some(key => 
			!(loadedData?.fieldMapping?.[key])
		);
		
		if (hasNewFields) {
			// Save the migrated settings to include new field mappings
			await this.saveData(this.settings);
		}
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
		
		// Update the cache manager with new settings
		this.cacheManager.updateConfig(
			this.settings.taskTag,
			this.settings.excludedFolders,
			this.settings.dailyNotesFolder,
			this.settings.dailyNoteTemplate,
			this.fieldMapper
		);
		
		// Update custom styles
		this.injectCustomStyles();
		
		// If settings have changed, notify views to refresh their data
		this.notifyDataChanged();
	}

	addCommands() {
		// View commands
		this.addCommand({
			id: 'open-calendar-view',
			name: 'Open mini calendar view',
			callback: async () => {
				await this.activateCalendarView();
			}
		});
		
		this.addCommand({
			id: 'open-advanced-calendar-view',
			name: 'Open advanced calendar view',
			callback: async () => {
				await this.activateAdvancedCalendarView();
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
			id: 'open-kanban-view',
			name: 'Open kanban board',
			callback: async () => {
				await this.activateKanbanView();
			}
		});
		
		this.addCommand({
			id: 'open-pomodoro-stats',
			name: 'Open pomodoro statistics',
			callback: async () => {
				await this.activatePomodoroStatsView();
			}
		});

		// Task commands
		this.addCommand({
			id: 'create-new-task',
			name: 'Create new task',
			callback: () => {
				this.openTaskCreationModal();
			}
		});

		this.addCommand({
			id: 'convert-to-tasknote',
			name: 'Convert task to TaskNote',
			editorCallback: (editor: Editor) => {
				this.convertTaskToTaskNote(editor);
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
		
		// Cache management commands
		this.addCommand({
			id: 'refresh-cache',
			name: 'Refresh TaskNotes cache',
			callback: async () => {
				await this.refreshCache();
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
		return this.activateView(MINI_CALENDAR_VIEW_TYPE);
	}
	
	async activateAdvancedCalendarView() {
		return this.activateView(ADVANCED_CALENDAR_VIEW_TYPE);
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
	
	async activatePomodoroStatsView() {
		return this.activateView(POMODORO_STATS_VIEW_TYPE);
	}
	
	async activateKanbanView() {
		return this.activateView(KANBAN_VIEW_TYPE);
	}
	

	getLeafOfType(viewType: string): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(viewType);
		return leaves.length > 0 ? leaves[0] : null;
	}
	
	getCalendarLeaf(): WorkspaceLeaf | null {
		return this.getLeafOfType(MINI_CALENDAR_VIEW_TYPE);
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
			try {
				// Create the daily notes folder if it doesn't exist
				await ensureFolderExists(this.app.vault, this.settings.dailyNotesFolder);
				
				// Create daily note with default content
				const content = await this.generateDailyNoteTemplate(date);
				await this.app.vault.create(dailyNotePath, content);
				noteWasCreated = true;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error('Failed to create daily note:', {
					error: errorMessage,
					path: dailyNotePath,
					date: format(date, 'yyyy-MM-dd')
				});
				new Notice(`Failed to create daily note: ${errorMessage}`);
				return; // Don't try to open the file if creation failed
			}
		}
		
		// Open the daily note
		const dailyNoteFile = this.app.vault.getAbstractFileByPath(dailyNotePath);
		if (dailyNoteFile instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(dailyNoteFile);
			
			// If we created a new daily note, force a rebuild of the calendar cache
			// for this month to ensure it shows up immediately in the calendar view
			if (noteWasCreated) {
				// Get the year and month from the date
				const year = date.getFullYear();
				const month = date.getMonth();
				
				// Rebuild the daily notes cache for this month
				try {
					await this.cacheManager.rebuildDailyNotesCache(year, month);
					// Notify views that data has changed to trigger a UI refresh
					this.notifyDataChanged(dailyNotePath, false, true);
				} catch (e) {
					console.error('Error rebuilding daily notes cache:', e);
				}
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

	async updateTaskProperty(task: TaskInfo, property: keyof TaskInfo, value: any, options: { silent?: boolean } = {}): Promise<TaskInfo> {
		try {
			const updatedTask = await this.taskService.updateProperty(task, property, value, options);
			
			// Provide user feedback unless silent
			if (!options.silent) {
				if (property === 'status') {
					const statusConfig = this.statusManager.getStatusConfig(value);
					new Notice(`Task marked as '${statusConfig?.label || value}'`);
				} else {
					new Notice(`Task ${property} updated`);
				}
			}
			
			return updatedTask;
		} catch (error) {
			console.error(`Failed to update task ${property}:`, error);
			new Notice(`Failed to update task ${property}`);
			throw error;
		}
	}
	
	/**
	 * Toggles a recurring task's completion status for the selected date
	 */
	async toggleRecurringTaskComplete(task: TaskInfo, date?: Date): Promise<TaskInfo> {
		try {
			const targetDate = date || this.selectedDate;
			const updatedTask = await this.taskService.toggleRecurringTaskComplete(task, date);
			
			// Determine if task was completed or marked incomplete
			const dateStr = format(targetDate, 'yyyy-MM-dd');
			const wasCompleted = updatedTask.complete_instances?.includes(dateStr);
			const action = wasCompleted ? 'completed' : 'marked incomplete';
			
			new Notice(`Recurring task ${action} for ${format(targetDate, 'MMM d')}`);
			return updatedTask;
		} catch (error) {
			console.error('Failed to toggle recurring task completion:', error);
			new Notice('Failed to update recurring task');
			throw error;
		}
	}
	
	async toggleTaskArchive(task: TaskInfo): Promise<TaskInfo> {
		try {
			const updatedTask = await this.taskService.toggleArchive(task);
			const action = updatedTask.archived ? 'archived' : 'unarchived';
			new Notice(`Task ${action}`);
			return updatedTask;
		} catch (error) {
			console.error('Failed to toggle task archive:', error);
			new Notice('Failed to update task archive status');
			throw error;
		}
	}
	
	async toggleTaskStatus(task: TaskInfo): Promise<TaskInfo> {
		try {
			const updatedTask = await this.taskService.toggleStatus(task);
			const statusConfig = this.statusManager.getStatusConfig(updatedTask.status);
			new Notice(`Task marked as '${statusConfig?.label || updatedTask.status}'`);
			return updatedTask;
		} catch (error) {
			console.error('Failed to toggle task status:', error);
			new Notice('Failed to update task status');
			throw error;
		}
	}
	
	openTaskCreationModal(prePopulatedValues?: Partial<TaskInfo>) {
		new TaskCreationModal(this.app, this, prePopulatedValues).open();
	}

	
	/**
	 * Starts a time tracking session for a task
	 */
	async startTimeTracking(task: TaskInfo, description?: string): Promise<TaskInfo> {
		try {
			const updatedTask = await this.taskService.startTimeTracking(task);
			new Notice('Time tracking started');
			return updatedTask;
		} catch (error) {
			console.error('Failed to start time tracking:', error);
			if (error.message === 'Time tracking is already active for this task') {
				new Notice('Time tracking is already active for this task');
			} else {
				new Notice('Failed to start time tracking');
			}
			throw error;
		}
	}
	
	/**
	 * Stops the active time tracking session for a task
	 */
	async stopTimeTracking(task: TaskInfo): Promise<TaskInfo> {
		try {
			const updatedTask = await this.taskService.stopTimeTracking(task);
			new Notice('Time tracking stopped');
			return updatedTask;
		} catch (error) {
			console.error('Failed to stop time tracking:', error);
			if (error.message === 'No active time tracking session for this task') {
				new Notice('No active time tracking session for this task');
			} else {
				new Notice('Failed to stop time tracking');
			}
			throw error;
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

	/**
	 * Opens the task edit modal for a specific task
	 */
	async openTaskEditModal(task: TaskInfo) {
		// Always fetch fresh task data from file system to ensure we have the latest values
		const freshTask = await this.cacheManager.getTaskInfo(task.path, true);
		const taskToEdit = freshTask || task; // Fallback to original if file read fails
		
		new TaskEditModal(this.app, this, taskToEdit).open();
	}

	/**
	 * Opens a simple due date modal (placeholder for now)
	 */
	async openDueDateModal(task: TaskInfo) {
		try {
			const { DueDateModal } = await import('./modals/DueDateModal');
			const modal = new DueDateModal(this.app, task, this);
			modal.open();
		} catch (error) {
			console.error('Error loading DueDateModal:', error);
		}
	}

	async openScheduledDateModal(task: TaskInfo) {
		try {
			const { ScheduledDateModal } = await import('./modals/ScheduledDateModal');
			const modal = new ScheduledDateModal(this.app, task, this);
			modal.open();
		} catch (error) {
			console.error('Error loading ScheduledDateModal:', error);
		}
	}
	
	/**
	 * Refreshes the TaskNotes cache by clearing all cached data and re-initializing
	 */
	async refreshCache(): Promise<void> {
		try {
			// Show loading notice
			const loadingNotice = new Notice('Refreshing TaskNotes cache...', 0);
			
			// Clear all caches
			this.cacheManager.clearAllCaches();
			YAMLCache.clearCache();
			
			// Re-initialize the cache
			await this.cacheManager.initializeCache();
			
			// Notify all views to refresh
			this.notifyDataChanged(undefined, true, true);
			
			// Hide loading notice and show success
			loadingNotice.hide();
			new Notice('TaskNotes cache refreshed successfully');
			
		} catch (error) {
			console.error('Error refreshing cache:', error);
			new Notice('Failed to refresh cache. Please try again.');
		}
	}

	/**
	 * Convert any checkbox task on current line to TaskNotes task
	 */
	convertTaskToTaskNote(editor: Editor): void {
		try {
			const cursor = editor.getCursor();
			const currentLine = editor.getLine(cursor.line);
			
			// Parse the current line for Tasks plugin format
			const taskLineInfo = TasksPluginParser.parseTaskLine(currentLine);
			
			if (!taskLineInfo.isTaskLine) {
				new Notice('Current line is not a task. Place cursor on a line with a checkbox task.');
				return;
			}
			
			if (taskLineInfo.error) {
				new Notice(`Error parsing task: ${taskLineInfo.error}`);
				return;
			}
			
			if (!taskLineInfo.parsedData) {
				new Notice('Failed to parse task data from current line.');
				return;
			}
			
			// Prepare conversion options
			const conversionOptions: TaskConversionOptions = {
				parsedData: taskLineInfo.parsedData,
				editor: editor,
				lineNumber: cursor.line
			};
			
			// Open TaskCreationModal with pre-populated data
			new TaskCreationModal(this.app, this, undefined, conversionOptions).open();
			
		} catch (error) {
			console.error('Error converting task:', error);
			new Notice('Failed to convert task. Please try again.');
		}
	}

}