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
	private monthTasksCache: Map<string, Map<string, {count: number, hasDue: boolean, hasCompleted: boolean, hasArchived: boolean}>> = new Map();
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
		
		// Pre-build the cache for the current month
		const currentMonthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		
		// Show loading indicator while building initial cache
		this.showLoadingIndicator();
		
		// Start rendering the view immediately
		this.renderView(container);
		
		// Build the cache in the background
		await this.buildCalendarCaches(currentMonthKey);
		
		// Refresh the view once the cache is built
		await this.refreshView();
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
	
	async navigateToPreviousPeriod() {
		if (this.viewType === 'month') {
			// Go to previous month
			this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1, 1);
		} else {
			// Go to previous week
			this.currentDate = new Date(this.currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
		}
		
		// Get the new month key
		const newMonthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		
		// Preload the cache for the new month in the background
		await this.buildCalendarCaches(newMonthKey);
		
		// Then refresh the view
		await this.refreshView();
	}
	
	async navigateToNextPeriod() {
		if (this.viewType === 'month') {
			// Go to next month
			this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 1);
		} else {
			// Go to next week
			this.currentDate = new Date(this.currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);
		}
		
		// Get the new month key
		const newMonthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		
		// Preload the cache for the new month in the background
		await this.buildCalendarCaches(newMonthKey);
		
		// Then refresh the view
		await this.refreshView();
	}
	
	async navigateToToday() {
		this.currentDate = new Date();
		
		// Get the current month key
		const currentMonthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		
		// Ensure cache is built for current month
		await this.buildCalendarCaches(currentMonthKey);
		
		// Then refresh the view
		await this.refreshView();
	}
	
	async switchView(viewType: 'month' | 'week') {
		if (this.viewType === viewType) return;
		this.viewType = viewType;
		
		// If switching to week view, ensure we have data for the week's month
		if (viewType === 'week') {
			const weekStart = this.getViewStartDate();
			const weekEnd = this.getViewEndDate();
			
			// If week crosses month boundary, ensure both months are cached
			const startMonthKey = `${weekStart.getFullYear()}-${weekStart.getMonth()}`;
			const endMonthKey = `${weekEnd.getFullYear()}-${weekEnd.getMonth()}`;
			
			// Build caches for start and end months if they're different
			await this.buildCalendarCaches(startMonthKey);
			if (startMonthKey !== endMonthKey) {
				await this.buildCalendarCaches(endMonthKey);
			}
		} else {
			// For month view, just ensure current month is cached
			const monthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
			await this.buildCalendarCaches(monthKey);
		}
		
		await this.refreshView();
	}
  
	async onClose() {
		// Clean up when the view is closed
		this.containerEl.empty();
	}
	
	// Helper method to refresh the view
	async refreshView() {
		// Store the current active tab
		const activeTabBefore = this.activeTab;
		
		// Get the current month-year key for caching
		const currentMonthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		
		// Check if we need to build/refresh the cache
		const cacheTimestamp = this.cacheTimestamps.get(currentMonthKey) || 0;
		const cacheAge = Date.now() - cacheTimestamp;
		
		// If cache is older than the invalidation time or doesn't exist, rebuild it
		if (cacheAge > this.CACHE_INVALIDATION_TIME || 
			!this.monthNotesCache.has(currentMonthKey) || 
			!this.monthTasksCache.has(currentMonthKey) || 
			!this.monthDailyNotesCache.has(currentMonthKey)) {
			
			// Force cache refresh for the current month
			await this.buildCalendarCaches(currentMonthKey);
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
	
	// Date when cache was last built for each month
	private cacheTimestamps: Map<string, number> = new Map();
	// Flag to indicate if cache building is in progress
	private isBuildingCache: boolean = false;
	// Cache invalidation time in milliseconds - 5 minutes
	private CACHE_INVALIDATION_TIME = 5 * 60 * 1000;

	// Method to build all caches for a given month
	async buildCalendarCaches(monthKey: string) {
		// If cache is being built, show a loading indicator and wait
		if (this.isBuildingCache) {
			this.showLoadingIndicator();
			return;
		}

		// Set building flag to prevent multiple builds
		this.isBuildingCache = true;
		this.showLoadingIndicator();

		try {
			const [year, month] = monthKey.split('-').map(Number);
			
			// Check cache timestamp - if recently built, skip rebuilding
			const cacheTimestamp = this.cacheTimestamps.get(monthKey) || 0;
			const cacheAge = Date.now() - cacheTimestamp;
			
			// If cache is fresh enough, don't rebuild
			if (cacheAge < this.CACHE_INVALIDATION_TIME && 
				this.monthNotesCache.has(monthKey) && 
				this.monthTasksCache.has(monthKey) && 
				this.monthDailyNotesCache.has(monthKey)) {
				
				// Update timestamp to indicate we checked this cache
				this.cacheTimestamps.set(monthKey, Date.now());
				this.hideLoadingIndicator();
				return;
			}
			
			// Create month caches if they don't exist
			if (!this.monthNotesCache.has(monthKey)) {
				this.monthNotesCache.set(monthKey, new Map());
			} else {
				// Clear existing data if rebuilding
				this.monthNotesCache.get(monthKey)!.clear();
			}
			
			if (!this.monthTasksCache.has(monthKey)) {
				this.monthTasksCache.set(monthKey, new Map());
			} else {
				// Clear existing data if rebuilding
				this.monthTasksCache.get(monthKey)!.clear();
			}
			
			if (!this.monthDailyNotesCache.has(monthKey)) {
				this.monthDailyNotesCache.set(monthKey, new Set());
			} else {
				// Clear existing data if rebuilding
				this.monthDailyNotesCache.get(monthKey)!.clear();
			}
			
			// Get the cache references - we know these exist since we just created them
			const notesCache = this.monthNotesCache.get(monthKey)!;
			const tasksCache = this.monthTasksCache.get(monthKey)!;
			const dailyNotesCache = this.monthDailyNotesCache.get(monthKey)!;
			
			// Calculate start and end dates for the month
			const startOfMonth = new Date(year, month, 1);
			const endOfMonth = new Date(year, month + 1, 0);
			
			// Process notes - retrieve and cache asynchronously
			const notes = await this.getNotesForView(false); // false to get all notes, not just for selected date
			
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
			
			// Process tasks - retrieve and cache asynchronously
			const tasks = await this.getTasksForView();
			
			// Process tasks for the cache
			for (const task of tasks) {
				if (task.due) {
					const dueDate = new Date(task.due);
					// Check if the task is due within the current month
					if (dueDate >= startOfMonth && dueDate <= endOfMonth) {
						const dateKey = format(dueDate, 'yyyy-MM-dd');
						// Get or create the task info for this date
						const taskInfo = tasksCache.get(dateKey) || { 
							count: 0, 
							hasDue: false, 
							hasCompleted: false,
							hasArchived: false 
						};
						
						// Update task info
						taskInfo.count++;
						taskInfo.hasDue = true;
						taskInfo.hasCompleted = taskInfo.hasCompleted || task.status.toLowerCase() === 'done';
						taskInfo.hasArchived = taskInfo.hasArchived || task.archived;
						
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
			
			// Update the timestamp for this cache
			this.cacheTimestamps.set(monthKey, Date.now());
		} catch (error) {
			console.error('Error building calendar caches:', error);
		} finally {
			// Always reset the flag and hide the indicator
			this.isBuildingCache = false;
			this.hideLoadingIndicator();
		}
	}

	// Show a loading indicator while building cache
	private showLoadingIndicator() {
		const container = this.containerEl.querySelector('.chronosync-container');
		if (!container) return;

		// Check if indicator already exists
		if (container.querySelector('.cache-loading-indicator')) return;

		const indicator = document.createElement('div');
		indicator.className = 'cache-loading-indicator';
		indicator.innerHTML = 'Loading calendar data...';
		container.prepend(indicator);
	}

	// Hide the loading indicator
	private hideLoadingIndicator() {
		const indicator = this.containerEl.querySelector('.cache-loading-indicator');
		if (indicator) {
			indicator.remove();
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
				dayCell.addEventListener('click', async () => {
					// Update current date
					this.currentDate = new Date(cellDate);
					
					// If tasks tab is active, we need to re-sort the task list based on the new date
					if (this.activeTab === 'tasks' && this.taskListContainer) {
						const tasks = await this.getTasksForView(false); // Use cache
						const selectedDateStr = format(cellDate, 'yyyy-MM-dd');
						
						// Get the active status filter
						const statusSelect = this.containerEl.querySelector('.status-select') as HTMLSelectElement;
						const selectedStatus = statusSelect ? statusSelect.value : 'all';
						
						// Apply filtering logic based on status and archived flag
						let filteredTasks: TaskInfo[] = [];
						
						if (selectedStatus === 'archived') {
							// Show only archived tasks
							filteredTasks = tasks.filter(task => task.archived);
						} else {
							// For all other statuses including 'all', exclude archived tasks
							const nonArchivedTasks = tasks.filter(task => !task.archived);
							
							if (selectedStatus === 'all') {
								// 'All' means all non-archived tasks
								filteredTasks = nonArchivedTasks;
							} else {
								// Other status filters apply only to non-archived tasks
								filteredTasks = nonArchivedTasks.filter(task => 
									task.status.toLowerCase() === selectedStatus
								);
							}
						}
							
						// Sort tasks with selected date first
						this.prioritizeTasksByDate(filteredTasks, selectedDateStr);
						
						// Update the task list without reloading all tasks
						this.renderTaskItems(this.taskListContainer, filteredTasks, selectedDateStr);
					}
					
					// If notes tab is active, filter notes by the selected date
					if (this.activeTab === 'notes') {
						const contentArea = this.containerEl.querySelector('.chronosync-content-area') as HTMLElement;
						if (contentArea) {
							contentArea.empty();
							this.createNotesView(contentArea);
						}
					}
					
					// Still refresh the rest of the view (calendar, etc.)
					await this.refreshView();
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
				dayCell.addEventListener('click', async () => {
					// Update current date
					this.currentDate = new Date(date);
					
					// If tasks tab is active, we need to re-sort the task list based on the new date
					if (this.activeTab === 'tasks' && this.taskListContainer) {
						const tasks = await this.getTasksForView(false); // Use cache
						const selectedDateStr = format(date, 'yyyy-MM-dd');
						
						// Get the active status filter
						const statusSelect = this.containerEl.querySelector('.status-select') as HTMLSelectElement;
						const selectedStatus = statusSelect ? statusSelect.value : 'all';
						
						// Apply filtering logic based on status and archived flag
						let filteredTasks: TaskInfo[] = [];
						
						if (selectedStatus === 'archived') {
							// Show only archived tasks
							filteredTasks = tasks.filter(task => task.archived);
						} else {
							// For all other statuses including 'all', exclude archived tasks
							const nonArchivedTasks = tasks.filter(task => !task.archived);
							
							if (selectedStatus === 'all') {
								// 'All' means all non-archived tasks
								filteredTasks = nonArchivedTasks;
							} else {
								// Other status filters apply only to non-archived tasks
								filteredTasks = nonArchivedTasks.filter(task => 
									task.status.toLowerCase() === selectedStatus
								);
							}
						}
							
						// Sort tasks with selected date first
						this.prioritizeTasksByDate(filteredTasks, selectedDateStr);
						
						// Update the task list without reloading all tasks
						this.renderTaskItems(this.taskListContainer, filteredTasks, selectedDateStr);
					}
					
					// If notes tab is active, filter notes by the selected date
					if (this.activeTab === 'notes') {
						const contentArea = this.containerEl.querySelector('.chronosync-content-area') as HTMLElement;
						if (contentArea) {
							contentArea.empty();
							this.createNotesView(contentArea);
						}
					}
					
					// Still refresh the rest of the view (calendar, etc.)
					await this.refreshView();
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
	
	// Clear all calendar colorization
	clearCalendarColorization() {
		// Find all calendar days
		const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
		
		// Clear all classes and indicators
		calendarDays.forEach(day => {
			// Remove all indicator-related classes
			day.classList.remove(
				'has-notes', 'has-few-notes', 'has-some-notes', 'has-many-notes',
				'has-tasks', 'has-completed-tasks', 'has-archived-tasks',
				'has-daily-note'
			);
			
			// Remove all indicator elements
			const indicators = day.querySelectorAll('.note-indicator, .task-indicator, .daily-note-indicator');
			indicators.forEach(indicator => indicator.remove());
		});
	}
	
	// Method to colorize calendar for notes tab (heatmap)
	colorizeCalendarForNotes() {
		// First clear all existing colorization
		this.clearCalendarColorization();
		
		// Get current month key for cache
		const monthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		const notesCache = this.monthNotesCache.get(monthKey);
		
		if (!notesCache) return;
		
		// Find all calendar days
		const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
		
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
					let noteCategory = '';
					if (noteCount >= 5) {
						day.classList.add('has-many-notes');
						indicator.classList.add('many-notes');
						noteCategory = 'Many';
					} else if (noteCount >= 3) {
						day.classList.add('has-some-notes');
						indicator.classList.add('some-notes');
						noteCategory = 'Some';
					} else {
						day.classList.add('has-few-notes');
						indicator.classList.add('few-notes');
						noteCategory = 'Few';
					}
					
					// Add tooltip with note count information
					indicator.setAttribute('aria-label', `${noteCategory} notes (${noteCount})`);
					indicator.setAttribute('title', `${noteCategory} notes (${noteCount})`);
					
					// Add indicator to the day cell
					day.appendChild(indicator);
				}
			}
		});
	}
	
	// Method to colorize calendar for tasks tab
	colorizeCalendarForTasks() {
		// First clear all existing colorization
		this.clearCalendarColorization();
		
		// Get current month key for cache
		const monthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		const tasksCache = this.monthTasksCache.get(monthKey);
		
		if (!tasksCache) return;
		
		// Find all calendar days
		const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
		
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
					
					// Different styling for completed, due, and archived tasks
					let taskStatus = '';
					if (taskInfo.hasArchived) {
						// Archived tasks get a different style
						day.classList.add('has-archived-tasks');
						indicator.classList.add('archived-tasks');
						taskStatus = 'Archived';
					} else if (taskInfo.hasCompleted) {
						// Completed tasks
						day.classList.add('has-completed-tasks');
						indicator.classList.add('completed-tasks');
						taskStatus = 'Completed';
					} else {
						// Due tasks
						day.classList.add('has-tasks');
						indicator.classList.add('due-tasks');
						taskStatus = 'Due';
					}
					
					// Add tooltip with task count information
					indicator.setAttribute('aria-label', `${taskStatus} tasks (${taskInfo.count})`);
					indicator.setAttribute('title', `${taskStatus} tasks (${taskInfo.count})`);
					
					// Add indicator to the day cell
					day.appendChild(indicator);
				}
			}
		});
	}
	
	// Method to colorize calendar for daily notes (timeblock tab)
	colorizeCalendarForDailyNotes() {
		// First clear all existing colorization
		this.clearCalendarColorization();
		
		// Get current month key for cache
		const monthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		const dailyNotesCache = this.monthDailyNotesCache.get(monthKey);
		
		if (!dailyNotesCache) return;
		
		// Find all calendar days
		const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
		
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
					
					// Add tooltip for daily note
					indicator.setAttribute('aria-label', 'Daily note exists');
					indicator.setAttribute('title', 'Daily note exists');
					
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
  
	// Store cached tasks to avoid unnecessary reloads
	private cachedTasks: TaskInfo[] | null = null;
	private lastTasksRefresh: number = 0;
	private readonly TASKS_CACHE_TTL = 60000; // 1 minute TTL for tasks cache

	async createTasksView(container: HTMLElement) {
		container.createEl('h3', { text: 'Tasks' });
		
		// Create filters
		const filtersContainer = container.createDiv({ cls: 'task-filters' });
		
		// Status filter
		const statusFilter = filtersContainer.createDiv({ cls: 'filter-group' });
		statusFilter.createEl('span', { text: 'Status: ' });
		const statusSelect = statusFilter.createEl('select', { cls: 'status-select' });
		
		const statuses = ['All', 'Open', 'In Progress', 'Done', 'Archived'];
		statuses.forEach(status => {
			const option = statusSelect.createEl('option', { value: status.toLowerCase(), text: status });
		});
		
		// Refresh button
		const refreshButton = filtersContainer.createEl('button', { 
			text: 'Refresh', 
			cls: 'refresh-tasks-button',
			attr: {
				'aria-label': 'Refresh task list',
				'title': 'Refresh task list'
			}
		});
		refreshButton.addEventListener('click', async () => {
			// Force refresh the cache
			this.cachedTasks = null;
			await this.refreshTaskView(container);
		});
		
		// Add task button
		const addButton = filtersContainer.createEl('button', { text: 'New Task', cls: 'add-task-button' });
		addButton.addEventListener('click', () => {
			// Use the TaskCreationModal from the plugin
			this.plugin.openTaskCreationModal();
		});
		
		// Task list
		const taskList = container.createDiv({ cls: 'task-list' });
		
		// Get tasks without triggering a full reload
		const tasks = await this.getTasksForView(false);
		
		// Add change event listener to the status filter
		statusSelect.addEventListener('change', async () => {
			const selectedStatus = statusSelect.value;
			const allTasks = await this.getTasksForView(false); // Use cache

			// Re-filter and re-prioritize tasks based on the selected date
			const selectedDate = this.getSingleSelectedDate();
			const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
			
			// Apply filtering logic based on status and archived flag
			let filteredTasks: TaskInfo[] = [];
			
			if (selectedStatus === 'archived') {
				// Show only archived tasks
				filteredTasks = allTasks.filter(task => task.archived);
			} else {
				// For other statuses, exclude archived tasks unless specifically requested
				const nonArchivedTasks = allTasks.filter(task => !task.archived);
				
				if (selectedStatus === 'all') {
					filteredTasks = nonArchivedTasks;
				} else {
					filteredTasks = nonArchivedTasks.filter(task => 
						task.status.toLowerCase() === selectedStatus
					);
				}
			}
				
			// Then sort the tasks to prioritize those due on the selected date
			this.prioritizeTasksByDate(filteredTasks, selectedDateStr);
			
			// Refresh the task list
			this.renderTaskItems(taskList, filteredTasks, selectedDateStr);
		});
		
		// Get the selected date
		const selectedDate = this.getSingleSelectedDate();
		const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
		
		// Apply initial filtering based on the default "all" status (exclude archived tasks)
		const nonArchivedTasks = tasks.filter(task => !task.archived);
		
		// Sort tasks to prioritize those due on the selected date
		this.prioritizeTasksByDate(nonArchivedTasks, selectedDateStr);
		
		// Initial task rendering with filtered tasks (non-archived)
		this.renderTaskItems(taskList, nonArchivedTasks, selectedDateStr);
		
		// Store reference to the task list container for future updates
		this.taskListContainer = taskList;
	}
	
	// Method to prioritize tasks by date
	private prioritizeTasksByDate(tasks: TaskInfo[], selectedDateStr: string | null): void {
		if (!selectedDateStr) return;
		
		// Sort with tasks due on selected date first, then by normal sort criteria
		tasks.sort((a, b) => {
			// First prioritize tasks due on the selected date
			const aIsDueOnSelectedDate = a.due === selectedDateStr;
			const bIsDueOnSelectedDate = b.due === selectedDateStr;
			
			if (aIsDueOnSelectedDate && !bIsDueOnSelectedDate) return -1;
			if (!aIsDueOnSelectedDate && bIsDueOnSelectedDate) return 1;
			
			// For tasks with the same priority on the selected date, use the normal sort
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
	
	// Method to refresh the task view when needed (e.g., after creating a new task)
	async refreshTaskView(container?: HTMLElement) {
		// Force reload tasks
		const tasks = await this.getTasksForView(true);
		
		// If container isn't provided, use the stored task list container
		if (!container && this.taskListContainer) {
			// Get the active status filter
			const statusSelect = this.containerEl.querySelector('.status-select') as HTMLSelectElement;
			const selectedStatus = statusSelect ? statusSelect.value : 'all';
			
			// Apply filtering logic based on status and archived flag
			let filteredTasks: TaskInfo[] = [];
			
			if (selectedStatus === 'archived') {
				// Show only archived tasks
				filteredTasks = tasks.filter(task => task.archived);
			} else {
				// For all other statuses including 'all', exclude archived tasks
				const nonArchivedTasks = tasks.filter(task => !task.archived);
				
				if (selectedStatus === 'all') {
					// 'All' means all non-archived tasks
					filteredTasks = nonArchivedTasks;
				} else {
					// Other status filters apply only to non-archived tasks
					filteredTasks = nonArchivedTasks.filter(task => 
						task.status.toLowerCase() === selectedStatus
					);
				}
			}
				
			// Get the selected date
			const selectedDate = this.getSingleSelectedDate();
			const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
			
			// Sort tasks
			this.prioritizeTasksByDate(filteredTasks, selectedDateStr);
			
			// Update the task list
			this.renderTaskItems(this.taskListContainer, filteredTasks, selectedDateStr);
			
			// Also refresh the calendar visualization
			const monthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
			// Only rebuild the cache for the current month 
			await this.buildCalendarCaches(monthKey);
			
			// Reapply colorization based on active tab
			if (this.activeTab === 'tasks') {
				this.colorizeCalendarForTasks();
			}
		}
	}
	
	// Reference to the task list container for updates
	private taskListContainer: HTMLElement | null = null;
	
	// Helper method to render task items
	renderTaskItems(container: HTMLElement, tasks: TaskInfo[], selectedDateStr: string | null = null) {
		// Clear the container
		container.empty();
		
		if (tasks.length === 0) {
			// Placeholder for empty task list
			container.createEl('p', { text: 'No tasks found for the selected filters.' });
		} else {
			// Check if we have tasks due on the selected date
			const tasksForSelectedDate = selectedDateStr 
				? tasks.filter(task => task.due === selectedDateStr)
				: [];
				
			// If we have tasks due on the selected date, create a section for them
			if (tasksForSelectedDate.length > 0 && selectedDateStr) {
				const selectedDateSection = container.createDiv({ cls: 'task-section selected-date-tasks' });
				selectedDateSection.createEl('h4', { 
					text: `Tasks due on ${format(new Date(selectedDateStr), 'MMM d, yyyy')}`,
					cls: 'task-section-header'
				});
				
				const selectedDateTaskList = selectedDateSection.createDiv({ cls: 'task-list' });
				
				// Create task items for selected date
				this.renderTaskGroup(selectedDateTaskList, tasksForSelectedDate, selectedDateStr);
				
				// If there are other tasks, add a separate section
				const otherTasks = tasks.filter(task => task.due !== selectedDateStr);
				
				if (otherTasks.length > 0) {
					const otherTasksSection = container.createDiv({ cls: 'task-section other-tasks' });
					otherTasksSection.createEl('h4', { 
						text: 'Other tasks',
						cls: 'task-section-header'
					});
					
					const otherTasksList = otherTasksSection.createDiv({ cls: 'task-list' });
					
					// Create task items for other tasks
					this.renderTaskGroup(otherTasksList, otherTasks, selectedDateStr);
				}
			} else {
				// No tasks on selected date, or no date selected - render all tasks together
				this.renderTaskGroup(container, tasks, selectedDateStr);
			}
		}
	}
	
	// Helper to render a group of tasks
	private renderTaskGroup(container: HTMLElement, tasks: TaskInfo[], selectedDateStr: string | null = null) {
		tasks.forEach(task => {
			// Determine if this task is due on the selected date
			const isDueOnSelectedDate = selectedDateStr && task.due === selectedDateStr;
			
			const taskItem = container.createDiv({ 
				cls: `task-item ${isDueOnSelectedDate ? 'task-due-today' : ''} ${task.archived ? 'task-archived' : ''}`
			});
			
			// Create header row (title and metadata)
			const taskHeader = taskItem.createDiv({ cls: 'task-header' });
			
			// Create info section (left side)
			const taskInfo = taskHeader.createDiv({ cls: 'task-info' });
			
			// Task title with priority
			taskInfo.createDiv({ 
				cls: `task-item-title task-priority-${task.priority}`, 
				text: task.title
			});
			
			// Due date
			if (task.due) {
				taskInfo.createDiv({ 
					cls: `task-item-due ${isTaskOverdue(task) ? 'task-overdue' : ''} ${isDueOnSelectedDate ? 'due-today' : ''}`,
					text: `Due: ${task.due}`
				});
			}
			
			// Create metadata section (right side)
			const taskMeta = taskHeader.createDiv({ cls: 'task-item-metadata' });
			
			// Status badge
			taskMeta.createDiv({
				cls: `task-status task-status-${task.status.replace(/\s+/g, '-').toLowerCase()}`,
				text: task.status
			});
			
			// Create archive button in the metadata section (top right)
			const archiveButton = taskMeta.createEl('button', { 
				cls: `archive-button-icon ${task.archived ? 'archived' : ''}`,
				attr: { 
					title: task.archived ? 'Unarchive this task' : 'Archive this task',
					'aria-label': task.archived ? 'Unarchive' : 'Archive'
				}
			});
			
			// Add icon based on archive status
			archiveButton.innerHTML = task.archived 
				? '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"></path></svg>'
				: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 9.5l5.5 5.5H14v2h-4v-2H6.5L12 9.5zM5.12 5l.81-1h12l.94 1H5.12z"></path></svg>';
			
			// Add event listener for archive toggle
			archiveButton.addEventListener('click', async (e) => {
				e.stopPropagation(); // Prevent task opening
				await this.toggleTaskArchive(task);
			});
			
			// Archived badge if applicable
			if (task.archived) {
				taskMeta.createDiv({
					cls: 'task-archived-badge',
					text: 'Archived'
				});
			}
			
			// Create controls row
			const taskControls = taskItem.createDiv({ cls: 'task-controls' });
			
			// Task status dropdown (direct child of controls grid)
			const statusSelect = taskControls.createEl('select', { cls: 'task-status-select' });
			
			// Add status options
			const statuses = ['Open', 'In Progress', 'Done'];
			statuses.forEach(status => {
				const option = statusSelect.createEl('option', { value: status.toLowerCase(), text: status });
				if (task.status.toLowerCase() === status.toLowerCase()) {
					option.selected = true;
				}
			});
			
			// Add event listener for status change
			statusSelect.addEventListener('change', async (e) => {
				e.stopPropagation(); // Prevent task opening
				const newStatus = (e.target as HTMLSelectElement).value;
				await this.updateTaskProperty(task, 'status', newStatus);
			});
			
			// Task priority dropdown (direct child of controls grid)
			const prioritySelect = taskControls.createEl('select', { cls: 'task-priority-select' });
			
			// Add priority options
			const priorities = ['High', 'Normal', 'Low'];
			priorities.forEach(priority => {
				const option = prioritySelect.createEl('option', { value: priority.toLowerCase(), text: priority });
				if (task.priority === priority.toLowerCase()) {
					option.selected = true;
				}
			});
			
			// Add event listener for priority change
			prioritySelect.addEventListener('change', async (e) => {
				e.stopPropagation(); // Prevent task opening
				const newPriority = (e.target as HTMLSelectElement).value;
				await this.updateTaskProperty(task, 'priority', newPriority);
			});
			
			// Due date input (direct child of controls grid)
			const dueDateInput = taskControls.createEl('input', { 
				type: 'date',
				cls: 'task-due-date-input',
				attr: { title: 'Set due date' }
			});
			
			// Set current due date if exists
				if (task.due) {
					dueDateInput.value = task.due;
				}
				
				// Add event listener for due date change
				dueDateInput.addEventListener('change', async (e) => {
					e.stopPropagation(); // Prevent task opening
					const newDueDate = (e.target as HTMLInputElement).value;
					await this.updateTaskProperty(task, 'due', newDueDate);
				});
				
				// Add click handler to open task (only on the task info part)
				taskInfo.addEventListener('click', () => {
					this.openTask(task.path);
				});
			});	}
	
	// Update a task property in the frontmatter
	async updateTaskProperty(task: TaskInfo, property: string, value: any): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
			// Read the file content
			const content = await this.app.vault.read(file);
			
			// Process the frontmatter
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				// Update the property
				frontmatter[property] = value;
			});
			
			// Show a notice
			new Notice(`Updated task ${property}`);
			
			// Refresh the task view
			await this.refreshTaskView();
		} catch (error) {
			console.error('Error updating task property:', error);
			new Notice('Failed to update task property');
		}
	}
	
	// Toggle archive status for a task
	async toggleTaskArchive(task: TaskInfo): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				new Notice(`Cannot find task file: ${task.path}`);
				return;
			}
			
			// Read the file content
			const content = await this.app.vault.read(file);
			
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
			
			// Refresh the task view
			await this.refreshTaskView();
		} catch (error) {
			console.error('Error toggling task archive status:', error);
			new Notice('Failed to update task archive status');
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
	
	async getTasksForView(forceRefresh: boolean = false): Promise<TaskInfo[]> {
		// Use cached tasks if available and not forcing refresh
		const now = Date.now();
		if (!forceRefresh && 
			this.cachedTasks && 
			now - this.lastTasksRefresh < this.TASKS_CACHE_TTL) {
			return [...this.cachedTasks]; // Return a copy to prevent modification of cache
		}
		
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
		const sortedResult = result.sort((a, b) => {
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
		
		// Update cache and timestamp
		this.cachedTasks = [...sortedResult];
		this.lastTasksRefresh = now;
		
		return sortedResult;
	}
	
	// Cache for notes
	private cachedNotes: NoteInfo[] | null = null;
	private lastNotesRefresh: number = 0;
	private readonly NOTES_CACHE_TTL = 60000; // 1 minute TTL for notes cache
	
	async getNotesForView(filterByDate: boolean = true, forceRefresh: boolean = false): Promise<NoteInfo[]> {
		// Use cached notes if available and not forcing refresh
		const now = Date.now();
		if (!forceRefresh &&
			this.cachedNotes && 
			now - this.lastNotesRefresh < this.NOTES_CACHE_TTL) {
			
			// We can filter the cached notes based on the selected date
			if (filterByDate) {
				const selectedDate = this.getSingleSelectedDate();
				const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
				
				if (selectedDateStr) {
					return this.cachedNotes.filter(note => 
						note.createdDate && note.createdDate.startsWith(selectedDateStr)
					);
				}
			}
			
			return [...this.cachedNotes]; // Return a copy to prevent modification of cache
		}
		
		const result: NoteInfo[] = [];
		const taskTag = this.plugin.settings.taskTag;
		
		// Get all markdown files in the vault
		const files = this.app.vault.getFiles().filter(file => 
			file.extension === 'md'
		);
		
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
					
					result.push(noteInfo);
				}
			} catch (e) {
				console.error(`Error processing note file ${file.path}:`, e);
			}
		}
		
		// Sort notes by title
		const sortedResult = result.sort((a, b) => a.title.localeCompare(b.title));
		
		// Update cache and timestamp - store all notes without date filtering
		this.cachedNotes = [...sortedResult];
		this.lastNotesRefresh = now;
		
		// Apply date filtering if needed
		if (filterByDate) {
			const selectedDate = this.getSingleSelectedDate();
			const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
			
			if (selectedDateStr) {
				return sortedResult.filter(note => 
					note.createdDate && note.createdDate.startsWith(selectedDateStr)
				);
			}
		}
		
		return sortedResult;
	}
	
	// Method to refresh the notes view (similar to refreshTaskView)
	async refreshNotesView() {
		// Force reload notes
		await this.getNotesForView(true, true);
		
		// Also refresh the calendar visualization
		const monthKey = `${this.currentDate.getFullYear()}-${this.currentDate.getMonth()}`;
		await this.buildCalendarCaches(monthKey);
		
		// Reapply colorization based on active tab
		if (this.activeTab === 'notes') {
			this.colorizeCalendarForNotes();
		}
		
		// Find the current container and refresh it if possible
		if (this.containerEl) {
			const contentArea = this.containerEl.querySelector('.chronosync-content-area') as HTMLElement;
			if (contentArea && this.activeTab === 'notes') {
				contentArea.empty();
				this.createNotesView(contentArea);
			}
		}
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