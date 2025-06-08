import { Notice, TFile, ItemView, WorkspaceLeaf, Menu } from 'obsidian';
import { format, addDays, startOfWeek, endOfWeek, isToday, isSameDay, isBefore, parseISO } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    AGENDA_VIEW_TYPE,
    EVENT_DATA_CHANGED,
    EVENT_DATE_SELECTED,
    EVENT_TASK_UPDATED,
    TaskInfo, 
    NoteInfo,
    FilterQuery
} from '../types';
import { isRecurringTaskDueOn, calculateTotalTimeSpent } from '../utils/helpers';
import { createTaskCard, updateTaskCard } from '../ui/TaskCard';
import { createNoteCard } from '../ui/NoteCard';
import { FilterBar } from '../ui/FilterBar';

export class AgendaView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // View settings
    private daysToShow: number = 7;
    private groupByDate: boolean = true;
    private showOverdueOnToday: boolean = false;
    private showNotes: boolean = true;
    private startDate: Date;
    
    // Filter system
    private filterBar: FilterBar | null = null;
    private currentQuery: FilterQuery;
    
    // Event listeners
    private listeners: (() => void)[] = [];
    
    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.startDate = new Date(plugin.selectedDate);
        
        // Initialize with saved state or default query for agenda view
        const savedQuery = this.plugin.viewStateManager?.getFilterState(AGENDA_VIEW_TYPE);
        this.currentQuery = savedQuery || {
            searchQuery: undefined,
            status: 'all',
            contexts: undefined,
            priorities: undefined,
            dateRange: this.getDateRange(),
            showArchived: false,
            sortKey: 'due',
            sortDirection: 'asc',
            groupKey: 'none' // Agenda groups by date internally
        };
        
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
        
        // Listen for date selection changes
        const dateListener = this.plugin.emitter.on(EVENT_DATE_SELECTED, (date: Date) => {
            this.startDate = new Date(date);
            this.updatePeriodDisplay();
            this.refresh();
        });
        this.listeners.push(dateListener);
        
        // Listen for individual task updates for granular DOM updates
        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, ({ path, originalTask, updatedTask }) => {
            // For agenda view, since items are organized by date and can move between days,
            // it's safer to do a refresh rather than try to update in place
            this.refresh();
        });
        this.listeners.push(taskUpdateListener);
        
        // Listen for filter service data changes
        const filterDataListener = this.plugin.filterService.on('data-changed', () => {
            this.refresh();
        });
        this.listeners.push(filterDataListener);
    }
    
    getViewType(): string {
        return AGENDA_VIEW_TYPE;
    }
    
    getDisplayText(): string {
        return 'Agenda';
    }
    
    getIcon(): string {
        return 'calendar-clock';
    }
    
    async onOpen() {
        // Wait for the plugin to be fully initialized before proceeding
        await this.plugin.onReady();
        
        const contentEl = this.contentEl;
        contentEl.empty();
        
        // Add container
        const container = contentEl.createDiv({ cls: 'tasknotes-container agenda-view-container' });
        
        // Show loading indicator
        this.showLoadingIndicator();
        
        // Render the view
        await this.renderView(container);
        
        // Hide loading indicator
        this.hideLoadingIndicator();
        
        // Register keyboard navigation
        this.registerKeyboardNavigation();
    }
    
    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        
        // Clean up FilterBar
        if (this.filterBar) {
            this.filterBar.destroy();
            this.filterBar = null;
        }
        
        // Clean up
        this.contentEl.empty();
    }
    
    private async renderView(container: HTMLElement) {
        // Clear existing content
        container.empty();
        
        // Create controls
        await this.createAgendaControls(container);
        
        // Create agenda content
        await this.renderAgendaContent(container);
    }
    
    private async createAgendaControls(container: HTMLElement) {
        const controlsContainer = container.createDiv({ cls: 'agenda-controls' });
        
        // Header section with date range and navigation (like tasks view)
        const headerSection = controlsContainer.createDiv({ cls: 'agenda-header-section' });
        
        const headerContent = headerSection.createDiv({ cls: 'agenda-header-content' });
        
        // Navigation controls
        const prevButton = headerContent.createEl('button', {
            cls: 'nav-arrow-button',
            text: '‹',
            attr: {
                'aria-label': 'Previous period',
                'title': 'Previous period (Left arrow)'
            }
        });
        
        // Current period display (large, styled like tasks view date)
        const currentPeriodDisplay = headerContent.createDiv({ 
            cls: 'agenda-period-title',
            text: this.getCurrentPeriodText()
        });
        
        const nextButton = headerContent.createEl('button', {
            cls: 'nav-arrow-button',
            text: '›',
            attr: {
                'aria-label': 'Next period',
                'title': 'Next period (Right arrow)'
            }
        });
        
        prevButton.addEventListener('click', () => {
            this.navigateToPreviousPeriod();
        });
        
        nextButton.addEventListener('click', () => {
            this.navigateToNextPeriod();
        });
        
        // FilterBar section (like tasks view)
        const filterBarContainer = controlsContainer.createDiv({ cls: 'agenda-filter-bar-container' });
        
        // Get filter options from FilterService
        const filterOptions = await this.plugin.filterService.getFilterOptions();
        
        // Create FilterBar with Agenda configuration
        this.filterBar = new FilterBar(
            filterBarContainer,
            this.currentQuery,
            filterOptions,
            {
                showSearch: true,
                showGroupBy: false, // Agenda groups by date internally
                showSortBy: true,
                showAdvancedFilters: true,
                allowedSortKeys: ['due', 'priority', 'title'],
                allowedGroupKeys: ['none'] // Only none allowed since we group by date
            }
        );
        
        // Listen for filter changes
        this.filterBar.on('queryChange', (newQuery: FilterQuery) => {
            this.currentQuery = newQuery;
            // Save the filter state (but always update date range based on current view)
            const queryToSave = { ...newQuery, dateRange: this.getDateRange() };
            this.plugin.viewStateManager.setFilterState(AGENDA_VIEW_TYPE, queryToSave);
            this.refresh();
        });
        
        // Settings section with period selector, today button, and toggles
        const settingsSection = controlsContainer.createDiv({ cls: 'agenda-settings-section' });
        
        // Left side: Period selector and Today button
        const leftControls = settingsSection.createDiv({ cls: 'agenda-left-controls' });
        
        const periodSelect = leftControls.createEl('select', { cls: 'agenda-period-select' });
        const periods = [
            { value: '7', text: '7 days' },
            { value: '14', text: '14 days' },
            { value: '30', text: '30 days' },
            { value: 'week', text: 'This week' },
        ];
        
        periods.forEach(period => {
            const option = periodSelect.createEl('option', { 
                value: period.value, 
                text: period.text 
            });
            if ((period.value === '7' && this.daysToShow === 7) ||
                (period.value === 'week' && this.daysToShow === -1)) {
                option.selected = true;
            }
        });
        
        periodSelect.addEventListener('change', () => {
            const value = periodSelect.value;
            if (value === 'week') {
                this.daysToShow = -1; // Special value for week view
            } else {
                this.daysToShow = parseInt(value);
            }
            
            // Update the date range in the query
            this.currentQuery.dateRange = this.getDateRange();
            
            this.refresh();
        });
        
        const todayButton = leftControls.createEl('button', {
            text: 'Today',
            cls: 'agenda-today-button'
        });
        
        todayButton.addEventListener('click', () => {
            this.startDate = new Date();
            this.refresh();
        });
        
        // Right side: Toggles
        const rightControls = settingsSection.createDiv({ cls: 'agenda-right-controls' });
        
        // Show overdue tasks toggle
        const overdueToggle = rightControls.createEl('label', { cls: 'agenda-toggle' });
        const overdueCheckbox = overdueToggle.createEl('input', { 
            type: 'checkbox',
            cls: 'agenda-toggle-checkbox'
        });
        overdueCheckbox.checked = this.showOverdueOnToday;
        overdueToggle.createSpan({ text: 'Overdue on today' });
        
        overdueCheckbox.addEventListener('change', () => {
            this.showOverdueOnToday = overdueCheckbox.checked;
            this.refresh();
        });
        
        // Show notes toggle
        const notesToggle = rightControls.createEl('label', { cls: 'agenda-toggle' });
        const notesCheckbox = notesToggle.createEl('input', { 
            type: 'checkbox',
            cls: 'agenda-toggle-checkbox'
        });
        notesCheckbox.checked = this.showNotes;
        notesToggle.createSpan({ text: 'Show notes' });
        
        notesCheckbox.addEventListener('change', () => {
            this.showNotes = notesCheckbox.checked;
            this.refresh();
        });
    }
    
    /**
     * Get date range for FilterService query
     */
    private getDateRange(): { start: string; end: string } {
        const dates = this.getAgendaDates();
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];
        
        return {
            start: format(startDate, 'yyyy-MM-dd'),
            end: format(endDate, 'yyyy-MM-dd')
        };
    }
    
    private async renderAgendaContent(container: HTMLElement) {
        // Find existing content container or create new one
        let contentContainer = container.querySelector('.agenda-content') as HTMLElement;
        if (!contentContainer) {
            contentContainer = container.createDiv({ cls: 'agenda-content' });
        }
        
        try {
            // Update the date range in the query
            this.currentQuery.dateRange = this.getDateRange();
            
            // Check if we should include overdue tasks (only if today is in range)
            const today = new Date();
            const todayStr = format(today, 'yyyy-MM-dd');
            const dates = this.getAgendaDates();
            const hasTodayInRange = dates.some(date => format(date, 'yyyy-MM-dd') === todayStr);
            
            // Set includeOverdue flag for efficient filtering
            this.currentQuery.includeOverdue = this.showOverdueOnToday && hasTodayInRange;
            
            // Get filtered tasks from FilterService (now efficiently includes overdue if needed)
            const groupedTasks = await this.plugin.filterService.getGroupedTasks(this.currentQuery);
            
            // Flatten the grouped tasks since we'll re-group by date
            const allTasks = Array.from(groupedTasks.values()).flat();
            
            // Get all notes for the date range (FilterService doesn't handle notes yet)
            const allNotes = await this.plugin.cacheManager.getAllNotes();
            
            // Group data by date
            const agendaData = dates.map(date => {
                const dateStr = format(date, 'yyyy-MM-dd');
                
                // Filter tasks for this date
                const tasksForDate = allTasks.filter(task => {
                    // Handle recurring tasks
                    if (task.recurrence) {
                        return isRecurringTaskDueOn(task, date);
                    }
                    
                    // Handle regular tasks with due dates for this specific date
                    if (task.due === dateStr) {
                        return true;
                    }
                    
                    // If showing overdue tasks and this is today, include overdue tasks
                    if (this.showOverdueOnToday && isToday(date) && task.due) {
                        const taskDueDate = parseISO(task.due);
                        return isBefore(taskDueDate, date);
                    }
                    
                    return false;
                });
                
                // Filter notes for this date (if notes are enabled)
                const notesForDate = this.showNotes ? allNotes.filter(note => {
                    if (note.createdDate) {
                        const noteCreatedDate = note.createdDate.split('T')[0];
                        return noteCreatedDate === dateStr;
                    }
                    return false;
                }) : [];
                
                return { date, tasks: tasksForDate, notes: notesForDate };
            });
            
            // Use DOMReconciler-based rendering
            if (this.groupByDate) {
                this.renderGroupedAgendaWithReconciler(contentContainer, agendaData);
            } else {
                this.renderFlatAgendaWithReconciler(contentContainer, agendaData);
            }
        } catch (error) {
            console.error('Error rendering agenda content:', error);
            contentContainer.empty();
            contentContainer.createEl('p', { 
                text: 'Error loading agenda. Please try refreshing.', 
                cls: 'error-message' 
            });
        }
    }
    
    private renderGroupedAgenda(container: HTMLElement, agendaData: Array<{date: Date, tasks: TaskInfo[], notes: NoteInfo[]}>) {
        let hasAnyItems = false;
        
        agendaData.forEach(dayData => {
            const dateStr = format(dayData.date, 'yyyy-MM-dd');
            
            // Filter tasks (archived filtering already handled by FilterService)
            const tasksForDate = dayData.tasks.filter(task => {
                // Handle recurring tasks
                if (task.recurrence) {
                    return isRecurringTaskDueOn(task, dayData.date);
                }
                
                // Handle regular tasks with due dates for this specific date
                if (task.due === dateStr) {
                    return true;
                }
                
                // If showing overdue tasks and this is today, include overdue tasks
                if (this.showOverdueOnToday && isToday(dayData.date) && task.due) {
                    const taskDueDate = parseISO(task.due);
                    return isBefore(taskDueDate, dayData.date);
                }
                
                return false;
            });
            
            const hasItems = tasksForDate.length > 0 || dayData.notes.length > 0;
            
            if (hasItems) {
                hasAnyItems = true;
                
                // Day header (rendered directly to container)
                const dayHeader = container.createDiv({ cls: 'agenda-day-header' });
                const headerText = dayHeader.createDiv({ cls: 'day-header-text' });
                
                const dayName = format(dayData.date, 'EEEE');
                const dateFormatted = format(dayData.date, 'MMMM d');
                
                if (isToday(dayData.date)) {
                    headerText.createSpan({ cls: 'day-name today-badge', text: 'Today' });
                    headerText.createSpan({ cls: 'day-date', text: ` • ${dateFormatted}` });
                } else {
                    headerText.createSpan({ cls: 'day-name', text: dayName });
                    headerText.createSpan({ cls: 'day-date', text: ` • ${dateFormatted}` });
                }
                
                // Item count badge
                const itemCount = tasksForDate.length + dayData.notes.length;
                dayHeader.createDiv({ cls: 'item-count-badge', text: `${itemCount}` });
                
                // Render tasks directly to container
                this.renderTasks(container, tasksForDate);
                
                // Render notes directly to container
                this.renderNotes(container, dayData.notes);
            }
        });
        
        // Show empty message if no items
        if (!hasAnyItems) {
            const emptyMessage = container.createDiv({ cls: 'empty-agenda-message' });
            
            emptyMessage.createEl('p', { 
                text: 'No items scheduled for this period.'
            });
            
            const tipMessage = emptyMessage.createEl('p', { 
                cls: 'empty-tip'
            });
            tipMessage.createEl('span', { text: 'Tip: ' });
            tipMessage.appendChild(document.createTextNode('Create tasks with due dates or add notes to see them here.'));
        }
    }
    
    private renderFlatAgenda(container: HTMLElement, agendaData: Array<{date: Date, tasks: TaskInfo[], notes: NoteInfo[]}>) {
        // Collect all items with their dates
        const allItems: Array<{type: 'task' | 'note', item: TaskInfo | NoteInfo, date: Date}> = [];
        
        agendaData.forEach(dayData => {
            const dateStr = format(dayData.date, 'yyyy-MM-dd');
            
            dayData.tasks.forEach(task => {
                // Archived filtering already handled by FilterService
                let shouldInclude = false;
                
                if (task.recurrence) {
                    shouldInclude = isRecurringTaskDueOn(task, dayData.date);
                } else if (task.due === dateStr) {
                    shouldInclude = true;
                } else if (this.showOverdueOnToday && isToday(dayData.date) && task.due) {
                    // If showing overdue tasks and this is today, include overdue tasks
                    const taskDueDate = parseISO(task.due);
                    shouldInclude = isBefore(taskDueDate, dayData.date);
                }
                
                if (shouldInclude) {
                    allItems.push({ type: 'task', item: task, date: dayData.date });
                }
            });
            
            dayData.notes.forEach(note => {
                allItems.push({ type: 'note', item: note, date: dayData.date });
            });
        });
        
        if (allItems.length === 0) {
            const emptyMessage = container.createDiv({ cls: 'empty-agenda-message' });
            emptyMessage.textContent = 'No items found for the selected period.';
            return;
        }
        
        // Sort by date
        allItems.sort((a, b) => a.date.getTime() - b.date.getTime());
        
        // Render all items
        const itemList = container.createDiv({ cls: 'agenda-item-list flat-list' });
        
        allItems.forEach(({ type, item, date }) => {
            if (type === 'task') {
                this.renderTaskItem(itemList, item as TaskInfo, date);
            } else {
                this.renderNoteItem(itemList, item as NoteInfo, date);
            }
        });
    }
    
    private renderTasks(container: HTMLElement, tasks: TaskInfo[]) {
        // Sort tasks by priority and status
        const sortedTasks = [...tasks].sort((a, b) => {
            // Incomplete tasks first
            if (a.status !== 'done' && b.status === 'done') return -1;
            if (a.status === 'done' && b.status !== 'done') return 1;
            
            // Then by priority using PriorityManager
            return this.plugin.priorityManager.comparePriorities(a.priority, b.priority);
        });
        
        sortedTasks.forEach(task => {
            this.renderTaskItem(container, task);
        });
    }
    
    private renderTaskItem(container: HTMLElement, task: TaskInfo, date?: Date) {
        const taskCard = createTaskCard(task, this.plugin, {
            showDueDate: !this.groupByDate,
            showCheckbox: false,
            showTimeTracking: true,
            showRecurringControls: true,
            groupByDate: this.groupByDate,
            targetDate: date
        });
        
        // Task cards use their native styling
        
        // Add completion status class if task is completed
        if (this.plugin.statusManager.isCompletedStatus(task.status)) {
            taskCard.classList.add('done');
        }
        
        container.appendChild(taskCard);
    }
    
    private renderNotes(container: HTMLElement, notes: NoteInfo[]) {
        notes.forEach(note => {
            this.renderNoteItem(container, note);
        });
    }
    
    private renderNoteItem(container: HTMLElement, note: NoteInfo, date?: Date) {
        const noteCard = createNoteCard(note, this.plugin, {
            showCreatedDate: false, // Don't show created date in agenda view
            showTags: true,
            showPath: false,
            maxTags: 3,
            showDailyNoteBadge: false // Notes in agenda are contextual to date
        });
        
        // Note cards use their native styling
        
        // Add date if not grouping by date
        if (!this.groupByDate && date) {
            const dateSpan = noteCard.createSpan({ 
                cls: 'note-date', 
                text: format(date, 'MMM d') 
            });
        }
        
        container.appendChild(noteCard);
    }
    
    /**
     * Render grouped agenda using DOMReconciler for efficient updates
     */
    private renderGroupedAgendaWithReconciler(container: HTMLElement, agendaData: Array<{date: Date, tasks: TaskInfo[], notes: NoteInfo[]}>) {
        // Create flattened list of all items with their day grouping
        const allItems: Array<{type: 'day-header' | 'task' | 'note', item: any, date: Date, dayKey: string}> = [];
        
        let hasAnyItems = false;
        agendaData.forEach(dayData => {
            const dateStr = format(dayData.date, 'yyyy-MM-dd');
            
            // Filter tasks for this date - use the same logic as the main filtering
            const tasksForDate = dayData.tasks.filter(task => {
                // Handle recurring tasks
                if (task.recurrence) {
                    return isRecurringTaskDueOn(task, dayData.date);
                }
                
                // Handle regular tasks with due dates for this specific date
                if (task.due === dateStr) {
                    return true;
                }
                
                // If showing overdue tasks and this is today, include overdue tasks
                if (this.showOverdueOnToday && isToday(dayData.date) && task.due) {
                    const taskDueDate = parseISO(task.due);
                    return isBefore(taskDueDate, dayData.date);
                }
                
                return false;
            });
            
            const hasItems = tasksForDate.length > 0 || dayData.notes.length > 0;
            
            if (hasItems) {
                hasAnyItems = true;
                const dayKey = dateStr;
                
                // Add day header
                allItems.push({
                    type: 'day-header',
                    item: dayData,
                    date: dayData.date,
                    dayKey
                });
                
                // Add tasks
                tasksForDate.forEach(task => {
                    allItems.push({
                        type: 'task',
                        item: task,
                        date: dayData.date,
                        dayKey
                    });
                });
                
                // Add notes
                dayData.notes.forEach(note => {
                    allItems.push({
                        type: 'note',
                        item: note,
                        date: dayData.date,
                        dayKey
                    });
                });
            }
        });
        
        if (!hasAnyItems) {
            container.empty();
            const emptyMessage = container.createDiv({ cls: 'empty-agenda-message' });
            emptyMessage.createEl('p', { text: 'No items scheduled for this period.' });
            const tipMessage = emptyMessage.createEl('p', { cls: 'empty-tip' });
            tipMessage.createEl('span', { text: 'Tip: ' });
            tipMessage.appendChild(document.createTextNode('Create tasks with due dates or add notes to see them here.'));
            return;
        }
        
        // Use DOMReconciler to update the list
        this.plugin.domReconciler.updateList(
            container,
            allItems,
            (item) => `${item.type}-${item.dayKey}-${item.type === 'day-header' ? item.dayKey : (item.item.path || (item.item as any).id || 'unknown')}`,
            (item) => this.createAgendaItemElement(item),
            (element, item) => this.updateAgendaItemElement(element, item)
        );
    }
    
    /**
     * Render flat agenda using DOMReconciler for efficient updates
     */
    private renderFlatAgendaWithReconciler(container: HTMLElement, agendaData: Array<{date: Date, tasks: TaskInfo[], notes: NoteInfo[]}>) {
        // Collect all items with their dates
        const allItems: Array<{type: 'task' | 'note', item: TaskInfo | NoteInfo, date: Date}> = [];
        
        agendaData.forEach(dayData => {
            const dateStr = format(dayData.date, 'yyyy-MM-dd');
            
            dayData.tasks.forEach(task => {
                let shouldInclude = false;
                
                if (task.recurrence) {
                    shouldInclude = isRecurringTaskDueOn(task, dayData.date);
                } else if (task.due === dateStr) {
                    shouldInclude = true;
                } else if (this.showOverdueOnToday && isToday(dayData.date) && task.due) {
                    // If showing overdue tasks and this is today, include overdue tasks
                    const taskDueDate = parseISO(task.due);
                    shouldInclude = isBefore(taskDueDate, dayData.date);
                }
                
                if (shouldInclude) {
                    allItems.push({ type: 'task', item: task, date: dayData.date });
                }
            });
            
            dayData.notes.forEach(note => {
                allItems.push({ type: 'note', item: note, date: dayData.date });
            });
        });
        
        if (allItems.length === 0) {
            container.empty();
            const emptyMessage = container.createDiv({ cls: 'empty-agenda-message' });
            emptyMessage.textContent = 'No items found for the selected period.';
            return;
        }
        
        // Sort by date
        allItems.sort((a, b) => a.date.getTime() - b.date.getTime());
        
        // Use DOMReconciler to update the list
        this.plugin.domReconciler.updateList(
            container,
            allItems,
            (item) => `${item.type}-${item.item.path || (item.item as any).id || 'unknown'}`,
            (item) => this.createFlatAgendaItemElement(item),
            (element, item) => this.updateFlatAgendaItemElement(element, item)
        );
    }
    
    /**
     * Create agenda item element for reconciler
     */
    private createAgendaItemElement(item: {type: 'day-header' | 'task' | 'note', item: any, date: Date, dayKey: string}): HTMLElement {
        if (item.type === 'day-header') {
            const dayHeader = document.createElement('div');
            dayHeader.className = 'agenda-day-header';
            
            const headerText = dayHeader.createDiv({ cls: 'day-header-text' });
            const dayName = format(item.date, 'EEEE');
            const dateFormatted = format(item.date, 'MMMM d');
            
            if (isToday(item.date)) {
                headerText.createSpan({ cls: 'day-name today-badge', text: 'Today' });
                headerText.createSpan({ cls: 'day-date', text: ` • ${dateFormatted}` });
            } else {
                headerText.createSpan({ cls: 'day-name', text: dayName });
                headerText.createSpan({ cls: 'day-date', text: ` • ${dateFormatted}` });
            }
            
            // Item count badge
            const itemCount = item.item.tasks.length + item.item.notes.length;
            dayHeader.createDiv({ cls: 'item-count-badge', text: `${itemCount}` });
            
            return dayHeader;
        } else if (item.type === 'task') {
            return this.createTaskItemElement(item.item as TaskInfo, item.date);
        } else {
            return this.createNoteItemElement(item.item as NoteInfo, item.date);
        }
    }
    
    /**
     * Update agenda item element for reconciler
     */
    private updateAgendaItemElement(element: HTMLElement, item: {type: 'day-header' | 'task' | 'note', item: any, date: Date, dayKey: string}): void {
        if (item.type === 'day-header') {
            // Update item count badge
            const countBadge = element.querySelector('.item-count-badge');
            if (countBadge) {
                const itemCount = item.item.tasks.length + item.item.notes.length;
                countBadge.textContent = `${itemCount}`;
            }
        } else if (item.type === 'task') {
            updateTaskCard(element, item.item as TaskInfo, this.plugin, {
                showDueDate: !this.groupByDate,
                showCheckbox: false,
                showTimeTracking: true,
                showRecurringControls: true,
                groupByDate: this.groupByDate,
                targetDate: item.date
            });
        }
        // Note updates are handled automatically by the note card structure
    }
    
    /**
     * Create flat agenda item element for reconciler
     */
    private createFlatAgendaItemElement(item: {type: 'task' | 'note', item: TaskInfo | NoteInfo, date: Date}): HTMLElement {
        if (item.type === 'task') {
            return this.createTaskItemElement(item.item as TaskInfo, item.date);
        } else {
            return this.createNoteItemElement(item.item as NoteInfo, item.date);
        }
    }
    
    /**
     * Update flat agenda item element for reconciler
     */
    private updateFlatAgendaItemElement(element: HTMLElement, item: {type: 'task' | 'note', item: TaskInfo | NoteInfo, date: Date}): void {
        if (item.type === 'task') {
            updateTaskCard(element, item.item as TaskInfo, this.plugin, {
                showDueDate: !this.groupByDate,
                showCheckbox: false,
                showTimeTracking: true,
                showRecurringControls: true,
                groupByDate: this.groupByDate,
                targetDate: item.date
            });
        }
        // Note updates are handled automatically by the note card structure
    }
    
    /**
     * Create task item element
     */
    private createTaskItemElement(task: TaskInfo, date?: Date): HTMLElement {
        const taskCard = createTaskCard(task, this.plugin, {
            showDueDate: !this.groupByDate,
            showCheckbox: false,
            showTimeTracking: true,
            showRecurringControls: true,
            groupByDate: this.groupByDate,
            targetDate: date
        });
        
        // Add completion status class if task is completed
        if (this.plugin.statusManager.isCompletedStatus(task.status)) {
            taskCard.classList.add('done');
        }
        
        return taskCard;
    }
    
    /**
     * Create note item element
     */
    private createNoteItemElement(note: NoteInfo, date?: Date): HTMLElement {
        const noteCard = createNoteCard(note, this.plugin, {
            showCreatedDate: false,
            showTags: true,
            showPath: false,
            maxTags: 3,
            showDailyNoteBadge: false
        });
        
        // Add date if not grouping by date
        if (!this.groupByDate && date) {
            const dateSpan = noteCard.createSpan({ 
                cls: 'note-date', 
                text: format(date, 'MMM d') 
            });
        }
        
        return noteCard;
    }
    
    private addHoverPreview(element: HTMLElement, filePath: string) {
        element.addEventListener('mouseover', (event) => {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file) {
                this.app.workspace.trigger('hover-link', {
                    event,
                    source: 'tasknotes-agenda',
                    hoverParent: this,
                    targetEl: element,
                    linktext: filePath,
                    sourcePath: filePath
                });
            }
        });
    }
    
    private openFile(path: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file);
        }
    }
    
    private getAgendaDates(): Date[] {
        const dates: Date[] = [];
        
        if (this.daysToShow === -1) {
            // Week view - show current week based on startDate
            const weekStart = startOfWeek(this.startDate, { weekStartsOn: 0 }); // Sunday
            const weekEnd = endOfWeek(this.startDate, { weekStartsOn: 0 });
            
            let currentDate = weekStart;
            while (currentDate <= weekEnd) {
                dates.push(new Date(currentDate));
                currentDate = addDays(currentDate, 1);
            }
        } else {
            // Fixed number of days starting from startDate
            for (let i = 0; i < this.daysToShow; i++) {
                dates.push(addDays(this.startDate, i));
            }
        }
        
        return dates;
    }
    
    private navigateToPreviousPeriod() {
        if (this.daysToShow === -1) {
            // Week view - go to previous week
            this.startDate = addDays(this.startDate, -7);
        } else {
            // Fixed days - go back by the number of days shown
            this.startDate = addDays(this.startDate, -this.daysToShow);
        }
        
        // Update the date range in the query
        this.currentQuery.dateRange = this.getDateRange();
        
        this.updatePeriodDisplay();
        this.refresh();
    }
    
    private navigateToNextPeriod() {
        if (this.daysToShow === -1) {
            // Week view - go to next week
            this.startDate = addDays(this.startDate, 7);
        } else {
            // Fixed days - go forward by the number of days shown
            this.startDate = addDays(this.startDate, this.daysToShow);
        }
        
        // Update the date range in the query
        this.currentQuery.dateRange = this.getDateRange();
        
        this.updatePeriodDisplay();
        this.refresh();
    }
    
    private updatePeriodDisplay(): void {
        const currentPeriodDisplay = this.contentEl.querySelector('.agenda-period-title');
        if (currentPeriodDisplay) {
            currentPeriodDisplay.textContent = this.getCurrentPeriodText();
        }
    }
    
    private getCurrentPeriodText(): string {
        const dates = this.getAgendaDates();
        if (dates.length === 0) return '';
        
        const start = dates[0];
        const end = dates[dates.length - 1];
        
        if (isSameDay(start, end)) {
            return format(start, 'EEEE, MMMM d, yyyy');
        } else {
            return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
        }
    }
    
    private showLoadingIndicator() {
        const container = this.contentEl.querySelector('.tasknotes-container');
        if (!container || container.querySelector('.cache-loading-indicator')) return;
        
        const indicator = document.createElement('div');
        indicator.className = 'cache-loading-indicator';
        indicator.textContent = 'Loading agenda...';
        container.prepend(indicator);
    }
    
    private hideLoadingIndicator() {
        const indicator = this.contentEl.querySelector('.cache-loading-indicator');
        if (indicator) {
            indicator.remove();
        }
    }
    
    async refresh() {
        const container = this.contentEl.querySelector('.tasknotes-container') as HTMLElement;
        if (container) {
            // Use DOMReconciler for efficient updates
            await this.renderAgendaContent(container);
        }
    }
    
    private registerKeyboardNavigation() {
        this.registerDomEvent(document, 'keydown', async (e: KeyboardEvent) => {
            // Only handle events when this view is active
            if (!this.isThisViewActive()) {
                return;
            }
            
            switch (e.key) {
                // Left arrow - previous period
                case 'ArrowLeft':
                    e.preventDefault();
                    this.navigateToPreviousPeriod();
                    break;
                    
                // Right arrow - next period
                case 'ArrowRight':
                    e.preventDefault();
                    this.navigateToNextPeriod();
                    break;
            }
        });
    }
    
    private isThisViewActive(): boolean {
        const activeView = this.app.workspace.getActiveViewOfType(AgendaView);
        return activeView === this;
    }
}