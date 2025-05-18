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
		});
		
		notesTab.addEventListener('click', () => {
			this.setActiveTab(tabsContainer, notesTab);
			contentArea.empty();
			this.activeTab = 'notes';
			this.createNotesView(contentArea);
		});
		
		timeblockTab.addEventListener('click', () => {
			this.setActiveTab(tabsContainer, timeblockTab);
			contentArea.empty();
			this.activeTab = 'timeblock';
			this.createTimeblockView(contentArea);
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
		const statusSelect = statusFilter.createEl('select');
		
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
		
		if (tasks.length === 0) {
			// Placeholder for empty task list
			taskList.createEl('p', { text: 'No tasks found for the selected date and filters.' });
		} else {
			// Create task items
			tasks.forEach(task => {
				const taskItem = taskList.createDiv({ cls: 'task-item' });
				
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
		const tasksFolder = this.plugin.settings.tasksFolder;
		const result: TaskInfo[] = [];
		
		// Ensure tasks folder exists
		const folderExists = await this.app.vault.adapter.exists(tasksFolder);
		if (!folderExists) return result;
		
		// Get all files in the tasks folder
		const files = this.app.vault.getFiles().filter(file => 
			file.path.startsWith(tasksFolder) && file.extension === 'md'
		);
		
		// Extract task information from each file
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				const taskInfo = extractTaskInfo(content, file.path);
				
				if (taskInfo) {
					// Filter based on current view date if it's a specific date
					if (this.viewType === 'month' || this.viewType === 'week') {
						// If we're in a specific date view, filter only tasks due in the current month/week
						if (taskInfo.due) {
							const dueDate = new Date(taskInfo.due);
							const startDate = this.getViewStartDate();
							const endDate = this.getViewEndDate();
							
							// Only include tasks due in the current view range
							if (dueDate >= startDate && dueDate <= endDate) {
								result.push(taskInfo);
							}
						} else {
							// Include tasks without due dates
							result.push(taskInfo);
						}
					} else {
						// For all other views, include all tasks
						result.push(taskInfo);
					}
				}
			} catch (e) {
				console.error(`Error processing task file ${file.path}:`, e);
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
	
	async getNotesForView(): Promise<NoteInfo[]> {
		const notesFolder = this.plugin.settings.notesFolder;
		const result: NoteInfo[] = [];
		
		// Ensure notes folder exists
		const folderExists = await this.app.vault.adapter.exists(notesFolder);
		if (!folderExists) return result;
		
		// Get all markdown files in the notes folder
		const files = this.app.vault.getFiles().filter(file => 
			file.path.startsWith(notesFolder) && file.extension === 'md'
		);
		
		// Get the selected date
		const selectedDate = this.getSingleSelectedDate();
		const selectedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
		
		// Extract note information from each file
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				const noteInfo = extractNoteInfo(content, file.path, file);
				
				if (noteInfo) {
					// Only include notes that match the selected date's creation date
					if (!selectedDateStr || (noteInfo.createdDate && noteInfo.createdDate.startsWith(selectedDateStr))) {
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