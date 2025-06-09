import { Notice, TFile, ItemView, WorkspaceLeaf, normalizePath } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    CALENDAR_VIEW_TYPE, 
    EVENT_DATA_CHANGED,
    EVENT_TASK_UPDATED,
    TaskInfo, 
    NoteInfo, 
    TimeInfo,
    ColorizeMode,
} from '../types';
import { 
    extractNoteInfo, 
    extractTaskInfo, 
    isSameDay, 
    parseTime,
    isRecurringTaskDueOn
} from '../utils/helpers';
import { perfMonitor } from '../utils/PerformanceMonitor';

export class CalendarView extends ItemView {
    // Static property to track initialization status for daily notes
    static dailyNotesInitialized: boolean = false;
    
    plugin: TaskNotesPlugin;
    colorizeMode: ColorizeMode = 'tasks';
    
    // Event listeners
    private listeners: (() => void)[] = [];
  
    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
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
        
        // Listen for individual task updates for granular calendar updates
        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, ({ path, originalTask, updatedTask }) => {
            if (!path || !updatedTask) {
                console.error('EVENT_TASK_UPDATED received invalid data:', { path, originalTask, updatedTask });
                return;
            }
            
            // Perform granular calendar update for task changes
            this.handleTaskUpdate(originalTask, updatedTask);
        });
        this.listeners.push(taskUpdateListener);
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
        // Wait for the plugin to be fully initialized before proceeding
        await this.plugin.onReady();
        
        // Clear and prepare the content element
        const contentEl = this.contentEl;
        contentEl.empty();
        
        // Add a container for our view content
        const container = contentEl.createDiv({ cls: 'tasknotes-plugin calendar-view' });
        
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
        const currentDate = new Date(this.plugin.selectedDate);
        const date = new Date(currentDate);
        
        // Go to previous month
        date.setMonth(date.getMonth() - 1);
        this.plugin.setSelectedDate(date);
        
        // Check if we're changing months - if so, we need a full refresh
        if (currentDate.getMonth() !== date.getMonth() || currentDate.getFullYear() !== date.getFullYear()) {
            // Force daily notes cache rebuild for the new month
            if (this.colorizeMode === 'daily') {
                this.plugin.cacheManager.rebuildDailyNotesCache(date.getFullYear(), date.getMonth());
            }
            await this.refresh();
        } else {
            // Same month, just update selected date
            this.updateSelectedDate(date);
        }
    }
    
    async navigateToNextPeriod() {
        const currentDate = new Date(this.plugin.selectedDate);
        const date = new Date(currentDate);
        
        // Go to next month
        date.setMonth(date.getMonth() + 1);
        this.plugin.setSelectedDate(date);
        
        // Check if we're changing months - if so, we need a full refresh
        if (currentDate.getMonth() !== date.getMonth() || currentDate.getFullYear() !== date.getFullYear()) {
            // Force daily notes cache rebuild for the new month
            if (this.colorizeMode === 'daily') {
                this.plugin.cacheManager.rebuildDailyNotesCache(date.getFullYear(), date.getMonth());
            }
            await this.refresh();
        } else {
            // Same month, just update selected date
            this.updateSelectedDate(date);
        }
    }
    
    async navigateToToday() {
        const currentDate = new Date(this.plugin.selectedDate);
        const today = new Date();
        this.plugin.setSelectedDate(today);
        
        // Check if we're changing months - if so, we need a full refresh
        if (currentDate.getMonth() !== today.getMonth() || 
            currentDate.getFullYear() !== today.getFullYear()) {
            
            // Force daily notes cache rebuild for the current month
            if (this.colorizeMode === 'daily') {
                this.plugin.cacheManager.rebuildDailyNotesCache(today.getFullYear(), today.getMonth());
            }
            
            await this.refresh();
        } else {
            // Same month, just update selected date
            this.updateSelectedDate(today);
        }
    }
    
  
    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        
        // Clean up when the view is closed
        this.contentEl.empty();
    }
    
    /**
     * Registers keyboard navigation for the calendar
     */
    registerKeyboardNavigation() {
        // Add keyboard event handling for this view
        this.registerDomEvent(document, 'keydown', async (e: KeyboardEvent) => {
            // Only handle events when this view is active
            if (!this.isThisViewActive()) {
                return;
            }
            
            // Get the currently selected date
            const currentDate = new Date(this.plugin.selectedDate);
            let newDate: Date | undefined = undefined;
            
            switch (e.key) {
                // Left arrow - previous day
                case 'ArrowLeft':
                    newDate = new Date(currentDate);
                    newDate.setDate(currentDate.getDate() - 1);
                    break;
                    
                // Right arrow - next day
                case 'ArrowRight':
                    newDate = new Date(currentDate);
                    newDate.setDate(currentDate.getDate() + 1);
                    break;
                    
                // Up arrow - previous week (same day)
                case 'ArrowUp':
                    newDate = new Date(currentDate);
                    newDate.setDate(currentDate.getDate() - 7);
                    break;
                    
                // Down arrow - next week (same day)
                case 'ArrowDown':
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
                
                // Check if we're navigating to a different month
                const currentDate = this.plugin.selectedDate;
                if (currentDate.getMonth() !== newDate.getMonth() || currentDate.getFullYear() !== newDate.getFullYear()) {
                    // Different month, need full refresh
                    this.plugin.setSelectedDate(newDate);
                    this.refresh();
                } else {
                    // Same month, just update selected date
                    this.updateSelectedDate(newDate);
                }
            }
        });
    }
    
    /**
     * Helper to check if this view is currently the active one
     */
    private isThisViewActive(): boolean {
        const activeView = this.app.workspace.getActiveViewOfType(CalendarView);
        return activeView === this;
    }
    
    /**
     * Helper to navigate by days and weeks
     */
    private navigateDate(dayOffset: number, weekOffset: number) {
        const currentDate = new Date(this.plugin.selectedDate);
        const newDate = new Date(currentDate);
        
        // Apply week offset (7 days per week)
        newDate.setDate(currentDate.getDate() + (weekOffset * 7) + dayOffset);
        
        // Check if we're navigating to a different month
        const currentMonth = this.plugin.selectedDate.getMonth();
        const currentYear = this.plugin.selectedDate.getFullYear();
        const newMonth = newDate.getMonth();
        const newYear = newDate.getFullYear();
        
        if (currentMonth !== newMonth || currentYear !== newYear) {
            // Different month, need full refresh
            this.plugin.setSelectedDate(newDate);
            this.refresh();
        } else {
            // Same month, just update selected date
            this.updateSelectedDate(newDate);
        }
    }
    
    // Helper method to refresh the view
    async refresh() {
        this.showLoadingIndicator();
        
        try {
            const container = this.contentEl.querySelector('.tasknotes-container') as HTMLElement;
            if (container) {
                // Simply render the view and get fresh data from CacheManager
                this.renderView(container);
            }
        } finally {
            this.hideLoadingIndicator();
        }
    }
    
    // Update selected date without re-rendering entire calendar
    private updateSelectedDate(newDate: Date) {
        // Remove selected class from all days
        const allDays = this.contentEl.querySelectorAll('.calendar-view__day');
        allDays.forEach(day => {
            day.classList.remove('calendar-view__day--selected');
            day.setAttribute('aria-selected', 'false');
            day.setAttribute('tabindex', '-1');
        });
        
        // Find and select the new date element
        const newDateStr = format(newDate, 'yyyy-MM-dd');
        allDays.forEach(day => {
            const dayEl = day as HTMLElement;
            const ariaLabel = dayEl.getAttribute('aria-label') || '';
            // Check if this element represents the new date
            if (ariaLabel.includes(format(newDate, 'EEEE, MMMM d, yyyy'))) {
                dayEl.classList.add('calendar-view__day--selected');
                dayEl.setAttribute('aria-selected', 'true');
                dayEl.setAttribute('tabindex', '0');
                dayEl.focus();
            }
        });
        
        // Update the plugin's selected date
        this.plugin.setSelectedDate(newDate);
    }
    
    // Show a loading indicator while building cache
    private showLoadingIndicator() {
        const container = this.contentEl.querySelector('.tasknotes-container');
        if (!container) return;

        // Check if indicator already exists
        if (container.querySelector('.cache-loading-indicator')) return;

        const indicator = document.createElement('div');
        indicator.className = 'cache-loading-indicator';
        indicator.textContent = 'Loading calendar data...';
        container.prepend(indicator);
    }

    // Hide the loading indicator
    private hideLoadingIndicator() {
        const indicator = this.contentEl.querySelector('.cache-loading-indicator');
        if (indicator) {
            indicator.remove();
        }
    }
  
    createCalendarControls(container: HTMLElement) {
        const controlsContainer = container.createDiv({ cls: 'calendar-view__controls' });
        
        // Calendar header with view selector first, then navigation
        const headerContainer = controlsContainer.createDiv({ cls: 'calendar-view__header' });
        
        // View Type Dropdown (moved to front)
        const colorizeSelect = headerContainer.createEl('select', { 
            cls: 'calendar-view__view-selector',
            attr: {
                'title': 'Change view',
                'aria-label': 'Change calendar view'
            }
        });
        
        // Add colorize mode options
        const modes = [
            { value: 'tasks', text: 'Tasks' },
            { value: 'notes', text: 'Notes' },
            { value: 'daily', text: 'Daily notes' }
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
        
        // Month Navigation Section (grouped together)
        const navSection = headerContainer.createDiv({ cls: 'calendar-view__navigation' });
        
        // Previous Month Button
        const prevButton = navSection.createEl('button', { 
            text: '‹', 
            cls: 'calendar-view__nav-button calendar-view__nav-button--prev',
            attr: {
                'aria-label': 'Previous month',
                'title': 'Previous month'
            }
        });
        prevButton.addEventListener('click', () => {
            this.navigateToPreviousPeriod();
        });
        
        // Current Month Display
        const monthDisplay = navSection.createDiv({ 
            cls: 'calendar-view__month-display',
            text: format(this.plugin.selectedDate, 'MMMM yyyy')
        });
        
        // Next Month Button
        const nextButton = navSection.createEl('button', { 
            text: '›', 
            cls: 'calendar-view__nav-button calendar-view__nav-button--next',
            attr: {
                'aria-label': 'Next month',
                'title': 'Next month'
            }
        });
        nextButton.addEventListener('click', () => {
            this.navigateToNextPeriod();
        });
        
        // Today button (moved to end)
        const todayButton = headerContainer.createEl('button', { 
            text: 'Today', 
            cls: 'calendar-view__today-button',
            attr: {
                'aria-label': 'Go to today',
                'title': 'Go to today'
            }
        });
        
        todayButton.addEventListener('click', () => {
            this.navigateToToday();
        });
    }
    
    // Set the colorization mode and update the view
    async setColorizeMode(mode: ColorizeMode) {
        if (this.colorizeMode !== mode) {
            this.colorizeMode = mode;
            
            // If switching to daily notes mode, rebuild the daily notes cache
            if (mode === 'daily') {
                const currentYear = this.plugin.selectedDate.getFullYear();
                const currentMonth = this.plugin.selectedDate.getMonth();
                await this.plugin.cacheManager.rebuildDailyNotesCache(currentYear, currentMonth);
            }
            
            this.colorizeCalendar();
        }
    }
    
    createCalendarGrid(container: HTMLElement) {
        // Create container for the calendar grid
        const gridContainer = container.createDiv({ cls: 'calendar-view__grid-container' });

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
            cls: 'calendar-view__grid',
            attr: {
                'role': 'grid',
                'aria-label': `Calendar for ${format(this.plugin.selectedDate, 'MMMM yyyy')}`,
                'id': 'calendar-grid'
            }
        });
        
        // Create the calendar header (day names)
        const calendarHeader = calendarGrid.createDiv({ 
            cls: 'calendar-view__grid-header',
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
                cls: 'calendar-view__day-header',
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
            cls: 'calendar-view__week',
            attr: { 'role': 'row' }
        });
        
        // Days from previous month
        for (let i = 0; i < daysFromPrevMonth; i++) {
            const dayNum = lastDayOfPrevMonth - daysFromPrevMonth + i + 1;
            const dayDate = new Date(currentYear, currentMonth - 1, dayNum);
            
            const isSelected = isSameDay(dayDate, selectedDate);
            
            const dayEl = currentWeekRow.createDiv({ 
                cls: `calendar-view__day calendar-view__day--outside-month${isSelected ? ' calendar-view__day--selected' : ''}`, 
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
                this.updateSelectedDate(dayDate);
            });
            
            // Add hover preview functionality for daily notes
            dayEl.addEventListener('mouseover', (event) => {
                this.showDayPreview(event, dayDate, dayEl);
            });
            
            // Add keyboard event handler to each day
            dayEl.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.updateSelectedDate(dayDate);
                }
            });
        }
        
        // Days from current month
        const today = new Date();
        for (let i = 1; i <= daysThisMonth; i++) {
            // Start a new row every 7 days (once per week)
            if ((i + daysFromPrevMonth) % 7 === 1) {
                currentWeekRow = calendarGrid.createDiv({
                    cls: 'calendar-view__week',
                    attr: { 'role': 'row' }
                });
            }
            
            const dayDate = new Date(currentYear, currentMonth, i);
            
            const isToday = isSameDay(dayDate, today);
            const isSelected = isSameDay(dayDate, selectedDate);
            
            let classNames = 'calendar-view__day';
            if (isToday) classNames += ' calendar-view__day--today';
            if (isSelected) classNames += ' calendar-view__day--selected';
            
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
                this.updateSelectedDate(dayDate);
            });
            
            // Add hover preview functionality for daily notes
            dayEl.addEventListener('mouseover', (event) => {
                this.showDayPreview(event, dayDate, dayEl);
            });
            
            // Add keyboard event handler to each day
            dayEl.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.updateSelectedDate(dayDate);
                }
            });
        }
        
        // Days from next month
        for (let i = 1; i <= daysFromNextMonth; i++) {
            // Start a new row every 7 days (once per week)
            if ((i + daysFromPrevMonth + daysThisMonth) % 7 === 1) {
                currentWeekRow = calendarGrid.createDiv({
                    cls: 'calendar-view__week',
                    attr: { 'role': 'row' }
                });
            }
            
            const dayDate = new Date(currentYear, currentMonth + 1, i);
            
            const isSelected = isSameDay(dayDate, selectedDate);
            
            const dayEl = currentWeekRow.createDiv({ 
                cls: `calendar-view__day calendar-view__day--outside-month${isSelected ? ' calendar-view__day--selected' : ''}`, 
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
                this.updateSelectedDate(dayDate);
            });
            
            // Add hover preview functionality for daily notes
            dayEl.addEventListener('mouseover', (event) => {
                this.showDayPreview(event, dayDate, dayEl);
            });
            
            // Add keyboard event handler to each day
            dayEl.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.updateSelectedDate(dayDate);
                }
            });
        }
    }
    
    // Clear all colorization to prepare for new colorization
    private clearCalendarColorization() {
        // Get all calendar day elements
        const calendarDays = this.contentEl.querySelectorAll('.calendar-view__day');
        
        // Remove all colorization classes and indicators
        calendarDays.forEach(day => {
            // Remove indicator elements
            day.querySelectorAll('.note-indicator, .task-indicator, .daily-note-indicator').forEach(el => el.remove());
            
            // Remove colorization classes
            day.classList.remove(
                'calendar-view__day--has-notes-few', 'calendar-view__day--has-notes-some', 'calendar-view__day--has-notes-many',
                'calendar-view__day--has-tasks', 'calendar-view__day--has-completed-tasks', 'calendar-view__day--has-archived-tasks', 'calendar-view__day--has-scheduled-tasks',
                'calendar-view__day--has-daily-note'
            );
        });
    }
    
    // Method to colorize calendar for notes (notes tab)
    async colorizeCalendarForNotes() {
        return perfMonitor.measure('calendar-colorize-notes', async () => {
            // First clear all existing colorization
            this.clearCalendarColorization();
            
            // Get current year and month
            const currentYear = this.plugin.selectedDate.getFullYear();
            const currentMonth = this.plugin.selectedDate.getMonth();
            
            // Get data from unified cache manager
            let calendarData;
            try {
                calendarData = await this.plugin.cacheManager.getCalendarData(currentYear, currentMonth);
            } catch (error) {
                console.warn('Failed to get calendar data from unified cache manager:', error);
                calendarData = await this.plugin.cacheManager.getCalendarData(currentYear, currentMonth);
            }
            const notesCache = calendarData.notes;
        
        // Find all calendar days
        const calendarDays = this.contentEl.querySelectorAll('.calendar-view__day');
        
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
                if (day.classList.contains('calendar-view__day--outside-month')) {
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
                        day.classList.add('calendar-view__day--has-notes-many');
                    } else if (noteCount >= 2) {
                        noteClass = 'some-notes';
                        day.classList.add('calendar-view__day--has-notes-some');
                    } else {
                        noteClass = 'few-notes';
                        day.classList.add('calendar-view__day--has-notes-few');
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
        const calendarData = await this.plugin.cacheManager.getCalendarData(currentYear, currentMonth);
        const tasksCache = calendarData.tasks;
        
        // Find all calendar days
        const calendarDays = this.contentEl.querySelectorAll('.calendar-view__day');
        
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
                if (day.classList.contains('calendar-view__day--outside-month')) {
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
                
                if (taskInfo && (taskInfo.hasDue || taskInfo.hasScheduled)) {
                    // Create indicator element
                    const indicator = document.createElement('div');
                    indicator.className = 'task-indicator';
                    
                    // Different styling for completed, due, scheduled, and archived tasks
                    // Priority order: archived > completed > due > scheduled
                    let taskStatus = '';
                    if (taskInfo.hasArchived) {
                        // Archived tasks get a different style
                        day.classList.add('calendar-view__day--has-archived-tasks');
                        indicator.classList.add('archived-tasks');
                        taskStatus = 'Archived';
                    } else if (taskInfo.hasCompleted) {
                        // Completed tasks
                        day.classList.add('calendar-view__day--has-completed-tasks');
                        indicator.classList.add('completed-tasks');
                        taskStatus = 'Completed';
                    } else if (taskInfo.hasDue) {
                        // Due tasks (prioritized over scheduled)
                        day.classList.add('calendar-view__day--has-tasks');
                        indicator.classList.add('due-tasks');
                        taskStatus = 'Due';
                    } else if (taskInfo.hasScheduled) {
                        // Scheduled tasks
                        day.classList.add('calendar-view__day--has-scheduled-tasks');
                        indicator.classList.add('scheduled-tasks');
                        taskStatus = 'Scheduled';
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
            // Use the targeted rebuild method instead of rebuilding the entire index
            dailyNotesCache = await this.plugin.cacheManager.rebuildDailyNotesCache(currentYear, currentMonth);
            CalendarView.dailyNotesInitialized = true;
        } else {
            // Get calendar data from file indexer
            const calendarData = await this.plugin.cacheManager.getCalendarData(currentYear, currentMonth);
            dailyNotesCache = calendarData.dailyNotes;
        }
        
        
        // Find all calendar days
        const calendarDays = this.contentEl.querySelectorAll('.calendar-view__day');
        
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
                if (day.classList.contains('calendar-view__day--outside-month')) {
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
                    day.classList.add('calendar-view__day--has-daily-note');
                    
                    // Add tooltip for daily note
                    indicator.setAttribute('aria-label', 'Daily note exists');
                    indicator.setAttribute('title', 'Daily note exists');
                    
                    // Add indicator to the day cell
                    day.appendChild(indicator);
                }
            }
        });
    }
    
    /**
     * Handle granular task updates without full calendar re-colorization
     */
    private handleTaskUpdate(originalTask: TaskInfo | undefined, updatedTask: TaskInfo) {
        // Only perform granular updates if we're in tasks mode
        if (this.colorizeMode !== 'tasks') {
            return;
        }
        
        // Get the dates that might be affected by this change
        const affectedDates = new Set<string>();
        
        // Add original due date if it exists
        if (originalTask?.due) {
            affectedDates.add(format(new Date(originalTask.due), 'yyyy-MM-dd'));
        }
        
        // Add new due date if it exists
        if (updatedTask.due) {
            affectedDates.add(format(new Date(updatedTask.due), 'yyyy-MM-dd'));
        }
        
        // Add original scheduled date if it exists
        if (originalTask?.scheduled) {
            affectedDates.add(format(new Date(originalTask.scheduled), 'yyyy-MM-dd'));
        }
        
        // Add new scheduled date if it exists
        if (updatedTask.scheduled) {
            affectedDates.add(format(new Date(updatedTask.scheduled), 'yyyy-MM-dd'));
        }
        
        // If no dates are affected, nothing to update
        if (affectedDates.size === 0) {
            return;
        }
        
        // Update only the affected calendar cells
        this.updateCalendarCellsForDates(Array.from(affectedDates));
    }
    
    /**
     * Update specific calendar cells for given dates
     */
    private async updateCalendarCellsForDates(dates: string[]) {
        if (dates.length === 0) return;
        
        // Get current calendar data
        const currentYear = this.plugin.selectedDate.getFullYear();
        const currentMonth = this.plugin.selectedDate.getMonth();
        const calendarData = await this.plugin.cacheManager.getCalendarData(currentYear, currentMonth);
        const tasksCache = calendarData.tasks;
        
        // Find all calendar day elements
        const calendarDays = this.contentEl.querySelectorAll('.calendar-view__day');
        
        // Update each affected date
        dates.forEach(dateKey => {
            const targetDate = new Date(dateKey);
            
            // Skip dates that are not in the current visible month
            if (targetDate.getFullYear() !== currentYear || 
                (Math.abs(targetDate.getMonth() - currentMonth) > 1)) {
                return;
            }
            
            // Find the corresponding calendar cell
            calendarDays.forEach(day => {
                const dayEl = day as HTMLElement;
                const dateText = dayEl.innerText.trim();
                
                if (!dateText || isNaN(parseInt(dateText))) return;
                
                // Determine the actual date this cell represents
                const cellDate = this.getCellDate(dayEl, parseInt(dateText), currentYear, currentMonth);
                
                if (cellDate && format(cellDate, 'yyyy-MM-dd') === dateKey) {
                    this.updateSingleCalendarCell(dayEl, dateKey, tasksCache);
                }
            });
        });
    }
    
    /**
     * Update a single calendar cell with task data
     */
    private updateSingleCalendarCell(dayEl: HTMLElement, dateKey: string, tasksCache: Map<string, any>) {
        // Remove existing task indicators and classes
        dayEl.querySelectorAll('.task-indicator').forEach(el => el.remove());
        dayEl.classList.remove('has-tasks', 'has-scheduled-tasks', 'has-completed-tasks', 'has-archived-tasks');
        
        // Get task info for this date
        const taskInfo = tasksCache.get(dateKey);
        
        if (taskInfo && (taskInfo.hasDue || taskInfo.hasScheduled)) {
            // Create indicator element
            const indicator = document.createElement('div');
            indicator.className = 'task-indicator';
            
            // Different styling for completed, due, scheduled, and archived tasks
            // Priority order: archived > completed > due > scheduled
            let taskStatus = '';
            if (taskInfo.hasArchived) {
                // Archived tasks get a different style
                dayEl.classList.add('has-archived-tasks');
                indicator.classList.add('archived-tasks');
                taskStatus = 'Archived';
            } else if (taskInfo.hasCompleted) {
                // Completed tasks
                dayEl.classList.add('has-completed-tasks');
                indicator.classList.add('completed-tasks');
                taskStatus = 'Completed';
            } else if (taskInfo.hasDue) {
                // Due tasks (prioritized over scheduled)
                dayEl.classList.add('has-tasks');
                indicator.classList.add('due-tasks');
                taskStatus = 'Due';
            } else if (taskInfo.hasScheduled) {
                // Scheduled tasks
                dayEl.classList.add('has-scheduled-tasks');
                indicator.classList.add('scheduled-tasks');
                taskStatus = 'Scheduled';
            }
            
            // Add tooltip with task count information
            indicator.setAttribute('aria-label', `${taskStatus} tasks (${taskInfo.count})`);
            indicator.setAttribute('title', `${taskStatus} tasks (${taskInfo.count})`);
            
            // Add indicator to the day cell
            dayEl.appendChild(indicator);
        }
    }
    
    /**
     * Get the actual date that a calendar cell represents
     */
    private getCellDate(dayEl: HTMLElement, dayNum: number, currentYear: number, currentMonth: number): Date | null {
        // Determine which month this cell actually represents
        let actualMonth = currentMonth;
        
        if (dayEl.classList.contains('outside-month')) {
            if (dayNum > 15) { // Probably previous month
                actualMonth = currentMonth === 0 ? 11 : currentMonth - 1;
            } else { // Probably next month
                actualMonth = currentMonth === 11 ? 0 : currentMonth + 1;
            }
        }
        
        try {
            return new Date(currentYear, actualMonth, dayNum);
        } catch (error) {
            console.warn('Invalid date in calendar cell:', { dayNum, actualMonth, currentYear });
            return null;
        }
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
    
    // Helper method to show day preview on hover
    private showDayPreview(event: MouseEvent, date: Date, targetEl: HTMLElement) {
        // Get the daily note path for this date
        const dailyNotePath = this.getDailyNotePath(date);
        const dailyNoteFile = this.app.vault.getAbstractFileByPath(dailyNotePath);
        
        if (dailyNoteFile && dailyNoteFile instanceof TFile) {
            // Show preview for the daily note only
            this.app.workspace.trigger('hover-link', {
                event,
source: 'tasknotes-calendar',
                hoverParent: this,
                targetEl: targetEl,
                linktext: dailyNotePath,
                sourcePath: dailyNotePath
            });
        }
        // If no daily note exists, don't show any preview
    }
    
    // Helper method to get daily note path for a date
    private getDailyNotePath(date: Date): string {
        const dateStr = format(date, 'yyyy-MM-dd');
        return normalizePath(`${this.plugin.settings.dailyNotesFolder}/${dateStr}.md`);
    }
    
}