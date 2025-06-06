import { Notice, TFile, ItemView, WorkspaceLeaf } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    TASK_LIST_VIEW_TYPE, 
    TaskInfo, 
    EVENT_DATE_SELECTED,
    EVENT_DATA_CHANGED,
    EVENT_TASK_UPDATED,
    TaskSortKey,
    TaskGroupKey
} from '../types';
import { 
    isTaskOverdue,
    isRecurringTaskDueOn,
    getEffectiveTaskStatus,
    calculateTotalTimeSpent
} from '../utils/helpers';
import { perfMonitor } from '../utils/PerformanceMonitor';

export class TaskListView extends ItemView {
    plugin: TaskNotesPlugin;
    
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
    
    // Sorting and grouping states
    private sortKey: TaskSortKey = 'due';
    private groupKey: TaskGroupKey = 'none';
    
    // Task item tracking for dynamic updates
    private taskElements: Map<string, HTMLElement> = new Map();
    
    // Event listeners
    private listeners: (() => void)[] = [];
    
    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
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
        
        // Listen for individual task updates
        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, ({ path, updatedTask }) => {
            if (!path || !updatedTask) {
                console.error('EVENT_TASK_UPDATED received invalid data:', { path, updatedTask });
                return;
            }
            
            // Update the data in the view's local cache
            this.updateTaskInCache(path, updatedTask);
            // Update the single task element in the DOM without a full refresh
            this.updateTaskElementInDOM(path, updatedTask);
        });
        this.listeners.push(taskUpdateListener);
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
        return perfMonitor.measure('task-list-refresh', async () => {
            // If forcing a full refresh, clear the caches
            if (forceFullRefresh) {
                this.cachedTasks = null;
                this.lastTasksRefresh = 0;
            }
            
            // Save UI state before refresh
            const taskListContainer = this.contentEl.querySelector('.task-list') as HTMLElement;
            if (taskListContainer) {
                this.plugin.uiStateManager.saveState('task-list-scroll', taskListContainer);
            }
            
            // Clear and prepare the content element
            this.contentEl.empty();
            await this.render();
            
            // Restore UI state after refresh
            const newTaskListContainer = this.contentEl.querySelector('.task-list') as HTMLElement;
            if (newTaskListContainer) {
                this.plugin.uiStateManager.restoreState('task-list-scroll', newTaskListContainer);
            }
        });
    }
    
    async render() {
        const container = this.contentEl.createDiv({ cls: 'tasknotes-container task-list-view-container' });
        
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
            text: 'New task', 
            cls: 'add-task-button tasknotes-button tasknotes-button-primary',
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
        // Create filters with improved layout
        const filtersContainer = container.createDiv({ cls: 'task-filters' });
        
        // First row - Primary controls only
        const primaryFiltersRow = filtersContainer.createDiv({ cls: 'filters-row primary-filters' });
        
        // Toggle button for filters
        const toggleOrgButton = primaryFiltersRow.createEl('button', {
            cls: 'toggle-org-filters-button',
            attr: {
                'aria-label': 'Toggle filters',
                'title': 'Toggle filters',
                'aria-expanded': 'true'
            }
        });
        const downArrowIcon = this.createSVGIcon('0 0 24 24', 16, 16, 'M7 10l5 5 5-5z');
        toggleOrgButton.appendChild(downArrowIcon);
        
        // Add label next to toggle
        const toggleLabel = primaryFiltersRow.createEl('span', {
            text: 'Filters',
            cls: 'toggle-filters-label'
        });
        
        // Spacer to push refresh button to the right
        primaryFiltersRow.createDiv({ cls: 'filters-spacer' });
        
        // Refresh button in primary row
        const refreshButton = primaryFiltersRow.createEl('button', { 
            text: 'Refresh', 
            cls: 'refresh-tasks-button tasknotes-button tasknotes-button-secondary',
            attr: {
                'aria-label': 'Refresh task list',
                'title': 'Refresh task list'
            }
        });
        
        // Second row - All filters (collapsible)
        const organizationFiltersRow = filtersContainer.createDiv({ cls: 'filters-row organization-filters' });
        
        // Apply saved collapse state
        if (this.plugin.settings.taskOrgFiltersCollapsed) {
            organizationFiltersRow.addClass('is-hidden');
            toggleOrgButton.setAttribute('aria-expanded', 'false');
            toggleOrgButton.empty();
            const upArrowIcon = this.createSVGIcon('0 0 24 24', 16, 16, 'M7 14l5-5 5 5z');
            toggleOrgButton.appendChild(upArrowIcon);
        }
        
        // Status filter (moved to collapsible section)
        const statusFilter = organizationFiltersRow.createDiv({ cls: 'filter-group' });
        statusFilter.createEl('span', { text: 'Status: ' });
        const statusSelect = statusFilter.createEl('select', { cls: 'status-select' });
        
        // Create status options from custom statuses
        const statusOptions = ['All', 'Open (All non-completed)', 'Archived'];
        
        // Add custom statuses
        this.plugin.statusManager.getAllStatuses().forEach(status => {
            statusOptions.splice(-1, 0, status.label); // Insert before 'Archived'
        });
        
        statusOptions.forEach(statusText => {
            let value: string;
            if (statusText === 'All') {
                value = 'all';
            } else if (statusText === 'Open (All non-completed)') {
                value = 'open';
            } else if (statusText === 'Archived') {
                value = 'archived';
            } else {
                // Find the status config that matches this label
                const statusConfig = this.plugin.statusManager.getAllStatuses().find(s => s.label === statusText);
                value = statusConfig ? statusConfig.value : statusText.toLowerCase();
            }
            
            const option = statusSelect.createEl('option', { value, text: statusText });
        });
        
        // Context filter (moved to collapsible section)
        const contextFilter = organizationFiltersRow.createDiv({ cls: 'filter-group context-filter' });
        contextFilter.createEl('span', { text: 'Contexts: ' });
        
        // Context multi-select dropdown
        const contextDropdown = contextFilter.createDiv({ cls: 'context-dropdown' });
        const contextButton = contextDropdown.createEl('button', { 
            text: 'Select contexts', 
            cls: 'context-dropdown-button'
        });
        const contextMenu = contextDropdown.createDiv({ cls: 'context-dropdown-menu' });
        contextMenu.addClass('is-hidden');
        
        // Grouping filter
        const groupFilter = organizationFiltersRow.createDiv({ cls: 'filter-group' });
        groupFilter.createEl('span', { text: 'Group by: ' });
        const groupSelect = groupFilter.createEl('select', { cls: 'group-select' });
        
        const groupOptions = [
            { value: 'none', text: 'None' },
            { value: 'priority', text: 'Priority' },
            { value: 'context', text: 'Context' },
            { value: 'due', text: 'Due date' },
            { value: 'status', text: 'Status' }
        ];
        groupOptions.forEach(option => {
            const optionEl = groupSelect.createEl('option', { value: option.value, text: option.text });
            if (option.value === this.groupKey) {
                optionEl.selected = true;
            }
        });
        
        // Sorting filter
        const sortFilter = organizationFiltersRow.createDiv({ cls: 'filter-group' });
        sortFilter.createEl('span', { text: 'Sort by: ' });
        const sortSelect = sortFilter.createEl('select', { cls: 'sort-select' });
        
        const sortOptions = [
            { value: 'due', text: 'Due date' },
            { value: 'priority', text: 'Priority' },
            { value: 'title', text: 'Title' }
        ];
        sortOptions.forEach(option => {
            const optionEl = sortSelect.createEl('option', { value: option.value, text: option.text });
            if (option.value === this.sortKey) {
                optionEl.selected = true;
            }
        });
        
        // Get available contexts from tasks
        await this.updateAvailableContexts();
        this.renderContextMenu(contextMenu, statusSelect);
        
        // Toggle dropdown menu
        contextButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = contextMenu.hasClass('is-hidden');
            if (isHidden) {
                contextMenu.removeClass('is-hidden');
            } else {
                contextMenu.addClass('is-hidden');
            }
        });
        
        // Close dropdown when clicking outside
        const documentClickHandler = (e: Event) => {
            if (!contextDropdown.contains(e.target as Node)) {
                contextMenu.addClass('is-hidden');
            }
        };
        document.addEventListener('click', documentClickHandler);
        
        // Track for cleanup
        this.listeners.push(() => {
            document.removeEventListener('click', documentClickHandler);
        });
        
        // Toggle filters visibility
        toggleOrgButton.addEventListener('click', async () => {
            const isHidden = organizationFiltersRow.hasClass('is-hidden');
            if (isHidden) {
                organizationFiltersRow.removeClass('is-hidden');
            } else {
                organizationFiltersRow.addClass('is-hidden');
            }
            toggleOrgButton.setAttribute('aria-expanded', isHidden.toString());
            toggleOrgButton.empty();
            const arrowIcon = isHidden 
                ? this.createSVGIcon('0 0 24 24', 16, 16, 'M7 10l5 5 5-5z')
                : this.createSVGIcon('0 0 24 24', 16, 16, 'M7 14l5-5 5 5z');
            toggleOrgButton.appendChild(arrowIcon);
            
            // Save the collapse state
            this.plugin.settings.taskOrgFiltersCollapsed = !isHidden;
            await this.plugin.saveSettings();
        });
        
        // Also allow clicking on the label to toggle
        toggleLabel.addEventListener('click', () => {
            toggleOrgButton.click();
        });
        
        refreshButton.addEventListener('click', async () => {
            // Force refresh the cache and update UI
            await this.refresh(true); // Pass true to force a full refresh
        });
        
        // Task list container
        const taskList = container.createDiv({ cls: 'task-list' });
        
        // Add loading indicator
        this.loadingIndicator = taskList.createDiv({ cls: 'loading-indicator' });
        this.loadingIndicator.createDiv({ cls: 'loading-spinner' });
        this.loadingIndicator.createDiv({ cls: 'loading-text', text: 'Loading tasks...' });
        this.loadingIndicator.addClass('is-hidden');
        
        // Show loading state if we're fetching data
        this.isTasksLoading = true;
        this.updateLoadingState();
        
        // Get tasks (this will now show loading indicator while working)
        const tasks = await this.getTasksForView(false);
        
        // Hide loading state when done
        this.isTasksLoading = false;
        this.updateLoadingState();
        
        // Add change event listeners to the filters
        statusSelect.addEventListener('change', async () => {
            await this.applyFilters(taskList, statusSelect);
        });
        
        groupSelect.addEventListener('change', async () => {
            this.groupKey = groupSelect.value as TaskGroupKey;
            await this.applyFilters(taskList, statusSelect);
        });
        
        sortSelect.addEventListener('change', async () => {
            this.sortKey = sortSelect.value as TaskSortKey;
            await this.applyFilters(taskList, statusSelect);
        });
        
        // Get the selected date
        const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
        
        // Apply initial filtering and render
        await this.applyFilters(taskList, statusSelect);
        
        // Store reference to the task list container for future updates
        this.taskListContainer = taskList;
    }
    
    // Helper method to render task items with grouping support
    renderTaskItems(container: HTMLElement, groupedTasks: Map<string, TaskInfo[]> | TaskInfo[], selectedDateStr: string | null = null) {
        // Handle backward compatibility - if passed array, convert to map
        let taskGroups: Map<string, TaskInfo[]>;
        if (Array.isArray(groupedTasks)) {
            taskGroups = new Map([['all', groupedTasks]]);
        } else {
            taskGroups = groupedTasks;
        }
        // Clear the container
        container.empty();
        
        // Check if there are any tasks across all groups
        const totalTasks = Array.from(taskGroups.values()).reduce((total, tasks) => total + tasks.length, 0);
        
        if (totalTasks === 0) {
            // Placeholder for empty task list
            container.createEl('p', { text: 'No tasks found for the selected filters.' });
            return;
        }
        
        // Render each group
        taskGroups.forEach((tasks, groupName) => {
            if (tasks.length === 0) return;
            
            // Create group section (only if we have groups other than 'all')
            const groupSection = container.createDiv({ cls: 'task-section task-group' });
            
            // Add group header (skip only if grouping is 'none' and group name is 'all')
            if (!(this.groupKey === 'none' && groupName === 'all')) {
                const groupHeader = groupSection.createEl('h4', { 
                    cls: 'task-group-header',
                    text: this.formatGroupName(groupName)
                });
            }
            
            // Create task cards container
            const taskCardsContainer = groupSection.createDiv({ cls: 'tasks-container task-cards' });
            
            // Deduplicate tasks within this group
            const processedTaskPaths = new Set<string>();
            const uniqueTasks = tasks.filter(task => {
                if (processedTaskPaths.has(task.path)) {
                    return false;
                }
                processedTaskPaths.add(task.path);
                return true;
            });
            
            // Render tasks using existing renderTaskGroup method
            this.renderTaskGroup(taskCardsContainer, uniqueTasks, selectedDateStr, false);
        });
    }
    
    /**
     * Generate a safe CSS class name from a value
     */
    private getSafeCSSClass(prefix: string, value: string): string {
        return `${prefix}-${value.replace(/[^a-zA-Z0-9-]/g, '-')}`;
    }
    
    /**
     * Create SVG icon element safely without innerHTML
     */
    private createSVGIcon(viewBox: string, width: number, height: number, pathData: string): SVGElement {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', viewBox);
        svg.setAttribute('width', width.toString());
        svg.setAttribute('height', height.toString());
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', pathData);
        
        svg.appendChild(path);
        return svg;
    }
    
    /**
     * Create archive/unarchive icon
     */
    private createArchiveIcon(isArchived: boolean): SVGElement {
        const unarchiveIcon = 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z';
        const archiveIcon = 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 9.5l5.5 5.5H14v2h-4v-2H6.5L12 9.5zM5.12 5l.81-1h12l.94 1H5.12z';
        
        return this.createSVGIcon('0 0 24 24', 16, 16, isArchived ? unarchiveIcon : archiveIcon);
    }
    
    /**
     * Format group name for display
     */
    private formatGroupName(groupName: string): string {
        // Check if it's a priority value
        const priorityConfig = this.plugin.priorityManager.getPriorityConfig(groupName);
        if (priorityConfig) {
            return `${priorityConfig.label} priority`;
        }
        
        // Check if it's a status value  
        const statusConfig = this.plugin.statusManager.getStatusConfig(groupName);
        if (statusConfig) {
            return statusConfig.label;
        }
        
        switch (groupName) {
            case 'all':
                return 'All tasks';
            default:
                return groupName;
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
            
            const priorityClass = this.getSafeCSSClass('priority', task.priority);
            const taskItem = container.createDiv({ 
                cls: `task-item ${priorityClass} ${isDueOnSelectedDate ? 'task-due-today' : ''} ${task.archived ? 'task-archived' : ''} ${task.recurrence ? 'task-recurring' : ''} tasknotes-card`
            });
            
            // Store reference to this task element for future updates
            taskItem.dataset.taskPath = task.path;
            this.taskElements.set(task.path, taskItem);
            
            // Get priority configuration for styling and interactions
            const priorityConfig = this.plugin.priorityManager.getPriorityConfig(task.priority);
            
            // Apply priority color for hover border styling
            if (priorityConfig) {
                taskItem.dataset.priorityColor = priorityConfig.color;
                taskItem.style.setProperty('--current-priority-color', priorityConfig.color);
            }
            
            // Create header row (title and metadata)
            const taskHeader = taskItem.createDiv({ cls: 'task-header tasknotes-card-header' });
            
            // Create info section (left side)
            const taskInfo = taskHeader.createDiv({ cls: 'task-info' });
            
            // Task title with priority indicator
            const titleContainer = taskInfo.createDiv({ cls: 'task-title-container' });
            
            // Priority indicator - clickable
            const priorityLabel = priorityConfig?.label || task.priority;
            
            const priorityIndicator = titleContainer.createEl('button', { 
                cls: `task-priority-indicator ${priorityClass} clickable`,
                attr: {
                    'aria-label': `Priority: ${priorityLabel}. Click to change`,
                    'title': 'Click to change priority',
                    'type': 'button'
                }
            });
            
            // Apply custom priority color
            if (priorityConfig) {
                priorityIndicator.style.setProperty('--priority-color', priorityConfig.color);
            }
            
            // Add click handler for priority indicator
            priorityIndicator.addEventListener('click', async (e) => {
                e.stopPropagation();
                
                // Get fresh task data from cache
                const currentTask = this.getTaskFromCache(task.path) || task;
                
                // Use PriorityManager to get next priority
                const nextPriority = this.plugin.priorityManager.getNextPriority(currentTask.priority);
                
                const originalPriority = currentTask.priority;
                const updatedTask = { ...currentTask, priority: nextPriority };
                
                // Optimistic UI update
                this.updateTaskElementInDOM(currentTask.path, updatedTask);
                this.updateTaskInCache(currentTask.path, updatedTask);
                
                try {
                    await this.plugin.updateTaskProperty(currentTask, 'priority', nextPriority);
                } catch(err) {
                    // Revert on error
                    const revertedTask = { ...currentTask, priority: originalPriority };
                    this.updateTaskElementInDOM(currentTask.path, revertedTask);
                    this.updateTaskInCache(currentTask.path, revertedTask);
                    console.error('Failed to update task priority:', err);
                }
            });
            
            // Time tracking icon (for all tasks)
            const activeSession = this.plugin.getActiveTimeSession(task);
            const isTracking = !!activeSession;
            
            const timeIcon = titleContainer.createEl('span', {
                cls: `time-icon ${isTracking ? 'tracking' : 'idle'}`,
                attr: {
                    'aria-label': isTracking ? 'Stop time tracking' : 'Start time tracking',
                    'title': isTracking ? 'Stop time tracking' : 'Start time tracking'
                }
            });
            
            timeIcon.textContent = isTracking ? '⏸' : '▶';
            
            timeIcon.addEventListener('click', async (e) => {
                e.stopPropagation();
                
                // Get fresh task data from cache
                const currentTask = this.getTaskFromCache(task.path) || task;
                const currentActiveSession = this.plugin.getActiveTimeSession(currentTask);
                const currentlyTracking = !!currentActiveSession;
                
                try {
                    if (currentlyTracking) {
                        await this.plugin.stopTimeTracking(currentTask);
                    } else {
                        await this.plugin.startTimeTracking(currentTask);
                    }
                    
                    // No need for refresh - granular updates will handle it
                } catch (error) {
                    console.error('Error toggling time tracking:', error);
                }
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
            
            // Time tracking info in metadata (compact display)
            const timeSpent = calculateTotalTimeSpent(task.timeEntries || []);
            if (task.timeEstimate || timeSpent > 0) {
                const timeMetaContainer = taskMeta.createDiv({ cls: 'time-meta-compact' });
                
                if (task.timeEstimate) {
                    timeMetaContainer.createSpan({ 
                        cls: 'time-meta-estimate',
                        text: this.plugin.formatTime(task.timeEstimate),
                        attr: { title: `Estimated: ${this.plugin.formatTime(task.timeEstimate)}` }
                    });
                }
                
                if (timeSpent > 0) {
                    timeMetaContainer.createSpan({ 
                        cls: 'time-meta-spent',
                        text: this.plugin.formatTime(timeSpent),
                        attr: { title: `Time spent: ${this.plugin.formatTime(timeSpent)}` }
                    });
                    
                    // Add small progress indicator if both are available
                    if (task.timeEstimate && task.timeEstimate > 0) {
                        const progress = Math.min((timeSpent / task.timeEstimate) * 100, 100);
                        const progressDot = timeMetaContainer.createSpan({ 
                            cls: `progress-dot ${progress > 100 ? 'over-estimate' : progress >= 100 ? 'complete' : 'in-progress'}`,
                            attr: { title: `${Math.round(progress)}% complete` }
                        });
                    }
                }
            }
            
            // Show completed date for non-recurring tasks that are done
            if (!task.recurrence && task.status === 'done' && task.completedDate) {
                const completedDateEl = taskMeta.createDiv({
                    cls: 'task-completed-date',
                    text: `${format(new Date(task.completedDate), 'MMM d')}`
                });
                completedDateEl.setAttribute('title', `Completed on ${format(new Date(task.completedDate), 'MMMM d, yyyy')}`);
            }
            
            // Create archive button in the metadata section (top right)
            const archiveButton = taskMeta.createEl('button', { 
                cls: `archive-button-icon ${task.archived ? 'archived' : ''}`,
                attr: { 
                    title: task.archived ? 'Unarchive this task' : 'Archive this task',
                    'aria-label': task.archived ? 'Unarchive' : 'Archive'
                }
            });
            
            // Add icon based on archive status
            const archiveIcon = this.createArchiveIcon(task.archived);
            archiveButton.appendChild(archiveIcon);
            
            // Add event listener for archive toggle
            archiveButton.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent task opening
                
                // Get fresh task data from cache
                const currentTask = this.getTaskFromCache(task.path) || task;
                
                try {
                    // Update in the backend
                    await this.plugin.toggleTaskArchive(currentTask);
                    
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
            
            // Create footer row for due date and recurring task control
            const taskFooter = taskItem.createDiv({ cls: 'task-footer' });
            
            // Due date section (left side of footer)
            const dueDateSection = taskFooter.createDiv({ cls: 'due-date-section' });
            
            const dueDateLabel = dueDateSection.createEl('label', { 
                cls: 'due-date-label',
                text: 'Due:',
                attr: { 'for': `due-${task.path}` }
            });
            
            const dueDateInput = dueDateSection.createEl('input', { 
                type: 'date',
                cls: 'task-due-date-input',
                attr: { 
                    'id': `due-${task.path}`,
                    'title': 'Set due date',
                    'aria-label': `Due date for ${task.title}`
                }
            });
            
            // Status badge - clickable for non-recurring tasks (in footer)
            const statusClass = this.getSafeCSSClass('task-status', effectiveStatus);
            const statusConfig = this.plugin.statusManager.getStatusConfig(effectiveStatus);
            const statusLabel = statusConfig?.label || effectiveStatus;
            
            const statusBadge = dueDateSection.createEl('button', {
                cls: `task-status ${statusClass} ${task.recurrence ? 'recurring-status' : ''} ${!task.recurrence ? 'clickable' : ''}`,
                text: statusLabel,
                attr: {
                    'aria-label': `Change status: ${statusLabel}`,
                    'title': task.recurrence ? `Status for ${format(this.plugin.selectedDate, 'MMMM d, yyyy')}` : 'Click to change status',
                    'type': 'button',
                    'disabled': task.recurrence ? 'true' : null
                }
            });
            
            // Apply custom status color
            if (statusConfig) {
                statusBadge.style.setProperty('background', statusConfig.color, 'important');
            }
            
            // Add click handler for status badge (non-recurring tasks only)
            if (!task.recurrence) {
                statusBadge.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    
                    // Get fresh task data from cache
                    const currentTask = this.getTaskFromCache(task.path) || task;
                    
                    // Use StatusManager to get next status
                    const nextStatus = this.plugin.statusManager.getNextStatus(currentTask.status);
                    
                    const originalStatus = currentTask.status;
                    const updatedTask = { ...currentTask, status: nextStatus };
                    
                    // Update completedDate based on whether new status is completed
                    if (this.plugin.statusManager.isCompletedStatus(nextStatus)) {
                        updatedTask.completedDate = format(new Date(), 'yyyy-MM-dd');
                    } else {
                        updatedTask.completedDate = undefined;
                    }
                    
                    // Optimistic UI update
                    this.updateTaskElementInDOM(currentTask.path, updatedTask);
                    this.updateTaskInCache(currentTask.path, updatedTask);
                    
                    try {
                        await this.plugin.updateTaskProperty(currentTask, 'status', nextStatus);
                    } catch(err) {
                        // Revert on error
                        const revertedTask = { ...currentTask, status: originalStatus };
                        this.updateTaskElementInDOM(currentTask.path, revertedTask);
                        this.updateTaskInCache(currentTask.path, revertedTask);
                        console.error('Failed to update task status:', err);
                    }
                });
            }
            
            // Set current due date if exists
            if (task.due) {
                dueDateInput.value = task.due;
            }
            
            // Add event listener for due date change
            dueDateInput.addEventListener('change', async (e) => {
                e.stopPropagation();
                const input = e.target as HTMLInputElement;
                const newDueDate = input.value;
                
                // Get fresh task data from cache
                const currentTask = this.getTaskFromCache(task.path) || task;
                const originalDueDate = currentTask.due;
                
                const updatedTask = { ...currentTask, due: newDueDate };
                
                this.updateTaskElementInDOM(currentTask.path, updatedTask);
                this.updateTaskInCache(currentTask.path, updatedTask);
                
                try {
                    await this.plugin.updateTaskProperty(currentTask, 'due', newDueDate);
                } catch(err) {
                    input.value = originalDueDate || '';
                    const revertedTask = { ...currentTask, due: originalDueDate };
                    this.updateTaskElementInDOM(currentTask.path, revertedTask);
                    this.updateTaskInCache(currentTask.path, revertedTask);
                    console.error('Failed to update task due date:', err);
                }
            });
            
            // Recurring task toggle button (right side of footer)
            if (task.recurrence) {
                const recurringSection = taskFooter.createDiv({ cls: 'recurring-section' });
                
                const isCompleted = this.plugin.statusManager.isCompletedStatus(effectiveStatus);
                
                const toggleButton = recurringSection.createEl('button', { 
                    cls: `task-toggle-button ${isCompleted ? 'mark-incomplete' : 'mark-complete'}`,
                    text: isCompleted ? 'Mark incomplete' : 'Mark complete',
                    attr: {
                        'aria-label': `${isCompleted ? 'Mark task incomplete' : 'Mark task complete'} for ${format(this.plugin.selectedDate, 'MMMM d, yyyy')}`,
                        'aria-pressed': isCompleted.toString()
                    }
                });
                
                toggleButton.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    
                    // Get fresh task data from cache
                    const currentTask = this.getTaskFromCache(task.path) || task;
                    
                    try {
                        await this.plugin.toggleRecurringTaskComplete(currentTask, this.plugin.selectedDate);
                        
                        // No need for manual refresh - granular updates will handle it
                    } catch (error) {
                        console.error('Error toggling recurring task completion:', error);
                    }
                });
            }
            
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
                        source: 'tasknotes-tasks',
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
            this.loadingIndicator.removeClass('is-hidden');
        } else {
            this.loadingIndicator.addClass('is-hidden');
        }
    }
    
    // Method to prioritize tasks by date
    private prioritizeTasksByDate(tasks: TaskInfo[], selectedDateStr: string | null): void {
        if (!selectedDateStr) return;
        
        // Sort with tasks due on selected date first, then by normal sort criteria
        tasks.sort((a, b) => {
            // First, put completed tasks at the bottom
            const aIsDone = this.plugin.statusManager.isCompletedStatus(a.status);
            const bIsDone = this.plugin.statusManager.isCompletedStatus(b.status);
            
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
            
            // Then sort by priority using PriorityManager
            return this.plugin.priorityManager.comparePriorities(a.priority, b.priority);
        });
    }
    
    async getTasksForView(forceRefresh: boolean = false): Promise<TaskInfo[]> {
        return perfMonitor.measure('get-tasks-for-view', async () => {
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
                
                // Use request deduplication for cache requests
                const cacheKey = `tasks-${format(this.plugin.selectedDate, 'yyyy-MM-dd')}-${forceRefresh}`;
                const tasks = await this.plugin.requestDeduplicator.execute(
                    cacheKey,
                    async () => {
                        // Try unified cache manager first
                        try {
                            const cachedTasks = await this.plugin.cacheManager.getTasksForDate(this.plugin.selectedDate, forceRefresh);
                            if (cachedTasks.length > 0) {
                                return cachedTasks;
                            }
                        } catch (error) {
                            console.warn('Failed to get tasks from unified cache manager:', error);
                        }
                        
                        // Use CacheManager
                        return this.plugin.cacheManager.getTaskInfoForDate(this.plugin.selectedDate, forceRefresh);
                    }
                );
                
                // Record access for predictive prefetching
                this.plugin.predictivePrefetcher.recordAccess(
                    this.plugin.selectedDate,
                    'tasks',
                    (date) => this.plugin.cacheManager.getTasksForDate(date, false)
                );
                
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
                    
                    // Then sort by priority using PriorityManager
                    return this.plugin.priorityManager.comparePriorities(a.priority, b.priority);
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
        });
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
                // Ensure contexts is always treated as an array
                const contextsArray = Array.isArray(task.contexts) ? task.contexts : [task.contexts];
                contextsArray.forEach(context => {
                    if (typeof context === 'string' && context.trim()) {
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
        if (!taskElement) {
            // Task element not found for path
            return;
        }
        
        // Use DOM reconciler for optimized updates
        this.plugin.domReconciler.scheduleUpdate(() => {
            this.performTaskElementUpdate(taskElement, updatedTask);
        });
    }
    
    /**
     * Perform the actual DOM updates for a task element
     */
    private performTaskElementUpdate(taskElement: HTMLElement, updatedTask: TaskInfo): void {
        if (!updatedTask) {
            console.error('performTaskElementUpdate called with undefined updatedTask');
            return;
        }
        
        perfMonitor.measureSync('task-element-update', () => {
            // Update task status badge
            const statusBadge = taskElement.querySelector('.task-status') as HTMLElement;
        if (statusBadge) {
            const effectiveStatus = updatedTask.recurrence 
                ? getEffectiveTaskStatus(updatedTask, this.plugin.selectedDate)
                : updatedTask.status;
            
            const statusClass = this.getSafeCSSClass('task-status', effectiveStatus);
            const statusConfig = this.plugin.statusManager.getStatusConfig(effectiveStatus);
            const statusLabel = statusConfig?.label || effectiveStatus;
            
            statusBadge.className = `task-status ${statusClass} ${updatedTask.recurrence ? 'recurring-status' : ''} ${!updatedTask.recurrence ? 'clickable' : ''}`;
            statusBadge.textContent = statusLabel;
            
            // Apply custom status color
            if (statusConfig) {
                statusBadge.style.setProperty('background', statusConfig.color, 'important');
            }
        }
        
        // Update priority indicator
        const priorityIndicator = taskElement.querySelector('.task-priority-indicator') as HTMLElement;
        if (priorityIndicator) {
            const priorityClass = this.getSafeCSSClass('priority', updatedTask.priority);
            const priorityConfig = this.plugin.priorityManager.getPriorityConfig(updatedTask.priority);
            priorityIndicator.className = `task-priority-indicator ${priorityClass} clickable`;
            
            // Apply custom priority color
            if (priorityConfig) {
                priorityIndicator.style.setProperty('--priority-color', priorityConfig.color);
                
                // Update hover border styling on the task item
                taskElement.dataset.priorityColor = priorityConfig.color;
                taskElement.style.setProperty('--current-priority-color', priorityConfig.color);
            }
        }
        
        // Update archive status
        const archiveButton = taskElement.querySelector('.archive-button-icon') as HTMLElement;
        if (archiveButton) {
            archiveButton.className = `archive-button-icon ${updatedTask.archived ? 'archived' : ''}`;
            archiveButton.title = updatedTask.archived ? 'Unarchive this task' : 'Archive this task';
            archiveButton.empty();
            const updatedArchiveIcon = this.createArchiveIcon(updatedTask.archived);
            archiveButton.appendChild(updatedArchiveIcon);
        }
        
        // Update archived badge visibility
        const archivedBadge = taskElement.querySelector('.task-archived-badge') as HTMLElement;
        if (archivedBadge) {
            if (updatedTask.archived) {
                archivedBadge.classList.remove('is-hidden');
            } else {
                archivedBadge.classList.add('is-hidden');
            }
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
        
        // Update completed date badge
        const completedDateEl = taskElement.querySelector('.task-completed-date') as HTMLElement;
        if (completedDateEl) {
            if (!updatedTask.recurrence && updatedTask.status === 'done' && updatedTask.completedDate) {
                completedDateEl.textContent = `${format(new Date(updatedTask.completedDate), 'MMM d')}`;
                completedDateEl.classList.remove('is-hidden');
            } else {
                completedDateEl.classList.add('is-hidden');
            }
        } else if (!updatedTask.recurrence && updatedTask.status === 'done' && updatedTask.completedDate) {
            // Add completed date badge if it doesn't exist
            const taskMeta = taskElement.querySelector('.task-item-metadata');
            if (taskMeta) {
                const completedDateEl = taskMeta.createDiv({
                    cls: 'task-completed-date',
                    text: `${format(new Date(updatedTask.completedDate), 'MMM d')}`
                });
                completedDateEl.setAttribute('title', `Completed on ${format(new Date(updatedTask.completedDate), 'MMMM d, yyyy')}`);
            }
        }
        
        // Update time metadata
        const timeMetaContainer = taskElement.querySelector('.time-meta-compact') as HTMLElement;
        if (timeMetaContainer) {
            // Calculate time spent dynamically
            const timeSpent = calculateTotalTimeSpent(updatedTask.timeEntries || []);
            
            // Update existing time info
            const estimateEl = timeMetaContainer.querySelector('.time-meta-estimate') as HTMLElement;
            const spentEl = timeMetaContainer.querySelector('.time-meta-spent') as HTMLElement;
            const progressDot = timeMetaContainer.querySelector('.progress-dot') as HTMLElement;
            
            if (estimateEl && updatedTask.timeEstimate) {
                estimateEl.textContent = this.plugin.formatTime(updatedTask.timeEstimate);
            }
            
            if (spentEl && timeSpent > 0) {
                spentEl.textContent = this.plugin.formatTime(timeSpent);
            }
            
            if (progressDot && updatedTask.timeEstimate && timeSpent > 0) {
                const progress = Math.min((timeSpent / updatedTask.timeEstimate) * 100, 100);
                progressDot.className = `progress-dot ${progress > 100 ? 'over-estimate' : progress >= 100 ? 'complete' : 'in-progress'}`;
                progressDot.setAttribute('title', `${Math.round(progress)}% complete`);
            }
        }
        
        // Update time tracking icon
        const timeIcon = taskElement.querySelector('.time-icon') as HTMLElement;
        if (timeIcon) {
            const activeSession = this.plugin.getActiveTimeSession(updatedTask);
            const isTracking = !!activeSession;
            
            timeIcon.className = `time-icon ${isTracking ? 'tracking' : 'idle'}`;
            timeIcon.textContent = isTracking ? '⏸' : '▶';
            timeIcon.setAttribute('aria-label', isTracking ? 'Stop time tracking' : 'Start time tracking');
            timeIcon.setAttribute('title', isTracking ? 'Stop time tracking' : 'Start time tracking');
        }
        
        // Update recurring task toggle button if it exists
        if (updatedTask.recurrence) {
            const toggleButton = taskElement.querySelector('.task-toggle-button') as HTMLButtonElement;
            if (toggleButton) {
                const effectiveStatus = getEffectiveTaskStatus(updatedTask, this.plugin.selectedDate);
                const isCompleted = this.plugin.statusManager.isCompletedStatus(effectiveStatus);
                
                // Update button class and text
                toggleButton.className = `task-toggle-button ${isCompleted ? 'mark-incomplete' : 'mark-complete'}`;
                toggleButton.textContent = isCompleted ? 'Mark incomplete' : 'Mark complete';
                toggleButton.setAttribute('aria-label', `${isCompleted ? 'Mark task incomplete' : 'Mark task complete'} for ${format(this.plugin.selectedDate, 'MMMM d, yyyy')}`);
                toggleButton.setAttribute('aria-pressed', isCompleted.toString());
            }
        }
        
        // Update main task item classes
        const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
        const isDueOnSelectedDate = selectedDateStr && (
            updatedTask.due === selectedDateStr || 
            (updatedTask.recurrence && isRecurringTaskDueOn(updatedTask, this.plugin.selectedDate))
        );
        
        const priorityClass = this.getSafeCSSClass('priority', updatedTask.priority);
        taskElement.className = `task-item ${priorityClass} ${isDueOnSelectedDate ? 'task-due-today' : ''} ${updatedTask.archived ? 'task-archived' : ''} ${updatedTask.recurrence ? 'task-recurring' : ''} tasknotes-card`;
        
            // Add visual feedback for the update
            taskElement.classList.add('task-updated');
            setTimeout(() => {
                taskElement.classList.remove('task-updated');
            }, 1500);
            
            // Animate the update
            this.plugin.domReconciler.animateUpdate(taskElement, 'flash');
        });
    }
    
    /**
     * Update a task in the cached tasks array
     */
    private updateTaskInCache(taskPath: string, updatedTask: TaskInfo): void {
        if (!this.cachedTasks || !taskPath || !updatedTask) {
            console.error('updateTaskInCache called with invalid data:', { taskPath, updatedTask, hasCachedTasks: !!this.cachedTasks });
            return;
        }
        
        const index = this.cachedTasks.findIndex(t => t && t.path === taskPath);
        if (index !== -1) {
            this.cachedTasks[index] = updatedTask;
        }
    }
    
    /**
     * Get current task from cache
     */
    private getTaskFromCache(taskPath: string): TaskInfo | undefined {
        if (!this.cachedTasks || !taskPath) return undefined;
        return this.cachedTasks.find(t => t && t.path === taskPath);
    }
    
    /**
     * Sort and group tasks according to current settings
     */
    private getSortedAndGroupedTasks(tasks: TaskInfo[]): Map<string, TaskInfo[]> {
        // First, sort the tasks
        const sortedTasks = [...tasks].sort((a, b) => {
            switch (this.sortKey) {
                case 'priority':
                    return this.plugin.priorityManager.comparePriorities(a.priority, b.priority);
                
                case 'title':
                    return a.title.localeCompare(b.title);
                
                case 'due':
                default:
                    // Handle due dates
                    const aDate = a.due ? new Date(a.due) : new Date('9999-12-31');
                    const bDate = b.due ? new Date(b.due) : new Date('9999-12-31');
                    return aDate.getTime() - bDate.getTime();
            }
        });
        
        // Then, group the sorted tasks
        if (this.groupKey === 'none') {
            // Special handling for "None" grouping - create groups for recurring and due today
            const grouped = new Map<string, TaskInfo[]>();
            const selectedDateStr = format(this.plugin.selectedDate, 'yyyy-MM-dd');
            
            const recurringTasks: TaskInfo[] = [];
            const dueTodayTasks: TaskInfo[] = [];
            const otherTasks: TaskInfo[] = [];
            
            sortedTasks.forEach(task => {
                if (task.recurrence) {
                    recurringTasks.push(task);
                } else if (task.due === selectedDateStr) {
                    dueTodayTasks.push(task);
                } else {
                    otherTasks.push(task);
                }
            });
            
            // Add groups in order they should appear
            if (recurringTasks.length > 0) {
                grouped.set('Recurring tasks', recurringTasks);
            }
            if (dueTodayTasks.length > 0) {
                grouped.set('Due today', dueTodayTasks);
            }
            if (otherTasks.length > 0) {
                grouped.set('Other tasks', otherTasks);
            }
            
            return grouped;
        }
        
        const grouped = new Map<string, TaskInfo[]>();
        
        sortedTasks.forEach(task => {
            let groupKey: string;
            
            switch (this.groupKey) {
                case 'priority':
                    groupKey = task.priority || 'normal';
                    break;
                
                case 'context':
                    if (task.contexts && task.contexts.length > 0) {
                        // Ensure contexts is an array
                        const contextsArray = Array.isArray(task.contexts) ? task.contexts : [task.contexts];
                        // For tasks with multiple contexts, create separate entries
                        contextsArray.forEach(context => {
                            if (typeof context === 'string') {
                                const contextKey = context.trim();
                                if (!grouped.has(contextKey)) {
                                    grouped.set(contextKey, []);
                                }
                                grouped.get(contextKey)!.push(task);
                            }
                        });
                        return; // Skip the default grouping below
                    } else {
                        groupKey = 'No context';
                    }
                    break;
                
                case 'due':
                    if (task.due) {
                        const dueDate = new Date(task.due);
                        const today = new Date();
                        const tomorrow = new Date(today);
                        tomorrow.setDate(today.getDate() + 1);
                        
                        if (dueDate < today) {
                            groupKey = 'Overdue';
                        } else if (dueDate.toDateString() === today.toDateString()) {
                            groupKey = 'Today';
                        } else if (dueDate.toDateString() === tomorrow.toDateString()) {
                            groupKey = 'Tomorrow';
                        } else {
                            groupKey = 'Later';
                        }
                    } else {
                        groupKey = 'No due date';
                    }
                    break;
                
                case 'status':
                    groupKey = task.status || 'open';
                    break;
                
                default:
                    groupKey = 'all';
                    break;
            }
            
            if (!grouped.has(groupKey)) {
                grouped.set(groupKey, []);
            }
            grouped.get(groupKey)!.push(task);
        });
        
        return grouped;
    }
    
    /**
     * Apply status, context, sorting, and grouping filters to the task list
     */
    private async applyFilters(taskListContainer: HTMLElement, statusSelect: HTMLSelectElement): Promise<void> {
        const selectedStatus = statusSelect.value;
        const allTasks = await this.getTasksForView(true); // Force refresh to get latest data

        // Get the current archive tag from field mapping
        const archiveTag = this.plugin.fieldMapper.getMapping().archiveTag;

        // Helper function to determine if a task is archived
        const isTaskArchived = (task: TaskInfo): boolean => {
            // Check the archived property first
            if (task.archived === true) {
                return true;
            }
            
            // Also check if the archive tag is present in the tags array (redundant check for robustness)
            if (task.tags && Array.isArray(task.tags) && task.tags.includes(archiveTag)) {
                return true;
            }
            
            return false;
        };

        // Apply status filtering logic
        let filteredTasks: TaskInfo[] = [];
        
        if (selectedStatus === 'archived') {
            // Show only archived tasks
            filteredTasks = allTasks.filter(task => isTaskArchived(task));
        } else {
            // For other statuses, exclude archived tasks unless specifically requested
            const nonArchivedTasks = allTasks.filter(task => !isTaskArchived(task));
            
            if (selectedStatus === 'all') {
                filteredTasks = nonArchivedTasks;
            } else if (selectedStatus === 'open') {
                // Show all non-completed tasks
                filteredTasks = nonArchivedTasks.filter(task => 
                    !this.plugin.statusManager.isCompletedStatus(task.status)
                );
            } else {
                // Show tasks with specific status value
                filteredTasks = nonArchivedTasks.filter(task => 
                    task.status === selectedStatus
                );
            }
        }
        
        // Apply context filtering
        if (this.selectedContexts.size > 0) {
            filteredTasks = filteredTasks.filter(task => {
                if (!task.contexts || task.contexts.length === 0) {
                    return false; // Task has no contexts, exclude it
                }
                
                // Ensure contexts is an array
                const contextsArray = Array.isArray(task.contexts) ? task.contexts : [task.contexts];
                
                // Check if task has any of the selected contexts
                return contextsArray.some(context => 
                    typeof context === 'string' && this.selectedContexts.has(context.trim())
                );
            });
        }
        
        // Apply sorting and grouping
        const groupedTasks = this.getSortedAndGroupedTasks(filteredTasks);
        
        // Refresh the task list
        this.renderTaskItems(taskListContainer, groupedTasks);
    }
    
    openTask(path: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file);
        }
    }
}