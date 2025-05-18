import { Notice, TFile, View, WorkspaceLeaf, normalizePath } from 'obsidian';
import { format } from 'date-fns';
import ChronoSyncPlugin from '../main';
import { 
    DETAIL_VIEW_TYPE, 
    DetailTab,
    TaskInfo, 
    NoteInfo, 
    EVENT_DATE_SELECTED,
    EVENT_TAB_CHANGED,
    EVENT_DATA_CHANGED
} from '../types';
import { 
    extractNoteInfo, 
    extractTaskInfo, 
    extractTimeblockContent, 
    isTaskOverdue, 
    isSameDay,
    parseTime,
    isRecurringTaskDueOn,
    getEffectiveTaskStatus
} from '../utils/helpers';

export class DetailView extends View {
    plugin: ChronoSyncPlugin;
    
    // UI elements
    private taskListContainer: HTMLElement | null = null;
    
    // Cached data
    private cachedTasks: TaskInfo[] | null = null;
    private lastTasksRefresh: number = 0;
    private readonly TASKS_CACHE_TTL = 60000; // 1 minute TTL for tasks cache
    
    private cachedNotes: NoteInfo[] | null = null;
    private lastNotesRefresh: number = 0;
    private readonly NOTES_CACHE_TTL = 60000; // 1 minute TTL for notes cache
    
    // Event listeners
    private listeners: (() => void)[] = [];
    
    constructor(leaf: WorkspaceLeaf, plugin: ChronoSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Register event listeners
        this.registerEvents();
    }
    
    getViewType(): string {
        return DETAIL_VIEW_TYPE;
    }
    
    getDisplayText(): string {
        return 'ChronoSync Details';
    }
    
    getIcon(): string {
        return 'list-checks';
    }
    
    registerEvents(): void {
        // Clean up any existing listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        this.listeners = [];
        
        // Listen for date selection changes
        const dateListener = this.plugin.emitter.on(EVENT_DATE_SELECTED, () => {
            this.refresh();
        });
        this.listeners.push(dateListener);
        
        // Listen for data changes
        const dataListener = this.plugin.emitter.on(EVENT_DATA_CHANGED, () => {
            this.refresh();
        });
        this.listeners.push(dataListener);
    }
    
