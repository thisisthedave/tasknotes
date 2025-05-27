import { Notice, TFile, ItemView, WorkspaceLeaf, normalizePath } from 'obsidian';
import { format } from 'date-fns';
import ChronoSyncPlugin from '../main';
import { 
    CALENDAR_VIEW_TYPE, 
    EVENT_DATA_CHANGED,
    TaskInfo, 
    NoteInfo, 
    TimeInfo,
    ColorizeMode,
    CalendarDisplayMode
} from '../types';
import { 
    extractNoteInfo, 
    extractTaskInfo, 
    isSameDay, 
    parseTime 
} from '../utils/helpers';

export class CalendarView extends ItemView {
    // Static property to track initialization status for daily notes
    static dailyNotesInitialized: boolean = false;
    
    plugin: ChronoSyncPlugin;
    displayMode: CalendarDisplayMode = 'month';
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
        const contentEl = this.contentEl;
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
        
        // Route to appropriate view based on display mode
        switch (this.displayMode) {
            case 'week':
                this.renderWeekGrid(container);
                break;
            case 'agenda':
                this.renderAgendaList(container);
                break;
            case 'month':
            default:
                this.createCalendarGrid(container);
                this.colorizeCalendar();
                break;
        }
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
                    
                // Number 1 key - switch to Tasks colorization
                case '1':
                    e.preventDefault();
                    if (this.colorizeMode !== 'tasks') {
                        await this.setColorizeMode('tasks');
                        // Update the dropdown to match
                        const dropdown = this.contentEl.querySelector('.colorize-mode-select') as HTMLSelectElement;
                        if (dropdown) dropdown.value = 'tasks';
                    }
                    return;
                    
                // Number 2 key - switch to Notes colorization
                case '2':
                    e.preventDefault();
                    if (this.colorizeMode !== 'notes') {
                        await this.setColorizeMode('notes');
                        // Update the dropdown to match
                        const dropdown = this.contentEl.querySelector('.colorize-mode-select') as HTMLSelectElement;
                        if (dropdown) dropdown.value = 'notes';
                    }
                    return;
                    
