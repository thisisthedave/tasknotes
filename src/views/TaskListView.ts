import { Notice, TFile, ItemView, WorkspaceLeaf } from 'obsidian';
import { format } from 'date-fns';
import ChronoSyncPlugin from '../main';
import { 
    TASK_LIST_VIEW_TYPE, 
    TaskInfo, 
    EVENT_DATE_SELECTED,
    EVENT_DATA_CHANGED
} from '../types';
import { 
    isTaskOverdue,
    isRecurringTaskDueOn,
    getEffectiveTaskStatus 
} from '../utils/helpers';

export class TaskListView extends ItemView {
    plugin: ChronoSyncPlugin;
    
    // UI elements
    private taskListContainer: HTMLElement | null = null;
    private loadingIndicator: HTMLElement | null = null;
    
    // Cached data
    private cachedTasks: TaskInfo[] | null = null;
    private lastTasksRefresh: number = 0;
    private readonly TASKS_CACHE_TTL = 60000; // 1 minute TTL for tasks cache
    
    // Loading states
    private isTasksLoading: boolean = false;
    
    // Filter states
    private selectedContexts: Set<string> = new Set();
    private availableContexts: string[] = [];
    
    // Task item tracking for dynamic updates
    private taskElements: Map<string, HTMLElement> = new Map();
    
    // Event listeners
    private listeners: (() => void)[] = [];
    
    constructor(leaf: WorkspaceLeaf, plugin: ChronoSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Register event listeners
        this.registerEvents();
    }
    
    getViewType(): string {
        return TASK_LIST_VIEW_TYPE;
    }
    
    getDisplayText(): string {
        return 'Tasks';
    }
    
    getIcon(): string {
        return 'check-square';
    }
    
    registerEvents(): void {
        // Clean up any existing listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        this.listeners = [];
        
        // Listen for date selection changes - force a full refresh when date changes
        const dateListener = this.plugin.emitter.on(EVENT_DATE_SELECTED, () => {
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
        this.contentEl.empty();
    }
    
    async refresh(forceFullRefresh: boolean = false) {
        // If forcing a full refresh, clear the caches
        if (forceFullRefresh) {
            this.cachedTasks = null;
            this.lastTasksRefresh = 0;
        }
        
        // Clear and prepare the content element
        this.contentEl.empty();
        await this.render();
    }
    
    async render() {
        const container = this.contentEl.createDiv({ cls: 'chronosync-container task-list-view-container' });
        
        // Create header with current date information
        this.createHeader(container);
        
        // Create task list content
        await this.createTasksContent(container);
    }
    
    createHeader(container: HTMLElement) {
        const headerContainer = container.createDiv({ cls: 'detail-view-header' });
        
        // Display selected date
        const formattedDate = format(this.plugin.selectedDate, 'EEEE, MMMM d, yyyy');
        headerContainer.createEl('h2', { text: formattedDate });
        
        // Add actions
        const actionsContainer = headerContainer.createDiv({ cls: 'detail-view-actions' });
        
        const addTaskButton = actionsContainer.createEl('button', { 
            text: 'New Task', 
            cls: 'add-task-button chronosync-button chronosync-button-primary',
            attr: {
                'aria-label': 'Create new task',
                'title': 'Create new task'
            }
        });
        
        addTaskButton.addEventListener('click', () => {
            this.plugin.openTaskCreationModal();
        });
    }
    
    async createTasksContent(container: HTMLElement) {
        container.createEl('h3', { text: 'Tasks' });
        
        // Create filters
        const filtersContainer = container.createDiv({ cls: 'task-filters' });
        
        // Left side - Status and Context filters
        const leftGroup = filtersContainer.createDiv({ cls: 'filters-left-group' });
        
        const statusFilter = leftGroup.createDiv({ cls: 'filter-group' });
        statusFilter.createEl('span', { text: 'Status: ' });
        const statusSelect = statusFilter.createEl('select', { cls: 'status-select' });
        
        const statuses = ['All', 'Open', 'In Progress', 'Done', 'Archived'];
        statuses.forEach(status => {
            const option = statusSelect.createEl('option', { value: status.toLowerCase(), text: status });
        });
        
        // Context filter
        const contextFilter = leftGroup.createDiv({ cls: 'filter-group context-filter' });
        contextFilter.createEl('span', { text: 'Contexts: ' });
        
        // Context multi-select dropdown
        const contextDropdown = contextFilter.createDiv({ cls: 'context-dropdown' });
        const contextButton = contextDropdown.createEl('button', { 
            text: 'Select contexts', 
            cls: 'context-dropdown-button'
        });
        const contextMenu = contextDropdown.createDiv({ cls: 'context-dropdown-menu' });
        contextMenu.style.display = 'none';
        
        // Get available contexts from tasks
        await this.updateAvailableContexts();
        this.renderContextMenu(contextMenu, statusSelect);
        
        // Toggle dropdown menu
        contextButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = contextMenu.style.display !== 'none';
            contextMenu.style.display = isVisible ? 'none' : 'block';
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!contextDropdown.contains(e.target as Node)) {
                contextMenu.style.display = 'none';
            }
        });
        
