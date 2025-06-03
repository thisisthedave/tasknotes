import { Notice, TFile, ItemView, WorkspaceLeaf, Menu } from 'obsidian';
import { format, addDays, startOfWeek, endOfWeek, isToday, isSameDay } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    AGENDA_VIEW_TYPE,
    EVENT_DATA_CHANGED,
    EVENT_DATE_SELECTED,
    TaskInfo, 
    NoteInfo,
} from '../types';
import { isRecurringTaskDueOn, calculateTotalTimeSpent } from '../utils/helpers';

export class AgendaView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // View settings
    private daysToShow: number = 7;
    private showCompletedTasks: boolean = false;
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
        
        // Navigation controls
        const navContainer = controlsContainer.createDiv({ cls: 'agenda-nav' });
        
        // Time navigation buttons
        const timeNavContainer = navContainer.createDiv({ cls: 'time-navigation' });
        
        const prevButton = timeNavContainer.createEl('button', {
            cls: 'nav-arrow-button',
            text: '‹',
            attr: {
                'aria-label': 'Previous period',
                'title': 'Previous period (Left arrow or H key)'
            }
        });
        
        prevButton.addEventListener('click', () => {
            this.navigateToPreviousPeriod();
        });
        
        const nextButton = timeNavContainer.createEl('button', {
            cls: 'nav-arrow-button',
            text: '›',
            attr: {
                'aria-label': 'Next period',
                'title': 'Next period (Right arrow or L key)'
            }
        });
        
        nextButton.addEventListener('click', () => {
            this.navigateToNextPeriod();
        });
        
        // Period selector
        const periodContainer = navContainer.createDiv({ cls: 'period-selector' });
        const periodLabel = periodContainer.createEl('span', { text: 'Show: ', cls: 'period-label' });
        
        const periodSelect = periodContainer.createEl('select', { cls: 'period-select' });
        const periods = [
            { value: '7', text: 'Next 7 days' },
            { value: '14', text: 'Next 14 days' },
            { value: '30', text: 'Next 30 days' },
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
        });
        
        // Show completed toggle
        const toggleContainer = navContainer.createDiv({ cls: 'toggle-container' });
        const toggleLabel = toggleContainer.createEl('label', { cls: 'toggle-label' });
        const toggleCheckbox = toggleLabel.createEl('input', { 
            type: 'checkbox',
            cls: 'toggle-checkbox'
        });
        toggleCheckbox.checked = this.showCompletedTasks;
        toggleLabel.appendChild(document.createTextNode(' Show completed'));
        
        toggleCheckbox.addEventListener('change', () => {
            this.showCompletedTasks = toggleCheckbox.checked;
            this.refresh();
        });
        
        // Today button
        const todayButton = navContainer.createEl('button', {
            text: 'Today',
            cls: 'today-button tasknotes-button tasknotes-button-primary'
        });
        
        todayButton.addEventListener('click', () => {
            this.startDate = new Date();
            this.refresh();
        });
        
        // Current period display
        const currentPeriod = controlsContainer.createDiv({ cls: 'current-period-display' });
        currentPeriod.textContent = this.getCurrentPeriodText();
    }
    
    private async renderAgendaContent(container: HTMLElement) {
        const contentContainer = container.createDiv({ cls: 'agenda-content' });
        
        // Get date range
        const dates = this.getAgendaDates();
        
        // Fetch all data
        const dataPromises = dates.map(async date => {
            const [tasks, notes] = await Promise.all([
                this.plugin.fileIndexer.getTaskInfoForDate(date),
                this.plugin.fileIndexer.getNotesForDate(date)
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
                // Skip completed tasks if not showing them
                if (!this.showCompletedTasks && task.status === 'done') {
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
            emptyMessage.createEl('p', { text: 'No items scheduled for this period.' });
            
            const tipMessage = emptyMessage.createEl('p', { cls: 'empty-tip' });
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
                if (!this.showCompletedTasks && task.status === 'done') {
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
            
            // Then by priority
            const priorityOrder = { high: 0, normal: 1, low: 2 };
            const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1;
            const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1;
            
            return aPriority - bPriority;
        });
        
        sortedTasks.forEach(task => {
            this.renderTaskItem(container, task);
        });
    }
    
    private renderTaskItem(container: HTMLElement, task: TaskInfo, date?: Date) {
        const item = container.createDiv({ cls: `agenda-item task-item ${task.status}` });
        
        // Task checkbox
        const checkbox = item.createEl('input', { 
            type: 'checkbox',
            cls: 'task-checkbox'
        });
        checkbox.checked = task.status === 'done';
        
        checkbox.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.toggleTaskStatus(task);
        });
        
        // Task content
        const content = item.createDiv({ cls: 'item-content' });
        
        // Title
        const titleEl = content.createDiv({ cls: 'item-title', text: task.title });
        if (task.status === 'done') {
            titleEl.classList.add('completed');
        }
        
        // Metadata
        const meta = content.createDiv({ cls: 'item-meta' });
        
        // Priority badge
        if (task.priority && task.priority !== 'normal') {
            meta.createSpan({ 
                cls: `priority-badge priority-${task.priority}`, 
                text: task.priority 
            });
        }
        
        // Due date (only show if not grouping by date)
        if (!this.groupByDate && task.due) {
            const dueSpan = meta.createSpan({ cls: 'due-date' });
            const dueDate = new Date(task.due);
            
            if (isToday(dueDate)) {
                dueSpan.classList.add('due-today');
                dueSpan.textContent = 'Today';
            } else {
                dueSpan.textContent = format(dueDate, 'MMM d');
            }
        }
        
        // Contexts
        if (task.contexts && task.contexts.length > 0) {
            task.contexts.forEach(context => {
                meta.createSpan({ cls: 'context-tag', text: `@${context}` });
            });
        }
        
        // Time tracking
        const timeSpent = calculateTotalTimeSpent(task.timeEntries || []);
        if (task.timeEstimate || timeSpent > 0) {
            const timeContainer = meta.createSpan({ cls: 'time-info' });
            
            if (timeSpent > 0) {
                const progress = task.timeEstimate ? 
                    Math.round((timeSpent / task.timeEstimate) * 100) : 0;
                
                timeContainer.createSpan({ 
                    cls: 'time-spent', 
                    text: this.plugin.formatTime(timeSpent)
                });
                
                if (task.timeEstimate) {
                    timeContainer.createSpan({ 
                        cls: 'time-separator', 
                        text: ' / ' 
                    });
                    timeContainer.createSpan({ 
                        cls: 'time-estimate', 
                        text: this.plugin.formatTime(task.timeEstimate)
                    });
                    
                    if (progress > 100) {
                        timeContainer.classList.add('over-estimate');
                    }
                }
            } else if (task.timeEstimate) {
                timeContainer.createSpan({ 
                    cls: 'time-estimate', 
                    text: `Est: ${this.plugin.formatTime(task.timeEstimate)}`
                });
            }
        }
        
        // Add click handler
        item.addEventListener('click', () => {
            this.openFile(task.path);
        });
        
        // Add context menu
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showTaskContextMenu(e, task);
        });
        
        // Add hover preview
        this.addHoverPreview(item, task.path);
    }
    
    private renderNotes(container: HTMLElement, notes: NoteInfo[]) {
        notes.forEach(note => {
            this.renderNoteItem(container, note);
        });
    }
    
    private renderNoteItem(container: HTMLElement, note: NoteInfo, date?: Date) {
        const item = container.createDiv({ cls: 'agenda-item note-item' });
        
        // Note icon
        item.createDiv({ cls: 'note-icon', text: '📝' });
        
        // Note content
        const content = item.createDiv({ cls: 'item-content' });
        
        // Title
        content.createDiv({ cls: 'item-title', text: note.title });
        
        // Metadata
        const meta = content.createDiv({ cls: 'item-meta' });
        
        meta.createSpan({ cls: 'item-type', text: 'Note' });
        
        // Tags
        if (note.tags && note.tags.length > 0) {
            const maxTags = 3;
            note.tags.slice(0, maxTags).forEach(tag => {
                meta.createSpan({ cls: 'note-tag', text: `#${tag}` });
            });
            
            if (note.tags.length > maxTags) {
                meta.createSpan({ 
                    cls: 'more-tags', 
                    text: `+${note.tags.length - maxTags}` 
                });
            }
        }
        
        // Date (only show if not grouping by date)
        if (!this.groupByDate && date) {
            meta.createSpan({ 
                cls: 'note-date', 
                text: format(date, 'MMM d') 
            });
        }
        
        // Add click handler
        item.addEventListener('click', () => {
            this.openFile(note.path);
        });
        
        // Add hover preview
        this.addHoverPreview(item, note.path);
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
    
    private async toggleTaskStatus(task: TaskInfo) {
        const file = this.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) return;
        
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        
        // Find the frontmatter
        let inFrontmatter = false;
        let frontmatterStart = -1;
        let frontmatterEnd = -1;
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === '---') {
                if (!inFrontmatter) {
                    inFrontmatter = true;
                    frontmatterStart = i;
                } else {
                    frontmatterEnd = i;
                    break;
                }
            }
        }
        
        if (frontmatterStart === -1 || frontmatterEnd === -1) return;
        
        // Update status in frontmatter
        for (let i = frontmatterStart + 1; i < frontmatterEnd; i++) {
            if (lines[i].startsWith('status:')) {
                const newStatus = task.status === 'done' ? 'open' : 'done';
                lines[i] = `status: ${newStatus}`;
                
                // Update completed date
                if (newStatus === 'done') {
                    // Add completed date if not present
                    let hasCompletedDate = false;
                    for (let j = frontmatterStart + 1; j < frontmatterEnd; j++) {
                        if (lines[j].startsWith('completed:')) {
                            hasCompletedDate = true;
                            lines[j] = `completed: ${format(new Date(), 'yyyy-MM-dd')}`;
                            break;
                        }
                    }
                    if (!hasCompletedDate) {
                        lines.splice(frontmatterEnd, 0, `completed: ${format(new Date(), 'yyyy-MM-dd')}`);
                    }
                } else {
                    // Remove completed date
                    for (let j = frontmatterStart + 1; j < frontmatterEnd; j++) {
                        if (lines[j].startsWith('completed:')) {
                            lines.splice(j, 1);
                            break;
                        }
                    }
                }
                
                break;
            }
        }
        
        // Save the file
        await this.app.vault.modify(file, lines.join('\n'));
        
        // Notify about the change
        this.plugin.notifyDataChanged(task.path);
        
        new Notice(`Task ${task.status === 'done' ? 'reopened' : 'completed'}`);
    }
    
    private showTaskContextMenu(event: MouseEvent, task: TaskInfo) {
        const menu = new Menu();
        
        menu.addItem((item) => {
            item.setTitle('Open task')
                .setIcon('file-text')
                .onClick(() => {
                    this.openFile(task.path);
                });
        });
        
        menu.addItem((item) => {
            item.setTitle(task.status === 'done' ? 'Mark as incomplete' : 'Mark as complete')
                .setIcon(task.status === 'done' ? 'undo' : 'check')
                .onClick(async () => {
                    await this.toggleTaskStatus(task);
                });
        });
        
        menu.addSeparator();
        
        menu.addItem((item) => {
            item.setTitle('Copy task title')
                .setIcon('copy')
                .onClick(() => {
                    navigator.clipboard.writeText(task.title);
                    new Notice('Task title copied');
                });
        });
        
        menu.showAtMouseEvent(event);
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
            await this.renderView(container);
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
                    this.refresh();
                    break;
                    
                // c - toggle completed tasks
                case 'c':
                case 'C':
                    e.preventDefault();
                    this.showCompletedTasks = !this.showCompletedTasks;
                    const checkbox = this.contentEl.querySelector('.toggle-checkbox') as HTMLInputElement;
                    if (checkbox) checkbox.checked = this.showCompletedTasks;
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