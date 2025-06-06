import { Notice, TFile, ItemView, WorkspaceLeaf, Menu } from 'obsidian';
import { format, addDays, startOfWeek, endOfWeek, isToday, isSameDay } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    AGENDA_VIEW_TYPE,
    EVENT_DATA_CHANGED,
    EVENT_DATE_SELECTED,
    EVENT_TASK_UPDATED,
    TaskInfo, 
    NoteInfo,
} from '../types';
import { isRecurringTaskDueOn, calculateTotalTimeSpent } from '../utils/helpers';
import { createTaskCard, updateTaskCard } from '../ui/TaskCard';
import { createNoteCard } from '../ui/NoteCard';

export class AgendaView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // View settings
    private daysToShow: number = 7;
    private showArchived: boolean = false;
    private groupByDate: boolean = true;
    private startDate: Date;
    
    // Event listeners
    private listeners: (() => void)[] = [];
    
    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.startDate = new Date(plugin.selectedDate);
        
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
            this.refresh();
        });
        this.listeners.push(dateListener);
        
        // Listen for individual task updates for granular DOM updates
        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, ({ path, updatedTask }) => {
            this.updateTaskElementInDOM(path, updatedTask);
        });
        this.listeners.push(taskUpdateListener);
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
        const contentEl = this.contentEl;
        contentEl.empty();
        
        // Add container with improved styling
        const container = contentEl.createDiv({ cls: 'tasknotes-container agenda-view-container' });
        container.style.padding = '16px';
        container.style.maxWidth = '1000px';
        container.style.margin = '0 auto';
        
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
        
        // Clean up
        this.contentEl.empty();
    }
    
    private async renderView(container: HTMLElement) {
        // Clear existing content
        container.empty();
        
        // Create controls
        this.createAgendaControls(container);
        
        // Create agenda content
        await this.renderAgendaContent(container);
    }
    
    private createAgendaControls(container: HTMLElement) {
        const controlsContainer = container.createDiv({ cls: 'agenda-controls' });
        
        // Row 1: Period Navigation
        const navigationRow = controlsContainer.createDiv({ cls: 'controls-row navigation-row' });
        navigationRow.style.display = 'flex';
        navigationRow.style.alignItems = 'center';
        navigationRow.style.justifyContent = 'space-between';
        navigationRow.style.gap = '12px';
        
        // Navigation controls group
        const navGroup = navigationRow.createDiv({ cls: 'nav-group' });
        navGroup.style.display = 'flex';
        navGroup.style.alignItems = 'center';
        navGroup.style.gap = '8px';
        
        const prevButton = navGroup.createEl('button', {
            cls: 'nav-arrow-button tasknotes-button',
            text: '‹',
            attr: {
                'aria-label': 'Previous period',
                'title': 'Previous period (Left arrow or H key)'
            }
        });
        
        prevButton.addEventListener('click', () => {
            this.navigateToPreviousPeriod();
        });
        
        // Current period display
        const currentPeriodDisplay = navGroup.createDiv({ 
            cls: 'current-period-display',
            text: this.getCurrentPeriodText()
        });
        currentPeriodDisplay.style.fontWeight = '600';
        currentPeriodDisplay.style.fontSize = '1.1em';
        currentPeriodDisplay.style.minWidth = '150px';
        currentPeriodDisplay.style.textAlign = 'center';
        
        const nextButton = navGroup.createEl('button', {
            cls: 'nav-arrow-button tasknotes-button',
            text: '›',
            attr: {
                'aria-label': 'Next period',
                'title': 'Next period (Right arrow or L key)'
            }
        });
        
        nextButton.addEventListener('click', () => {
            this.navigateToNextPeriod();
        });
        
        const todayButton = navigationRow.createEl('button', {
            text: 'Today',
            cls: 'today-button tasknotes-button tasknotes-button-primary'
        });
        
        todayButton.addEventListener('click', () => {
            this.startDate = new Date();
            this.refresh();
        });
        
        // Row 2: View Options
        const optionsRow = controlsContainer.createDiv({ cls: 'controls-row options-row' });
        optionsRow.style.display = 'flex';
        optionsRow.style.alignItems = 'center';
        optionsRow.style.gap = '20px';
        optionsRow.style.flexWrap = 'wrap';
        
        // Period selector
        const periodContainer = optionsRow.createDiv({ cls: 'option-group period-selector' });
        periodContainer.style.display = 'flex';
        periodContainer.style.alignItems = 'center';
        periodContainer.style.gap = '8px';
        
        periodContainer.createEl('label', { text: 'Period:', cls: 'option-label' });
        
        const periodSelect = periodContainer.createEl('select', { cls: 'period-select' });
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
            this.refresh();
            // Update the period display
            currentPeriodDisplay.textContent = this.getCurrentPeriodText();
        });
        
        // Show archived toggle
        const archivedContainer = optionsRow.createDiv({ cls: 'option-group toggle-container' });
        archivedContainer.style.display = 'flex';
        archivedContainer.style.alignItems = 'center';
        
        const archivedToggle = archivedContainer.createEl('label', { cls: 'toggle-label' });
        archivedToggle.style.display = 'flex';
        archivedToggle.style.alignItems = 'center';
        archivedToggle.style.gap = '6px';
        archivedToggle.style.cursor = 'pointer';
        
        const archivedCheckbox = archivedToggle.createEl('input', { 
            type: 'checkbox',
            cls: 'toggle-checkbox'
        });
        archivedCheckbox.checked = this.showArchived;
        archivedToggle.createSpan({ text: 'Show archived' });
        
        archivedCheckbox.addEventListener('change', () => {
            this.showArchived = archivedCheckbox.checked;
            this.refresh();
        });
        
        // Group by date toggle
        const groupingContainer = optionsRow.createDiv({ cls: 'option-group toggle-container' });
        groupingContainer.style.display = 'flex';
        groupingContainer.style.alignItems = 'center';
        
        const groupingToggle = groupingContainer.createEl('label', { cls: 'toggle-label' });
        groupingToggle.style.display = 'flex';
        groupingToggle.style.alignItems = 'center';
        groupingToggle.style.gap = '6px';
        groupingToggle.style.cursor = 'pointer';
        
        const groupingCheckbox = groupingToggle.createEl('input', { 
            type: 'checkbox',
            cls: 'toggle-checkbox'
        });
        groupingCheckbox.checked = this.groupByDate;
        groupingToggle.createSpan({ text: 'Group by date' });
        
        groupingCheckbox.addEventListener('change', () => {
            this.groupByDate = groupingCheckbox.checked;
            this.refresh();
        });
    }
    
    private async renderAgendaContent(container: HTMLElement) {
        const contentContainer = container.createDiv({ cls: 'agenda-content' });
        
        // Get date range
        const dates = this.getAgendaDates();
        
        // Fetch all data
        const dataPromises = dates.map(async date => {
            const [tasks, notes] = await Promise.all([
                this.plugin.cacheManager.getTaskInfoForDate(date),
                this.plugin.cacheManager.getNotesForDate(date)
            ]);
            return { date, tasks, notes };
        });
        
        const agendaData = await Promise.all(dataPromises);
        
        // Group items by date if enabled
        if (this.groupByDate) {
            this.renderGroupedAgenda(contentContainer, agendaData);
        } else {
            this.renderFlatAgenda(contentContainer, agendaData);
        }
    }
    
    private renderGroupedAgenda(container: HTMLElement, agendaData: Array<{date: Date, tasks: TaskInfo[], notes: NoteInfo[]}>) {
        let hasAnyItems = false;
        
        agendaData.forEach(dayData => {
            const dateStr = format(dayData.date, 'yyyy-MM-dd');
            
            // Filter tasks
            const tasksForDate = dayData.tasks.filter(task => {
                // Skip archived tasks if not showing them
                if (!this.showArchived && task.archived) {
                    return false;
                }
                
                // Handle recurring tasks
                if (task.recurrence) {
                    return isRecurringTaskDueOn(task, dayData.date);
                }
                
                return task.due === dateStr;
            });
            
            const hasItems = tasksForDate.length > 0 || dayData.notes.length > 0;
            
            if (hasItems) {
                hasAnyItems = true;
                
                // Create day section
                const daySection = container.createDiv({ cls: 'agenda-day-section' });
                
                // Day header
                const dayHeader = daySection.createDiv({ cls: 'agenda-day-header' });
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
                
                // Item list
                const itemList = daySection.createDiv({ cls: 'agenda-item-list' });
                
                // Render tasks first
                this.renderTasks(itemList, tasksForDate);
                
                // Then render notes
                this.renderNotes(itemList, dayData.notes);
            }
        });
        
        // Show empty message if no items
        if (!hasAnyItems) {
            const emptyMessage = container.createDiv({ cls: 'empty-agenda-message' });
            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.padding = '40px 20px';
            emptyMessage.style.color = 'var(--text-muted)';
            
            emptyMessage.createEl('p', { 
                text: 'No items scheduled for this period.',
                attr: { style: 'margin: 0 0 8px 0; font-size: 1.1em;' }
            });
            
            const tipMessage = emptyMessage.createEl('p', { 
                cls: 'empty-tip',
                attr: { style: 'margin: 0; font-size: 0.9em; opacity: 0.8;' }
            });
            tipMessage.createEl('span', { text: 'Tip: ', attr: { style: 'font-weight: 500;' } });
            tipMessage.appendChild(document.createTextNode('Create tasks with due dates or add notes to see them here.'));
        }
    }
    
    private renderFlatAgenda(container: HTMLElement, agendaData: Array<{date: Date, tasks: TaskInfo[], notes: NoteInfo[]}>) {
        // Collect all items with their dates
        const allItems: Array<{type: 'task' | 'note', item: TaskInfo | NoteInfo, date: Date}> = [];
        
        agendaData.forEach(dayData => {
            const dateStr = format(dayData.date, 'yyyy-MM-dd');
            
            dayData.tasks.forEach(task => {
                if (!this.showArchived && task.archived) {
                    return;
                }
                
                if (task.recurrence) {
                    if (isRecurringTaskDueOn(task, dayData.date)) {
                        allItems.push({ type: 'task', item: task, date: dayData.date });
                    }
                } else if (task.due === dateStr) {
                    allItems.push({ type: 'task', item: task, date: dayData.date });
                }
            });
            
            dayData.notes.forEach(note => {
                allItems.push({ type: 'note', item: note, date: dayData.date });
            });
        });
        
        if (allItems.length === 0) {
            const emptyMessage = container.createDiv({ cls: 'empty-agenda-message' });
            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.padding = '40px 20px';
            emptyMessage.style.color = 'var(--text-muted)';
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
        
        // Add agenda-specific styling
        taskCard.classList.add('agenda-item', 'task-item');
        
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
        
        // Add agenda-specific styling
        noteCard.classList.add('agenda-item', 'note-item');
        
        // Add date if not grouping by date
        if (!this.groupByDate && date) {
            const dateSpan = noteCard.createSpan({ 
                cls: 'note-date', 
                text: format(date, 'MMM d') 
            });
        }
        
        container.appendChild(noteCard);
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
    
    
    /**
     * Update a specific task element in the DOM without full re-render
     */
    private updateTaskElementInDOM(taskPath: string, updatedTask: TaskInfo): void {
        const taskElement = this.contentEl.querySelector(`[data-task-path="${taskPath}"]`) as HTMLElement;
        
        // Check if task should be visible based on archived filter
        const shouldBeVisible = this.showArchived || !updatedTask.archived;
        
        if (taskElement && shouldBeVisible) {
            try {
                // Update the existing task card
                updateTaskCard(taskElement, updatedTask, this.plugin, {
                    showDueDate: !this.groupByDate,
                    showCheckbox: false,
                    showTimeTracking: true,
                    showRecurringControls: true,
                    groupByDate: this.groupByDate,
                    targetDate: this.startDate
                });
                console.log(`AgendaView: Successfully updated DOM for task ${taskPath}`);
            } catch (error) {
                console.error(`AgendaView: Error updating DOM for task ${taskPath}:`, error);
                // If update fails, trigger a full refresh to recover
                this.refresh();
            }
        } else if (taskElement && !shouldBeVisible) {
            // Task should be hidden - remove it from the DOM
            taskElement.remove();
            console.log(`AgendaView: Removed task ${taskPath} from DOM (archived)`);
        } else if (!taskElement && shouldBeVisible) {
            // Task element not found but should be visible - might be a new task
            console.log(`AgendaView: No element found for task ${taskPath}, triggering refresh`);
            this.refresh();
        } else {
            // Task element not found and shouldn't be visible - nothing to do
            console.log(`AgendaView: No element found for task ${taskPath}, skipping update (filtered)`);
        }
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
        this.refresh();
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
            // Try to preserve scroll position
            const contentContainer = container.querySelector('.agenda-content') as HTMLElement;
            let scrollTop = 0;
            if (contentContainer) {
                scrollTop = contentContainer.scrollTop;
            }
            
            await this.renderView(container);
            
            // Restore scroll position
            const newContentContainer = container.querySelector('.agenda-content') as HTMLElement;
            if (newContentContainer) {
                newContentContainer.scrollTop = scrollTop;
            }
        }
    }
    
    private registerKeyboardNavigation() {
        this.registerDomEvent(document, 'keydown', async (e: KeyboardEvent) => {
            // Only handle events when this view is active
            if (!this.isThisViewActive()) {
                return;
            }
            
            switch (e.key) {
                // Left arrow or h - previous period
                case 'ArrowLeft':
                case 'h':
                    e.preventDefault();
                    this.navigateToPreviousPeriod();
                    break;
                    
                // Right arrow or l - next period
                case 'ArrowRight':
                case 'l':
                    e.preventDefault();
                    this.navigateToNextPeriod();
                    break;
                    
                // t - go to today
                case 't':
                case 'T':
                    e.preventDefault();
                    this.startDate = new Date();
                    this.refresh();
                    break;
                    
                // g - toggle grouping
                case 'g':
                case 'G':
                    e.preventDefault();
                    this.groupByDate = !this.groupByDate;
                    const groupingCheckbox = this.contentEl.querySelector('.option-group.toggle-container:last-child .toggle-checkbox') as HTMLInputElement;
                    if (groupingCheckbox) groupingCheckbox.checked = this.groupByDate;
                    this.refresh();
                    break;
                    
                // c - toggle archived tasks
                case 'c':
                case 'C':
                    e.preventDefault();
                    this.showArchived = !this.showArchived;
                    const checkbox = this.contentEl.querySelector('.toggle-checkbox') as HTMLInputElement;
                    if (checkbox) checkbox.checked = this.showArchived;
                    this.refresh();
                    break;
            }
        });
    }
    
    private isThisViewActive(): boolean {
        const activeView = this.app.workspace.getActiveViewOfType(AgendaView);
        return activeView === this;
    }
}