        // Right side - Refresh button
        const rightGroup = filtersContainer.createDiv({ cls: 'filters-right-group' });
        
        const refreshButton = rightGroup.createEl('button', { 
            text: 'Refresh', 
            cls: 'refresh-tasks-button chronosync-button chronosync-button-secondary',
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
            await this.applyFilters(taskList, statusSelect);
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
        
        // Clear task elements map for new render
        this.taskElements.clear();
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
                
                // Create a container for the task cards layout
                const selectedDateTasksContainer = selectedDateSection.createDiv({ cls: 'tasks-container task-cards' });
                
                // Create task items for selected date - pass false to not filter recurring tasks
                this.renderTaskGroup(selectedDateTasksContainer, tasksForSelectedDate, selectedDateStr, false);
            }
            
            // If we have recurring tasks, add a section for them
            if (recurringTasks.length > 0) {
                hasRenderedAnySection = true;
                const recurringTasksSection = container.createDiv({ cls: 'task-section recurring-tasks' });
                recurringTasksSection.createEl('h4', { 
                    text: `Recurring tasks for ${format(this.plugin.selectedDate, 'MMM d, yyyy')}`,
                    cls: 'task-section-header recurring-section-header'
                });
                
                // Create a container for the task cards layout
                const recurringTasksContainer = recurringTasksSection.createDiv({ cls: 'tasks-container task-cards' });
                
                // Create task items for recurring tasks - pass false to not filter recurring tasks again
                this.renderTaskGroup(recurringTasksContainer, recurringTasks, selectedDateStr, false);
            }
            
            // If there are other tasks, add a separate section
            if (otherTasks.length > 0) {
                hasRenderedAnySection = true;
                const otherTasksSection = container.createDiv({ cls: 'task-section other-tasks' });
                otherTasksSection.createEl('h4', { 
                    text: 'Other tasks',
                    cls: 'task-section-header'
                });
                
                // Create a container for the task cards layout
                const otherTasksContainer = otherTasksSection.createDiv({ cls: 'tasks-container task-cards' });
                
                // Create task items for other tasks
                this.renderTaskGroup(otherTasksContainer, otherTasks, selectedDateStr, false);
            }
            
            // If no sections were rendered, show all tasks
            if (!hasRenderedAnySection) {
                // Create a container for the task cards layout
                const tasksContainer = container.createDiv({ cls: 'tasks-container task-cards' });
                this.renderTaskGroup(tasksContainer, uniqueTasks, selectedDateStr);
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
                cls: `task-item ${isDueOnSelectedDate ? 'task-due-today' : ''} ${task.archived ? 'task-archived' : ''} ${task.recurrence ? 'task-recurring' : ''} chronosync-card`
            });
            
