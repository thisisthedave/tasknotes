import { Notice, TFile, View, WorkspaceLeaf, normalizePath } from 'obsidian';
import { format } from 'date-fns';
import ChronoSyncPlugin from '../main';
import { 
    CALENDAR_VIEW_TYPE, 
    EVENT_DATA_CHANGED,
    EVENT_TAB_CHANGED,
    TaskInfo, 
    NoteInfo, 
    TimeInfo 
} from '../types';
import { 
    extractNoteInfo, 
    extractTaskInfo, 
    isSameDay, 
    parseTime 
} from '../utils/helpers';

export class CalendarView extends View {
    plugin: ChronoSyncPlugin;
    viewType: 'month' = 'month';
    
    // Caches for heatmap data
    private monthNotesCache: Map<string, Map<string, number>> = new Map(); // year-month -> date -> count
    private monthTasksCache: Map<string, Map<string, {count: number, hasDue: boolean, hasCompleted: boolean, hasArchived: boolean}>> = new Map();
    private monthDailyNotesCache: Map<string, Set<string>> = new Map(); // year-month -> Set of dates
    
    // Event listeners
    private listeners: (() => void)[] = [];
  
    constructor(leaf: WorkspaceLeaf, plugin: ChronoSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Register event listeners
        this.registerEvents();
    }
    
    registerEvents(): void {
        // Clean up any existing listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        this.listeners = [];
        
        // Listen for data changes
        const dataListener = this.plugin.emitter.on(EVENT_DATA_CHANGED, () => {
            this.refresh();
        });
        this.listeners.push(dataListener);
        
        // Listen for tab changes and update colorization
        const tabListener = this.plugin.emitter.on(EVENT_TAB_CHANGED, (tab: string) => {
            // Update the view to show the correct colorization
            const container = this.containerEl.querySelector('.chronosync-container') as HTMLElement;
            if (container) {
                this.colorizeCalendar();
            }
        });
        this.listeners.push(tabListener);
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
        const container = contentEl.createDiv({ cls: 'chronosync-container calendar-view-container' });
        
        // Pre-build the cache for the current month
        const currentMonthKey = `${this.plugin.selectedDate.getFullYear()}-${this.plugin.selectedDate.getMonth()}`;
        
        // Show loading indicator while building initial cache
        this.showLoadingIndicator();
        
        // Start rendering the view immediately
        this.renderView(container);
        
        // Build the cache in the background
        await this.buildCalendarCaches(currentMonthKey);
        
        // Refresh the view once the cache is built
        await this.refresh();
    }

    renderView(container: HTMLElement) {
        // Clear existing content
        container.empty();
        
        // Create the calendar UI
        this.createCalendarControls(container);
        
        // Create the calendar grid
        this.createCalendarGrid(container);
        
        // Add colorization based on the currently active detail tab
        this.colorizeCalendar();
    }
    
    colorizeCalendar() {
        switch (this.plugin.activeTab) {
            case 'tasks':
                this.colorizeCalendarForTasks();
                break;
            case 'notes':
                this.colorizeCalendarForNotes();
                break;
            case 'timeblock':
                this.colorizeCalendarForDailyNotes();
                break;
        }
    }
    
    async navigateToPreviousPeriod() {
        // Go to previous month
        const date = new Date(this.plugin.selectedDate);
        date.setMonth(date.getMonth() - 1);
        this.plugin.setSelectedDate(date);
        
        // Get the new month key
        const newMonthKey = `${this.plugin.selectedDate.getFullYear()}-${this.plugin.selectedDate.getMonth()}`;
        
        // Preload the cache for the new month in the background
        await this.buildCalendarCaches(newMonthKey);
        
        // Then refresh the view
        await this.refresh();
    }
    
    async navigateToNextPeriod() {
        // Go to next month
        const date = new Date(this.plugin.selectedDate);
        date.setMonth(date.getMonth() + 1);
        this.plugin.setSelectedDate(date);
        
        // Get the new month key
        const newMonthKey = `${this.plugin.selectedDate.getFullYear()}-${this.plugin.selectedDate.getMonth()}`;
        
        // Preload the cache for the new month in the background
        await this.buildCalendarCaches(newMonthKey);
        
        // Then refresh the view
        await this.refresh();
    }
    
