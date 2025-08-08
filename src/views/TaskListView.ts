import { TFile, ItemView, WorkspaceLeaf, EventRef, Notice, debounce } from 'obsidian';
import TaskNotesPlugin from '../main';
import { 
    TASK_LIST_VIEW_TYPE, 
    TaskInfo, 
    EVENT_DATA_CHANGED,
    EVENT_TASK_UPDATED,
    FilterQuery,
    SavedView
} from '../types';
// No helper functions needed from helpers
import { perfMonitor } from '../utils/PerformanceMonitor';
import { 
    createTaskCard,
    updateTaskCard,
    toggleTaskCardSelection,
    setTaskCardSelected,
    isTaskCardSelected,
    showDateContextMenu,
    showPriorityContextMenu,
    showRecurrenceContextMenu,
    showStatusContextMenu,
    showDeleteConfirmationModal,
    copyTaskTitleToClipboard,
    showProjectModal,
    showPointsModal,
    showTagsModal,
    showContextModal
} from '../ui/TaskCard';
import { FilterBar } from '../ui/FilterBar';
import { DragDropHandler } from 'src/ui/DragDropHandler';
import { getTopmostVisibleElement } from 'src/utils/helpers';

export class TaskListView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // UI elements
    private taskListContainer: HTMLElement | null = null;
    private loadingIndicator: HTMLElement | null = null;
    private dragDropHandler: DragDropHandler;
    
    // Removed redundant local caching - CacheManager is the single source of truth
    
    // Loading states
    private isTasksLoading = false;
    
    // Filter system
    private filterBar: FilterBar | null = null;
    private currentQuery: FilterQuery;
    
    // Task item tracking for dynamic updates
    private taskElements: HTMLElement[] = [];
    private focusTaskElementIndex: number = -1; // Track focused task for keyboard navigation
    
    // Event listeners
    private listeners: EventRef[] = [];
    private functionListeners: (() => void)[] = [];
    
    // Debounce timer for refreshTasks
    private refreshTasksDebounceTimer: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Initialize with default query - will be properly set when plugin services are ready
        this.currentQuery = {
            type: 'group',
            id: 'temp',
            conjunction: 'and',
            children: [],
            sortKey: 'due',
            sortDirection: 'asc',
            groupKey: 'none'
        };

        // Initialize drag and drop handler
        this.dragDropHandler = new DragDropHandler(async (fromIndex, toIndex, draggedElement, placeholder) => {
            if (fromIndex != toIndex) {
                // Clamp to array bounds
                const start = Math.max(0, fromIndex > toIndex ? toIndex - 1 : fromIndex - 1);
                const end = Math.min(this.taskElements.length, fromIndex > toIndex ? fromIndex + 2 : toIndex + 2); // +2 because end is exclusive for slice

                const affectedTaskElements = this.taskElements.slice(start, end); // returns a copy
                if (affectedTaskElements.length > 0) {
                    const tasks = await Promise.all(
                        affectedTaskElements.map(child => this.plugin.cacheManager.getTaskInfo((child as HTMLElement).dataset.key!))
                    );
                    console.log(`Reordering tasks from ${fromIndex} to ${toIndex}. Loaded ${tasks.length} tasks with offset ${start}`);
                    plugin.reorderTasks(tasks as TaskInfo[], fromIndex - start, toIndex - start); // offset indices by the array slice
                }
            }

            // Update the value of the grouping field if the task was moved, e.g. from "In Progress" to "Done"
            if (this.currentQuery.groupKey) {
                let fromGroup = this.findTaskElementGroup(draggedElement);
                let toGroup = this.findTaskElementGroup(placeholder);
                this.moveBetweenGroups(draggedElement.dataset.key!, fromGroup, toGroup);
            }
        });

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
        this.listeners.forEach(listener => this.plugin.emitter.offref(listener));
        this.listeners = [];
        this.functionListeners.forEach(unsubscribe => unsubscribe());
        this.functionListeners = [];
        
        // Listen for data changes
        const dataListener = this.plugin.emitter.on(EVENT_DATA_CHANGED, async () => {
            this.refresh();
            // Update FilterBar options when data changes (new properties, contexts, etc.)
            if (this.filterBar) {
                const updatedFilterOptions = await this.plugin.filterService.getFilterOptions();
                this.filterBar.updateFilterOptions(updatedFilterOptions);
            }
        });
        this.listeners.push(dataListener);
        
        // Listen for individual task updates
        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, async ({ path, originalTask, updatedTask }) => {
            if (!path || !updatedTask) {
                console.error('EVENT_TASK_UPDATED received invalid data:', { path, originalTask, updatedTask });
                return;
            }
            
            // Check if this task is currently visible in our view
            const taskElements = this.taskElements.filter(element => element.dataset.key === path);
            if (taskElements.length > 0) {
                // Task is visible - update it in place using TaskCard's update function
                for (const taskElement of taskElements) {
                    try {
                        updateTaskCard(taskElement, updatedTask, this.plugin, {
                            showDueDate: true,
                            showCheckbox: false,
                            showArchiveButton: true,
                            showTimeTracking: true,
                            showRecurringControls: true,
                            groupByDate: false
                        });
                        
                        // Add update animation for real user updates
                        taskElement.classList.add('task-updated');
                        setTimeout(() => {
                            taskElement.classList.remove('task-updated');
                        }, 1000);
                    } catch (error) {
                        console.error('Error updating task card:', error);
                        // Fallback to refresh if update fails
                        this.debouncedRefreshTasks();
                    }
                }
            } else {
                // Task not currently visible - it might now match our filters, so refresh
                this.debouncedRefreshTasks();
            }
            
            // Update FilterBar options when tasks are updated (may have new properties, contexts, etc.)
            if (this.filterBar) {
                const updatedFilterOptions = await this.plugin.filterService.getFilterOptions();
                this.filterBar.updateFilterOptions(updatedFilterOptions);
            }
        });
        this.listeners.push(taskUpdateListener);
        
        // Listen for filter service data changes
        const filterDataListener = this.plugin.filterService.on('data-changed', () => {
            this.refreshTasks();
        });
        this.functionListeners.push(filterDataListener);
    }
    
    async onOpen() {
        try {
            // Wait for the plugin to be fully initialized before proceeding
            await this.plugin.onReady();
            
            // Wait for migration to complete before initializing UI
            await this.plugin.waitForMigration();
            
            // Initialize with default query from FilterService
            this.currentQuery = this.plugin.filterService.createDefaultQuery();
            
            // Load saved filter state if it exists (will be empty after migration)
            const savedQuery = this.plugin.viewStateManager.getFilterState(TASK_LIST_VIEW_TYPE);
            if (savedQuery) {
                this.currentQuery = savedQuery;
            }

            // Add keyboard navigation.
            this.addKeyboardHandlers();

            await this.refresh();
        } catch (error) {
            console.error('TaskListView: Error during onOpen:', error);
            // Fall back to the old polling approach if onReady fails
            this.fallbackToPolling();
        }
    }

    private async fallbackToPolling() {
        // Show loading state
        this.contentEl.empty();
        const loadingEl = this.contentEl.createDiv({ cls: 'task-list-view__loading' });
        loadingEl.createSpan({ text: 'Initializing...' });
        
        // Poll for cache to be ready (with timeout)
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max
        const checkReady = async () => {
            attempts++;
            if (this.plugin.cacheManager && this.plugin.cacheManager.isInitialized()) {
                await this.refresh();
            } else if (attempts < maxAttempts) {
                setTimeout(checkReady, 100);
            } else {
                // Timeout - try to refresh anyway
                console.warn('TaskListView: Cache initialization timeout, attempting to load anyway');
                await this.refresh();
            }
        };
        checkReady();
    }
    
    async onClose() {
        // Remove event listeners
        this.listeners.forEach(listener => this.plugin.emitter.offref(listener));
        this.functionListeners.forEach(unsubscribe => unsubscribe());
        
        // Clean up FilterBar
        if (this.filterBar) {
            this.filterBar.destroy();
            this.filterBar = null;
        }
        
        this.contentEl.empty();
    }
    
    async refresh(forceFullRefresh = false) {
        return perfMonitor.measure('task-list-refresh', async () => {
            // Clear and prepare the content element for full refresh
            this.contentEl.empty();
            this.taskElements = [];
            await this.render();
        });
    }
    
    
    async render() {
        const container = this.contentEl.createDiv({ cls: 'tasknotes-plugin tasknotes-container task-list-view-container' });
        
        // Create header with current date information
        this.createHeader(container);
        
        // Create task list content
        await this.createTasksContent(container);
    }
    
    createHeader(container: HTMLElement) {
        container.createDiv({ cls: 'detail-view-header task-list-header' });
        
        // // Display view title
        // headerContainer.createEl('h2', {
        //     text: 'All tasks',
        //     cls: 'task-list-view__title'
        // });
        
        // Actions container removed - no buttons needed
    }
    
    async createTasksContent(container: HTMLElement) {
        // Create FilterBar container
        const filterBarContainer = container.createDiv({ cls: 'filter-bar-container' });
        
        // Wait for cache to be initialized with actual data
        await this.waitForCacheReady();
        
        // Initialize with default query from FilterService
        this.currentQuery = this.plugin.filterService.createDefaultQuery();
        
        // Load saved filter state if it exists
        const savedQuery = this.plugin.viewStateManager.getFilterState(TASK_LIST_VIEW_TYPE);
        if (savedQuery) {
            this.currentQuery = savedQuery;
        }
        
        // Get filter options from FilterService
        const filterOptions = await this.plugin.filterService.getFilterOptions();
        
        // Create new FilterBar with simplified constructor
        this.filterBar = new FilterBar(
            this.app,
            filterBarContainer,
            this.currentQuery,
            filterOptions
        );
        
        // Get saved views for the FilterBar
        const savedViews = this.plugin.viewStateManager.getSavedViews();
        this.filterBar.updateSavedViews(savedViews);
        
        // Listen for saved view events
        this.filterBar.on('saveView', ({ name, query, viewOptions }) => {
            console.log('TaskListView: Received saveView event:', name, query, viewOptions); // Debug
            const savedView = this.plugin.viewStateManager.saveView(name, query, viewOptions);
            console.log('TaskListView: Saved view result:', savedView); // Debug
            // Don't update here - the ViewStateManager event will handle it
        });
        
        this.filterBar.on('deleteView', (viewId: string) => {
            console.log('TaskListView: Received deleteView event:', viewId); // Debug
            this.plugin.viewStateManager.deleteView(viewId);
            // Don't update here - the ViewStateManager event will handle it
        });

        // Listen for global saved views changes
        this.plugin.viewStateManager.on('saved-views-changed', (updatedViews: readonly SavedView[]) => {
            console.log('TaskListView: Received saved-views-changed event:', updatedViews); // Debug
            this.filterBar?.updateSavedViews(updatedViews);
        });
        
        this.filterBar.on('reorderViews', (fromIndex: number, toIndex: number) => {
            this.plugin.viewStateManager.reorderSavedViews(fromIndex, toIndex);
        });
        
        // Listen for filter changes
        this.filterBar.on('queryChange', async (newQuery: FilterQuery) => {
            this.currentQuery = newQuery;
            // Save the filter state
            this.plugin.viewStateManager.setFilterState(TASK_LIST_VIEW_TYPE, newQuery);
            await this.refreshTasks();
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
     * Get all TaskInfo objects for selected task elements
     */
    async getSelectedTasks(): Promise<TaskInfo[]> {
        const selectedTaskPaths: string[] = this.getSelectedTaskElements().map(element => element.dataset.key!);
        const selected: TaskInfo[] = [];
        for (const taskPath of new Set(selectedTaskPaths)) {
            const info = await this.plugin.cacheManager.getTaskInfo(taskPath);
            if (info) selected.push(info);
        }
        return selected;
    }

    /**
     * Get the TaskCard div elements for all task elements that are selected.
     * @returns An array of selected task elements.
     */
    getSelectedTaskElements(): HTMLElement[] {
        return this.taskElements.filter(element => isTaskCardSelected(element));
    }

    /**
     * Get the topmost visible task element that is used for the placement of context menus.
     * @returns The topmost visible task element that should be used for context menus.
     */
    getContextShowAtElement(): HTMLElement {
        var elements = this.getSelectedTaskElements();
        if (elements.length === 0) {
            const focusElement = this.getFocusedTaskElement();
            elements = focusElement ? [focusElement] : this.taskElements;
        }
        const topmost = getTopmostVisibleElement(elements);
        return topmost || this.contentEl; // Fallback to container if no visible element found
    }

    /**
     * Helper to gather selected tasks, or fall back to the focused task.
     * Calls the provided handler with the resulting array if any are found.
     */
    private async withSelectedOrFocusedTasks(
        handler: (tasks: TaskInfo[]) => void | Promise<void>
    ): Promise<void> {
        const selectedTasks = await this.getSelectedTasks();
        if (selectedTasks.length > 0) {
            await handler(selectedTasks);
            return;
        }
        
        const focusedElement = this.getFocusedTaskElement();
        if (focusedElement && focusedElement.dataset.key) {
            const taskInfo = await this.plugin.cacheManager.getTaskInfo(focusedElement.dataset.key!);
            if (taskInfo) {
                await handler([taskInfo]);
            }
        }
    }

    async editDueDates() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showDateContextMenu(this.plugin, tasks, "due", this.getContextShowAtElement());
        });
    }

    async editScheduleDates() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showDateContextMenu(this.plugin, tasks, "scheduled", this.getContextShowAtElement());
        });
    }

    async editPoints() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showPointsModal(this.plugin, tasks);
        });
    }

    async editTags() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showTagsModal(this.plugin, tasks);
        });
    }

    async editProjects() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showProjectModal(this.plugin, tasks);
        });
    }

    async editContexts() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showContextModal(this.plugin, tasks);
        });
    }

    async editPriorities() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showPriorityContextMenu(this.plugin, tasks, this.getContextShowAtElement());
        });
    }

    async editRecurrence() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showRecurrenceContextMenu(this.plugin, tasks, this.getContextShowAtElement());
        });
    }

    async editStatuses() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showStatusContextMenu(this.plugin, tasks, this.getContextShowAtElement());
        });
    }

    async moveBetweenGroups(taskPath: string, fromGroup: string | null, toGroup: string | null) {
        const movedTask = await this.plugin.cacheManager.getTaskInfo(taskPath);
        if (movedTask && fromGroup !== toGroup) {
            const [propertyKey, isArrayProperty] =
                this.currentQuery.groupKey == 'project' ? ['projects' as keyof TaskInfo, true] :
                this.currentQuery.groupKey == 'context' ? ['contexts' as keyof TaskInfo, true] :
                [this.currentQuery.groupKey as keyof TaskInfo, false]
            let newValue: string | string[] | null = toGroup;
            if (isArrayProperty) {
                const oldValue = (movedTask[propertyKey]! as string[])
                newValue = 
                    (toGroup !== null && fromGroup !== null && !oldValue.includes(toGroup)) ? oldValue.map(oldProject => oldProject == fromGroup ? toGroup : oldProject) : // swap projects
                    (toGroup !== null && !oldValue.includes(toGroup)) ? [...oldValue, toGroup] : // add new project
                    oldValue.filter(oldProject => oldProject != fromGroup) // remove old project
            }
            await this.plugin.updateTaskProperty(movedTask, propertyKey, newValue as TaskInfo[keyof TaskInfo]);
        }
    }

    async deleteTasks() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            showDeleteConfirmationModal(tasks, this.plugin);
        });
    }

    async toggleArchive() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            const firstValue = tasks[0]?.archived; // only toggle archive if the tasks already have the same archived state
            if (tasks.every(t => t.archived === firstValue)) {
                Promise.all(tasks.map(task => this.plugin.toggleTaskArchive(task)));
            }
        });
    }

    async copyTaskTitles() {
        await this.withSelectedOrFocusedTasks((tasks) => {
            copyTaskTitleToClipboard(tasks);
        });
    }

    private debouncedRefreshTasks = debounce(() => {
        this.refreshTasks();
    }, 100, true);

    /**
     * Refresh tasks using FilterService
     */
    private async refreshTasks(): Promise<void> {
        if (!this.taskListContainer) {
            return;
        }
        
        try {
            this.isTasksLoading = true;
            this.updateLoadingState();
            
            // Get grouped tasks from FilterService
            const groupedTasks = await this.plugin.filterService.getGroupedTasks(this.currentQuery);
            
            // Render the grouped tasks
            this.renderTaskItems(this.taskListContainer, groupedTasks);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('TaskListView: Error refreshing tasks:', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                query: this.currentQuery,
                cacheInitialized: this.plugin.cacheManager?.isInitialized() || false
            });
            
            // Clear existing content and show error message
            this.taskListContainer.empty();
            const errorContainer = this.taskListContainer.createDiv({ cls: 'error-container' });
            errorContainer.createEl('p', { 
                text: 'Error loading tasks. Please try refreshing.', 
                cls: 'error-message' 
            });
            
            // Add retry button for better UX
            const retryButton = errorContainer.createEl('button', {
                text: 'Retry',
                cls: 'mod-cta'
            });
            retryButton.addEventListener('click', () => {
                this.refreshTasks();
            });
        } finally {
            this.isTasksLoading = false;
            this.updateLoadingState();
        }
    }

    // Helper method to render task items with grouping support using DOMReconciler or Virtual Scrolling
    renderTaskItems(container: HTMLElement, groupedTasks: Map<string, TaskInfo[]>) {
        // Check if there are any tasks across all groups
        const totalTasks = Array.from(groupedTasks.values()).reduce((total, tasks) => total + tasks.length, 0);
        
        if (totalTasks === 0) {
            // Clear everything and show placeholder
            container.empty();
            this.taskElements = [];
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

        for (let i = 0; i < this.taskElements.length; i++) {
            // Add drag and drop event handlers
            this.dragDropHandler.setupDragAndDrop(this.taskElements[i], i);
        }

        // Add global handlers to ensure drop events work reliably
        this.dragDropHandler.setupGlobalHandlers(container, this.findAllTaskElements.bind(this));
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
        this.taskElements = [];
        Array.from(container.children).forEach(child => {
            const childElement = child as HTMLElement;
            const taskPath = childElement.dataset.key;
            if (taskPath) {
                this.taskElements.push(childElement);
            }
            childElement.addClass('filter-bar__view-item-container'); // TODO remove
        });
    }
    
    // Virtual scrolling methods removed for compliance verification

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
        this.taskElements = [];
        
        // Render each group
        groupedTasks.forEach((tasks, groupName) => {
            if (tasks.length === 0) return;
            
            // Create group section
            const groupSection = container.createDiv({ cls: 'task-section task-group' });
            groupSection.setAttribute('data-group', groupName);
            
            // Add group header (skip only if grouping is 'none' and group name is 'all')
            if (!(this.currentQuery.groupKey === 'none' && groupName === 'all')) {
                const headerElement = groupSection.createEl('h3', {
                    cls: 'task-group-header task-list-view__group-header'
                });
                
                // For project groups, make the header clickable if it's a wikilink project
                if (this.currentQuery.groupKey === 'project' && this.isWikilinkProject(groupName)) {
                    this.createClickableProjectHeader(headerElement, groupName);
                } else {
                    headerElement.textContent = this.formatGroupName(groupName);
                }
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
                const childElement = child as HTMLElement;
                const taskPath = childElement.dataset.key;
                if (taskPath) {
                    this.taskElements.push(childElement);
                }
                childElement.addClass('filter-bar__view-item-container'); // TODO remove
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
            showCheckbox: true,
            showArchiveButton: true,
            showTimeTracking: true,
            showRecurringControls: true,
            groupByDate: false,
            draggable: this.isViewDraggable()
        });
        
        // Ensure the key is set for reconciler
        taskCard.dataset.key = task.path;
        
        // Add focus handling
        this.addFocusHandler(taskCard, task);
        
        return taskCard;
    }

    /**
     * Update an existing task card for use with DOMReconciler
     */
    private updateTaskCardForReconciler(element: HTMLElement, task: TaskInfo): void {
        updateTaskCard(element, task, this.plugin, {
            showDueDate: true,
            showCheckbox: true,
            showArchiveButton: true,
            showTimeTracking: true,
            showRecurringControls: true,
            groupByDate: false,
            draggable: this.isViewDraggable()
        });
    }

    private findAllTaskElements(): HTMLElement[] {
        if (this.taskListContainer) {
            return Array.from(this.taskListContainer.querySelectorAll<HTMLElement>('.task-card'));
        }
        return [];
    }

    private findTaskElementGroup(taskElement: HTMLElement): string | null {
        const groupEl = taskElement.closest<HTMLElement>('.task-group');
        const groupKey = groupEl?.dataset.group; // returns string or undefined
        return groupKey && !this.plugin.filterService.isNullGroupKey(groupKey) ? groupKey : null;
    }

    private getFocusedTaskElement(): HTMLElement | null {
        if (0 <= this.focusTaskElementIndex && this.focusTaskElementIndex < this.taskElements.length) {
            return this.taskElements[this.focusTaskElementIndex];
        }
        return null;
    }

    private focusTaskElement(elementIndex: number): void {
        // Blur the previous focused element if it exists
        const prevFocusElement = this.getFocusedTaskElement();
        if (prevFocusElement) {
            prevFocusElement.blur();
        }

        this.focusTaskElementIndex = elementIndex;
        const focusedElement = this.getFocusedTaskElement();
        if (focusedElement) {
            focusedElement.focus();
        } else {
            this.focusTaskElementIndex = -1; // Reset if no valid element
        }
    }

    private addKeyboardHandlers(): void {
        this.registerDomEvent(document, 'keydown', async (event: KeyboardEvent) => {
            const shouldHandleInput = this.plugin.inputObserver.shouldHandleKeyboardInput(TaskListView);
            // console.log("Key in plugin view:", event.key, " should handle input:", shouldHandleInput);
            if (shouldHandleInput) {
                let handled = false;
                if (event.key === 'j' || event.key === 'ArrowDown') {
                    // Navigate down
                    handled = true;
                    if (this.focusTaskElementIndex < this.taskElements.length - 1) {
                        this.focusTaskElement(this.focusTaskElementIndex + 1);
                    }
                } else if (event.key === 'k' || event.key === 'ArrowUp') {
                    // Navigate up
                    if (this.focusTaskElementIndex > 0) {
                        this.focusTaskElement(this.focusTaskElementIndex - 1);
                    }
                } else if (event.key == 'c' && (event.ctrlKey || event.metaKey)) {
                    this.copyTaskTitles();
                    handled = true;
                } else if (event.key === 'c') {
                    this.plugin.openTaskCreationModal();
                    handled = true;
                } else if (event.key === '/') {
                    this.filterBar?.focus();
                    handled = true;
                } else if (event.key === 'x') {
                    const focusedElement = this.getFocusedTaskElement();
                    if (focusedElement) {
                        const matchingCards = this.taskElements.filter(card => card.dataset.key === focusedElement.dataset.key);
                        toggleTaskCardSelection(matchingCards);
                    }
                    handled = true;
                } else if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
                    // Ctrl+A: select all task cards
                    this.taskElements.forEach((taskCard) => {
                        setTaskCardSelected(taskCard, true);
                    });
                    handled = true;
                } else if (event.key === 'Escape' || event.key === 'Backspace') {
                    // Escape: clear focus and selection
                    this.focusTaskElementIndex = -1; // Reset focus index
                    this.taskElements.forEach((taskCard) => {
                        setTaskCardSelected(taskCard, false);
                    });
                    this.filterBar?.closeMainFilterBox();
                    this.filterBar?.closeViewSelectorDropdown();
                    handled = true;
                } else if (event.key === 'Enter' && event.shiftKey) {
                    // Ctrl+Enter: open focused task in new pane
                    this.openTasks();
                    handled = true;
                } else if (event.key === 'Enter') {
                    // Enter: open focused task
                    const focusedElement = this.getFocusedTaskElement();
                    if (focusedElement && focusedElement.dataset.key) {
                        const taskInfo = await this.plugin.cacheManager.getTaskInfo(focusedElement.dataset.key!);
                        if (taskInfo) {
                            await this.plugin.openTaskEditModal(taskInfo);
                        }
                    }
                    handled = true;
                } else if (event.key == 'D') {
                    this.editDueDates();
                    handled = true;
                } else if (event.key == 'S') {
                    this.editScheduleDates();
                    handled = true;
                } else if (event.key == '^') {
                    this.editPoints();
                    handled = true;
                } else if (event.key == '#') {
                    this.editTags();
                    handled = true;
                } else if (event.key == '+') {
                    this.editProjects();
                    handled = true;
                } else if (event.key == '@') {
                    this.editContexts();
                    handled = true;
                } else if (event.key == 'p') {
                    this.editPriorities();
                    handled = true;
                } else if (event.key == 'r') {
                    this.editRecurrence();
                    handled = true;
                } else if (event.key == 's') {
                    this.editStatuses();
                    handled = true;
                } else if (event.key == 'Delete' && (event.ctrlKey || event.metaKey)) {
                    this.deleteTasks();
                    handled = true;
                } else if (event.key == 'y') {
                    this.toggleArchive();
                    handled = true;
                }

                if (handled) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }
        });
    }
    
    /**
     * Keep track of focused task element for keyboard navigation
     */
    private addFocusHandler(card: HTMLElement, task: TaskInfo): void {
        card.addEventListener("mouseenter", this.onMouseEnterCard.bind(this));
    }

    private onMouseEnterCard(event: Event): void {
        const hoveredCard = event.currentTarget as HTMLElement; // the element you attached to
        const index = this.taskElements.indexOf(hoveredCard);
        this.focusTaskElement(index);
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
            case 'no-status':
                return 'No status assigned';
            default:
                return groupName;
        }
    }

    private isViewDraggable(): boolean {
        if (this.currentQuery.sortKey !== 'sortOrder') {
            return false;
        } 
        
        if (this.currentQuery.groupKey && ['due', 'scheduled'].includes(this.currentQuery.groupKey)) {
            return false; // Don't allow drag if grouping by due/scheduled date
        }
        return true;
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
    
    private openTasks() {
        this.withSelectedOrFocusedTasks(async (tasks) => {
            if (tasks.length > 0) {
                // Open each task in a new pane
                for (const task of tasks) {
                    this.openTask(task.path);
                }
            }
        });
    }

    openTask(path: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf('tab').openFile(file);
        }
    }
    
    /**
     * Wait for cache to be ready with actual data
     */
    private async waitForCacheReady(): Promise<void> {
        // First check if cache is already initialized
        if (this.plugin.cacheManager.isInitialized()) {
            return;
        }
        
        // If not initialized, wait for the cache-initialized event
        return new Promise((resolve) => {
            const unsubscribe = this.plugin.cacheManager.subscribe('cache-initialized', () => {
                unsubscribe();
                resolve();
            });
        });
    }

    /**
     * Check if a project string is in wikilink format [[Note Name]]
     */
    private isWikilinkProject(project: string): boolean {
        return project.startsWith('[[') && project.endsWith(']]');
    }

    /**
     * Create a clickable project header for wikilink projects
     */
    private createClickableProjectHeader(headerElement: HTMLElement, projectName: string): void {
        if (this.isWikilinkProject(projectName)) {
            // Extract the note name from [[Note Name]]
            const noteName = projectName.slice(2, -2);
            
            // Create a clickable link
            const linkEl = headerElement.createEl('a', {
                cls: 'internal-link task-list-view__project-link',
                text: noteName
            });
            
            // Add click handler to open the note
            this.registerDomEvent(linkEl, 'click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Resolve the link to get the actual file
                const file = this.plugin.app.metadataCache.getFirstLinkpathDest(noteName, '');
                if (file instanceof TFile) {
                    // Open the file in the current leaf
                    await this.plugin.app.workspace.getLeaf(false).openFile(file);
                } else {
                    // File not found, show notice
                    new Notice(`Note "${noteName}" not found`);
                }
            });
            
            // Add hover preview functionality - resolve the file first
            const file = this.plugin.app.metadataCache.getFirstLinkpathDest(noteName, '');
            if (file instanceof TFile) {
                this.addHoverPreview(linkEl, file.path);
            }
        } else {
            // Fallback to plain text
            headerElement.textContent = this.formatGroupName(projectName);
        }
    }

    /**
     * Add hover preview functionality to an element
     */
    private addHoverPreview(element: HTMLElement, filePath: string) {
        element.addEventListener('mouseover', (event) => {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file) {
                this.app.workspace.trigger('hover-link', {
                    event,
                    source: 'tasknotes-tasklistview',
                    hoverParent: this,
                    targetEl: element,
                    linktext: filePath,
                    sourcePath: filePath
                });
            }
        });
    }
}
