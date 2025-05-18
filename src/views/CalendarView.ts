import { Notice, TFile, View, WorkspaceLeaf, normalizePath } from 'obsidian';
import { format } from 'date-fns';
import ChronoSyncPlugin from '../main';
import { CALENDAR_VIEW_TYPE, TaskInfo, NoteInfo, TimeInfo } from '../types';
import { 
	extractNoteInfo, 
	extractTaskInfo, 
	extractTimeblockContent, 
	isTaskOverdue, 
	isSameDay, 
	parseTime 
} from '../utils/helpers';

export class CalendarView extends View {
	plugin: ChronoSyncPlugin;
	currentDate: Date;
	viewType: 'month' | 'week' = 'month';
	activeTab: 'tasks' | 'notes' | 'timeblock' = 'tasks';
	
	// Caches for heatmap data
	private monthNotesCache: Map<string, Map<string, number>> = new Map(); // year-month -> date -> count
	private monthTasksCache: Map<string, Map<string, {count: number, hasDue: boolean, hasCompleted: boolean}>> = new Map();
	private monthDailyNotesCache: Map<string, Set<string>> = new Map(); // year-month -> Set of dates
  
	constructor(leaf: WorkspaceLeaf, plugin: ChronoSyncPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.currentDate = new Date();
	}
  
	getViewType(): string {
		return CALENDAR_VIEW_TYPE;
	}
  
	getDisplayText(): string {
		return 'Calendar';
	}
  
	getIcon(): string {
		return 'calendar-days';
	}
  
	async onOpen() {
		// Clear and prepare the content element
		const contentEl = this.containerEl;
		contentEl.empty();
		
		// Add a container for our view content
		const container = contentEl.createDiv({ cls: 'chronosync-container' });
		
		// Create and add UI elements
		container.createEl('h2', { text: 'ChronoSync Calendar' });
		
		// Create the calendar UI
		this.renderView(container);
	}

	renderView(container: HTMLElement) {
		// Clear existing content except the header
		const header = container.querySelector('h2');
		container.empty();
		if (header) container.appendChild(header);
		
		// Create the calendar UI
		this.createCalendarControls(container);
		
		if (this.viewType === 'month') {
			this.createCalendarGrid(container);
		} else {
			this.createWeekView(container);
		}
		
		this.createSidePanel(container);
	}
	
	navigateToPreviousPeriod() {
		if (this.viewType === 'month') {
			// Go to previous month
			this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, 1);
		} else {
			// Go to previous week
			this.currentDate = new Date(this.currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
		}
		
		this.refreshView();
	}
	
	navigateToNextPeriod() {
		if (this.viewType === 'month') {
			// Go to next month
			this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 1);
		} else {
			// Go to next week
			this.currentDate = new Date(this.currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);
		}
		