                // Number 3 key - switch to Daily Notes colorization
                case '3':
                    e.preventDefault();
                    if (this.colorizeMode !== 'daily') {
                        await this.setColorizeMode('daily');
                        // Update the dropdown to match
                        const dropdown = this.contentEl.querySelector('.colorize-mode-select') as HTMLSelectElement;
                        if (dropdown) dropdown.value = 'daily';
                    }
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
            const container = this.contentEl.querySelector('.chronosync-container') as HTMLElement;
            if (container) {
                // Simply render the view and get fresh data from FileIndexer
                this.renderView(container);
            }
        } finally {
            this.hideLoadingIndicator();
        }
    }
    
    // Update selected date without re-rendering entire calendar
    private updateSelectedDate(newDate: Date) {
        // Remove selected class from all days
        const allDays = this.contentEl.querySelectorAll('.calendar-day');
        allDays.forEach(day => {
            day.classList.remove('selected');
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
                dayEl.classList.add('selected');
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
        const container = this.contentEl.querySelector('.chronosync-container');
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
        const indicator = this.contentEl.querySelector('.cache-loading-indicator');
        if (indicator) {
            indicator.remove();
        }
    }
  
    createCalendarControls(container: HTMLElement) {
        const controlsContainer = container.createDiv({ cls: 'calendar-controls' });
        
        // Add view switcher buttons
        const viewSwitcherContainer = controlsContainer.createDiv({ cls: 'view-switcher-container' });
        
        const viewModes = [
            { value: 'month', text: 'Month' },
            { value: 'week', text: 'Week' },
            { value: 'agenda', text: 'Agenda' }
        ];
        
        viewModes.forEach(mode => {
            const button = viewSwitcherContainer.createEl('button', { 
                text: mode.text, 
                cls: `view-switcher-button${this.displayMode === mode.value ? ' active' : ''}` 
            });
            
            button.addEventListener('click', () => {
                // Remove active class from all buttons
                viewSwitcherContainer.querySelectorAll('.view-switcher-button').forEach(btn => {
                    btn.classList.remove('active');
                });
                
                // Add active class to clicked button
                button.classList.add('active');
                
                // Update display mode and refresh
                this.displayMode = mode.value as CalendarDisplayMode;
                this.refresh();
            });
        });
        
        // Add month navigation
        const navContainer = controlsContainer.createDiv({ cls: 'calendar-nav' });
        
        // Create compact navigation group
        const monthNavigationGroup = navContainer.createDiv({ cls: 'month-navigation-group' });
        
        // Button group for prev/next
        const navButtons = monthNavigationGroup.createDiv({ cls: 'nav-button-group' });
        
        const prevButton = navButtons.createEl('button', { text: '‹', cls: 'nav-arrow-button' });
        prevButton.addEventListener('click', () => {
            this.navigateToPreviousPeriod();
        });
        prevButton.setAttribute('aria-label', 'Previous period');
        prevButton.setAttribute('title', 'Previous period (Left arrow or H key)');
        
        const nextButton = navButtons.createEl('button', { text: '›', cls: 'nav-arrow-button' });
        nextButton.addEventListener('click', () => {
            this.navigateToNextPeriod();
        });
        nextButton.setAttribute('aria-label', 'Next period');
        nextButton.setAttribute('title', 'Next period (Right arrow or L key)');
        
        const currentPeriod = monthNavigationGroup.createEl('span', { 
            text: this.getCurrentPeriodText(), 
            cls: 'current-period' 
        });
        
        // Add colorize mode selector (only show for month view)
        if (this.displayMode === 'month') {
            const colorizeContainer = navContainer.createDiv({ cls: 'colorize-mode-container' });
            const colorizeLabel = colorizeContainer.createEl('span', { text: 'Show: ', cls: 'colorize-mode-label' });
            
            const colorizeSelect = colorizeContainer.createEl('select', { 
                cls: 'colorize-mode-select',
                attr: {
                    'title': 'Change view (use keys 1, 2, 3 to switch)',
                    'aria-label': 'Change calendar view (use keys 1, 2, 3 to switch)'
                }
            });
            
            // Add colorize mode options with keyboard shortcuts
            const modes = [
                { value: 'tasks', text: 'Tasks (1)' },
                { value: 'notes', text: 'Notes (2)' },
                { value: 'daily', text: 'Daily Notes (3)' }
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
        }
        
        // Today button
        const todayButton = navContainer.createEl('button', { 
            text: 'Today', 
            cls: 'today-button chronosync-button chronosync-button-primary',
            attr: {
                'aria-label': 'Go to today',
                'title': 'Go to today (T key)'
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
        const calendarDays = this.contentEl.querySelectorAll('.calendar-day');
        
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
        const calendarDays = this.contentEl.querySelectorAll('.calendar-day');
        
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
        const calendarDays = this.contentEl.querySelectorAll('.calendar-day');
        
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
        const calendarDays = this.contentEl.querySelectorAll('.calendar-day');
        
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
    
    // Helper method to show day preview on hover
    private showDayPreview(event: MouseEvent, date: Date, targetEl: HTMLElement) {
        // Get the daily note path for this date
        const dailyNotePath = this.getDailyNotePath(date);
        const dailyNoteFile = this.app.vault.getAbstractFileByPath(dailyNotePath);
        
        if (dailyNoteFile) {
            // Show preview for the daily note only
            this.app.workspace.trigger('hover-link', {
                event,
                source: 'chronosync-calendar',
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
        return `${this.plugin.settings.dailyNotesFolder}/${dateStr}.md`;
    }
    
    // Helper method to get current period text based on display mode
    private getCurrentPeriodText(): string {
        switch (this.displayMode) {
            case 'week':
                const weekStart = this.getWeekStartDate(this.plugin.selectedDate);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
            case 'agenda':
                const agendaStart = this.plugin.selectedDate;
                const agendaEnd = new Date(agendaStart);
                agendaEnd.setDate(agendaStart.getDate() + 6);
                return `${format(agendaStart, 'MMM d')} - ${format(agendaEnd, 'MMM d, yyyy')}`;
            case 'month':
            default:
                return format(this.plugin.selectedDate, 'MMMM yyyy');
        }
    }
    
    // Helper method to get the start of the week (Sunday)
    private getWeekStartDate(date: Date): Date {
        const start = new Date(date);
        const day = start.getDay();
        start.setDate(start.getDate() - day);
        return start;
    }
    
    // Render week grid view
    private async renderWeekGrid(container: HTMLElement): Promise<void> {
        const weekGridContainer = container.createDiv({ cls: 'week-grid-container' });
        
        // Calculate week dates
        const weekStart = this.getWeekStartDate(this.plugin.selectedDate);
        const weekDates: Date[] = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            weekDates.push(date);
        }
        
        // Fetch data for all days concurrently
        const dataPromises = weekDates.map(async date => {
            const [tasks, notes] = await Promise.all([
                this.plugin.fileIndexer.getTaskInfoForDate(date),
                this.plugin.fileIndexer.getNotesForDate(date)
            ]);
            return { date, tasks, notes };
        });
        
        const weekData = await Promise.all(dataPromises);
        
        // Create header
        const weekHeader = weekGridContainer.createDiv({ cls: 'week-header' });
        weekHeader.createDiv({ cls: 'time-label-header', text: 'Time' });
        
        weekDates.forEach(date => {
            const dayHeader = weekHeader.createDiv({ cls: 'week-day-header' });
            dayHeader.createDiv({ cls: 'day-name', text: format(date, 'EEE') });
            dayHeader.createDiv({ cls: 'day-number', text: format(date, 'd') });
        });
        
        // Create body with time slots
        const weekBody = weekGridContainer.createDiv({ cls: 'week-body' });
        
        // Create time labels column
        const timeLabelsCol = weekBody.createDiv({ cls: 'time-labels-col' });
        
        // Create day columns
        const dayColumns: HTMLElement[] = [];
        for (let i = 0; i < 7; i++) {
            dayColumns.push(weekBody.createDiv({ cls: 'day-column' }));
        }
        
        // Generate time slots (8 AM to 6 PM for example)
        for (let hour = 8; hour <= 18; hour++) {
            const timeStr = `${hour.toString().padStart(2, '0')}:00`;
            timeLabelsCol.createDiv({ cls: 'time-slot', text: timeStr });
            
            // Add corresponding slots to each day column
            dayColumns.forEach((column, dayIndex) => {
                column.createDiv({ cls: 'time-slot' });
            });
        }
        
        // Add events to day columns
        weekData.forEach((dayData, dayIndex) => {
            const column = dayColumns[dayIndex];
            const allDaySection = column.createDiv({ cls: 'all-day-section' });
            
            // Add tasks
            dayData.tasks.forEach(task => {
                const eventBlock = allDaySection.createDiv({ cls: 'event-block task-event' });
                eventBlock.textContent = task.title;
                eventBlock.setAttribute('title', `Task: ${task.title}`);
            });
            
            // Add notes
            dayData.notes.forEach(note => {
                const eventBlock = allDaySection.createDiv({ cls: 'event-block note-event' });
                eventBlock.textContent = note.title;
                eventBlock.setAttribute('title', `Note: ${note.title}`);
            });
        });
    }
    
    // Render agenda list view
    private async renderAgendaList(container: HTMLElement): Promise<void> {
        const agendaContainer = container.createDiv({ cls: 'agenda-list-container' });
        
        // Get next 7 days starting from selected date
        const agendaDates: Date[] = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(this.plugin.selectedDate);
            date.setDate(this.plugin.selectedDate.getDate() + i);
            agendaDates.push(date);
        }
        
        // Fetch data for all days concurrently
        const dataPromises = agendaDates.map(async date => {
            const [tasks, notes] = await Promise.all([
                this.plugin.fileIndexer.getTaskInfoForDate(date),
                this.plugin.fileIndexer.getNotesForDate(date)
            ]);
            return { date, tasks, notes };
        });
        
        const agendaData = await Promise.all(dataPromises);
        
        // Render each day that has items
        agendaData.forEach(dayData => {
            const hasItems = dayData.tasks.length > 0 || dayData.notes.length > 0;
            
            if (hasItems) {
                // Create day header
                const dayHeader = agendaContainer.createDiv({ cls: 'agenda-day-header' });
                dayHeader.textContent = format(dayData.date, 'EEEE, MMMM d');
                
                // Create item list
                const itemList = agendaContainer.createDiv({ cls: 'agenda-item-list' });
                
                // Add tasks
                dayData.tasks.forEach(task => {
                    const item = itemList.createDiv({ cls: 'agenda-item task-item' });
                    const title = item.createDiv({ cls: 'item-title', text: task.title });
                    const meta = item.createDiv({ cls: 'item-meta' });
                    meta.createSpan({ cls: 'item-type', text: 'Task' });
                    
                    if (task.priority && task.priority !== 'normal') {
                        meta.createSpan({ cls: `priority-badge priority-${task.priority}`, text: task.priority });
                    }
                    
                    if (task.contexts && task.contexts.length > 0) {
                        task.contexts.forEach(context => {
                            meta.createSpan({ cls: 'context-tag', text: `@${context}` });
                        });
                    }
                });
                
                // Add notes
                dayData.notes.forEach(note => {
                    const item = itemList.createDiv({ cls: 'agenda-item note-item' });
                    const title = item.createDiv({ cls: 'item-title', text: note.title });
                    const meta = item.createDiv({ cls: 'item-meta' });
                    meta.createSpan({ cls: 'item-type', text: 'Note' });
                    
                    if (note.tags && note.tags.length > 0) {
                        note.tags.slice(0, 3).forEach(tag => {
                            meta.createSpan({ cls: 'note-tag', text: `#${tag}` });
                        });
                    }
                });
            }
        });
        
        // If no items found
        if (agendaContainer.children.length === 0) {
            const emptyMessage = agendaContainer.createDiv({ cls: 'empty-agenda-message' });
            emptyMessage.textContent = 'No tasks or notes found for the next 7 days.';
        }
    }
}