    async navigateToToday() {
        const today = new Date();
        this.plugin.setSelectedDate(today);
        
        // Get the current month key
        const currentMonthKey = `${today.getFullYear()}-${today.getMonth()}`;
        
        // Ensure cache is built for current month
        await this.buildCalendarCaches(currentMonthKey);
        
        // Then refresh the view
        await this.refresh();
    }
    
  
    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        
        // Clean up when the view is closed
        this.containerEl.empty();
    }
    
    // Helper method to refresh the view
    async refresh() {
        // Get the current month-year key for caching
        const currentMonthKey = `${this.plugin.selectedDate.getFullYear()}-${this.plugin.selectedDate.getMonth()}`;
        
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
            const notes = await this.getNotesForMonth(startOfMonth, endOfMonth);
            
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
            const tasks = await this.getTasksForMonth(startOfMonth, endOfMonth);
            
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
        
        // Group the current month display with navigation buttons
        const monthNavigationGroup = navContainer.createDiv({ cls: 'month-navigation-group' });
        
        const prevButton = monthNavigationGroup.createEl('button', { text: '←' });
        prevButton.addEventListener('click', () => {
            this.navigateToPreviousPeriod();
        });
        
        const currentMonth = monthNavigationGroup.createEl('span', { 
            text: format(this.plugin.selectedDate, 'MMMM yyyy'), 
            cls: 'current-month' 
        });
        
        const nextButton = monthNavigationGroup.createEl('button', { text: '→' });
        nextButton.addEventListener('click', () => {
            this.navigateToNextPeriod();
        });
        
        // Today button on the right side
        const todayButton = navContainer.createEl('button', { text: 'Today', cls: 'today-button' });
        todayButton.addEventListener('click', () => {
            this.navigateToToday();
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
        
        // Get current year and month from the plugin.selectedDate
        const currentYear = this.plugin.selectedDate.getFullYear();
        const currentMonth = this.plugin.selectedDate.getMonth();
        
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
                if (isSameDay(cellDate, this.plugin.selectedDate)) {
                    dayCell.classList.add('selected');
                }
                
                // Add click event handler - select the date and notify other views
                dayCell.addEventListener('click', () => {
                    // Update selected date
                    this.plugin.setSelectedDate(new Date(cellDate));
                    
                    // Also refresh the view
                    this.refresh();
                });
                
                // Add double-click handler to open the daily note
                dayCell.addEventListener('dblclick', () => {
                    // Navigate to daily note for this day
                    this.plugin.navigateToDailyNote(cellDate);
                });
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
                if (isSameDay(date, this.plugin.selectedDate)) {
                    dayCell.classList.add('selected');
                }
                
                // Add click event handler for days outside current month
                dayCell.addEventListener('click', () => {
                    // Update selected date
                    this.plugin.setSelectedDate(new Date(date));
                    
                    // Also refresh the view
                    this.refresh();
                });
                
                // Add double-click handler to open the daily note
                dayCell.addEventListener('dblclick', () => {
                    // Navigate to daily note for this day
                    this.plugin.navigateToDailyNote(date);
                });
            }
        }
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
        const monthKey = `${this.plugin.selectedDate.getFullYear()}-${this.plugin.selectedDate.getMonth()}`;
        const notesCache = this.monthNotesCache.get(monthKey);
        
        if (!notesCache) return;
        
        // Find all calendar days
        const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
        
        // Add heatmap classes based on note count
        calendarDays.forEach(day => {
            const dateText = (day as HTMLElement).innerText.trim();
            if (dateText) {
                // Create the date string in yyyy-MM-dd format
                const year = this.plugin.selectedDate.getFullYear();
                const month = this.plugin.selectedDate.getMonth();
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
        const monthKey = `${this.plugin.selectedDate.getFullYear()}-${this.plugin.selectedDate.getMonth()}`;
        const tasksCache = this.monthTasksCache.get(monthKey);
        
        if (!tasksCache) return;
        
        // Find all calendar days
        const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
        
        // Add task indicators
        calendarDays.forEach(day => {
            const dateText = (day as HTMLElement).innerText.trim();
            if (dateText) {
                // Create the date string in yyyy-MM-dd format
                const year = this.plugin.selectedDate.getFullYear();
                const month = this.plugin.selectedDate.getMonth();
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
        const monthKey = `${this.plugin.selectedDate.getFullYear()}-${this.plugin.selectedDate.getMonth()}`;
        const dailyNotesCache = this.monthDailyNotesCache.get(monthKey);
        
        if (!dailyNotesCache) return;
        
        // Find all calendar days
        const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
        
        // Add daily note indicators
        calendarDays.forEach(day => {
            const dateText = (day as HTMLElement).innerText.trim();
            if (dateText) {
                // Create the date string in yyyy-MM-dd format
                const year = this.plugin.selectedDate.getFullYear();
                const month = this.plugin.selectedDate.getMonth();
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
    
    // Helper methods for date calculations
    getViewStartDate(): Date {
        // First day of the month
        return new Date(this.plugin.selectedDate.getFullYear(), this.plugin.selectedDate.getMonth(), 1);
    }
    
    getViewEndDate(): Date {
        // Last day of the month
        return new Date(this.plugin.selectedDate.getFullYear(), this.plugin.selectedDate.getMonth() + 1, 0);
    }
    
    // Get notes for a specific month
    async getNotesForMonth(startDate: Date, endDate: Date): Promise<NoteInfo[]> {
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
                
                // Include notes that don't have the task tag and have a creation date
                if (noteInfo && 
                    (!noteInfo.tags || !noteInfo.tags.includes(taskTag)) && 
                    file.path !== this.plugin.settings.homeNotePath && 
                    !file.path.startsWith(this.plugin.settings.dailyNotesFolder)) {
                    
                    if (noteInfo.createdDate) {
                        // Only include notes created in the target month
                        const createdDate = new Date(noteInfo.createdDate);
                        if (createdDate >= startDate && createdDate <= endDate) {
                            result.push(noteInfo);
                        }
                    }
                }
            } catch (e) {
                console.error(`Error processing note file ${file.path}:`, e);
            }
        }
        
        return result;
    }
    
    // Get tasks for a specific month
    async getTasksForMonth(startDate: Date, endDate: Date): Promise<TaskInfo[]> {
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
                    
                    if (taskInfo && taskInfo.due) {
                        // Only include tasks due in the target month
                        const dueDate = new Date(taskInfo.due);
                        if (dueDate >= startDate && dueDate <= endDate) {
                            result.push(taskInfo);
                        }
                    }
                }
            } catch (e) {
                console.error(`Error processing file ${file.path}:`, e);
            }
        }
        
        return result;
    }
}