		this.refreshView();
	}
	
	navigateToToday() {
		this.currentDate = new Date();
		this.refreshView();
	}
	
	switchView(viewType: 'month' | 'week') {
		if (this.viewType === viewType) return;
		this.viewType = viewType;
		this.refreshView();
	}
  
	async onClose() {
		// Clean up when the view is closed
		this.containerEl.empty();
	}
	
	// Helper method to refresh the view
	refreshView() {
		// Store the current active tab
		const activeTabBefore = this.activeTab;
		
		// Get the current month-year key for caching
		const currentMonthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		
		// If the month has changed, clear the caches
		if (!this.monthNotesCache.has(currentMonthKey) || 
			!this.monthTasksCache.has(currentMonthKey) || 
			!this.monthDailyNotesCache.has(currentMonthKey)) {
			
			// Force cache refresh for the current month
			this.buildCalendarCaches(currentMonthKey);
		}
		
		const container = this.containerEl.querySelector('.chronosync-container') as HTMLElement;
		if (container) {
			this.renderView(container);
			
			// Restore the active tab
			if (activeTabBefore) {
				// Find the tab and click it
				const tabSelector = `.chronosync-tab[data-tab="${activeTabBefore}"]`;
				const tabButton = container.querySelector(tabSelector);
				if (tabButton) {
					(tabButton as HTMLElement).click();
				}
			}
		}
	}
	
	// Method to build all caches for a given month
	async buildCalendarCaches(monthKey: string) {
		const [year, month] = monthKey.split('-').map(Number);
		
		// Create month caches if they don't exist
		if (!this.monthNotesCache.has(monthKey)) {
			this.monthNotesCache.set(monthKey, new Map());
		}
		
		if (!this.monthTasksCache.has(monthKey)) {
			this.monthTasksCache.set(monthKey, new Map());
		}
		
		if (!this.monthDailyNotesCache.has(monthKey)) {
			this.monthDailyNotesCache.set(monthKey, new Set());
		}
		
		// Get the cache references - we know these exist since we just created them
		const notesCache = this.monthNotesCache.get(monthKey)!;
		const tasksCache = this.monthTasksCache.get(monthKey)!;
		const dailyNotesCache = this.monthDailyNotesCache.get(monthKey)!;
		
		// Get all notes in vault
		const notes = await this.getNotesForView(false); // false to get all notes, not just for selected date
		
		// Get all tasks in vault
		const tasks = await this.getTasksForView();
		
		// Calculate start and end dates for the month
		const startOfMonth = new Date(year, month, 1);
		const endOfMonth = new Date(year, month + 1, 0);
		
		// Process notes for the cache
		for (const note of notes) {
			if (note.createdDate) {
				const noteDate = new Date(note.createdDate);
				// Check if the note is within the current month
				if (noteDate >= startOfMonth && noteDate <= endOfMonth) {
					const dateKey = format(noteDate, 'yyyy-MM-dd');
					// Increment count for the date
					notesCache.set(dateKey, (notesCache.get(dateKey) || 0) + 1);
				}
			}
		}
		
		// Process tasks for the cache
		for (const task of tasks) {
			if (task.due) {
				const dueDate = new Date(task.due);
				// Check if the task is due within the current month
				if (dueDate >= startOfMonth && dueDate <= endOfMonth) {
					const dateKey = format(dueDate, 'yyyy-MM-dd');
					// Get or create the task info for this date
					const taskInfo = tasksCache.get(dateKey) || { count: 0, hasDue: false, hasCompleted: false };
					
					// Update task info
					taskInfo.count++;
					taskInfo.hasDue = true;
					taskInfo.hasCompleted = taskInfo.hasCompleted || task.status.toLowerCase() === 'done';
					
					// Update the cache
					tasksCache.set(dateKey, taskInfo);
				}
			}
		}
		
		// Check for daily notes in the month
		const dailyNotesFolder = this.plugin.settings.dailyNotesFolder;
		const files = this.app.vault.getFiles().filter(file => 
			file.path.startsWith(dailyNotesFolder) && file.extension === 'md'
		);
		
		for (const file of files) {
			const filename = file.basename;
			// Check if filename is in YYYY-MM-DD format
			if (/^\d{4}-\d{2}-\d{2}$/.test(filename)) {
				const fileDate = new Date(filename);
				// If the file is for the current month, add to cache
				if (fileDate.getFullYear() === year && fileDate.getMonth() === month) {
					dailyNotesCache.add(filename);
				}
			}
		}
	}
  
	createCalendarControls(container: HTMLElement) {
		const controlsContainer = container.createDiv({ cls: 'calendar-controls' });
		
		// Add month navigation
		const navContainer = controlsContainer.createDiv({ cls: 'calendar-nav' });
		
		const prevButton = navContainer.createEl('button', { text: '←' });
		prevButton.addEventListener('click', () => {
			this.navigateToPreviousPeriod();
		});
		
		const currentMonth = navContainer.createEl('span', { 
			text: format(this.currentDate, 'MMMM yyyy'), 
			cls: 'current-month' 
		});
		
		const todayButton = navContainer.createEl('button', { text: 'Today' });
		todayButton.addEventListener('click', () => {
			this.navigateToToday();
		});
		
		const nextButton = navContainer.createEl('button', { text: '→' });
		nextButton.addEventListener('click', () => {
			this.navigateToNextPeriod();
		});
		
		// Add view type switcher
		const viewContainer = controlsContainer.createDiv({ cls: 'view-switcher' });
		
		const monthButton = viewContainer.createEl('button', { text: 'Month' });
		if (this.viewType === 'month') monthButton.classList.add('active');
		monthButton.addEventListener('click', () => {
			this.switchView('month');
		});
		
		const weekButton = viewContainer.createEl('button', { text: 'Week' });
		if (this.viewType === 'week') weekButton.classList.add('active');
		weekButton.addEventListener('click', () => {
			this.switchView('week');
		});
	}
  
	createCalendarGrid(container: HTMLElement) {
		const calendarContainer = container.createDiv({ cls: 'calendar-grid-container' });
		const grid = calendarContainer.createDiv({ cls: 'calendar-grid' });
		
		// Create header with day names
		const header = grid.createDiv({ cls: 'calendar-header' });
		const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		
		for (const day of dayNames) {
			header.createDiv({ cls: 'calendar-day-header', text: day });
		}
		
		// Get current year and month from the currentDate
		const currentYear = this.currentDate.getFullYear();
		const currentMonth = this.currentDate.getMonth();
		
		// First day of the month
		const firstDay = new Date(currentYear, currentMonth, 1);
		// Last day of the month
		const lastDay = new Date(currentYear, currentMonth + 1, 0);
		
		// Get the day of the week for the first day (0 = Sunday, 6 = Saturday)
		const firstDayOfWeek = firstDay.getDay();
		
		// Calculate the total number of cells needed (max 6 rows of 7 days)
		const totalDays = lastDay.getDate();
		const totalCells = Math.ceil((totalDays + firstDayOfWeek) / 7) * 7;
		
		// Create the grid cells
		for (let i = 0; i < totalCells; i++) {
			const dayCell = grid.createDiv({ cls: 'calendar-day' });
			
			// Calculate the day number
			const dayNumber = i - firstDayOfWeek + 1;
			
			if (dayNumber > 0 && dayNumber <= totalDays) {
				// Regular day in current month
				dayCell.textContent = dayNumber.toString();
				
				const cellDate = new Date(currentYear, currentMonth, dayNumber);
				
				// Highlight today
				const today = new Date();
				if (today.getFullYear() === cellDate.getFullYear() && 
					today.getMonth() === cellDate.getMonth() && 
					today.getDate() === cellDate.getDate()) {
					dayCell.classList.add('today');
				}
				
				// Highlight selected date
				if (isSameDay(cellDate, this.currentDate)) {
					dayCell.classList.add('selected');
				}
				
				// Add click event handler - just select the date, don't open the note
				dayCell.addEventListener('click', () => {
					// Update current date and refresh the view
					this.currentDate = new Date(cellDate);
					this.refreshView();
				});
				
				// Add double-click handler to open the daily note
				dayCell.addEventListener('dblclick', () => {
					// Navigate to daily note for this day
					this.navigateToDailyNote(cellDate);
				});
				
				
				// TODO: Add indicators for tasks, daily notes, etc.
			} else {
				// Day outside current month
				dayCell.classList.add('outside-month');
				
				// Calculate the actual date for days outside current month
				let date: Date;
				if (dayNumber <= 0) {
					// Days from previous month
					const prevMonth = new Date(currentYear, currentMonth - 1, 1);
					const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
					date = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), daysInPrevMonth + dayNumber);
					dayCell.textContent = date.getDate().toString();
				} else {
					// Days from next month
					const nextMonth = new Date(currentYear, currentMonth + 1, 1);
					date = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), dayNumber - totalDays);
					dayCell.textContent = date.getDate().toString();
				}
				
				// Highlight selected date
				if (isSameDay(date, this.currentDate)) {
					dayCell.classList.add('selected');
				}
				
				// Add click event handler for days outside current month - just select the date
				dayCell.addEventListener('click', () => {
					// Update current date and refresh the view
					this.currentDate = new Date(date);
					this.refreshView();
				});
				
				// Add double-click handler to open the daily note
				dayCell.addEventListener('dblclick', () => {
					// Navigate to daily note for this day
					this.navigateToDailyNote(date);
				});
			}
		}
	}
	
	createWeekView(container: HTMLElement) {
		const weekContainer = container.createDiv({ cls: 'week-view-container' });
		const grid = weekContainer.createDiv({ cls: 'week-grid' });
		
		// Determine the start of the week (Sunday of the week containing currentDate)
		const currentDate = new Date(this.currentDate);
		const dayOfWeek = currentDate.getDay();
		const startOfWeek = new Date(currentDate);
		startOfWeek.setDate(currentDate.getDate() - dayOfWeek);
		
		// Create header with day names and dates
		const header = grid.createDiv({ cls: 'week-header' });
		const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		
		for (let i = 0; i < 7; i++) {
			const date = new Date(startOfWeek);
			date.setDate(startOfWeek.getDate() + i);
			
			const dayHeader = header.createDiv({ cls: 'week-day-header' });
			dayHeader.createDiv({ cls: 'week-day-name', text: dayNames[i] });
			dayHeader.createDiv({ cls: 'week-day-date', text: format(date, 'MMM d') });
			
			// Highlight today
			const today = new Date();
			if (today.getFullYear() === date.getFullYear() && 
				today.getMonth() === date.getMonth() && 
				today.getDate() === date.getDate()) {
				dayHeader.classList.add('today');
			}
			
			// Highlight selected date
			if (isSameDay(date, this.currentDate)) {
				dayHeader.classList.add('selected');
			}
			
			// Add click event to select the day
			dayHeader.addEventListener('click', () => {
				this.currentDate = new Date(date);
				this.refreshView();
			});
			
			// Add double-click event to navigate to the daily note
			dayHeader.addEventListener('dblclick', () => {
				this.navigateToDailyNote(date);
			});
			
		}
		
		// Create time slots for the week view
		const timeContainer = grid.createDiv({ cls: 'week-time-container' });
		
		// Start and end times based on settings
		const startTime = parseTime(this.plugin.settings.timeblockStartTime);
		const endTime = parseTime(this.plugin.settings.timeblockEndTime);
		const intervalMinutes = parseInt(this.plugin.settings.timeblockInterval);
		
		if (!startTime || !endTime) return;
		
		const startMinutes = startTime.hours * 60 + startTime.minutes;
		const endMinutes = endTime.hours * 60 + endTime.minutes;
		
		for (let minutes = startMinutes; minutes <= endMinutes; minutes += intervalMinutes) {
			const hours = Math.floor(minutes / 60);
			const mins = minutes % 60;
			const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
			
			const timeRow = timeContainer.createDiv({ cls: 'week-time-row' });
			timeRow.createDiv({ cls: 'week-time-label', text: timeStr });
			
			const timeGrid = timeRow.createDiv({ cls: 'week-time-grid' });
			
			// Create a cell for each day in the week
			for (let i = 0; i < 7; i++) {
				const date = new Date(startOfWeek);
				date.setDate(startOfWeek.getDate() + i);
				
				const cell = timeGrid.createDiv({ cls: 'week-time-cell' });
				
				// Add highlight for current time if it matches
				const now = new Date();
				if (now.getFullYear() === date.getFullYear() && 
					now.getMonth() === date.getMonth() && 
					now.getDate() === date.getDate() &&
					now.getHours() === hours &&
					Math.floor(now.getMinutes() / intervalMinutes) * intervalMinutes === mins) {
					cell.classList.add('current-time');
				}
				
				// Add click handler to edit the timeblock
				cell.addEventListener('click', () => {
					// TODO: Implement timeblock editing
					new Notice(`Editing timeblock for ${format(date, 'yyyy-MM-dd')} at ${timeStr}`);
				});
			}
		}
	}
  
	createSidePanel(container: HTMLElement) {
		const mainContent = container.createDiv({ cls: 'chronosync-main-content' });
		
		// Create tabs for different views
		const tabsContainer = mainContent.createDiv({ cls: 'chronosync-tabs' });
		
		const tasksTab = tabsContainer.createEl('button', { 
			text: 'Tasks', 
			cls: 'chronosync-tab active',
			attr: { 'data-tab': 'tasks' }
		});
		const notesTab = tabsContainer.createEl('button', { 
			text: 'Notes', 
			cls: 'chronosync-tab',
			attr: { 'data-tab': 'notes' }
		});
		const timeblockTab = tabsContainer.createEl('button', { 
			text: 'Timeblock', 
			cls: 'chronosync-tab',
			attr: { 'data-tab': 'timeblock' }
		});
		
		// Create content area
		const contentArea = mainContent.createDiv({ cls: 'chronosync-content-area' });
		
		// Initial content - Tasks view
		this.createTasksView(contentArea);
		
		// Store active tab reference
		this.activeTab = 'tasks';
		
		// Set up tab switching
		tasksTab.addEventListener('click', () => {
			this.setActiveTab(tabsContainer, tasksTab);
			contentArea.empty();
			this.activeTab = 'tasks';
			this.createTasksView(contentArea);
			
			// Update calendar colorization for tasks
			this.colorizeCalendarForTasks();
		});
		
		notesTab.addEventListener('click', () => {
			this.setActiveTab(tabsContainer, notesTab);
			contentArea.empty();
			this.activeTab = 'notes';
			this.createNotesView(contentArea);
			
			// Update calendar heatmap for notes
			this.colorizeCalendarForNotes();
		});
		
		timeblockTab.addEventListener('click', () => {
			this.setActiveTab(tabsContainer, timeblockTab);
			contentArea.empty();
			this.activeTab = 'timeblock';
			this.createTimeblockView(contentArea);
			
			// Update calendar colorization for daily notes
			this.colorizeCalendarForDailyNotes();
		});
		
		// Initially colorize the calendar for tasks tab
		this.colorizeCalendarForTasks();
	}
	
	// Method to colorize calendar for notes tab (heatmap)
	colorizeCalendarForNotes() {
		// Get current month key for cache
		const monthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		const notesCache = this.monthNotesCache.get(monthKey);
		
		if (!notesCache) return;
		
		// Find all calendar days
		const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
		
		// Clear any existing note indicators
		calendarDays.forEach(day => {
			day.classList.remove('has-notes', 'has-few-notes', 'has-some-notes', 'has-many-notes');
			// Remove any existing indicator elements
			const indicators = day.querySelectorAll('.note-indicator');
			indicators.forEach(indicator => indicator.remove());
		});
		
		// Add heatmap classes based on note count
		calendarDays.forEach(day => {
			const dateText = (day as HTMLElement).innerText.trim();
			if (dateText) {
				// Create the date string in yyyy-MM-dd format
				const year = this.currentDate.getFullYear();
				const month = this.currentDate.getMonth();
				const date = parseInt(dateText);
				
				// Skip if the date is not valid
				if (isNaN(date)) return;
				
				// Adjust for days outside current month
				let actualMonth = month;
				if (day.classList.contains('outside-month')) {
					if (date > 15) { // Probably previous month
						actualMonth = month === 0 ? 11 : month - 1;
					} else { // Probably next month
						actualMonth = month === 11 ? 0 : month + 1;
					}
				}
				
				const dateObj = new Date(year, actualMonth, date);
				const dateKey = format(dateObj, 'yyyy-MM-dd');
				
				// Get note count for this date
				const noteCount = notesCache.get(dateKey) || 0;
				
				if (noteCount > 0) {
					// Create indicator element
					const indicator = document.createElement('div');
					indicator.className = 'note-indicator';
					
					// Apply heatmap classes based on note count
					if (noteCount >= 5) {
						day.classList.add('has-many-notes');
						indicator.classList.add('many-notes');
					} else if (noteCount >= 3) {
						day.classList.add('has-some-notes');
						indicator.classList.add('some-notes');
					} else {
						day.classList.add('has-few-notes');
						indicator.classList.add('few-notes');
					}
					
					// Add indicator to the day cell
					day.appendChild(indicator);
				}
			}
		});
	}
	
	// Method to colorize calendar for tasks tab
	colorizeCalendarForTasks() {
		// Get current month key for cache
		const monthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		const tasksCache = this.monthTasksCache.get(monthKey);
		
		if (!tasksCache) return;
		
		// Find all calendar days
		const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
		
		// Clear any existing task indicators
		calendarDays.forEach(day => {
			day.classList.remove('has-tasks', 'has-completed-tasks');
			// Remove any existing indicator elements
			const indicators = day.querySelectorAll('.task-indicator');
			indicators.forEach(indicator => indicator.remove());
		});
		
		// Add task indicators
		calendarDays.forEach(day => {
			const dateText = (day as HTMLElement).innerText.trim();
			if (dateText) {
				// Create the date string in yyyy-MM-dd format
				const year = this.currentDate.getFullYear();
				const month = this.currentDate.getMonth();
				const date = parseInt(dateText);
				
				// Skip if the date is not valid
				if (isNaN(date)) return;
				
				// Adjust for days outside current month
				let actualMonth = month;
				if (day.classList.contains('outside-month')) {
					if (date > 15) { // Probably previous month
						actualMonth = month === 0 ? 11 : month - 1;
					} else { // Probably next month
						actualMonth = month === 11 ? 0 : month + 1;
					}
				}
				
				const dateObj = new Date(year, actualMonth, date);
				const dateKey = format(dateObj, 'yyyy-MM-dd');
				
				// Get task info for this date
				const taskInfo = tasksCache.get(dateKey);
				
				if (taskInfo && taskInfo.hasDue) {
					// Create indicator element
					const indicator = document.createElement('div');
					indicator.className = 'task-indicator';
					
					// Different styling for completed and due tasks
					if (taskInfo.hasCompleted) {
						day.classList.add('has-completed-tasks');
						indicator.classList.add('completed-tasks');
					} else {
						day.classList.add('has-tasks');
						indicator.classList.add('due-tasks');
					}
					
					// Add indicator to the day cell
					day.appendChild(indicator);
				}
			}
		});
	}
	
	// Method to colorize calendar for daily notes (timeblock tab)
	colorizeCalendarForDailyNotes() {
		// Get current month key for cache
		const monthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		const dailyNotesCache = this.monthDailyNotesCache.get(monthKey);
		
		if (!dailyNotesCache) return;
		
		// Find all calendar days
		const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
		
		// Clear any existing daily note indicators
		calendarDays.forEach(day => {
			day.classList.remove('has-daily-note');
			// Remove any existing indicator elements
			const indicators = day.querySelectorAll('.daily-note-indicator');
			indicators.forEach(indicator => indicator.remove());
		});
		
		// Add daily note indicators
		calendarDays.forEach(day => {
			const dateText = (day as HTMLElement).innerText.trim();
			if (dateText) {
				// Create the date string in yyyy-MM-dd format
				const year = this.currentDate.getFullYear();
				const month = this.currentDate.getMonth();
				const date = parseInt(dateText);
				
				// Skip if the date is not valid
				if (isNaN(date)) return;
				
				// Adjust for days outside current month
				let actualMonth = month;
				if (day.classList.contains('outside-month')) {
					if (date > 15) { // Probably previous month
						actualMonth = month === 0 ? 11 : month - 1;
					} else { // Probably next month
						actualMonth = month === 11 ? 0 : month + 1;
					}
				}
				
				// Format the date as the file basename
				const dateObj = new Date(year, actualMonth, date);
				const dateStr = format(dateObj, 'yyyy-MM-dd');
				
				// Check if we have a daily note for this date
				if (dailyNotesCache.has(dateStr)) {
					// Create indicator element
					const indicator = document.createElement('div');
					indicator.className = 'daily-note-indicator';
					
					// Add class to the day
					day.classList.add('has-daily-note');
					
					// Add indicator to the day cell
					day.appendChild(indicator);
				}
			}
		});
	}
  
	setActiveTab(container: HTMLElement, activeTab: HTMLElement) {
		const tabs = container.querySelectorAll('.chronosync-tab');
		tabs.forEach(tab => tab.classList.remove('active'));
		activeTab.classList.add('active');
	}
  
	async createTasksView(container: HTMLElement) {
		container.createEl('h3', { text: 'Tasks' });
		
		// Create filters
		const filtersContainer = container.createDiv({ cls: 'task-filters' });
		
		// Status filter
		const statusFilter = filtersContainer.createDiv({ cls: 'filter-group' });
		statusFilter.createEl('span', { text: 'Status: ' });
		const statusSelect = statusFilter.createEl('select', { cls: 'status-select' });
		
		const statuses = ['All', 'Open', 'In Progress', 'Done'];
		statuses.forEach(status => {
			const option = statusSelect.createEl('option', { value: status.toLowerCase(), text: status });
		});
		
		// Add task button
		const addButton = filtersContainer.createEl('button', { text: 'New Task', cls: 'add-task-button' });
		addButton.addEventListener('click', () => {
			// Use the TaskCreationModal from the plugin
			this.plugin.openTaskCreationModal();
		});
		
		// Task list
		const taskList = container.createDiv({ cls: 'task-list' });
		
		// Get tasks for the current view
		const tasks = await this.getTasksForView();
		
		// Add change event listener to the status filter
		statusSelect.addEventListener('change', async () => {
			const selectedStatus = statusSelect.value;
			const allTasks = await this.getTasksForView();
			
			// Filter tasks based on selected status
			const filteredTasks = selectedStatus === 'all' 
				? allTasks 
				: allTasks.filter(task => task.status.toLowerCase() === selectedStatus);
			
			// Refresh the task list
			this.renderTaskItems(taskList, filteredTasks);
		});
		
		// Initial task rendering with all tasks (no filtering)
		this.renderTaskItems(taskList, tasks);
	}
	
	// Helper method to render task items
	renderTaskItems(container: HTMLElement, tasks: TaskInfo[]) {
		// Clear the container
		container.empty();
		
		if (tasks.length === 0) {
			// Placeholder for empty task list
			container.createEl('p', { text: 'No tasks found for the selected filters.' });
		} else {
			// Create task items
			tasks.forEach(task => {
				const taskItem = container.createDiv({ cls: 'task-item' });
				
				const taskInfo = taskItem.createDiv({ cls: 'task-info' });
				taskInfo.createDiv({ 
					cls: `task-item-title task-priority-${task.priority}`, 
					text: task.title
				});
				
				if (task.due) {
					taskInfo.createDiv({ 
						cls: `task-item-due ${isTaskOverdue(task) ? 'task-overdue' : ''}`,
						text: `Due: ${task.due}`
					});
				}
				
				const taskMeta = taskItem.createDiv({ cls: 'task-item-metadata' });
				
				taskMeta.createDiv({
					cls: `task-status task-status-${task.status.replace(/\s+/g, '-').toLowerCase()}`,
					text: task.status
				});
				
				// Add click handler to open task
				taskItem.addEventListener('click', () => {
					this.openTask(task.path);
				});
			});
		}
	}
  
	async createNotesView(container: HTMLElement) {
		// Get the selected date as a string for display
		const selectedDate = this.getSingleSelectedDate();
		const dateText = selectedDate ? `Notes for ${format(selectedDate, 'MMM d, yyyy')}` : 'All Notes';
		
		container.createEl('h3', { text: dateText });
		
		// Notes list
		const notesList = container.createDiv({ cls: 'notes-list' });
		
		// Get notes for the current view
		const notes = await this.getNotesForView();
		
		if (notes.length === 0) {
			// Placeholder for empty notes list
			notesList.createEl('p', { text: 'No notes found for the selected date.' });
		} else {
			// Create note items
			notes.forEach(note => {
				const noteItem = notesList.createDiv({ cls: 'note-item' });
				
				noteItem.createDiv({ cls: 'note-item-title', text: note.title });
				
				// Add created date if available
				if (note.createdDate) {
					const dateStr = note.createdDate.indexOf('T') > 0 
						? format(new Date(note.createdDate), 'MMM d, yyyy h:mm a') 
						: note.createdDate;
					noteItem.createDiv({ cls: 'note-item-date', text: `Created: ${dateStr}` });
				}
				
				if (note.tags && note.tags.length > 0) {
					const tagContainer = noteItem.createDiv({ cls: 'note-item-tags' });
					note.tags.forEach(tag => {
						tagContainer.createSpan({ cls: 'note-tag', text: tag });
					});
				}
				
				// Add click handler to open note
				noteItem.addEventListener('click', () => {
					this.openNote(note.path);
				});
			});
		}
	}
  
	async createTimeblockView(container: HTMLElement) {
		container.createEl('h3', { text: 'Timeblock' });
		
		// Get the daily note for the specific date
		const date = this.getSingleSelectedDate();
		
		if (!date) {
			// No specific date selected in current view
			container.createEl('p', { text: 'Select a specific date to view timeblocks.' });
			return;
		}
		
		const dateStr = format(date, 'yyyy-MM-dd');
		const dailyNotePath = normalizePath(`${this.plugin.settings.dailyNotesFolder}/${dateStr}.md`);
		
		// Check if the daily note exists
		const fileExists = await this.app.vault.adapter.exists(dailyNotePath);
		if (!fileExists) {
			container.createEl('p', { text: `No daily note exists for ${format(date, 'MMMM d, yyyy')}. Click a date to create one.` });
			
			const createButton = container.createEl('button', { text: 'Create daily note', cls: 'create-note-button' });
			createButton.addEventListener('click', () => {
				this.navigateToDailyNote(date);
			});
			
			return;
		}
		
		// Timeblock editor
		const timeblockEditor = container.createDiv({ cls: 'timeblock-editor' });
		
		// Get the timeblock content from the daily note
		const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			const timeblockContent = extractTimeblockContent(content);
			
			if (timeblockContent) {
				// Create a timeblock table
				const table = timeblockEditor.createEl('table', { cls: 'timeblock-table' });
				
				// Parse the timeblock content and create rows
				const rows = timeblockContent.trim().split('\n').slice(1); // Skip header row
				
				rows.forEach(row => {
					const [time, activity] = row.split('|').map(cell => cell.trim()).filter(cell => cell);
					
					if (time && time !== '----') {
						const tr = table.createEl('tr');
						tr.createEl('td', { cls: 'timeblock-time', text: time });
						
						const activityTd = tr.createEl('td', { cls: 'timeblock-activity' });
						if (activity) {
							activityTd.textContent = activity;
						}
						
						// Make the activity cell editable
						activityTd.addEventListener('click', () => {
							this.editTimeblockActivity(date, time, activityTd, dailyNotePath);
						});
					}
				});
			} else {
				// No timeblock found
				timeblockEditor.createEl('p', { text: 'No timeblock found in the daily note.' });
				
				const generateButton = timeblockEditor.createEl('button', { 
					text: 'Generate timeblock', 
					cls: 'generate-timeblock-button' 
				});
				
				generateButton.addEventListener('click', async () => {
					// Generate a timeblock table and add it to the daily note
					await this.addTimeblockToNote(file);
					// Refresh the view
					this.createTimeblockView(container);
				});
			}
		}
	}
	
	async getTasksForView(): Promise<TaskInfo[]> {
		const result: TaskInfo[] = [];
		const taskTag = this.plugin.settings.taskTag;
		
		// Get all markdown files in the vault
		const files = this.app.vault.getFiles().filter(file => 
			file.extension === 'md'
		);
		
		// Extract task information from each file
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				const noteInfo = extractNoteInfo(content, file.path, file);
				
				// Check if this note has the task tag
				if (noteInfo && noteInfo.tags && noteInfo.tags.includes(taskTag)) {
					const taskInfo = extractTaskInfo(content, file.path);
					
					if (taskInfo) {
						// Include all tasks regardless of due date or any other filters
						result.push(taskInfo);
					}
				}
			} catch (e) {
				console.error(`Error processing file ${file.path}:`, e);
			}
		}
		
		// Sort tasks by due date, then priority
		return result.sort((a, b) => {
			// Sort by due date
			if (a.due && b.due) {
				return new Date(a.due).getTime() - new Date(b.due).getTime();
			}
			// Tasks with due dates come before tasks without
			if (a.due && !b.due) return -1;
			if (!a.due && b.due) return 1;
			
			// Then sort by priority
			const priorityOrder = { high: 0, normal: 1, low: 2 };
			return priorityOrder[a.priority as keyof typeof priorityOrder] - priorityOrder[b.priority as keyof typeof priorityOrder];
		});
	}
	
	async getNotesForView(filterByDate: boolean = true): Promise<NoteInfo[]> {
		const result: NoteInfo[] = [];
		const taskTag = this.plugin.settings.taskTag;
		
		// Get all markdown files in the vault
		const files = this.app.vault.getFiles().filter(file => 
			file.extension === 'md'
		);
		
		// Get the selected date
		const selectedDate = this.getSingleSelectedDate();
		const selectedDateStr = selectedDate && filterByDate ? format(selectedDate, 'yyyy-MM-dd') : null;
		
		// Extract note information from each file
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				const noteInfo = extractNoteInfo(content, file.path, file);
				
				// Include notes that don't have the task tag
				if (noteInfo && 
					(!noteInfo.tags || !noteInfo.tags.includes(taskTag)) && 
					file.path !== this.plugin.settings.homeNotePath && 
					!file.path.startsWith(this.plugin.settings.dailyNotesFolder)) {
					
					// Only include notes that match the selected date's creation date if filtering by date
					if (!filterByDate || !selectedDateStr || (noteInfo.createdDate && noteInfo.createdDate.startsWith(selectedDateStr))) {
						result.push(noteInfo);
					}
				}
			} catch (e) {
				console.error(`Error processing note file ${file.path}:`, e);
			}
		}
		
		// Sort notes by title
		return result.sort((a, b) => a.title.localeCompare(b.title));
	}
	
	async addTimeblockToNote(file: TFile) {
		try {
			// Read the content
			const content = await this.app.vault.read(file);
			
			// Check if it already has a timeblock section
			if (extractTimeblockContent(content)) {
				new Notice('Note already has a timeblock section');
				return;
			}
			
			// Parse the settings for timeblock generation
			const startTime = parseTime(this.plugin.settings.timeblockStartTime);
			const endTime = parseTime(this.plugin.settings.timeblockEndTime);
			const interval = parseInt(this.plugin.settings.timeblockInterval);
			
			if (!startTime || !endTime) {
				new Notice('Invalid timeblock settings');
				return;
			}
			
			// Generate the timeblock table
			const timeblockTable = this.plugin.generateTimeblockTable();
			
			// Append the timeblock to the content
			const updatedContent = `${content.trim()}\n\n## Timeblock\n\n${timeblockTable}\n`;
			
			// Update the file
			await this.app.vault.modify(file, updatedContent);
			
			new Notice('Timeblock added to daily note');
		} catch (e) {
			console.error('Error adding timeblock to note:', e);
			new Notice('Error adding timeblock to note');
		}
	}
	
	async editTimeblockActivity(date: Date, time: string, cell: HTMLElement, notePath: string) {
		// Create an input element
		const input = document.createElement('input');
		input.type = 'text';
		input.value = cell.textContent || '';
		input.className = 'timeblock-edit-input';
		input.style.width = '100%';
		
		// Replace the cell content with the input
		cell.empty();
		cell.appendChild(input);
		input.focus();
		
		// Handle saving on enter or blur
		const saveChange = async () => {
			const newValue = input.value;
			cell.textContent = newValue;
			
			// Update the note file
			await this.updateTimeblockInNote(time, newValue, notePath);
		};
		
		input.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				await saveChange();
			} else if (e.key === 'Escape') {
				// Restore original content
				cell.textContent = input.value;
			}
		});
		
		input.addEventListener('blur', async () => {
			await saveChange();
		});
	}
	
	async updateTimeblockInNote(time: string, activity: string, notePath: string) {
		try {
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (!(file instanceof TFile)) return;
			
			const content = await this.app.vault.read(file);
			const timeblockMatch = content.match(/## Timeblock\s*\n([^#]*)/);
			
			if (!timeblockMatch) return;
			
			const timeblockContent = timeblockMatch[1].trim();
			const lines = timeblockContent.split('\n');
			
			// Find the line with the matching time
			let updatedTimeblock = lines.map(line => {
				if (line.includes(`| ${time} |`)) {
					return `| ${time} | ${activity} |`;
				}
				return line;
			}).join('\n');
			
			// Replace the timeblock in the content
			const updatedContent = content.replace(
				/## Timeblock\s*\n([^#]*)/,
				`## Timeblock\n\n${updatedTimeblock}\n`
			);
			
			// Update the file
			await this.app.vault.modify(file, updatedContent);
		} catch (e) {
			console.error('Error updating timeblock in note:', e);
			new Notice('Error updating timeblock');
		}
	}
	
	getSingleSelectedDate(): Date | null {
		if (this.viewType === 'week') {
			// For week view, return the current date
			return this.currentDate;
		} else {
			// For month view, if the user has selected a specific day, return that
			return this.currentDate;
		}
	}
	
	getViewStartDate(): Date {
		if (this.viewType === 'month') {
			// First day of the month
			return new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
		} else if (this.viewType === 'week') {
			// Start of the week (Sunday)
			const date = new Date(this.currentDate);
			const dayOfWeek = date.getDay();
			date.setDate(date.getDate() - dayOfWeek);
			return date;
		}
		return this.currentDate;
	}
	
	getViewEndDate(): Date {
		if (this.viewType === 'month') {
			// Last day of the month
			return new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);
		} else if (this.viewType === 'week') {
			// End of the week (Saturday)
			const date = new Date(this.currentDate);
			const dayOfWeek = date.getDay();
			date.setDate(date.getDate() + (6 - dayOfWeek));
			return date;
		}
		return this.currentDate;
	}
	
	openTask(path: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			this.app.workspace.getLeaf(false).openFile(file);
		}
	}
	
	openNote(path: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			this.app.workspace.getLeaf(false).openFile(file);
		}
	}
  
	async navigateToDailyNote(date: Date) {
		await this.plugin.navigateToDailyNote(date);
	}
}