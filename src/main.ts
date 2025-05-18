import { Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import { 
	ChronoSyncSettings, 
	DEFAULT_SETTINGS, 
	ChronoSyncSettingTab 
} from './settings/settings';
import { 
	CALENDAR_VIEW_TYPE, 
	DETAIL_VIEW_TYPE,
	NOTES_VIEW_TYPE, 
	TASK_LIST_VIEW_TYPE,
	TimeInfo,
	DetailTab,
	TaskInfo,
	EVENT_DATE_SELECTED,
	EVENT_TAB_CHANGED,
	EVENT_DATA_CHANGED
} from './types';
import { CalendarView } from './views/CalendarView';
import { DetailView } from './views/DetailView';
import { TaskListView } from './views/TaskListView';
import { NotesView } from './views/NotesView';
import { TaskCreationModal } from './modals/TaskCreationModal';
import { 
	ensureFolderExists, 
	generateDailyNoteTemplate,
	parseTime, 
	updateYamlFrontmatter 
} from './utils/helpers';
import { EventEmitter } from './utils/EventEmitter';

export default class ChronoSyncPlugin extends Plugin {
	settings: ChronoSyncSettings;
	
	// Shared state between views
	selectedDate: Date = new Date();
	activeTab: DetailTab = 'tasks';
	
	// Event emitter for view communication
	emitter = new EventEmitter();
	
	async onload() {
		await this.loadSettings();

		// Register view types
		this.registerView(
			CALENDAR_VIEW_TYPE,
			(leaf) => new CalendarView(leaf, this)
		);
		this.registerView(
			DETAIL_VIEW_TYPE,
			(leaf) => new DetailView(leaf, this)
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
	 * Update the active detail tab and notify all views
	 */
	setActiveTab(tab: DetailTab): void {
		this.activeTab = tab;
		this.emitter.emit(EVENT_TAB_CHANGED, tab);
	}
	
	/**
	 * Notify views that data has changed and views should refresh
	 */
	notifyDataChanged(): void {
		this.emitter.emit(EVENT_DATA_CHANGED);
	}

	onunload() {
		// Views cleanup happens automatically
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
			id: 'open-detail-view',
			name: 'Open tasks/notes/timeblock view',
			callback: async () => {
				await this.activateDetailView();
			}
		});
		
		this.addCommand({
			id: 'open-linked-views',
			name: 'Open linked calendar and detail views',
			callback: async () => {
				await this.activateLinkedViews();
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

		// Note commands
		this.addCommand({
			id: 'go-to-today',
			name: 'Go to today\'s note',
			callback: async () => {
				await this.navigateToCurrentDailyNote();
			}
		});

		this.addCommand({
			id: 'go-to-home',
			name: 'Open home note',
			callback: async () => {
				await this.navigateToHomeNote();
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

		this.addCommand({
			id: 'toggle-important',
			name: 'Toggle daily important flag',
			callback: async () => {
				await this.toggleDailyMetadata('important');
			}
		});
	}

	async activateCalendarView() {
		const { workspace } = this.app;
		
		// Use existing calendar view if it exists
		let leaf = this.getCalendarLeaf();
		
		if (!leaf) {
			// Create new leaf for calendar view
			leaf = workspace.getLeaf('split', 'vertical');
			await leaf.setViewState({
				type: CALENDAR_VIEW_TYPE,
				active: true,
			});
		}
		
		// Reveal the leaf in case it's in a collapsed state
		workspace.revealLeaf(leaf);
	}
	
	async activateDetailView() {
		const { workspace } = this.app;
		
		// Use existing detail view if it exists
		let leaf = this.getDetailLeaf();
		
		if (!leaf) {
			// Create new leaf for detail view
			leaf = workspace.getLeaf('split', 'vertical');
			await leaf.setViewState({
				type: DETAIL_VIEW_TYPE,
				active: true,
			});
		}
		
		// Reveal the leaf in case it's in a collapsed state
		workspace.revealLeaf(leaf);
	}
	
	async activateLinkedViews() {
		const { workspace } = this.app;
		
		// Create or activate calendar view first
		await this.activateCalendarView();
		
		// Then create or activate detail view
		await this.activateDetailView();
	}

	getCalendarLeaf(): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);
		return leaves.length > 0 ? leaves[0] : null;
	}
	
	getDetailLeaf(): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(DETAIL_VIEW_TYPE);
		return leaves.length > 0 ? leaves[0] : null;
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
		
		if (!fileExists) {
			// Create the daily notes folder if it doesn't exist
			await ensureFolderExists(this.app.vault, this.settings.dailyNotesFolder);
			
			// Create daily note with default content
			const content = this.generateDailyNoteTemplate(date);
			await this.app.vault.create(dailyNotePath, content);
		}
		
		// Open the daily note
		const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
		if (file instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(file);
		}
	}

	async navigateToHomeNote() {
		const homeNotePath = this.settings.homeNotePath;
		
		// Check if the home note exists, if not create it
		const fileExists = await this.app.vault.adapter.exists(homeNotePath);
		
		if (!fileExists) {
			// Create the parent folder if it doesn't exist
			const folderPath = homeNotePath.substring(0, homeNotePath.lastIndexOf('/'));
			await ensureFolderExists(this.app.vault, folderPath);
			
			// Create home note with default content
			const content = '# ChronoSync Home\n\nWelcome to your ChronoSync Home note!\n';
			await this.app.vault.create(homeNotePath, content);
		}
		
		// Open the home note
		const file = this.app.vault.getAbstractFileByPath(homeNotePath);
		if (file instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(file);
		}
	}

	async incrementPomodoros() {
		await this.updateDailyNoteMetadata('pomodoros', (val) => {
			const current = typeof val === 'number' ? val : 0;
			return current + 1;
		});
	}

	async toggleDailyMetadata(key: 'workout' | 'meditate' | 'important') {
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

	async updateTaskProperty(task: TaskInfo, property: string, value: any): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
			// Process the frontmatter
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// Update the property
				frontmatter[property] = value;
			});
			
			// Show a notice
			new Notice(`Updated task ${property}`);
			
			// Notify views that data has changed
			this.notifyDataChanged();
		} catch (error) {
			console.error('Error updating task property:', error);
			new Notice('Failed to update task property');
		}
	}
	
	async toggleTaskArchive(task: TaskInfo): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
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
			
			// Notify views that data has changed
			this.notifyDataChanged();
		} catch (error) {
			console.error('Error toggling task archive status:', error);
			new Notice('Failed to update task archive status');
		}
	}
	
	openTaskCreationModal() {
		new TaskCreationModal(this.app, this).open();
	}
}