            // Store reference to this task element for future updates
            taskItem.dataset.taskPath = task.path;
            this.taskElements.set(task.path, taskItem);
            
            // Create header row (title and metadata)
            const taskHeader = taskItem.createDiv({ cls: 'task-header chronosync-card-header' });
            
            // Create info section (left side)
            const taskInfo = taskHeader.createDiv({ cls: 'task-info' });
            
            // Task title with priority indicator
            const titleContainer = taskInfo.createDiv({ cls: 'task-title-container' });
            
            // Priority indicator
            const priorityIndicator = titleContainer.createDiv({ 
                cls: `task-priority-indicator priority-${task.priority}`
            });
            
            const titleEl = titleContainer.createDiv({ 
                cls: 'task-item-title', 
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
            
            // Due date display removed
            
            // Create metadata section (right side)
            const taskMeta = taskHeader.createDiv({ cls: 'task-item-metadata' });
            
            // Status badge - use effective status for recurring tasks
            const statusBadge = taskMeta.createDiv({
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
                
                try {
                    // Update in the backend
                    await this.plugin.toggleTaskArchive(task);
                    
                    // Manually trigger refresh like recurring tasks do
                    this.refresh();
                } catch(err) {
                    console.error('Failed to toggle task archive:', err);
                }
            });
            
            // Archived badge if applicable
            if (task.archived) {
                taskMeta.createDiv({
                    cls: 'task-archived-badge',
                    text: 'Archived'
                });
            }
            
            // Create controls row
            const taskControls = taskItem.createDiv({ cls: 'task-controls chronosync-card-content' });
            
            // Status control - different behavior for recurring vs. regular tasks
            if (task.recurrence) {
                // Toggle button for recurring tasks
                const toggleButton = taskControls.createEl('button', { 
                    cls: `task-toggle-button ${effectiveStatus === 'done' ? 'mark-incomplete' : 'mark-complete'} chronosync-button chronosync-button-${effectiveStatus === 'done' ? 'secondary' : 'primary'}`,
                    text: effectiveStatus === 'done' ? 'Mark Incomplete' : 'Mark Complete',
                    attr: {
                        'aria-label': `${effectiveStatus === 'done' ? 'Mark task incomplete' : 'Mark task complete'} for ${format(this.plugin.selectedDate, 'MMMM d, yyyy')}`,
                        'aria-pressed': (effectiveStatus === 'done').toString()
                    }
                });
                
                // Add event listener for toggle
                toggleButton.addEventListener('click', async (e) => {
                    e.stopPropagation(); // Prevent task opening
                    
                    // First update the UI element for immediate feedback
                    toggleButton.disabled = true; // Prevent multiple clicks
                    toggleButton.classList.add('processing');
                    
                    try {
                        // Calculate the new state
                        const currentlyComplete = effectiveStatus === 'done';
                        const newComplete = !currentlyComplete;
                        
                        // Update task's complete_instances locally
                        const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
                        const updatedTask = { ...task };
                        if (!updatedTask.complete_instances) {
                            updatedTask.complete_instances = [];
                        }
                        
                        if (newComplete) {
                            if (!updatedTask.complete_instances.includes(selectedDateStr)) {
                                updatedTask.complete_instances.push(selectedDateStr);
                            }
                        } else {
                            updatedTask.complete_instances = updatedTask.complete_instances.filter(d => d !== selectedDateStr);
                        }
                        
                        // Update in the backend with the updated task object
                        await this.plugin.toggleRecurringTaskStatus(updatedTask, this.plugin.selectedDate);
                        
                        // Update the UI immediately
                        this.updateTaskElementInDOM(task.path, updatedTask);
                        
                        // Update our cached task data
                        this.updateTaskInCache(task.path, updatedTask);
                        
                        // Wait a bit before allowing more changes
                        setTimeout(() => {
                            toggleButton.disabled = false;
                            toggleButton.classList.remove('processing');
                        }, 500);
                    } catch(err) {
                        // Re-enable on error
                        toggleButton.disabled = false;
                        toggleButton.classList.remove('processing');
                        console.error('Failed to toggle recurring task:', err);
                    }
                });
            } else {
                // Task status dropdown (direct child of controls grid)
                const statusSelect = taskControls.createEl('select', { 
                    cls: 'task-status-select',
                    attr: {
                        'aria-label': `Task status for ${task.title}`,
                        'title': 'Change task status'
                    }
                });
                
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
                    const select = e.target as HTMLSelectElement;
                    const newStatus = select.value;
                    const originalStatus = task.status;
                    
                    // 1. Create a local copy of the task with the new status
                    const updatedTask = { ...task, status: newStatus };
                    
                    // 2. Perform optimistic UI update
                    this.updateTaskElementInDOM(task.path, updatedTask);
                    this.updateTaskInCache(task.path, updatedTask);
                    
                    try {
                        // 3. Sync change with the backend
                        await this.plugin.updateTaskProperty(task, 'status', newStatus);
                        // 4. The this.refresh() call is removed.
                    } catch(err) {
                        // Revert UI on error
                        select.value = originalStatus;
                        const revertedTask = { ...task, status: originalStatus };
                        this.updateTaskElementInDOM(task.path, revertedTask);
                        this.updateTaskInCache(task.path, revertedTask);
                        console.error('Failed to update task status:', err);
                    }
                });
            }
            
