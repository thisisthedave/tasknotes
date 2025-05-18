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
    private loadingIndicator: HTMLElement | null = null;
    
    // Cached data
    private cachedTasks: TaskInfo[] | null = null;
    private lastTasksRefresh: number = 0;
    private readonly TASKS_CACHE_TTL = 60000; // 1 minute TTL for tasks cache
    
    private cachedNotes: NoteInfo[] | null = null;
    private lastNotesRefresh: number = 0;
    private readonly NOTES_CACHE_TTL = 60000; // 1 minute TTL for notes cache
    
    // Loading states
    private isTasksLoading: boolean = false;
    private isNotesLoading: boolean = false;
    
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
        
        // Listen for date selection changes - force a full refresh when date changes
        const dateListener = this.plugin.emitter.on(EVENT_DATE_SELECTED, () => {
            // Clear both caches when date changes
            this.cachedNotes = null;
            this.lastNotesRefresh = 0;
            this.cachedTasks = null;
            this.lastTasksRefresh = 0;
            
            this.refresh(true); // Force refresh on date change
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
    
    async refresh(forceFullRefresh: boolean = false) {
        // If forcing a full refresh, clear the caches
        if (forceFullRefresh) {
            this.cachedTasks = null;
            this.lastTasksRefresh = 0;
            this.cachedNotes = null;
            this.lastNotesRefresh = 0;
        }
        
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
            // Clear cache when switching to tasks tab to ensure fresh data
            this.cachedTasks = null;
            this.lastTasksRefresh = 0;
            this.refresh(true); // Force refresh when switching tabs
            this.plugin.notifyDataChanged(); // Notify calendar that tab has changed
        });
        
        notesTab.addEventListener('click', () => {
            this.plugin.setActiveTab('notes');
            // Clear cache when switching to notes tab to ensure fresh data
            this.cachedNotes = null;
            this.lastNotesRefresh = 0;
            this.refresh(true); // Force refresh when switching tabs
            this.plugin.notifyDataChanged(); // Notify calendar that tab has changed
        });
        
        timeblockTab.addEventListener('click', () => {
            this.plugin.setActiveTab('timeblock');
            this.refresh(true); // Force refresh when switching tabs
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
            // Force refresh the cache and update UI
            await this.refresh(true); // Pass true to force a full refresh
        });
        
        // Task list container
        const taskList = container.createDiv({ cls: 'task-list' });
        
        // Add loading indicator
        this.loadingIndicator = taskList.createDiv({ cls: 'loading-indicator' });
        this.loadingIndicator.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-text">Loading tasks...</div>
        `;
        this.loadingIndicator.style.display = 'none';
        
        // Show loading state if we're fetching data
        this.isTasksLoading = true;
        this.updateLoadingState();
        
        // Get tasks (this will now show loading indicator while working)
        const tasks = await this.getTasksForView(false);
        
        // Hide loading state when done
        this.isTasksLoading = false;
        this.updateLoadingState();
        
        // Add change event listener to the status filter
        statusSelect.addEventListener('change', async () => {
            const selectedStatus = statusSelect.value;
            const allTasks = await this.getTasksForView(true); // Force refresh to get latest data

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
        // Create a map to track unique tasks by path to prevent duplicates
        const processedTaskPaths = new Set<string>();
        
        // Clear the container
        container.empty();
        
        if (tasks.length === 0) {
            // Placeholder for empty task list
            container.createEl('p', { text: 'No tasks found for the selected filters.' });
        } else {
            // First, deduplicate the tasks array based on path
            const uniqueTasks = tasks.filter(task => {
                if (processedTaskPaths.has(task.path)) {
                    return false; // Skip this task, it's a duplicate
                }
                processedTaskPaths.add(task.path);
                return true;
            });
            
            // Check if we have tasks due on the selected date (non-recurring tasks)
            const tasksForSelectedDate = selectedDateStr 
                ? uniqueTasks.filter(task => task.due === selectedDateStr && !task.recurrence)
                : [];
            
            // Check for recurring tasks due on the selected date
            const recurringTasks = uniqueTasks.filter(task => 
                task.recurrence && isRecurringTaskDueOn(task, this.plugin.selectedDate)
            );
            
            // Calculate other tasks - not due today and not recurring for today
            const otherTasks = uniqueTasks.filter(task => {
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
                this.renderTaskGroup(container, uniqueTasks, selectedDateStr);
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
                    
                    // First update the UI element for immediate feedback
                    toggleButton.disabled = true; // Prevent multiple clicks
                    toggleButton.classList.add('processing');
                    
                    try {
                        // Then update in the backend
                        await this.plugin.toggleRecurringTaskStatus(task, this.plugin.selectedDate);
                        
                        // Force a manual refresh of the task list to get updated status
                        // This ensures we see the updated state
                        const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
                        
                        // Toggle the button state manually since we know what it should be
                        const currentState = toggleButton.classList.contains('mark-incomplete');
                        const newState = !currentState;
                        
                        // Update button text and classes based on the new state
                        toggleButton.textContent = newState ? 'Mark Incomplete' : 'Mark Complete';
                        toggleButton.classList.remove(newState ? 'mark-complete' : 'mark-incomplete');
                        toggleButton.classList.add(newState ? 'mark-incomplete' : 'mark-complete');
                        
                        // Force a refresh of the task list
                        this.cachedTasks = null;
                        this.getTasksForView(true);
                        
                        // Wait a bit before allowing more changes
                        setTimeout(() => {
                            toggleButton.disabled = false;
                            toggleButton.classList.remove('processing');
                        }, 500);
                    } catch(err) {
                        // Re-enable on error
                        toggleButton.disabled = false;
                        toggleButton.classList.remove('processing');
                    }
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
                    
                    // First update the UI element for immediate feedback
                    statusSelect.disabled = true; // Prevent multiple changes
                    
                    try {
                        // Then update in the backend
                        await this.plugin.updateTaskProperty(task, 'status', newStatus);
                        
                        // Wait a bit before allowing more changes
                        setTimeout(() => {
                            statusSelect.disabled = false;
                        }, 500);
                    } catch(err) {
                        // Re-enable on error
                        statusSelect.disabled = false;
                    }
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
                
                // First update the UI element for immediate feedback
                prioritySelect.disabled = true; // Prevent multiple changes
                
                try {
                    // Then update in the backend
                    await this.plugin.updateTaskProperty(task, 'priority', newPriority);
                    
                    // Wait a bit before allowing more changes
                    setTimeout(() => {
                        prioritySelect.disabled = false;
                    }, 500);
                } catch(err) {
                    // Re-enable on error
                    prioritySelect.disabled = false;
                }
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
                
                // First update the UI element for immediate feedback
                dueDateInput.disabled = true; // Prevent multiple changes
                
                try {
                    // Then update in the backend
                    await this.plugin.updateTaskProperty(task, 'due', newDueDate);
                    
                    // Wait a bit before allowing more changes
                    setTimeout(() => {
                        dueDateInput.disabled = false;
                    }, 500);
                } catch(err) {
                    // Re-enable on error
                    dueDateInput.disabled = false;
                }
            });
            
            // Add click handler to open task (only on the task info part)
            taskInfo.addEventListener('click', () => {
                this.openTask(task.path);
            });
        });
    }
    
    /**
     * Helper method to update the loading indicator visibility
     */
    private updateLoadingState(): void {
        if (!this.loadingIndicator) return;
        
        if (this.isTasksLoading || this.isNotesLoading) {
            this.loadingIndicator.style.display = 'flex';
        } else {
            this.loadingIndicator.style.display = 'none';
        }
    }
    
    async createNotesView(container: HTMLElement) {
        // Get the selected date as a string for display
        const dateText = `Notes for ${format(this.plugin.selectedDate, 'MMM d, yyyy')}`;
        
        // Create header with refresh option
        const headerContainer = container.createDiv({ cls: 'notes-header' });
        headerContainer.createEl('h3', { text: dateText, cls: 'notes-title' });
        
        // Add refresh button to header
        const refreshButton = headerContainer.createEl('button', { 
            text: 'Refresh', 
            cls: 'refresh-notes-button',
            attr: {
                'aria-label': 'Refresh notes list',
                'title': 'Refresh notes list'
            }
        });
        
        refreshButton.addEventListener('click', async () => {
            // Force refresh the notes cache
            this.cachedNotes = null;
            this.lastNotesRefresh = 0;
            await this.refresh(true);
        });
        
        // Notes list
        const notesList = container.createDiv({ cls: 'notes-list' });
        
        // Add loading indicator if it doesn't exist yet
        if (!this.loadingIndicator) {
            this.loadingIndicator = notesList.createDiv({ cls: 'loading-indicator' });
            this.loadingIndicator.innerHTML = `
                <div class="loading-spinner"></div>
                <div class="loading-text">Loading notes...</div>
            `;
            this.loadingIndicator.style.display = 'none';
        }
        
        // Show loading state
        this.isNotesLoading = true;
        this.updateLoadingState();
        
        // Get notes for the current view
        const notes = await this.getNotesForView();
        
        // Hide loading state
        this.isNotesLoading = false;
        this.updateLoadingState();
        
        if (notes.length === 0) {
            // Placeholder for empty notes list
            notesList.createEl('p', { text: 'No notes found for the selected date.' });
        } else {
            // Create a div to hold all note items for quicker rendering
            const notesContainer = notesList.createDiv({ cls: 'notes-container' });
            
            // Use document fragment for faster DOM operations
            const fragment = document.createDocumentFragment();
            
            // Create note items
            notes.forEach(note => {
                const noteItem = document.createElement('div');
                noteItem.className = 'note-item';
                
                const titleEl = document.createElement('div');
                titleEl.className = 'note-item-title';
                titleEl.textContent = note.title;
                noteItem.appendChild(titleEl);
                
                // Add created date if available
                if (note.createdDate) {
                    const dateStr = note.createdDate.indexOf('T') > 0 
                        ? format(new Date(note.createdDate), 'MMM d, yyyy h:mm a') 
                        : note.createdDate;
                    const dateEl = document.createElement('div');
                    dateEl.className = 'note-item-date';
                    dateEl.textContent = `Created: ${dateStr}`;
                    noteItem.appendChild(dateEl);
                }
                
                if (note.tags && note.tags.length > 0) {
                    const tagContainer = document.createElement('div');
                    tagContainer.className = 'note-item-tags';
                    
                    note.tags.forEach(tag => {
                        const tagEl = document.createElement('span');
                        tagEl.className = 'note-tag';
                        tagEl.textContent = tag;
                        tagContainer.appendChild(tagEl);
                    });
                    
                    noteItem.appendChild(tagContainer);
                }
                
                // Add click handler to open note
                noteItem.addEventListener('click', () => {
                    this.openNote(note.path);
                });
                
                fragment.appendChild(noteItem);
            });
            
            // Append all notes at once
            notesContainer.appendChild(fragment);
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
        try {
            // Set loading state
            this.isTasksLoading = true;
            this.updateLoadingState();
            
            // Use cached tasks if available and not forcing refresh - important for UI stability
            const now = Date.now();
            if (!forceRefresh && 
                this.cachedTasks && 
                now - this.lastTasksRefresh < this.TASKS_CACHE_TTL) {
                // Wait a little bit before returning to allow temp UI changes to be visible
                await new Promise(resolve => setTimeout(resolve, 100));
                return [...this.cachedTasks]; // Return a copy to prevent modification of cache
            }
            
            // Get fresh tasks if cache expired or forcing refresh
            // Use the FileIndexer to get task information much more efficiently
            const tasks = await this.plugin.fileIndexer.getTaskInfoForDate(this.plugin.selectedDate, forceRefresh);
            
            // Deduplicate by path - this prevents duplicates if they somehow got into the indexer
            const uniqueTasks = this.deduplicateTasksByPath(tasks);
            
            // Sort tasks by due date, then priority
            const sortedResult = uniqueTasks.sort((a, b) => {
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
            
            // Update cache and timestamp - we need a fresh cache 
            this.cachedTasks = [...sortedResult];
            this.lastTasksRefresh = now;
            
            return sortedResult;
        } finally {
            // Clear loading state
            this.isTasksLoading = false;
            this.updateLoadingState();
        }
    }
    
    // Helper method to deduplicate tasks by path
    private deduplicateTasksByPath(tasks: TaskInfo[]): TaskInfo[] {
        const seen = new Map<string, TaskInfo>();
        
        // Keep only the most recent version of each task by path
        for (const task of tasks) {
            seen.set(task.path, task);
        }
        
        return Array.from(seen.values());
    }
    
    async getNotesForView(forceRefresh: boolean = false): Promise<NoteInfo[]> {
        try {
            // Set loading state
            this.isNotesLoading = true;
            this.updateLoadingState();
            
            // We should always force a fresh fetch when the date changes
            // A single TTL is not enough - we need date-based invalidation
            
            // Use the FileIndexer to get notes information for the specific date
            const notes = await this.plugin.fileIndexer.getNotesForDate(this.plugin.selectedDate, forceRefresh);
            
            // Filter out home note and daily notes
            const filteredNotes = notes.filter(note => 
                note.path !== this.plugin.settings.homeNotePath && 
                !note.path.startsWith(this.plugin.settings.dailyNotesFolder)
            );
            
            // Sort notes by title
            const sortedResult = filteredNotes.sort((a, b) => a.title.localeCompare(b.title));
            
            // Update cache and timestamp
            this.cachedNotes = [...sortedResult];
            this.lastNotesRefresh = Date.now();
            
            return sortedResult;
        } finally {
            // Clear loading state
            this.isNotesLoading = false;
            this.updateLoadingState();
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