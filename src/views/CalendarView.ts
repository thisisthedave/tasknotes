import { Notice, TFile, View, WorkspaceLeaf, normalizePath } from 'obsidian';
import { format } from 'date-fns';
import ChronoSyncPlugin from '../main';
import { 
    CALENDAR_VIEW_TYPE, 
    EVENT_DATA_CHANGED,
    TaskInfo, 
    NoteInfo, 
    TimeInfo,
    ColorizeMode
} from '../types';
import { 
    extractNoteInfo, 
    extractTaskInfo, 
    isSameDay, 
    parseTime 
} from '../utils/helpers';

export class CalendarView extends View {
    // Static property to track initialization status for daily notes
    static dailyNotesInitialized: boolean = false;
    
    plugin: ChronoSyncPlugin;
    viewType: 'month' = 'month';
    colorizeMode: ColorizeMode = 'tasks';
    
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
        
        // Show loading indicator while loading initial data
        this.showLoadingIndicator();
        
        // Start rendering the view immediately
        this.renderView(container);
        
        // Refresh the view to load the data
        await this.refresh();
        
        // Register keyboard event handlers
        this.registerKeyboardNavigation();
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
        switch (this.colorizeMode) {
            case 'tasks':
                this.colorizeCalendarForTasks();
                break;
            case 'notes':
                this.colorizeCalendarForNotes();
                break;
            case 'daily':
                this.colorizeCalendarForDailyNotes();
                break;
        }
    }
    
    async navigateToPreviousPeriod() {
        // Go to previous month
        const date = new Date(this.plugin.selectedDate);
        date.setMonth(date.getMonth() - 1);
        this.plugin.setSelectedDate(date);
        
        // Force daily notes cache rebuild for the new month
        if (this.colorizeMode === 'daily') {
            this.plugin.fileIndexer.rebuildDailyNotesCache(date.getFullYear(), date.getMonth());
        }
        
        // Refresh the view to show the new month
        await this.refresh();
    }
    
    async navigateToNextPeriod() {
        // Go to next month
        const date = new Date(this.plugin.selectedDate);
        date.setMonth(date.getMonth() + 1);
        this.plugin.setSelectedDate(date);
        
        // Force daily notes cache rebuild for the new month
        if (this.colorizeMode === 'daily') {
            this.plugin.fileIndexer.rebuildDailyNotesCache(date.getFullYear(), date.getMonth());
        }
        
        // Refresh the view to show the new month
        await this.refresh();
    }
    
    async navigateToToday() {
        const today = new Date();
        this.plugin.setSelectedDate(today);
        
        // Force daily notes cache rebuild for the current month
        if (this.colorizeMode === 'daily') {
            this.plugin.fileIndexer.rebuildDailyNotesCache(today.getFullYear(), today.getMonth());
        }
        
        // Refresh the view to show the current month
        await this.refresh();
    }
    
  
    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        
        // Clean up when the view is closed
        this.containerEl.empty();
    }
    
    /**
     * Registers keyboard navigation for the calendar
     */
    registerKeyboardNavigation() {
        // Add keyboard event handling for this view
        this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
            // Only handle events when this view is active
            if (!this.isThisViewActive()) {
                return;
            }
            
            // Get the currently selected date
            const currentDate = new Date(this.plugin.selectedDate);
            let newDate: Date | undefined = undefined;
            
            switch (e.key) {
                // Left arrow or h - previous day
                case 'ArrowLeft':
                case 'h':
                    newDate = new Date(currentDate);
                    newDate.setDate(currentDate.getDate() - 1);
                    break;
                    
                // Right arrow or l - next day
                case 'ArrowRight':
                case 'l':
                    newDate = new Date(currentDate);
                    newDate.setDate(currentDate.getDate() + 1);
                    break;
                    
                // Up arrow or k - previous week (same day)
                case 'ArrowUp':
                case 'k':
                    newDate = new Date(currentDate);
                    newDate.setDate(currentDate.getDate() - 7);
                    break;
                    
                // Down arrow or j - next week (same day)
                case 'ArrowDown':
                case 'j':
                    newDate = new Date(currentDate);
                    newDate.setDate(currentDate.getDate() + 7);
                    break;
                
                // Enter key - open daily note for selected date
                case 'Enter':
                    e.preventDefault();
                    this.plugin.navigateToDailyNote(currentDate);
                    return;
                    
                default:
                    // Not a navigation key
                    return;
            }
            
            // If we have a new date, update it and prevent default
            if (newDate) {
                e.preventDefault();
                this.plugin.setSelectedDate(newDate);
                
                // Refresh the view
                this.refresh();
            }
        });
    }
    
    /**
     * Helper to check if this view is currently the active one
     */
    private isThisViewActive(): boolean {
        const activeLeaf = this.app.workspace.activeLeaf;
        return activeLeaf !== null && activeLeaf.view === this;
    }
    
    /**
     * Helper to navigate by days and weeks
     */
    private navigateDate(dayOffset: number, weekOffset: number) {
        const currentDate = new Date(this.plugin.selectedDate);
        const newDate = new Date(currentDate);
        
        // Apply week offset (7 days per week)
        newDate.setDate(currentDate.getDate() + (weekOffset * 7) + dayOffset);
        
        // Update the date
        this.plugin.setSelectedDate(newDate);
        
        // Refresh the view
        this.refresh();
    }
    
    // Helper method to refresh the view
    async refresh() {
        this.showLoadingIndicator();
        
        try {
            const container = this.containerEl.querySelector('.chronosync-container') as HTMLElement;
            if (container) {
                // Simply render the view and get fresh data from FileIndexer
                this.renderView(container);
            }
        } finally {
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
        prevButton.setAttribute('aria-label', 'Previous month (←)');
        prevButton.setAttribute('title', 'Previous month (←)');
        
        const currentMonth = monthNavigationGroup.createEl('span', { 
            text: format(this.plugin.selectedDate, 'MMMM yyyy'), 
            cls: 'current-month' 
        });
        
        const nextButton = monthNavigationGroup.createEl('button', { text: '→' });
        nextButton.addEventListener('click', () => {
            this.navigateToNextPeriod();
        });
        nextButton.setAttribute('aria-label', 'Next month (→)');
        nextButton.setAttribute('title', 'Next month (→)');
        
        // Add colorize mode selector
        const colorizeContainer = navContainer.createDiv({ cls: 'colorize-mode-container' });
        const colorizeLabel = colorizeContainer.createEl('span', { text: 'Show: ', cls: 'colorize-mode-label' });
        
        const colorizeSelect = colorizeContainer.createEl('select', { cls: 'colorize-mode-select' });
        
        // Add colorize mode options
        const modes = [
            { value: 'tasks', text: 'Tasks' },
            { value: 'notes', text: 'Notes' },
            { value: 'daily', text: 'Daily Notes' }
        ];
        
        modes.forEach(mode => {
            const option = colorizeSelect.createEl('option', { 
                value: mode.value, 
                text: mode.text 
            });
            
            if (mode.value === this.colorizeMode) {
                option.selected = true;
            }
        });
        
        // Add change event listener
        colorizeSelect.addEventListener('change', async () => {
            const newMode = colorizeSelect.value as ColorizeMode;
            // Show loading indicator while changing modes
            this.showLoadingIndicator();
            try {
                await this.setColorizeMode(newMode);
            } finally {
                this.hideLoadingIndicator();
            }
        });
        
        // Today button
        const todayButton = navContainer.createEl('button', { 
            text: 'Today', 
            cls: 'today-button chronosync-button chronosync-button-primary' 
        });
        
        todayButton.addEventListener('click', () => {
            this.navigateToToday();
        });
        
        // Add keyboard navigation hint
        const keyboardHint = controlsContainer.createDiv({ cls: 'keyboard-nav-hint' });
        keyboardHint.setText('Keyboard navigation: Arrow keys / h,j,k,l to navigate, Enter to open daily note');
    }
    
    // Set the colorization mode and update the view
    async setColorizeMode(mode: ColorizeMode) {
        if (this.colorizeMode !== mode) {
            this.colorizeMode = mode;
            
            // If switching to daily notes mode, rebuild the daily notes cache
            if (mode === 'daily') {
                const currentYear = this.plugin.selectedDate.getFullYear();
                const currentMonth = this.plugin.selectedDate.getMonth();
                await this.plugin.fileIndexer.rebuildDailyNotesCache(currentYear, currentMonth);
            }
            
            this.colorizeCalendar();
        }
    }
    
    createCalendarGrid(container: HTMLElement) {
        // Create container for the calendar grid
        const gridContainer = container.createDiv({ cls: 'calendar-grid-container' });

        // Add skip link for accessibility
        const skipLink = gridContainer.createEl('a', {
            cls: 'a11y-skip-link',
            text: 'Skip to calendar content',
            attr: {
                href: '#calendar-grid',
                'aria-label': 'Skip to calendar content'
            }
        });
        
        // Get the currently selected date
        const selectedDate = this.plugin.selectedDate;
        
        // Get the current month and year
        const currentMonth = selectedDate.getMonth();
        const currentYear = selectedDate.getFullYear();
        
        // Get the first day of the month
        const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
        
        // Get the last day of the month
        const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
        
        // Get the day of the week for the first day (0-6, 0 is Sunday)
        const firstDayOfWeek = firstDayOfMonth.getDay();
        
        // Create the calendar grid with ARIA role
        const calendarGrid = gridContainer.createDiv({ 
            cls: 'calendar-grid',
            attr: {
                'role': 'grid',
                'aria-label': `Calendar for ${format(this.plugin.selectedDate, 'MMMM yyyy')}`,
                'id': 'calendar-grid'
            }
        });
        
        // Create the calendar header (day names)
        const calendarHeader = calendarGrid.createDiv({ 
            cls: 'calendar-header',
            attr: {
                'role': 'row'
            }
        });
        
        // Day names
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        // Add day headers with ARIA roles
        dayNames.forEach((dayName, index) => {
            calendarHeader.createDiv({ 
                text: dayName, 
                cls: 'calendar-day-header',
                attr: {
                    'role': 'columnheader',
                    'aria-label': dayName
                }
            });
        });
        
        // Calculate days from previous month to show
        const daysFromPrevMonth = firstDayOfWeek;
        
        // Calculate days from next month to show (to fill the grid)
        const totalCells = 42; // 6 rows of 7 days
        const daysThisMonth = lastDayOfMonth.getDate();
        const daysFromNextMonth = totalCells - daysThisMonth - daysFromPrevMonth;
        
        // Get the last day of the previous month
        const lastDayOfPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
        
        // Create calendar days - start new row for first week
        let currentWeekRow = calendarGrid.createDiv({
            cls: 'calendar-week',
            attr: { 'role': 'row' }
        });
        
        // Days from previous month
        for (let i = 0; i < daysFromPrevMonth; i++) {
            const dayNum = lastDayOfPrevMonth - daysFromPrevMonth + i + 1;
            const dayDate = new Date(currentYear, currentMonth - 1, dayNum);
            
            const isSelected = isSameDay(dayDate, selectedDate);
            
            const dayEl = currentWeekRow.createDiv({ 
                cls: `calendar-day outside-month${isSelected ? ' selected' : ''}`, 
                text: dayNum.toString(),
                attr: {
                    'role': 'gridcell',
                    'tabindex': isSelected ? '0' : '-1',
                    'aria-label': format(dayDate, 'EEEE, MMMM d, yyyy'),
                    'aria-selected': isSelected ? 'true' : 'false'
                }
            });
            
            // Add click handler
            dayEl.addEventListener('click', () => {
                this.plugin.setSelectedDate(dayDate);
                this.refresh();
            });
            
            // Add keyboard event handler to each day
            dayEl.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.plugin.setSelectedDate(dayDate);
                    this.refresh();
                }
            });
        }
        
        // Days from current month
        const today = new Date();
        for (let i = 1; i <= daysThisMonth; i++) {
            // Start a new row every 7 days (once per week)
            if ((i + daysFromPrevMonth) % 7 === 1) {
                currentWeekRow = calendarGrid.createDiv({
                    cls: 'calendar-week',
                    attr: { 'role': 'row' }
                });
            }
            
            const dayDate = new Date(currentYear, currentMonth, i);
            
            const isToday = isSameDay(dayDate, today);
            const isSelected = isSameDay(dayDate, selectedDate);
            
            let classNames = 'calendar-day';
            if (isToday) classNames += ' today';
            if (isSelected) classNames += ' selected';
            
            const dayEl = currentWeekRow.createDiv({ 
                cls: classNames, 
                text: i.toString(),
                attr: {
                    'role': 'gridcell',
                    'tabindex': isSelected ? '0' : '-1',
                    'aria-label': format(dayDate, 'EEEE, MMMM d, yyyy') + (isToday ? ' (Today)' : ''),
                    'aria-selected': isSelected ? 'true' : 'false',
                    'aria-current': isToday ? 'date' : null
                }
            });
            
            // Add click handler
            dayEl.addEventListener('click', () => {
                this.plugin.setSelectedDate(dayDate);
                this.refresh();
            });
            
            // Add keyboard event handler to each day
            dayEl.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.plugin.setSelectedDate(dayDate);
                    this.refresh();
                }
            });
        }
        
        // Days from next month
        for (let i = 1; i <= daysFromNextMonth; i++) {
            // Start a new row every 7 days (once per week)
            if ((i + daysFromPrevMonth + daysThisMonth) % 7 === 1) {
                currentWeekRow = calendarGrid.createDiv({
                    cls: 'calendar-week',
                    attr: { 'role': 'row' }
                });
            }
            
            const dayDate = new Date(currentYear, currentMonth + 1, i);
            
            const isSelected = isSameDay(dayDate, selectedDate);
            
            const dayEl = currentWeekRow.createDiv({ 
                cls: `calendar-day outside-month${isSelected ? ' selected' : ''}`, 
                text: i.toString(),
                attr: {
                    'role': 'gridcell',
                    'tabindex': isSelected ? '0' : '-1',
                    'aria-label': format(dayDate, 'EEEE, MMMM d, yyyy'),
                    'aria-selected': isSelected ? 'true' : 'false'
                }
            });
            
            // Add click handler
            dayEl.addEventListener('click', () => {
                this.plugin.setSelectedDate(dayDate);
                this.refresh();
            });
            
            // Add keyboard event handler to each day
            dayEl.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.plugin.setSelectedDate(dayDate);
                    this.refresh();
                }
            });
        }
    }
    
    // Clear all colorization to prepare for new colorization
    private clearCalendarColorization() {
        // Get all calendar day elements
        const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
        
        // Remove all colorization classes and indicators
        calendarDays.forEach(day => {
            // Remove indicator elements
            day.querySelectorAll('.note-indicator, .task-indicator, .daily-note-indicator').forEach(el => el.remove());
            
            // Remove colorization classes
            day.classList.remove(
                'has-few-notes', 'has-some-notes', 'has-many-notes',
                'has-tasks', 'has-completed-tasks', 'has-archived-tasks',
                'has-daily-note'
            );
        });
    }
    
    // Method to colorize calendar for notes (notes tab)
    async colorizeCalendarForNotes() {
        // First clear all existing colorization
        this.clearCalendarColorization();
        
        // Get current year and month
        const currentYear = this.plugin.selectedDate.getFullYear();
        const currentMonth = this.plugin.selectedDate.getMonth();
        
        // Get calendar data from unified cache
        const calendarData = await this.plugin.fileIndexer.getCalendarData(currentYear, currentMonth);
        const notesCache = calendarData.notes;
        
        // Find all calendar days
        const calendarDays = this.containerEl.querySelectorAll('.calendar-day');
        
        // Add note indicators
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
                    
                    // Different styling based on note count
                    let noteClass = '';
                    if (noteCount >= 5) {
                        noteClass = 'many-notes';
                        day.classList.add('has-many-notes');
                    } else if (noteCount >= 2) {
                        noteClass = 'some-notes';
                        day.classList.add('has-some-notes');
                    } else {
                        noteClass = 'few-notes';
                        day.classList.add('has-few-notes');
                    }
                    
                    indicator.classList.add(noteClass);
                    
                    // Add tooltip with note count
                    indicator.setAttribute('aria-label', `${noteCount} note${noteCount > 1 ? 's' : ''}`);
                    indicator.setAttribute('title', `${noteCount} note${noteCount > 1 ? 's' : ''}`);
                    
                    // Add indicator to the day cell
                    day.appendChild(indicator);
                }
            }
        });
    }
    
    // Method to colorize calendar for tasks (tasks tab)
    async colorizeCalendarForTasks() {
        // First clear all existing colorization
        this.clearCalendarColorization();
        
        // Get current year and month
        const currentYear = this.plugin.selectedDate.getFullYear();
        const currentMonth = this.plugin.selectedDate.getMonth();
        
        // Get calendar data from unified cache
        const calendarData = await this.plugin.fileIndexer.getCalendarData(currentYear, currentMonth);
        const tasksCache = calendarData.tasks;
        
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
    async colorizeCalendarForDailyNotes() {
        // First clear all existing colorization
        this.clearCalendarColorization();
        
        // Get current year and month
        const currentYear = this.plugin.selectedDate.getFullYear();
        const currentMonth = this.plugin.selectedDate.getMonth();
        
        // Force a rebuild of the cache on the first call to ensure daily notes are properly indexed
        // Using class property instead of static variable to track first call
        let dailyNotesCache: Set<string>;
        
        if (!CalendarView.dailyNotesInitialized) {
            console.debug('First call to colorizeCalendarForDailyNotes, forcing cache rebuild');
            // Use the targeted rebuild method instead of rebuilding the entire index
            dailyNotesCache = await this.plugin.fileIndexer.rebuildDailyNotesCache(currentYear, currentMonth);
            CalendarView.dailyNotesInitialized = true;
        } else {
            // Get calendar data from file indexer
            const calendarData = await this.plugin.fileIndexer.getCalendarData(currentYear, currentMonth);
            dailyNotesCache = calendarData.dailyNotes;
        }
        
        // Log the number of daily notes found for debugging
        console.debug(`Found ${dailyNotesCache.size} daily notes for ${currentYear}-${currentMonth+1}`);
        if (dailyNotesCache.size > 0) {
            console.debug('Daily notes:', Array.from(dailyNotesCache));
        }
        
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
}