            // Task priority dropdown (direct child of controls grid)
            const prioritySelect = taskControls.createEl('select', { 
                cls: 'task-priority-select',
                attr: {
                    'aria-label': `Task priority for ${task.title}`,
                    'title': 'Change task priority'
                }
            });
            
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
                const select = e.target as HTMLSelectElement;
                const newPriority = select.value;
                const originalPriority = task.priority;
                
                const updatedTask = { ...task, priority: newPriority as 'low' | 'normal' | 'high' };
                
                this.updateTaskElementInDOM(task.path, updatedTask);
                this.updateTaskInCache(task.path, updatedTask);
                
                try {
                    await this.plugin.updateTaskProperty(task, 'priority', newPriority);
                } catch(err) {
                    select.value = originalPriority;
                    const revertedTask = { ...task, priority: originalPriority };
                    this.updateTaskElementInDOM(task.path, revertedTask);
                    this.updateTaskInCache(task.path, revertedTask);
                    console.error('Failed to update task priority:', err);
                }
            });
            
            // Due date input (direct child of controls grid)
            const dueDateInput = taskControls.createEl('input', { 
                type: 'date',
                cls: 'task-due-date-input',
                attr: { 
                    'title': 'Set due date',
                    'aria-label': `Due date for ${task.title}`
                }
            });
            
            // Set current due date if exists
            if (task.due) {
                dueDateInput.value = task.due;
            }
            
            // Add event listener for due date change
            dueDateInput.addEventListener('change', async (e) => {
                e.stopPropagation(); // Prevent task opening
                const input = e.target as HTMLInputElement;
                const newDueDate = input.value;
                const originalDueDate = task.due;
                
                const updatedTask = { ...task, due: newDueDate };
                
                this.updateTaskElementInDOM(task.path, updatedTask);
                this.updateTaskInCache(task.path, updatedTask);
                
                try {
                    await this.plugin.updateTaskProperty(task, 'due', newDueDate);
                } catch(err) {
                    input.value = originalDueDate || '';
                    const revertedTask = { ...task, due: originalDueDate };
                    this.updateTaskElementInDOM(task.path, revertedTask);
                    this.updateTaskInCache(task.path, revertedTask);
                    console.error('Failed to update task due date:', err);
                }
            });
            
            // Add click handler to open task (only on the task info part)
            taskInfo.addEventListener('click', () => {
                this.openTask(task.path);
            });
            
            // Add hover preview functionality for tasks
            taskInfo.addEventListener('mouseover', (event) => {
                const file = this.app.vault.getAbstractFileByPath(task.path);
                if (file) {
                    this.app.workspace.trigger('hover-link', {
                        event,
                        source: 'chronosync-tasks',
                        hoverParent: this,
                        targetEl: taskInfo,
                        linktext: task.path,
                        sourcePath: task.path
                    });
                }
            });
        });
    }
    
    /**
     * Helper method to update the loading indicator visibility
     */
    private updateLoadingState(): void {
        if (!this.loadingIndicator) return;
        
        if (this.isTasksLoading) {
            this.loadingIndicator.style.display = 'flex';
        } else {
            this.loadingIndicator.style.display = 'none';
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
    
    /**
     * Update the list of available contexts from all tasks
     */
    private async updateAvailableContexts(): Promise<void> {
        const tasks = await this.getTasksForView(false);
        const contextsSet = new Set<string>();
        
        tasks.forEach(task => {
            if (task.contexts) {
                task.contexts.forEach(context => {
                    if (context.trim()) {
                        contextsSet.add(context.trim());
                    }
                });
            }
        });
        
        this.availableContexts = Array.from(contextsSet).sort();
    }
    
    /**
     * Render the context filter menu with checkboxes
     */
    private renderContextMenu(menu: HTMLElement, statusSelect: HTMLSelectElement): void {
        menu.empty();
        
        if (this.availableContexts.length === 0) {
            menu.createEl('div', { text: 'No contexts available', cls: 'context-menu-empty' });
            return;
        }
        
        // "All contexts" option
        const allOption = menu.createDiv({ cls: 'context-menu-item' });
        const allCheckbox = allOption.createEl('input', { type: 'checkbox' });
        allCheckbox.checked = this.selectedContexts.size === 0;
        allOption.createSpan({ text: 'All contexts' });
        
        allCheckbox.addEventListener('change', async () => {
            if (allCheckbox.checked) {
                this.selectedContexts.clear();
                // Uncheck all other options
                menu.querySelectorAll('input[type="checkbox"]').forEach((cb, index) => {
                    if (index > 0) (cb as HTMLInputElement).checked = false;
                });
            }
            await this.updateContextButtonText();
            await this.applyFilters(this.taskListContainer!, statusSelect);
        });
        
        // Individual context options
        this.availableContexts.forEach(context => {
            const item = menu.createDiv({ cls: 'context-menu-item' });
            const checkbox = item.createEl('input', { type: 'checkbox' });
            checkbox.checked = this.selectedContexts.has(context);
            item.createSpan({ text: context });
            
            checkbox.addEventListener('change', async () => {
                if (checkbox.checked) {
                    this.selectedContexts.add(context);
                    // Uncheck "All contexts"
                    (menu.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = false;
                } else {
                    this.selectedContexts.delete(context);
                    // If no contexts are selected, check "All contexts"
                    if (this.selectedContexts.size === 0) {
                        (menu.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = true;
                    }
                }
                await this.updateContextButtonText();
                await this.applyFilters(this.taskListContainer!, statusSelect);
            });
        });
    }
    
    /**
     * Update the context button text based on selected contexts
     */
    private async updateContextButtonText(): Promise<void> {
        const contextButton = this.contentEl.querySelector('.context-dropdown-button') as HTMLElement;
        if (!contextButton) return;
        
        if (this.selectedContexts.size === 0) {
            contextButton.textContent = 'All contexts';
        } else if (this.selectedContexts.size === 1) {
            contextButton.textContent = Array.from(this.selectedContexts)[0];
        } else {
            contextButton.textContent = `${this.selectedContexts.size} contexts`;
        }
    }
    
    /**
     * Update a specific task element in the DOM without full re-render
     */
    private updateTaskElementInDOM(taskPath: string, updatedTask: TaskInfo): void {
        const taskElement = this.taskElements.get(taskPath);
        if (!taskElement) return;
        
        // Update task status badge
        const statusBadge = taskElement.querySelector('.task-status') as HTMLElement;
        if (statusBadge) {
            const effectiveStatus = updatedTask.recurrence 
                ? getEffectiveTaskStatus(updatedTask, this.plugin.selectedDate)
                : updatedTask.status;
            
            statusBadge.className = `task-status task-status-${effectiveStatus.replace(/\s+/g, '-').toLowerCase()} ${updatedTask.recurrence ? 'recurring-status' : ''}`;
            statusBadge.textContent = effectiveStatus;
        }
        
        // Update priority indicator
        const priorityIndicator = taskElement.querySelector('.task-priority-indicator') as HTMLElement;
        if (priorityIndicator) {
            priorityIndicator.className = `task-priority-indicator priority-${updatedTask.priority}`;
        }
        
        // Update archive status
        const archiveButton = taskElement.querySelector('.archive-button-icon') as HTMLElement;
        if (archiveButton) {
            archiveButton.className = `archive-button-icon ${updatedTask.archived ? 'archived' : ''}`;
            archiveButton.title = updatedTask.archived ? 'Unarchive this task' : 'Archive this task';
            archiveButton.innerHTML = updatedTask.archived 
                ? '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"></path></svg>'
                : '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 9.5l5.5 5.5H14v2h-4v-2H6.5L12 9.5zM5.12 5l.81-1h12l.94 1H5.12z"></path></svg>';
        }
        
        // Update archived badge visibility
        const archivedBadge = taskElement.querySelector('.task-archived-badge') as HTMLElement;
        if (archivedBadge) {
            archivedBadge.style.display = updatedTask.archived ? 'block' : 'none';
        } else if (updatedTask.archived) {
            // Add archived badge if it doesn't exist
            const taskMeta = taskElement.querySelector('.task-item-metadata');
            if (taskMeta) {
                taskMeta.createDiv({
                    cls: 'task-archived-badge',
                    text: 'Archived'
                });
            }
        }
        
        // Update main task item classes
        const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
        const isDueOnSelectedDate = selectedDateStr && (
            updatedTask.due === selectedDateStr || 
            (updatedTask.recurrence && isRecurringTaskDueOn(updatedTask, this.plugin.selectedDate))
        );
        
        taskElement.className = `task-item ${isDueOnSelectedDate ? 'task-due-today' : ''} ${updatedTask.archived ? 'task-archived' : ''} ${updatedTask.recurrence ? 'task-recurring' : ''} chronosync-card`;
        
        // Add visual feedback for the update
        taskElement.classList.add('task-updated');
        setTimeout(() => {
            taskElement.classList.remove('task-updated');
        }, 1500);
    }
    
    /**
     * Update a task in the cached tasks array
     */
    private updateTaskInCache(taskPath: string, updatedTask: TaskInfo): void {
        if (!this.cachedTasks) return;
        
        const index = this.cachedTasks.findIndex(t => t.path === taskPath);
        if (index !== -1) {
            this.cachedTasks[index] = updatedTask;
        }
    }
    
    /**
     * Apply both status and context filters to the task list
     */
    private async applyFilters(taskListContainer: HTMLElement, statusSelect: HTMLSelectElement): Promise<void> {
        const selectedStatus = statusSelect.value;
        const allTasks = await this.getTasksForView(true); // Force refresh to get latest data

        // Apply status filtering logic
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
        
        // Apply context filtering
        if (this.selectedContexts.size > 0) {
            filteredTasks = filteredTasks.filter(task => {
                if (!task.contexts || task.contexts.length === 0) {
                    return false; // Task has no contexts, exclude it
                }
                
                // Check if task has any of the selected contexts
                return task.contexts.some(context => 
                    this.selectedContexts.has(context.trim())
                );
            });
        }
            
        // Then sort the tasks to prioritize those due on the selected date
        const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
        this.prioritizeTasksByDate(filteredTasks, selectedDateStr);
        
        // Refresh the task list
        this.renderTaskItems(taskListContainer, filteredTasks, selectedDateStr);
    }
    
    openTask(path: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file);
        }
    }
}