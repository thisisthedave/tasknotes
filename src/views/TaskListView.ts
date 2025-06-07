import { Notice, TFile, ItemView, WorkspaceLeaf } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    TASK_LIST_VIEW_TYPE, 
    TaskInfo, 
    EVENT_DATE_SELECTED,
    EVENT_DATA_CHANGED,
    EVENT_TASK_UPDATED,
    FilterQuery
} from '../types';
import { 
    isTaskOverdue,
    isRecurringTaskDueOn,
    getEffectiveTaskStatus,
    calculateTotalTimeSpent
} from '../utils/helpers';
import { perfMonitor } from '../utils/PerformanceMonitor';
import { createTaskCard, updateTaskCard } from '../ui/TaskCard';
import { FilterBar } from '../ui/FilterBar';

export class TaskListView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // UI elements
    private taskListContainer: HTMLElement | null = null;
    private loadingIndicator: HTMLElement | null = null;
    
    // Removed redundant local caching - CacheManager is the single source of truth
    
    // Loading states
    private isTasksLoading: boolean = false;
    
    // Filter system
    private filterBar: FilterBar | null = null;
    private currentQuery: FilterQuery;
    
    // Task item tracking for dynamic updates
    private taskElements: Map<string, HTMLElement> = new Map();
    
    // Event listeners
    private listeners: (() => void)[] = [];
    
    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Initialize with saved state or default query
        const savedQuery = this.plugin.viewStateManager?.getFilterState(TASK_LIST_VIEW_TYPE);
        this.currentQuery = savedQuery || this.plugin.filterService?.createDefaultQuery() || {
            searchQuery: undefined,
            status: 'all',
            contexts: undefined,
            priorities: undefined,
            dateRange: undefined,
            showArchived: false,
            sortKey: 'due',
            sortDirection: 'asc',
            groupKey: 'none'
        };
        
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
        
        // Listen for date selection changes - refresh when date changes
        const dateListener = this.plugin.emitter.on(EVENT_DATE_SELECTED, () => {
            this.refresh(true); // Force refresh on date change
        });
        this.listeners.push(dateListener);
        
        // Listen for data changes
        const dataListener = this.plugin.emitter.on(EVENT_DATA_CHANGED, () => {
            this.refresh();
        });
        this.listeners.push(dataListener);
        
        // Listen for individual task updates
        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, async ({ path, originalTask, updatedTask }) => {
            if (!path || !updatedTask) {
                console.error('EVENT_TASK_UPDATED received invalid data:', { path, originalTask, updatedTask });
                return;
            }
            
            // Update the data in the cache manager
            await this.updateTaskInCache(path, updatedTask);
            // Refresh the view with current filters
            await this.refreshTasks();
        });
        this.listeners.push(taskUpdateListener);
        
        // Listen for filter service data changes
        const filterDataListener = this.plugin.filterService.on('data-changed', () => {
            this.refreshTasks();
        });
        this.listeners.push(filterDataListener);
    }
    
    async onOpen() {
        await this.refresh();
    }
    
    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        
        // Clean up FilterBar
        if (this.filterBar) {
            this.filterBar.destroy();
            this.filterBar = null;
        }
        
        this.contentEl.empty();
    }
    
    async refresh(forceFullRefresh: boolean = false) {
        return perfMonitor.measure('task-list-refresh', async () => {
            // If forcing a full refresh, clear the task elements tracking
            if (forceFullRefresh) {
                this.taskElements.clear();
            }
            
            
            // Save UI state before full refresh
            const taskListContainer = this.contentEl.querySelector('.task-list') as HTMLElement;
            if (taskListContainer) {
                this.plugin.uiStateManager.saveState('task-list-scroll', taskListContainer);
            }
            
            // Clear and prepare the content element for full refresh
            this.contentEl.empty();
            this.taskElements.clear();
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
        // Create FilterBar container
        const filterBarContainer = container.createDiv({ cls: 'filter-bar-container' });
        
        // Get filter options from FilterService
        const filterOptions = await this.plugin.filterService.getFilterOptions();
        
        // Create FilterBar with TaskListView configuration
        this.filterBar = new FilterBar(
            filterBarContainer,
            this.currentQuery,
            filterOptions,
            {
                showSearch: true,
                showGroupBy: true,
                showSortBy: true,
                showAdvancedFilters: true,
                allowedSortKeys: ['due', 'priority', 'title'],
                allowedGroupKeys: ['none', 'status', 'priority', 'context', 'due']
            }
        );
        
        // Listen for filter changes
        this.filterBar.on('queryChange', (newQuery: FilterQuery) => {
            this.currentQuery = newQuery;
            // Save the filter state
            this.plugin.viewStateManager.setFilterState(TASK_LIST_VIEW_TYPE, newQuery);
            this.refreshTasks();
        });
        
        // Add refresh button
        const actionsContainer = container.createDiv({ cls: 'task-list-actions' });
        const refreshButton = actionsContainer.createEl('button', { 
            text: 'Refresh', 
            cls: 'refresh-tasks-button tasknotes-button tasknotes-button-secondary',
            attr: {
                'aria-label': 'Refresh task list',
                'title': 'Refresh task list'
            }
        });
        
        
        refreshButton.addEventListener('click', async () => {
            // Prevent double-clicks during refresh
            if (refreshButton.classList.contains('is-loading')) return;
            
            refreshButton.classList.add('is-loading');
            refreshButton.disabled = true;
            const originalText = refreshButton.textContent;
            refreshButton.textContent = 'Refreshing...';
            
            try {
                // Force refresh the cache and update UI
                await this.refresh(true);
            } finally {
                refreshButton.classList.remove('is-loading');
                refreshButton.disabled = false;
                refreshButton.textContent = originalText;
            }
        });
        
        // Task list container
        const taskList = container.createDiv({ cls: 'task-list' });
        
        // Add loading indicator
        this.loadingIndicator = taskList.createDiv({ cls: 'loading-indicator' });
        this.loadingIndicator.createDiv({ cls: 'loading-spinner' });
        this.loadingIndicator.createDiv({ cls: 'loading-text', text: 'Loading tasks...' });
        this.loadingIndicator.addClass('is-hidden');
        
        // Store reference to the task list container for future updates
        this.taskListContainer = taskList;
        
        // Show loading state if we're fetching data
        this.isTasksLoading = true;
        this.updateLoadingState();
        
        // Initial load with current query
        await this.refreshTasks();
        
        // Hide loading state when done
        this.isTasksLoading = false;
        this.updateLoadingState();
    }
    
    /**
     * Refresh tasks using FilterService
     */
    private async refreshTasks(): Promise<void> {
        if (!this.taskListContainer) return;
        
        try {
            this.isTasksLoading = true;
            this.updateLoadingState();
            
            // Get grouped tasks from FilterService
            const groupedTasks = await this.plugin.filterService.getGroupedTasks(this.currentQuery);
            
            // Render the grouped tasks
            this.renderTaskItems(this.taskListContainer, groupedTasks);
            
        } catch (error) {
            console.error('Error refreshing tasks:', error);
            this.taskListContainer.createEl('p', { 
                text: 'Error loading tasks. Please try refreshing.', 
                cls: 'error-message' 
            });
        } finally {
            this.isTasksLoading = false;
            this.updateLoadingState();
        }
    }

    // Helper method to render task items with grouping support using DOMReconciler
    renderTaskItems(container: HTMLElement, groupedTasks: Map<string, TaskInfo[]>) {
        // Check if there are any tasks across all groups
        const totalTasks = Array.from(groupedTasks.values()).reduce((total, tasks) => total + tasks.length, 0);
        
        if (totalTasks === 0) {
            // Clear everything and show placeholder
            container.empty();
            this.taskElements.clear();
            container.createEl('p', { text: 'No tasks found for the selected filters.' });
            return;
        }
        
        // Handle grouped vs non-grouped rendering differently
        if (this.currentQuery.groupKey === 'none' && groupedTasks.has('all')) {
            // Non-grouped: use DOMReconciler for the flat task list
            const allTasks = groupedTasks.get('all') || [];
            this.renderTaskListWithReconciler(container, allTasks);
        } else {
            // Grouped: render groups normally (groups change less frequently than individual tasks)
            this.renderGroupedTasksWithReconciler(container, groupedTasks);
        }
    }

    /**
     * Render a flat task list using DOMReconciler for optimal performance
     */
    private renderTaskListWithReconciler(container: HTMLElement, tasks: TaskInfo[]) {
        this.plugin.domReconciler.updateList<TaskInfo>(
            container,
            tasks,
            (task) => task.path, // Unique key
            (task) => this.createTaskCardForReconciler(task), // Render new item
            (element, task) => this.updateTaskCardForReconciler(element, task) // Update existing item
        );
        
        // Update task elements tracking
        this.taskElements.clear();
        Array.from(container.children).forEach(child => {
            const taskPath = (child as HTMLElement).dataset.key;
            if (taskPath) {
                this.taskElements.set(taskPath, child as HTMLElement);
            }
        });
    }

    /**
     * Render grouped tasks with reconciler optimization for individual groups
     */
    private renderGroupedTasksWithReconciler(container: HTMLElement, groupedTasks: Map<string, TaskInfo[]>) {
        // Save scroll position
        const scrollTop = container.scrollTop;
        
        // Clear container but preserve structure for groups that haven't changed
        const existingGroups = new Map<string, HTMLElement>();
        Array.from(container.children).forEach(child => {
            const groupKey = (child as HTMLElement).dataset.group;
            if (groupKey) {
                existingGroups.set(groupKey, child as HTMLElement);
            }
        });
        
        // Clear container
        container.empty();
        this.taskElements.clear();
        
        // Render each group
        groupedTasks.forEach((tasks, groupName) => {
            if (tasks.length === 0) return;
            
            // Create group section
            const groupSection = container.createDiv({ cls: 'task-section task-group' });
            groupSection.setAttribute('data-group', groupName);
            
            // Add group header (skip only if grouping is 'none' and group name is 'all')
            if (!(this.currentQuery.groupKey === 'none' && groupName === 'all')) {
                const groupHeader = groupSection.createEl('h4', { 
                    cls: 'task-group-header',
                    text: this.formatGroupName(groupName)
                });
            }
            
            // Create task cards container
            const taskCardsContainer = groupSection.createDiv({ cls: 'tasks-container task-cards' });
            
            // Use reconciler for this group's task list
            this.plugin.domReconciler.updateList<TaskInfo>(
                taskCardsContainer,
                tasks,
                (task) => task.path, // Unique key
                (task) => this.createTaskCardForReconciler(task), // Render new item
                (element, task) => this.updateTaskCardForReconciler(element, task) // Update existing item
            );
            
            // Update task elements tracking for this group
            Array.from(taskCardsContainer.children).forEach(child => {
                const taskPath = (child as HTMLElement).dataset.key;
                if (taskPath) {
                    this.taskElements.set(taskPath, child as HTMLElement);
                }
            });
        });
        
        // Restore scroll position
        container.scrollTop = scrollTop;
    }

    /**
     * Create a task card for use with DOMReconciler
     */
    private createTaskCardForReconciler(task: TaskInfo): HTMLElement {
        const taskCard = createTaskCard(task, this.plugin, {
            showDueDate: true,
            showCheckbox: false, // TaskListView doesn't use checkboxes 
            showArchiveButton: true,
            showTimeTracking: true,
            showRecurringControls: true,
            groupByDate: false,
            targetDate: this.plugin.selectedDate
        });
        
        // Ensure the key is set for reconciler
        taskCard.dataset.key = task.path;
        
        return taskCard;
    }

    /**
     * Update an existing task card for use with DOMReconciler
     */
    private updateTaskCardForReconciler(element: HTMLElement, task: TaskInfo): void {
        updateTaskCard(element, task, this.plugin, {
            showDueDate: true,
            showCheckbox: false, // TaskListView doesn't use checkboxes
            showArchiveButton: true,
            showTimeTracking: true,
            showRecurringControls: true,
            groupByDate: false,
            targetDate: this.plugin.selectedDate
        });
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
    
            
    
    
    
    
    
    
    /**
     * Update a specific task element in the DOM without full re-render
     */
    private updateTaskElementInDOM(taskPath: string, updatedTask: TaskInfo): void {
        const taskElement = this.taskElements.get(taskPath);
        if (!taskElement) {
            // Task not currently in view, a refresh might be needed if it now matches filters
            this.debounceRefresh();
            return;
        }
        
        // Check if the task's group or visibility has changed
        if (this.hasTaskMovedGroups(taskElement, updatedTask)) {
            // Task has moved to a new group or changed visibility, trigger full refresh
            this.debounceRefresh();
            return;
        }
        
        try {
            // Use the unified TaskCard update logic
            updateTaskCard(taskElement, updatedTask, this.plugin, {
                showDueDate: true,
                showCheckbox: false, // TaskListView doesn't use checkboxes
                showArchiveButton: true,
                showTimeTracking: true,
                showRecurringControls: true,
                groupByDate: false,
                targetDate: this.plugin.selectedDate
            });
        } catch (error) {
            console.error(`TaskListView: Error updating DOM for task ${taskPath}:`, error);
            // If update fails, trigger a full refresh to recover
            this.refresh();
        }
    }

    // Debounced refresh to avoid multiple rapid refreshes
    private refreshTimeout: NodeJS.Timeout | null = null;
    private debounceRefresh() {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this.refresh();
            this.refreshTimeout = null;
        }, 150);
    }

    /**
     * Check if a task has moved to a different group or changed visibility
     */
    private hasTaskMovedGroups(taskElement: HTMLElement, updatedTask: TaskInfo): boolean {
        // Get current group from DOM structure
        const currentGroup = taskElement.closest('.task-group');
        if (!currentGroup) return false;
        
        const currentGroupKey = currentGroup.getAttribute('data-group');
        if (!currentGroupKey) return false;

        // Determine what group this task should belong to now
        const newGroupKey = this.getTaskGroupKey(updatedTask);
        
        return currentGroupKey !== newGroupKey;
    }
    
    /**
     * Get the group key for a task based on current grouping
     */
    private getTaskGroupKey(task: TaskInfo): string {
        switch (this.currentQuery.groupKey) {
            case 'status':
                return task.status;
            case 'priority':
                return task.priority;
            case 'context':
                const contexts = task.contexts || [];
                return contexts.length > 0 ? contexts[0] : 'No Context';
            case 'due':
                return task.due || 'No Due Date';
            default:
                return 'All';
        }
    }
    
    
    /**
     * Update a task in the cache manager
     */
    private async updateTaskInCache(taskPath: string, updatedTask: TaskInfo): Promise<void> {
        if (!taskPath || !updatedTask) {
            console.error('updateTaskInCache called with invalid data:', { taskPath, updatedTask });
            return;
        }
        
        // Update the task directly in CacheManager - it will handle the cache update
        await this.plugin.cacheManager.updateTaskInfoInCache(taskPath, updatedTask);
    }
    
    /**
     * Get current task from cache
     */
    private async getTaskFromCache(taskPath: string): Promise<TaskInfo | null> {
        if (!taskPath) return null;
        // Get task directly from CacheManager
        return this.plugin.cacheManager.getTaskInfo(taskPath, false);
    }
    
    
    openTask(path: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file);
        }
    }
}