    async onOpen() {
        await this.refresh();
    }
    
    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        this.containerEl.empty();
    }
    
    async refresh() {
        // Clear cached data
        this.cachedTasks = null;
        this.cachedNotes = null;
        
        // Clear and prepare the content element
        this.containerEl.empty();
        await this.render();
    }
    
    async render() {
        const container = this.containerEl.createDiv({ cls: 'chronosync-container detail-view-container' });
        
        // Create header with current date information
        this.createHeader(container);
        
        // Create tabs
        this.createTabs(container);
        
        // Create content area based on active tab
        const contentArea = container.createDiv({ cls: 'chronosync-content-area' });
        
        // Render the appropriate content based on active tab
        switch (this.plugin.activeTab) {
            case 'tasks':
                await this.createTasksView(contentArea);
                break;
            case 'notes':
                await this.createNotesView(contentArea);
                break;
            case 'timeblock':
                await this.createTimeblockView(contentArea);
                break;
        }
    }
    
    createHeader(container: HTMLElement) {
        const headerContainer = container.createDiv({ cls: 'detail-view-header' });
        
        // Display selected date
        const formattedDate = format(this.plugin.selectedDate, 'EEEE, MMMM d, yyyy');
        headerContainer.createEl('h2', { text: formattedDate });
        
        // Add actions based on the active tab
        const actionsContainer = headerContainer.createDiv({ cls: 'detail-view-actions' });
        
        if (this.plugin.activeTab === 'tasks') {
            const addTaskButton = actionsContainer.createEl('button', { 
                text: 'New Task', 
                cls: 'add-task-button' 
            });
            
            addTaskButton.addEventListener('click', () => {
                this.plugin.openTaskCreationModal();
            });
        } else if (this.plugin.activeTab === 'notes') {
            const createNoteButton = actionsContainer.createEl('button', { 
                text: 'New Note', 
                cls: 'new-note-button' 
            });
            
            createNoteButton.addEventListener('click', () => {
                // TODO: Add note creation functionality
                new Notice('Note creation not yet implemented');
            });
        } else if (this.plugin.activeTab === 'timeblock') {
            const dailyNoteButton = actionsContainer.createEl('button', { 
                text: 'Open Daily Note', 
                cls: 'daily-note-button' 
            });
            
            dailyNoteButton.addEventListener('click', async () => {
                await this.plugin.navigateToDailyNote(this.plugin.selectedDate);
            });
        }
    }
    
    createTabs(container: HTMLElement) {
        const tabsContainer = container.createDiv({ cls: 'chronosync-tabs' });
        
        const tasksTab = tabsContainer.createEl('button', { 
            text: 'Tasks', 
            cls: `chronosync-tab ${this.plugin.activeTab === 'tasks' ? 'active' : ''}`,
            attr: { 'data-tab': 'tasks' }
        });
        
        const notesTab = tabsContainer.createEl('button', { 
            text: 'Notes', 
            cls: `chronosync-tab ${this.plugin.activeTab === 'notes' ? 'active' : ''}`,
            attr: { 'data-tab': 'notes' }
        });
        
        const timeblockTab = tabsContainer.createEl('button', { 
            text: 'Timeblock', 
            cls: `chronosync-tab ${this.plugin.activeTab === 'timeblock' ? 'active' : ''}`,
            attr: { 'data-tab': 'timeblock' }
        });
        
        // Set up tab switching
        tasksTab.addEventListener('click', () => {
            this.plugin.setActiveTab('tasks');
            this.refresh();
            this.plugin.notifyDataChanged(); // Notify calendar that tab has changed
        });
        
        notesTab.addEventListener('click', () => {
            this.plugin.setActiveTab('notes');
            this.refresh();
            this.plugin.notifyDataChanged(); // Notify calendar that tab has changed
        });
        
        timeblockTab.addEventListener('click', () => {
            this.plugin.setActiveTab('timeblock');
            this.refresh();
            this.plugin.notifyDataChanged(); // Notify calendar that tab has changed
        });
    }
    
    async createTasksView(container: HTMLElement) {
        container.createEl('h3', { text: 'Tasks' });
        
        // Create filters
        const filtersContainer = container.createDiv({ cls: 'task-filters' });
        
        // Left side - Status filter
        const leftGroup = filtersContainer.createDiv({ cls: 'filters-left-group' });
        
        const statusFilter = leftGroup.createDiv({ cls: 'filter-group' });
        statusFilter.createEl('span', { text: 'Status: ' });
        const statusSelect = statusFilter.createEl('select', { cls: 'status-select' });
        
        const statuses = ['All', 'Open', 'In Progress', 'Done', 'Archived'];
        statuses.forEach(status => {
            const option = statusSelect.createEl('option', { value: status.toLowerCase(), text: status });
        });
        
        // Right side - Refresh button
        const rightGroup = filtersContainer.createDiv({ cls: 'filters-right-group' });
        
        const refreshButton = rightGroup.createEl('button', { 
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
            await this.refresh();
        });
        
        // Task list
        const taskList = container.createDiv({ cls: 'task-list' });
        
        // Get tasks
        const tasks = await this.getTasksForView(false);
        
        // Add change event listener to the status filter
        statusSelect.addEventListener('change', async () => {
            const selectedStatus = statusSelect.value;
            const allTasks = await this.getTasksForView(false); // Use cache

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
            const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
            this.prioritizeTasksByDate(filteredTasks, selectedDateStr);
            
            // Refresh the task list
            this.renderTaskItems(taskList, filteredTasks, selectedDateStr);
        });
        
        // Get the selected date
        const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
        
        // Apply initial filtering based on the default "all" status (exclude archived tasks)
        const nonArchivedTasks = tasks.filter(task => !task.archived);
        
        // Sort tasks to prioritize those due on the selected date
        this.prioritizeTasksByDate(nonArchivedTasks, selectedDateStr);
        
        // Initial task rendering with filtered tasks (non-archived)
        this.renderTaskItems(taskList, nonArchivedTasks, selectedDateStr);
        
        // Store reference to the task list container for future updates
        this.taskListContainer = taskList;
    }
    
    // Helper method to render task items
    renderTaskItems(container: HTMLElement, tasks: TaskInfo[], selectedDateStr: string | null = null) {
        // Clear the container
        container.empty();
        
        if (tasks.length === 0) {
            // Placeholder for empty task list
            container.createEl('p', { text: 'No tasks found for the selected filters.' });
        } else {
            // Check if we have tasks due on the selected date (non-recurring tasks)
            const tasksForSelectedDate = selectedDateStr 
                ? tasks.filter(task => task.due === selectedDateStr && !task.recurrence)
                : [];
            
            // Check for recurring tasks due on the selected date
            const recurringTasks = tasks.filter(task => 
                task.recurrence && isRecurringTaskDueOn(task, this.plugin.selectedDate)
            );
            
            // Calculate other tasks - not due today and not recurring for today
            const otherTasks = tasks.filter(task => {
                const isNotDueToday = !selectedDateStr || task.due !== selectedDateStr;
                const isNotRecurringToday = !task.recurrence || 
                    (task.recurrence && !isRecurringTaskDueOn(task, this.plugin.selectedDate));
                return isNotDueToday && isNotRecurringToday;
            });
            
            let hasRenderedAnySection = false;
                
            // If we have tasks due on the selected date, create a section for them
            if (tasksForSelectedDate.length > 0 && selectedDateStr) {
                hasRenderedAnySection = true;
                const selectedDateSection = container.createDiv({ cls: 'task-section selected-date-tasks' });
                selectedDateSection.createEl('h4', { 
                    text: `Tasks due on ${format(new Date(selectedDateStr), 'MMM d, yyyy')}`,
                    cls: 'task-section-header'
                });
                
                const selectedDateTaskList = selectedDateSection.createDiv({ cls: 'task-list' });
                
                // Create task items for selected date - pass false to not filter recurring tasks
                this.renderTaskGroup(selectedDateTaskList, tasksForSelectedDate, selectedDateStr, false);
            }
            
            // If we have recurring tasks, add a section for them
            if (recurringTasks.length > 0) {
                hasRenderedAnySection = true;
                const recurringTasksSection = container.createDiv({ cls: 'task-section recurring-tasks' });
                recurringTasksSection.createEl('h4', { 
                    text: `Recurring tasks for ${format(this.plugin.selectedDate, 'MMM d, yyyy')}`,
                    cls: 'task-section-header recurring-section-header'
                });
                
                const recurringTasksList = recurringTasksSection.createDiv({ cls: 'task-list' });
                
                // Create task items for recurring tasks - pass false to not filter recurring tasks again
                this.renderTaskGroup(recurringTasksList, recurringTasks, selectedDateStr, false);
            }
            
            // If there are other tasks, add a separate section
            if (otherTasks.length > 0) {
                hasRenderedAnySection = true;
                const otherTasksSection = container.createDiv({ cls: 'task-section other-tasks' });
                otherTasksSection.createEl('h4', { 
                    text: 'Other tasks',
                    cls: 'task-section-header'
                });
                
                const otherTasksList = otherTasksSection.createDiv({ cls: 'task-list' });
                
                // Create task items for other tasks
                this.renderTaskGroup(otherTasksList, otherTasks, selectedDateStr, false);
            }
            
            // If no sections were rendered, show all tasks
            if (!hasRenderedAnySection) {
                this.renderTaskGroup(container, tasks, selectedDateStr);
            }
        }
    }
    
    // Helper to render a group of tasks
    private renderTaskGroup(container: HTMLElement, tasks: TaskInfo[], selectedDateStr: string | null = null, filterRecurring: boolean = true) {
        tasks.forEach(task => {
            // Determine if this task is due on the selected date
            let isDueOnSelectedDate = selectedDateStr && task.due === selectedDateStr;
            
            // For recurring tasks, check if it's due on the selected date
            if (task.recurrence) {
                isDueOnSelectedDate = isRecurringTaskDueOn(task, this.plugin.selectedDate);
            }
            
            // If filtering recurring tasks is enabled and this task is not due on the selected date, skip it
            if (filterRecurring && task.recurrence && !isDueOnSelectedDate) {
                return;
            }
            
            // Get effective status for recurring tasks
            const effectiveStatus = task.recurrence 
                ? getEffectiveTaskStatus(task, this.plugin.selectedDate)
                : task.status;
            
            const taskItem = container.createDiv({ 
                cls: `task-item ${isDueOnSelectedDate ? 'task-due-today' : ''} ${task.archived ? 'task-archived' : ''} ${task.recurrence ? 'task-recurring' : ''}`
            });
            
            // Create header row (title and metadata)
            const taskHeader = taskItem.createDiv({ cls: 'task-header' });
            
            // Create info section (left side)
            const taskInfo = taskHeader.createDiv({ cls: 'task-info' });
            
            // Task title with priority
            const titleEl = taskInfo.createDiv({ 
                cls: `task-item-title task-priority-${task.priority}`, 
                text: task.title
            });
            
            // Add recurring indicator if needed
            if (task.recurrence) {
                const recurIcon = document.createElement('span');
                recurIcon.className = 'task-recurring-icon';
                recurIcon.textContent = '⟳ ';
                recurIcon.title = `${task.recurrence.frequency} recurring task`;
                titleEl.prepend(recurIcon);
            }
            
            // Due date
            if (task.due) {
                taskInfo.createDiv({ 
                    cls: `task-item-due ${isTaskOverdue(task) ? 'task-overdue' : ''} ${isDueOnSelectedDate ? 'due-today' : ''}`,
                    text: `Due: ${task.due}`
                });
            }
            
            // Create metadata section (right side)
            const taskMeta = taskHeader.createDiv({ cls: 'task-item-metadata' });
            
            // Status badge - use effective status for recurring tasks
            taskMeta.createDiv({
                cls: `task-status task-status-${effectiveStatus.replace(/\s+/g, '-').toLowerCase()} ${task.recurrence ? 'recurring-status' : ''}`,
                text: effectiveStatus
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
                await this.plugin.toggleTaskArchive(task);
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
            
            // Status control - different behavior for recurring vs. regular tasks
            if (task.recurrence) {
                // Toggle button for recurring tasks
                const toggleButton = taskControls.createEl('button', { 
                    cls: `task-toggle-button ${effectiveStatus === 'done' ? 'mark-incomplete' : 'mark-complete'}`,
                    text: effectiveStatus === 'done' ? 'Mark Incomplete' : 'Mark Complete'
                });
                
                // Add event listener for toggle
                toggleButton.addEventListener('click', async (e) => {
                    e.stopPropagation(); // Prevent task opening
                    await this.plugin.toggleRecurringTaskStatus(task, this.plugin.selectedDate);
                });
            } else {
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
                    await this.plugin.updateTaskProperty(task, 'status', newStatus);
                });
            }
            
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
                await this.plugin.updateTaskProperty(task, 'priority', newPriority);
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
                await this.plugin.updateTaskProperty(task, 'due', newDueDate);
            });
            
            // Add click handler to open task (only on the task info part)
            taskInfo.addEventListener('click', () => {
                this.openTask(task.path);
            });
        });
    }
    
    async createNotesView(container: HTMLElement) {
        // Get the selected date as a string for display
        const dateText = `Notes for ${format(this.plugin.selectedDate, 'MMM d, yyyy')}`;
        
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
        const date = this.plugin.selectedDate;
        const dateStr = format(date, 'yyyy-MM-dd');
        const dailyNotePath = normalizePath(`${this.plugin.settings.dailyNotesFolder}/${dateStr}.md`);
        
        // Check if the daily note exists
        const fileExists = await this.app.vault.adapter.exists(dailyNotePath);
        if (!fileExists) {
            container.createEl('p', { text: `No daily note exists for ${format(date, 'MMMM d, yyyy')}. Click a date to create one.` });
            
            const createButton = container.createEl('button', { text: 'Create daily note', cls: 'create-note-button' });
            createButton.addEventListener('click', () => {
                this.plugin.navigateToDailyNote(date);
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
                    this.refresh();
                });
            }
        }
    }
    
    // Method to prioritize tasks by date
    private prioritizeTasksByDate(tasks: TaskInfo[], selectedDateStr: string | null): void {
        if (!selectedDateStr) return;
        
        // Sort with tasks due on selected date first, then by normal sort criteria
        tasks.sort((a, b) => {
            // First, put completed tasks at the bottom
            const aIsDone = a.status.toLowerCase() === 'done';
            const bIsDone = b.status.toLowerCase() === 'done';
            
            if (aIsDone && !bIsDone) return 1;
            if (!aIsDone && bIsDone) return -1;
            
            // For non-completed tasks, prioritize those due on the selected date
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
    
    async getNotesForView(forceRefresh: boolean = false): Promise<NoteInfo[]> {
        // Use cached notes if available and not forcing refresh
        const now = Date.now();
        if (!forceRefresh &&
            this.cachedNotes && 
            now - this.lastNotesRefresh < this.NOTES_CACHE_TTL) {
            
            // Filter cached notes based on the selected date
            const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
            
            return this.cachedNotes.filter(note => 
                note.createdDate && note.createdDate.startsWith(selectedDateStr)
            );
        }
        
        const result: NoteInfo[] = [];
        const taskTag = this.plugin.settings.taskTag;
        
        // Get all markdown files in the vault
        const files = this.app.vault.getFiles().filter(file => 
            file.extension === 'md'
        );
        
        // Get excluded folders as an array
        const excludedFolders = this.plugin.settings.excludedFolders
            ? this.plugin.settings.excludedFolders.split(',').map(folder => folder.trim())
            : [];
            
        // Extract note information from each file
        for (const file of files) {
            try {
                // Check if the file is in an excluded folder
                const isExcluded = excludedFolders.some(folder => 
                    folder && file.path.startsWith(folder)
                );
                
                // Skip excluded folders
                if (isExcluded) continue;
                
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
        
        // Filter by selected date
        const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
        
        return sortedResult.filter(note => 
            note.createdDate && note.createdDate.startsWith(selectedDateStr)
        );
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
            
            // Notify that data has changed
            this.plugin.notifyDataChanged();
        } catch (e) {
            console.error('Error updating timeblock in note:', e);
            new Notice('Error updating timeblock');
        }
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
}