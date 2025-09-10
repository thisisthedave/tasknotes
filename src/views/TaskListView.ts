import { TFile, ItemView, WorkspaceLeaf, EventRef, Notice, debounce, setIcon, ButtonComponent } from 'obsidian';
import TaskNotesPlugin from '../main';
import {
    TASK_LIST_VIEW_TYPE,
    TaskInfo,
    EVENT_DATA_CHANGED,
    EVENT_TASK_UPDATED,
    EVENT_DATE_CHANGED,
    FilterQuery,
    SavedView
} from '../types';
// No helper functions needed from helpers
import { perfMonitor } from '../utils/PerformanceMonitor';
import { createTaskCard, updateTaskCard, refreshParentTaskSubtasks, isTaskCardSelected, showDateContextMenu, showStatusContextMenu, showDeleteConfirmationModal, copyTaskTitleToClipboard, toggleTaskCardSelection, setTaskCardSelected } from '../ui/TaskCard';
import { FilterBar } from '../ui/FilterBar';
import { GroupingUtils } from '../utils/GroupingUtils';
import { FilterHeading } from '../ui/FilterHeading';
import { GroupCountUtils } from '../utils/GroupCountUtils';
import { DragDropHandler } from 'src/ui/DragDropHandler';
import { getTopmostVisibleElement } from 'src/utils/helpers';
import { showPointsModal } from 'src/modals/StoryPointsModal';
import { showTagsModal } from 'src/modals/TagsModal';
import { showProjectModal } from 'src/modals/ProjectSelectModal';
import { showContextModal } from 'src/modals/ContextsModal';
import { showPriorityContextMenu } from 'src/components/PriorityContextMenu';
import { showRecurrenceContextMenu } from 'src/components/RecurrenceContextMenu';
import { KeyboardShortcutsMap } from 'src/types/settings';

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
    private filterHeading: FilterHeading | null = null;
    private currentQuery: FilterQuery;
    
    // Task item tracking for dynamic updates
    private taskElements: HTMLElement[] = [];
    private focusTaskElementIndex: number = -1; // Track focused task for keyboard navigation
    
    // Event listeners
    private listeners: EventRef[] = [];
    private functionListeners: (() => void)[] = [];
    
    // Debounce timer for refreshTasks
    private refreshTasksDebounceTimer: number | null = null;
    private keyboardShortcuts: KeyboardShortcutsMap

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
        this.dragDropHandler = new DragDropHandler(async (fromIndex, toIndex, draggedEl, placeholder) => {
            const pending: Array<Promise<unknown>> = [];

            // Determine the destination group container (whatever you currently use)
            const destGroupId = this.findTaskElementGroup(placeholder);

            // Determine which elements move: dragged + selected-in-same-group
            setTaskCardSelected(draggedEl, true); // Ensure dragged element is selected
            const movingEls = this.getSelectedTaskElements();

            // Keep track of original groupings
            const srcGroupsByTaskId = movingEls.reduce<Record<string, string[]>>((acc, el: HTMLElement) => {
                const taskGroup = this.findTaskElementGroup(el);
                if (taskGroup) {
                    const taskId: string = el.dataset.key!;
                    (acc[taskId] ??= []).push(taskGroup);
                }
                return acc;
            }, {});

            // Find their indices (ascending)
            const indicesToMove = movingEls.map(el => this.taskElements.indexOf(el));

            if (indicesToMove.length > 0) {
                // Find the affected range of tasks to update.
                fromIndex = indicesToMove[0]
                const affectedStart = Math.max(0, fromIndex > toIndex ? toIndex - 1 : fromIndex - 1);
                const affectedEnd = Math.min(this.taskElements.length, Math.max(toIndex, indicesToMove.at(-1)!) + 2); // +2 because end is exclusive for slice
                const affectedTaskElements = this.taskElements.slice(affectedStart, affectedEnd); // returns a copy
                const affectedIndices = indicesToMove.map(idx => idx - affectedStart);
                if (affectedTaskElements.length > 0) {
                    // Load tasks and ensure they're loaded
                    const affectedTasks = await Promise.all(
                        affectedTaskElements.map(child => this.plugin.cacheManager.getTaskInfo((child as HTMLElement).dataset.key!))
                    );
                    const failedLoad = affectedTasks.map((task, idx) => [task, affectedTaskElements[idx].dataset.key]).filter(([task, key]) => task == null)
                    if (failedLoad.length > 0) {
                        throw new Error(`TaskInfo not found for key(s) ${failedLoad.map(([task, key]) => key).join(', ')}`);
                    }

                    // reorder the tasks
                    console.debug(`Reordering tasks from ${fromIndex} to ${toIndex}. Loaded ${affectedTasks.length} tasks with offset ${affectedStart}`);
                    const reorder = this.plugin.taskService.reorderTasks(affectedTasks as TaskInfo[], affectedIndices, toIndex - affectedStart);
                    pending.push(reorder);

                    // Update the value of the grouping field if the task was moved, e.g. from "In Progress" to "Done"
                    if (this.currentQuery.groupKey) {
                        for (const task of affectedTasks) {
                            const srcGroups = srcGroupsByTaskId[task!.id!];
                            if (srcGroups) {
                                const regroup = this.moveBetweenGroups(task!, srcGroups.filter(group => group !== null), destGroupId);
                                pending.push(regroup);
                            } 
                        }
                    }

                    if (pending.length > 0) {
                        await Promise.all(pending);
                        this.debouncedRefreshTasks(); // Ensures DOM reflects new order
                    }
                }
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
        
        // Listen for date changes to refresh recurring task states
        const dateChangeListener = this.plugin.emitter.on(EVENT_DATE_CHANGED, async () => {
            this.refresh();
        });
        this.listeners.push(dateChangeListener);
        
        // Listen for individual task updates
        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, async ({ path, originalTask, updatedTask }) => {
            if (!path || !updatedTask) {
                console.error('EVENT_TASK_UPDATED received invalid data:', { path, originalTask, updatedTask });
                return;
            }
            
            // Check if any parent task cards need their subtasks refreshed
            await refreshParentTaskSubtasks(updatedTask, this.plugin, this.contentEl);
            
            // Check if this task is currently visible in our view
            const taskElements = this.taskElements.filter(element => element.dataset.key === path);
            if (taskElements.length > 0) {
                // Task is visible - update it in place using TaskCard's update function
                for (const taskElement of taskElements) {
                    try {
	                const visibleProperties = this.getCurrentVisibleProperties();
        	        updateTaskCard(taskElement, updatedTask, this.plugin, visibleProperties, {
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

        // Listen for settings changes to update today highlight and custom view
        const settingsListener = this.plugin.emitter.on('settings-changed', () => {
            this.initializeKeyboardShortcuts();
        });
        this.listeners.push(settingsListener);

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
            this.initializeKeyboardShortcuts();
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

        // Clean up FilterHeading
        if (this.filterHeading) {
            this.filterHeading.destroy();
            this.filterHeading = null;
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
            this.plugin,
            filterBarContainer,
            this.currentQuery,
            filterOptions,
            this.plugin.settings.viewsButtonAlignment || 'right',
            { enableGroupExpandCollapse: false, forceShowExpandCollapse: false, viewType: 'task-list' }
        );


        // Get saved views for the FilterBar
        const savedViews = this.plugin.viewStateManager.getSavedViews();
        this.filterBar.updateSavedViews(savedViews);
        
        // Listen for saved view events
        this.filterBar.on('saveView', ({ name, query, viewOptions, visibleProperties }) => {
            const savedView = this.plugin.viewStateManager.saveView(name, query, viewOptions, visibleProperties);
            // Set the newly saved view as active to prevent incorrect view matching
            this.filterBar!.setActiveSavedView(savedView);
        });
        
        this.filterBar.on('deleteView', (viewId: string) => {
            this.plugin.viewStateManager.deleteView(viewId);
            // Don't update here - the ViewStateManager event will handle it
        });

        // Listen for global saved views changes
        this.plugin.viewStateManager.on('saved-views-changed', (updatedViews: readonly SavedView[]) => {
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
            // Update expand/collapse buttons visibility
            const controlsContainer = this.contentEl.querySelector('.filter-heading__controls') as HTMLElement;
            if (controlsContainer) {
                this.createExpandCollapseButtons(controlsContainer);
            }
            await this.refreshTasks();
        });

        // Listen for properties changes
        this.filterBar.on('propertiesChanged', (properties: string[]) => {
            // Refresh the task display with new properties
            this.refreshTaskDisplay();
        });

        // Create filter heading with integrated controls
        this.filterHeading = new FilterHeading(container);
        
        // Add expand/collapse controls to the heading container
        const headingContainer = container.querySelector('.filter-heading') as HTMLElement;
        if (headingContainer) {
            const headingContent = headingContainer.querySelector('.filter-heading__content') as HTMLElement;
            if (headingContent) {
                // Add controls to the right side of the heading
                const controlsContainer = headingContent.createDiv({ cls: 'filter-heading__controls' });
                this.createExpandCollapseButtons(controlsContainer);
            }
        }

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
        
        // Update expand/collapse buttons after initial load
        const controlsContainer = this.contentEl.querySelector('.filter-heading__controls') as HTMLElement;
        if (controlsContainer) {
            this.createExpandCollapseButtons(controlsContainer);
        }
    }

    /**
     * Create expand/collapse buttons for grouped views
     */
    private createExpandCollapseButtons(container: HTMLElement): void {
        const isGrouped = (this.currentQuery.groupKey || 'none') !== 'none';
        
        if (!isGrouped) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.empty();
        
        // Expand all button
        const expandAllBtn = new ButtonComponent(container)
            .setIcon('list-tree')
            .setTooltip('Expand All Groups')
            .setClass('task-view-control-button')
            .onClick(() => {
                const key = this.currentQuery.groupKey || 'none';
                this.contentEl.querySelectorAll('.task-group').forEach(section => {
                    section.classList.remove('is-collapsed');
                    const list = (section as HTMLElement).querySelector('.task-cards') as HTMLElement | null;
                    if (list) list.style.display = '';
                });
                GroupingUtils.expandAllGroups(TASK_LIST_VIEW_TYPE, key, this.plugin);
            });
        expandAllBtn.buttonEl.addClass('clickable-icon');

        // Collapse all button  
        const collapseAllBtn = new ButtonComponent(container)
            .setIcon('list-collapse')
            .setTooltip('Collapse All Groups')
            .setClass('task-view-control-button')
            .onClick(() => {
                const key = this.currentQuery.groupKey || 'none';
                const groupNames: string[] = [];
                this.contentEl.querySelectorAll('.task-group').forEach(section => {
                    const name = (section as HTMLElement).dataset.group;
                    if (name) {
                        groupNames.push(name);
                        section.classList.add('is-collapsed');
                        const list = (section as HTMLElement).querySelector('.task-cards') as HTMLElement | null;
                        if (list) list.style.display = 'none';
                    }
                });
                GroupingUtils.collapseAllGroups(TASK_LIST_VIEW_TYPE, key, groupNames, this.plugin);
            });
        collapseAllBtn.buttonEl.addClass('clickable-icon');
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

    async moveBetweenGroups(movedTask: TaskInfo, fromGroups: string[], toGroup: string | null) {
        if (movedTask && (fromGroups.length !== 1 || fromGroups[0] !== toGroup)) {
            const [propertyKey, isArrayProperty] =
                this.currentQuery.groupKey == 'project' ? ['projects' as keyof TaskInfo, true] :
                this.currentQuery.groupKey == 'context' ? ['contexts' as keyof TaskInfo, true] :
                [this.currentQuery.groupKey as keyof TaskInfo, false]
            let newValue: string | string[] | null = toGroup;
            if (isArrayProperty) {
                const oldValue = (movedTask[propertyKey]! as string[])
                newValue = oldValue.filter(oldProject => !fromGroups.includes(oldProject));
                if (toGroup != null && !newValue.includes(toGroup)) {
                    newValue.push(toGroup);
                }
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
     * Update the filter heading with current saved view and completion count
     */
    private async updateFilterHeading(): Promise<void> {
        if (!this.filterHeading || !this.filterBar) return;

        try {
            // Get all filtered tasks to calculate completion stats
            const groupedTasks = await this.plugin.filterService.getGroupedTasks(this.currentQuery);
            const allTasks = Array.from(groupedTasks.values()).flat();

            // Calculate completion stats
            const stats = GroupCountUtils.calculateGroupStats(allTasks, this.plugin);

            // Get current saved view from FilterBar
            const activeSavedView = (this.filterBar as any).activeSavedView || null;

            // Update the filter heading
            this.filterHeading.update(activeSavedView, stats.completed, stats.total);
        } catch (error) {
            console.error('Error updating filter heading in TaskListView:', error);
        }
    }
    
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
                cacheInitialized: this.plugin.cacheManager?.isInitialized() || false,
                visibleProperties: this.getCurrentVisibleProperties(),
                filterServiceQuery: JSON.stringify(this.currentQuery, null, 2)
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
            // Update filter heading with current data
            await this.updateFilterHeading();
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
        
        // Clear any elements without proper keys to avoid DOMReconciler confusion
        Array.from(container.children).forEach(child => {
            const element = child as HTMLElement;
            if (!element.dataset.key) {
                element.remove();
            }
        });
        
        
        try {
            
            this.plugin.domReconciler.updateList<TaskInfo>(
                container,
                tasks,
                (task) => {
                    return task.path;
                }, // Unique key
                (task) => {
                    return this.createTaskCardForReconciler(task);
                }, // Render new item
                (element, task) => {
                    return this.updateTaskCardForReconciler(element, task);
                } // Update existing item
            );
            
        } catch (error) {
            console.error('TaskListView: Error in renderTaskListWithReconciler:', error);
            throw error;
        }
        
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
            
            const groupingKey = this.currentQuery.groupKey || 'none';
            const isAllGroup = groupingKey === 'none' && groupName === 'all';
            const collapsedInitially = this.isGroupCollapsed(groupingKey, groupName);

            // Add group header (skip only if grouping is 'none' and group name is 'all')
            if (!isAllGroup) {
                const headerElement = groupSection.createEl('h3', {
                    cls: 'task-group-header task-list-view__group-header'
                });

                // Create toggle button first (exactly as in preview-all)
                const toggleBtn = headerElement.createEl('button', { cls: 'task-group-toggle', attr: { 'aria-label': 'Toggle group' } });
                try { setIcon(toggleBtn, 'chevron-right'); } catch (_) { /* Ignore setIcon errors */ }
                const svg = toggleBtn.querySelector('svg');
                if (svg) { svg.classList.add('chevron'); svg.setAttr('width', '16'); svg.setAttr('height', '16'); }
                else { toggleBtn.textContent = '▸'; toggleBtn.addClass('chevron-text'); }

                // Calculate completion stats for this group
                const groupStats = GroupCountUtils.calculateGroupStats(tasks, this.plugin);

                // Label: project path -> clickable, else plain text span
                if (groupingKey === 'project' && this.isClickableProject(groupName)) {
                    this.createClickableProjectHeader(headerElement, groupName, groupStats);
                } else {
                    headerElement.createSpan({ text: this.formatGroupName(groupName) });

                    // Add count with agenda-view__item-count styling
                    headerElement.createSpan({
                        text: ` ${GroupCountUtils.formatGroupCount(groupStats.completed, groupStats.total).text}`,
                        cls: 'agenda-view__item-count'
                    });
                }

                // Click handlers (match preview-all semantics; ignore link clicks inside header)
                this.registerDomEvent(headerElement, 'click', (e: MouseEvent) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('a')) return;
                    const willCollapse = !groupSection.hasClass('is-collapsed');
                    this.setGroupCollapsed(groupingKey, groupName, willCollapse);
                    groupSection.toggleClass('is-collapsed', willCollapse);
                    const list = groupSection.querySelector('.task-cards') as HTMLElement | null;
                    if (list) list.style.display = willCollapse ? 'none' : '';
                    toggleBtn.setAttr('aria-expanded', String(!willCollapse));
                });
                this.registerDomEvent(toggleBtn, 'click', (e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const willCollapse = !groupSection.hasClass('is-collapsed');
                    this.setGroupCollapsed(groupingKey, groupName, willCollapse);
                    groupSection.toggleClass('is-collapsed', willCollapse);
                    const list = groupSection.querySelector('.task-cards') as HTMLElement | null;
                    if (list) list.style.display = willCollapse ? 'none' : '';
                    toggleBtn.setAttr('aria-expanded', String(!willCollapse));
                });

                // Initial ARIA state set after list container is created below
                toggleBtn.setAttr('aria-expanded', String(!collapsedInitially));
            }

            // Create task cards container
            const taskCardsContainer = groupSection.createDiv({ cls: 'tasks-container task-cards' });

            // Apply initial collapsed state
            if (collapsedInitially && !isAllGroup) {
                groupSection.addClass('is-collapsed');
                taskCardsContainer.style.display = 'none';
            }

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

    // Persist and restore collapsed state per grouping key and group name
    private isGroupCollapsed(groupingKey: string, groupName: string): boolean {
        return GroupingUtils.isGroupCollapsed(TASK_LIST_VIEW_TYPE, groupingKey, groupName, this.plugin);
    }

    private setGroupCollapsed(groupingKey: string, groupName: string, collapsed: boolean): void {
        GroupingUtils.setGroupCollapsed(TASK_LIST_VIEW_TYPE, groupingKey, groupName, collapsed, this.plugin);
    }

    /**
     * Get current visible properties for task cards
     */
    private getCurrentVisibleProperties(): string[] | undefined {
        // Use the FilterBar's method which handles temporary state
        return this.filterBar?.getCurrentVisibleProperties();
    }

    /**
     * Refresh task display with current properties (without refetching data)
     */
    private refreshTaskDisplay(): void {
        if (!this.taskListContainer) return;
        
        // Get all existing task cards
        const taskCards = this.taskListContainer.querySelectorAll('.task-card');
        const visibleProperties = this.getCurrentVisibleProperties();
        
        taskCards.forEach(card => {
            const taskPath = (card as HTMLElement).dataset.taskPath;
            if (!taskPath) return;
            
            // Get task data from cache
            this.plugin.cacheManager.getTaskInfo(taskPath).then(task => {
                if (task) {
                    updateTaskCard(card as HTMLElement, task, this.plugin, visibleProperties);
                }
            });
        });
    }

    /**
     * Create a task card for use with DOMReconciler
     */
    private createTaskCardForReconciler(task: TaskInfo): HTMLElement {
        try {
            const visibleProperties = this.getCurrentVisibleProperties();
            const taskCard = createTaskCard(task, this.plugin, visibleProperties, {
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
        } catch (error) {
            console.error('TaskListView: Error creating task card for', task.path, ':', error);
            throw error;
        }
    }

    /**
     * Update an existing task card for use with DOMReconciler
     */
    private updateTaskCardForReconciler(element: HTMLElement, task: TaskInfo): void {
        const visibleProperties = this.getCurrentVisibleProperties();
        updateTaskCard(element, task, this.plugin, visibleProperties, {
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

    private initializeKeyboardShortcuts(): void {
        // Normalizes shortcut strings like "Ctrl+Shift+K" or "j" for comparison.
        const normalize = (s: string): string => {
            const raw = s.trim();
            if (!raw) return '';
            const parts = raw.split('+').map(p => p.trim().toLowerCase());
            // Separate modifiers from key
            const mods = new Set<string>();
            let key = '';
            for (const p of parts) {
                if (p === 'ctrl' || p === 'control') mods.add('ctrl');
                else if (p === 'cmd' || p === 'meta' || p === 'command') mods.add('meta');
                else if (p === 'alt' || p === 'option') mods.add('alt');
                else if (p === 'shift') mods.add('shift');
                else key = p; // last non-modifier wins
            }
            // Keep order stable for comparison
            const ordered = ['ctrl', 'meta', 'alt', 'shift'].filter(m => mods.has(m));
            return (ordered.length ? ordered.join('+') + '+' : '') + key;
        };

        const ks = this.plugin.settings.keyboardShortcuts ?? {};
        // Fallbacks so missing settings still work
        const fallback = (action: string, defaults: string[]) => (ks as any)[action] ?? defaults;

        // Expand and normalize list-of-shortcuts
        const normList = (list: string[]) => list.map(normalize).filter(Boolean);

        this.keyboardShortcuts = {
            navigateDown: normList(fallback('navigateDown', ['j', 'ArrowDown'])),
            navigateUp: normList(fallback('navigateUp', ['k', 'ArrowUp'])),
            copyTaskTitles: normList(fallback('copyTaskTitles', ['ctrl+c', 'meta+c'])),
            newTask: normList(fallback('newTask', ['c'])),
            focusFilter: normList(fallback('focusFilter', ['/'])),
            toggleSelect: normList(fallback('toggleSelect', ['x'])),
            selectAll: normList(fallback('selectAll', ['ctrl+a', 'meta+a'])),
            clearFocusAndSelection: normList(fallback('clearFocusAndSelection', ['Escape', 'Backspace'])),
            openInNewPane: normList(fallback('openInNewPane', ['shift+Enter'])),
            openEdit: normList(fallback('openEdit', ['Enter'])),
            editDueDates: normList(fallback('editDueDates', ['D'])),
            editScheduleDates: normList(fallback('editScheduleDates', ['S'])),
            editPoints: normList(fallback('editPoints', ['^'])),
            editTags: normList(fallback('editTags', ['#'])),
            editProjects: normList(fallback('editProjects', ['+'])),
            editContexts: normList(fallback('editContexts', ['@'])),
            editPriorities: normList(fallback('editPriorities', ['p'])),
            editRecurrence: normList(fallback('editRecurrence', ['r'])),
            editStatuses: normList(fallback('editStatuses', ['s'])),
            deleteTasks: normList(fallback('deleteTasks', ['ctrl+Delete', 'meta+Delete'])),
            toggleArchive: normList(fallback('toggleArchive', ['y'])),
        } as const;    
    }
    
    private addKeyboardHandlers(): void {
        const eventSig = (e: KeyboardEvent): string => {
            const mods: string[] = [];
            if (e.ctrlKey) mods.push('ctrl');
            if (e.metaKey) mods.push('meta');
            if (e.altKey) mods.push('alt');
            if (e.shiftKey) mods.push('shift');

            // Prefer event.key; keep case for single letters only to allow exacts like '^' or '#'
            // Normalize to lower for matching, but let punctuation and names (ArrowDown) pass through.
            const k = e.key.toLowerCase();
            return (mods.length ? mods.join('+') + '+' : '') + k;
        };

        const matchesAny = (eventSig: string, shortcuts: readonly string[]) => {
            return shortcuts.includes(eventSig);
        };

        this.registerDomEvent(document, 'keydown', async (event: KeyboardEvent) => {
            const shouldHandleInput = this.plugin.inputObserver.shouldHandleKeyboardInput(TaskListView);
            if (!shouldHandleInput) return;

            let handled = false;
            const sig = eventSig(event);
            if (matchesAny(sig, this.keyboardShortcuts.navigateDown)) {
                handled = true;
                if (this.focusTaskElementIndex < this.taskElements.length - 1) {
                    this.focusTaskElement(this.focusTaskElementIndex + 1);
                }
            } else if (matchesAny(sig, this.keyboardShortcuts.navigateUp)) {
                handled = true;
                if (this.focusTaskElementIndex > 0) {
                    this.focusTaskElement(this.focusTaskElementIndex - 1);
                }
            } else if (matchesAny(sig, this.keyboardShortcuts.copyTaskTitles)) {
                handled = true;
                await this.copyTaskTitles();
            } else if (matchesAny(sig, this.keyboardShortcuts.newTask)) {
                handled = true;
                this.plugin.openTaskCreationModal();
            } else if (matchesAny(sig, this.keyboardShortcuts.focusFilter)) {
                handled = true;
                this.filterBar?.focus();
            } else if (matchesAny(sig, this.keyboardShortcuts.toggleSelect)) {
                handled = true;
                const focusedElement = this.getFocusedTaskElement();
                if (focusedElement) {
                    toggleTaskCardSelection([focusedElement]);
                }
            } else if (matchesAny(sig, this.keyboardShortcuts.selectAll)) {
                handled = true;
                this.taskElements.forEach((taskCard) => setTaskCardSelected(taskCard, true));
            } else if (matchesAny(sig, this.keyboardShortcuts.clearFocusAndSelection)) {
                handled = true;
                this.focusTaskElementIndex = -1;
                this.taskElements.forEach((taskCard) => setTaskCardSelected(taskCard, false));
                this.filterBar?.closeMainFilterBox();
                this.filterBar?.closeViewSelectorDropdown();
            } else if (matchesAny(sig, this.keyboardShortcuts.openInNewPane)) {
                handled = true;
                this.openTasks();
            } else if (matchesAny(sig, this.keyboardShortcuts.openEdit)) {
                handled = true;
                const focusedElement = this.getFocusedTaskElement();
                if (focusedElement?.dataset.key) {
                    const taskInfo = await this.plugin.cacheManager.getTaskInfo(focusedElement.dataset.key!);
                    if (taskInfo) await this.plugin.openTaskEditModal(taskInfo);
                }
            } else if (matchesAny(sig, this.keyboardShortcuts.editDueDates)) {
                handled = true;
                await this.editDueDates();
            } else if (matchesAny(sig, this.keyboardShortcuts.editScheduleDates)) {
                handled = true;
                await this.editScheduleDates();
            } else if (matchesAny(sig, this.keyboardShortcuts.editPoints)) {
                handled = true;
                await this.editPoints();
            } else if (matchesAny(sig, this.keyboardShortcuts.editTags)) {
                handled = true;
                await this.editTags();
            } else if (matchesAny(sig, this.keyboardShortcuts.editProjects)) {
                handled = true;
                await this.editProjects();
            } else if (matchesAny(sig, this.keyboardShortcuts.editContexts)) {
                handled = true;
                await this.editContexts();
            } else if (matchesAny(sig, this.keyboardShortcuts.editPriorities)) {
                handled = true;
                await this.editPriorities();
            } else if (matchesAny(sig, this.keyboardShortcuts.editRecurrence)) {
                handled = true;
                await this.editRecurrence();
            } else if (matchesAny(sig, this.keyboardShortcuts.editStatuses)) {
                handled = true;
                await this.editStatuses();
            } else if (matchesAny(sig, this.keyboardShortcuts.deleteTasks)) {
                handled = true;
                await this.deleteTasks();
            } else if (matchesAny(sig, this.keyboardShortcuts.toggleArchive)) {
                handled = true;
                await this.toggleArchive();
            }

            if (handled) {
                event.preventDefault();
                event.stopPropagation();
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
     * Format group name for display
     */
    private formatGroupName(groupName: string): string {
        return GroupingUtils.formatGroupName(groupName, this.plugin);
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
     * Check if a project string is a file path that should be made clickable
     */
    private isClickableProject(project: string): boolean {
        if (!project || typeof project !== 'string') {
            return false;
        }
        
        // Wikilink format
        if (project.startsWith('[[') && project.endsWith(']]')) {
            return true;
        }
        
        // File path (contains slash) or could be a resolved file
        if (project.includes('/')) {
            return true;
        }
        
        // Check if it's a resolved file path by trying to find the file
        if (this.plugin?.app) {
            const file = this.plugin.app.vault.getAbstractFileByPath(project + '.md');
            if (file instanceof TFile) {
                return true;
            }
            
            const resolvedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(project, '');
            return !!resolvedFile;
        }
        
        return false;
    }

    /**
     * Create a clickable project header for project file paths
     */
    private createClickableProjectHeader(headerElement: HTMLElement, projectName: string, groupStats?: { completed: number; total: number }): void {
        if (!projectName || typeof projectName !== 'string') {
            return;
        }
        
        let filePath = projectName;
        let displayName = projectName;
        
        // Handle wikilink format
        if (projectName.startsWith('[[') && projectName.endsWith(']]')) {
            const linkContent = projectName.slice(2, -2);
            filePath = linkContent;
            displayName = linkContent;
        }
        
        // Create a clickable link
        const linkEl = headerElement.createEl('a', {
            cls: 'internal-link task-list-view__project-link',
            text: displayName
        });
        
        // Add click handler to open the file
        this.registerDomEvent(linkEl, 'click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            try {
                // First try to get file by direct path
                const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    await this.plugin.app.workspace.getLeaf(false).openFile(file);
                    return;
                }
                
                // If not found, try to resolve using metadata cache
                const resolvedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(filePath, '');
                if (resolvedFile) {
                    await this.plugin.app.workspace.getLeaf(false).openFile(resolvedFile);
                } else {
                    new Notice(`Project file not found: ${displayName}`);
                }
            } catch (error) {
                console.error('Error opening project file:', error);
                new Notice(`Error opening project: ${displayName}`);
            }
        });
        
        // Add hover preview functionality
        this.addHoverPreview(linkEl, filePath);

        // Add count with agenda-view__item-count styling if stats provided
        if (groupStats) {
            headerElement.createSpan({
                text: ` ${GroupCountUtils.formatGroupCount(groupStats.completed, groupStats.total).text}`,
                cls: 'agenda-view__item-count'
            });
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
