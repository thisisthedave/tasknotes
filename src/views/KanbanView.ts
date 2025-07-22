import { ItemView, WorkspaceLeaf, Notice, EventRef, debounce } from 'obsidian';
import TaskNotesPlugin from '../main';
import { 
    KANBAN_VIEW_TYPE, 
    EVENT_DATA_CHANGED, 
    EVENT_TASK_UPDATED, 
    TaskInfo,
    FilterQuery,
    TaskGroupKey,
    SavedView
} from '../types';
import { createTaskCard, updateTaskCard } from '../ui/TaskCard';
import { FilterBar } from '../ui/FilterBar';

export class KanbanView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // UI elements
    private boardContainer: HTMLElement | null = null;
    
    // Filter system
    private filterBar: FilterBar | null = null;
    private currentQuery: FilterQuery;
    private taskElements: Map<string, HTMLElement> = new Map();
    private previousGroupKey: string | null = null;

    // Event listeners
    private listeners: EventRef[] = [];
    private functionListeners: (() => void)[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Initialize with default query - will be properly set when plugin services are ready
        this.currentQuery = {
            type: 'group',
            id: 'temp',
            conjunction: 'and',
            children: [],
            sortKey: 'priority',
            sortDirection: 'desc',
            groupKey: 'status' // Kanban default grouping
        };
        
        // Initialize previous group key to current state to avoid clearing on first load
        this.previousGroupKey = this.currentQuery.groupKey || null;
        
        this.registerEvents();
    }

    getViewType(): string {
        return KANBAN_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Kanban';
    }

    getIcon(): string {
        return 'layout-grid';
    }

    registerEvents(): void {
        this.listeners.forEach(listener => this.plugin.emitter.offref(listener));
        this.listeners = [];
        this.functionListeners.forEach(unsubscribe => unsubscribe());
        this.functionListeners = [];

        const dataListener = this.plugin.emitter.on(EVENT_DATA_CHANGED, async () => {
            this.refresh();
            // Update FilterBar options when data changes (new properties, contexts, etc.)
            if (this.filterBar) {
                const updatedFilterOptions = await this.plugin.filterService.getFilterOptions();
                this.filterBar.updateFilterOptions(updatedFilterOptions);
            }
        });
        this.listeners.push(dataListener);

        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, async ({ path, originalTask, updatedTask }) => {
            if (!path || !updatedTask) return;
            
            // Check if this task is currently visible in our view
            const taskElement = this.taskElements.get(path);
            if (taskElement) {
                // Task is visible - update it in place
                try {
                    updateTaskCard(taskElement, updatedTask, this.plugin, {
                        showDueDate: true,
                        showCheckbox: false,
                        showTimeTracking: true
                    });
                    
                    // Add update animation for real user updates
                    taskElement.classList.add('task-card--updated');
                    window.setTimeout(() => {
                        taskElement.classList.remove('task-card--updated');
                    }, 1000);
                } catch (error) {
                    console.error('Error updating task card in kanban:', error);
                    // Fallback to refresh if update fails
                    this.refresh();
                }
            } else {
                // Task not currently visible or might have moved columns - refresh
                this.refresh();
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
            this.refresh();
        });
        this.functionListeners.push(filterDataListener);
    }

    async onOpen() {
        // Wait for the plugin to be fully initialized before proceeding
        await this.plugin.onReady();
        
        // Wait for migration to complete before initializing UI
        await this.plugin.waitForMigration();
        
        // Load saved filter state
        const savedQuery = this.plugin.viewStateManager.getFilterState(KANBAN_VIEW_TYPE);
        if (savedQuery) {
            this.currentQuery = savedQuery;
            this.previousGroupKey = this.currentQuery.groupKey || null;
        }
        
        // Load saved column order
        this.loadColumnOrder();
        
        this.contentEl.empty();
        await this.render();
    }

    async onClose() {
        this.listeners.forEach(listener => this.plugin.emitter.offref(listener));
        this.functionListeners.forEach(unsubscribe => unsubscribe());
        
        // Clean up FilterBar
        if (this.filterBar) {
            this.filterBar.destroy();
            this.filterBar = null;
        }
        
        this.contentEl.empty();
    }

    async refresh() {
        // Use DOMReconciler for efficient updates
        if (this.boardContainer) {
            await this.loadAndRenderBoard();
        } else {
            // First render - do full render
            await this.render();
        }
    }

    async render() {
        const container = this.contentEl;
        container.empty();
        container.addClass('tasknotes-plugin', 'kanban-view');

        await this.renderHeader(container);
        
        this.boardContainer = container.createDiv({ cls: 'kanban-view__board-container' });

        await this.loadAndRenderBoard();
    }

    private async renderHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: 'kanban-view__header' });

        // FilterBar container
        const filterBarContainer = header.createDiv({ cls: 'kanban-view__filter-container' });
        
        // Initialize with default query from FilterService
        this.currentQuery = this.plugin.filterService.createDefaultQuery();
        this.currentQuery.sortKey = 'priority';
        this.currentQuery.sortDirection = 'desc';
        this.currentQuery.groupKey = 'status';
        
        // Load saved filter state if it exists
        const savedQuery = this.plugin.viewStateManager.getFilterState(KANBAN_VIEW_TYPE);
        if (savedQuery) {
            this.currentQuery = savedQuery;
        }
        
        // Get filter options from FilterService
        const filterOptions = await this.plugin.filterService.getFilterOptions();
        
        // Create new FilterBar
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
        this.filterBar.on('saveView', ({ name, query }) => {
            this.plugin.viewStateManager.saveView(name, query);
            // Don't update here - the ViewStateManager event will handle it
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
        
        this.filterBar.on('manageViews', () => {
            console.log('Manage views requested');
        });
        
        // Listen for filter changes
        this.filterBar.on('queryChange', async (newQuery: FilterQuery) => {
            this.currentQuery = newQuery;
            // Save the filter state
            await this.plugin.viewStateManager.setFilterState(KANBAN_VIEW_TYPE, newQuery);
            this.loadAndRenderBoard();
        });

        // Actions row
        const actionsRow = header.createDiv({ cls: 'kanban-view__actions' });
        
        // Left actions
        const leftActions = actionsRow.createDiv({ cls: 'kanban-view__actions-left' });
        
        // Add new task button
        const newTaskButton = leftActions.createEl('button', { 
            cls: 'kanban-view__new-task-button',
            text: 'New task'
        });
        newTaskButton.addEventListener('click', () => {
            this.plugin.openTaskCreationModal();
        });

        // Right actions
        const rightActions = actionsRow.createDiv({ cls: 'kanban-view__actions-right' });
        
        // Board stats
        const statsContainer = rightActions.createDiv({ cls: 'kanban-view__stats' });
        this.updateBoardStats(statsContainer);
    }

    private updateBoardStats(container: HTMLElement, tasks?: TaskInfo[]) {
        container.empty();
        
        if (!tasks || tasks.length === 0) return;

        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(task => 
            this.plugin.statusManager.isCompletedStatus(task.status)
        ).length;

        // Simple, minimal stats
        if (totalTasks > 0) {
            const completionRate = Math.round((completedTasks / totalTasks) * 100);
            container.createSpan({ 
                text: `${totalTasks} tasks • ${completionRate}% complete`,
                cls: 'kanban-view__stats-simple'
            });
        }
    }

    private async loadAndRenderBoard() {
        if (!this.boardContainer) return;
        
        // Check if grouping type has changed - if so, clear the board completely
        const currentGroupKey = this.currentQuery.groupKey || null;
        if (this.previousGroupKey !== null && this.previousGroupKey !== currentGroupKey) {
            this.boardContainer.empty();
            this.columnOrder = [];
        }
        this.previousGroupKey = currentGroupKey;
        
        // Show loading indicator only if board is empty
        let loadingIndicator: HTMLElement | null = null;
        if (this.boardContainer.children.length === 0) {
            loadingIndicator = this.boardContainer.createDiv({ cls: 'kanban-view__loading', text: 'Loading board...' });
        }

        try {
            // Get grouped tasks from FilterService
            const groupedTasks = await this.plugin.filterService.getGroupedTasks(this.currentQuery, this.plugin.selectedDate);
            
            // Remove loading indicator if it exists
            if (loadingIndicator) {
                loadingIndicator.remove();
            }
            
            // Render the grouped tasks using DOMReconciler
            this.renderBoardFromGroupedTasksWithReconciler(groupedTasks);
            
            // Calculate stats from all tasks
            const allTasks = Array.from(groupedTasks.values()).flat();
            
            // Update stats after rendering
            const statsContainer = this.contentEl.querySelector('.kanban-view__stats') as HTMLElement;
            if (statsContainer) {
                this.updateBoardStats(statsContainer, allTasks);
            }
        } catch (error) {
            console.error("Error loading Kanban board:", error);
            new Notice("Failed to load Kanban board. See console for details.");
            
            // Remove loading indicator if it exists
            if (loadingIndicator) {
                loadingIndicator.remove();
            }
            
            // Show error state
            this.boardContainer.empty();
            this.boardContainer.createDiv({ cls: 'kanban-view__error', text: 'Error loading board.' });
        }
    }

    private renderBoardFromGroupedTasks(groupedTasks: Map<string, TaskInfo[]>) {
        if (!this.boardContainer) return;
        this.boardContainer.empty();
        this.taskElements.clear();

        // Get all possible columns from the grouped tasks
        const allColumns = Array.from(groupedTasks.keys()).sort();

        // Initialize column order if empty
        if (this.columnOrder.length === 0) {
            this.columnOrder = [...allColumns];
            if (this.columnOrder.length > 0) {
                this.saveColumnOrder();
            }
        }

        // Use the render method with order for consistency
        this.renderBoardFromGroupedTasksWithOrder(groupedTasks);
    }


    private renderColumn(container: HTMLElement, columnId: string, tasks: TaskInfo[]) {
        const columnEl = container.createDiv({ cls: 'kanban-view__column' });
        columnEl.dataset.columnId = columnId;

        // Add column status classes for styling
        if (columnId === 'uncategorized') {
            columnEl.addClass('kanban-view__column--uncategorized');
        }

        // Column header
        const headerEl = columnEl.createDiv({ cls: 'kanban-view__column-header' });
        
        // Make columns draggable for reordering
        headerEl.draggable = true;
        headerEl.dataset.columnId = columnId;
        this.addColumnDragHandlers(headerEl);
        
        // Title line
        const title = this.formatColumnTitle(columnId, this.currentQuery.groupKey || 'none');
        headerEl.createEl('div', { text: title, cls: 'kanban-view__column-title' });
        
        // Count line
        headerEl.createEl('div', { 
            text: `${tasks.length} tasks`, 
            cls: 'kanban-view__column-count' 
        });

        
        // Column body for tasks
        const bodyEl = columnEl.createDiv({ cls: 'kanban-view__column-body' });
        
        if (tasks.length === 0) {
            // Empty column placeholder
            const emptyEl = bodyEl.createDiv({ 
                cls: 'kanban-view__column-empty',
                text: 'No tasks'
            });
            
            // Make empty columns droppable
            this.addColumnDropHandlers(emptyEl);
        } else {
            // Tasks are already sorted by FilterService, just render them
            tasks.forEach(task => {
                const taskCard = createTaskCard(task, this.plugin, {
                    showDueDate: true,
                    showCheckbox: false,
                    showTimeTracking: true
                });
                taskCard.draggable = true;
                this.addDragHandlers(taskCard, task);
                bodyEl.appendChild(taskCard);
                this.taskElements.set(task.path, taskCard);
            });
        }
        
        // Add "Add Card" button
        const addCardButton = bodyEl.createEl('button', {
            cls: 'kanban-view__add-card-button',
            text: '+ Add a card'
        });
        addCardButton.addEventListener('click', () => {
            this.openTaskCreationModalForColumn(columnId);
        });
        
        // Add drop handlers to the column
        this.addColumnDropHandlers(columnEl);
    }

    private addColumnDragHandlers(headerEl: HTMLElement) {
        headerEl.addEventListener('dragstart', (e) => {
            if (e.dataTransfer) {
                const columnId = headerEl.dataset.columnId;
                if (columnId) {
                    e.dataTransfer.setData('text/plain', `column:${columnId}`);
                    e.dataTransfer.effectAllowed = 'move';
                }
            }
            headerEl.classList.add('kanban-view__column-header--dragging');
        });

        headerEl.addEventListener('dragend', () => {
            headerEl.classList.remove('kanban-view__column-header--dragging');
        });

        // Note: Drop handling is now handled by the column-level handlers
        // to avoid conflicts between header and column drop zones
    }

    private columnOrder: string[] = [];

    /**
     * Load column order from view preferences
     */
    private loadColumnOrder(): void {
        const preferences = this.plugin.viewStateManager.getViewPreferences<{ columnOrder?: string[] }>(KANBAN_VIEW_TYPE);
        if (preferences?.columnOrder) {
            this.columnOrder = [...preferences.columnOrder];
        }
    }

    /**
     * Save column order to view preferences
     */
    private saveColumnOrder(): void {
        const preferences = this.plugin.viewStateManager.getViewPreferences<{ columnOrder?: string[] }>(KANBAN_VIEW_TYPE) || {};
        preferences.columnOrder = [...this.columnOrder];
        this.plugin.viewStateManager.setViewPreferences(KANBAN_VIEW_TYPE, preferences);
    }

    private async reorderColumns(sourceColumnId: string, targetColumnId: string) {
        // Get current column order or create it from DOM
        if (this.columnOrder.length === 0) {
            const columns = this.boardContainer?.querySelectorAll('.kanban-view__column');
            this.columnOrder = Array.from(columns || []).map(col => 
                (col as HTMLElement).dataset.columnId || ''
            ).filter(id => id);
        }

        const sourceIndex = this.columnOrder.indexOf(sourceColumnId);
        const targetIndex = this.columnOrder.indexOf(targetColumnId);

        if (sourceIndex === -1 || targetIndex === -1) return;

        // Remove source column from its current position
        const [movedColumn] = this.columnOrder.splice(sourceIndex, 1);
        
        // Insert it at the target position
        this.columnOrder.splice(targetIndex, 0, movedColumn);

        // Save the new column order to preferences
        this.saveColumnOrder();

        // Re-render the board with new order
        this.renderBoardWithOrder();
    }

    private async renderBoardWithOrder() {
        if (!this.boardContainer) return;
        
        try {
            // Get fresh grouped tasks from FilterService
            const groupedTasks = await this.plugin.filterService.getGroupedTasks(this.currentQuery, this.plugin.selectedDate);
            
            // Re-render the board using the new column order and DOMReconciler
            this.renderBoardFromGroupedTasksWithReconciler(groupedTasks);
            
            // Update stats after rendering
            const allTasks = Array.from(groupedTasks.values()).flat();
            const statsContainer = this.contentEl.querySelector('.kanban-view__stats') as HTMLElement;
            if (statsContainer) {
                this.updateBoardStats(statsContainer, allTasks);
            }
        } catch (error) {
            console.error("Error reordering Kanban board:", error);
            // Fallback to regular refresh if reordering fails
            this.refresh();
        }
    }

    /**
     * Render board with custom column order
     */
    private renderBoardFromGroupedTasksWithOrder(groupedTasks: Map<string, TaskInfo[]>) {
        if (!this.boardContainer) return;

        // Get or create board element
        let boardEl = this.boardContainer.querySelector('.kanban-view__board') as HTMLElement;
        if (!boardEl) {
            boardEl = this.boardContainer.createDiv({ cls: 'kanban-view__board' });
        } else {
            boardEl.empty();
        }
        
        this.taskElements.clear();
        
        // Render columns in the stored order first
        this.columnOrder.forEach(columnId => {
            if (groupedTasks.has(columnId)) {
                const columnTasks = groupedTasks.get(columnId) || [];
                this.renderColumn(boardEl, columnId, columnTasks);
            }
        });

        // Add any new columns that aren't in our order yet
        const allColumns = Array.from(groupedTasks.keys());
        let orderChanged = false;
        allColumns.forEach(columnId => {
            if (!this.columnOrder.includes(columnId)) {
                this.columnOrder.push(columnId);
                orderChanged = true;
                const columnTasks = groupedTasks.get(columnId) || [];
                this.renderColumn(boardEl, columnId, columnTasks);
            }
        });

        // Save column order if it changed
        if (orderChanged) {
            this.saveColumnOrder();
        }
    }

    private addDragHandlers(card: HTMLElement, task: TaskInfo) {
        card.addEventListener('dragstart', (e) => {
            if (e.dataTransfer) {
                e.dataTransfer.setData('text/plain', task.path);
                e.dataTransfer.effectAllowed = 'move';
            }
            window.setTimeout(() => card.classList.add('task-card--dragging'), 0);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('task-card--dragging');
        });
    }

    private addColumnDropHandlers(columnEl: HTMLElement) {
        columnEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
                
                // Check if we're dragging a column by looking for the dragging column class
                const draggingColumn = this.boardContainer?.querySelector('.kanban-view__column-header--dragging');
                if (draggingColumn) {
                    // We're dragging a column, use column drop styling
                    columnEl.classList.add('kanban-view__column--column-drop-target');
                } else {
                    // We're dragging a task, use task drop styling
                    columnEl.classList.add('kanban-view__column--dragover');
                }
            }
        });

        columnEl.addEventListener('dragleave', (e) => {
            // Only remove drop styling if we're actually leaving the column
            // and not just moving to a child element
            if (!columnEl.contains(e.relatedTarget as Node)) {
                columnEl.classList.remove('kanban-view__column--dragover');
                columnEl.classList.remove('kanban-view__column--column-drop-target');
            }
        });

        columnEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent event bubbling
            
            // Remove drop styling from all columns (cleanup)
            this.boardContainer?.querySelectorAll('.kanban-view__column--dragover, .kanban-view__column--column-drop-target').forEach(col => {
                col.classList.remove('kanban-view__column--dragover', 'kanban-view__column--column-drop-target');
            });

            const data = e.dataTransfer?.getData('text/plain');
            
            // Handle column reordering
            if (data?.startsWith('column:')) {
                const sourceColumnId = data.replace('column:', '');
                const targetColumnId = columnEl.dataset.columnId;

                if (sourceColumnId && targetColumnId && sourceColumnId !== targetColumnId) {
                    await this.reorderColumns(sourceColumnId, targetColumnId);
                }
                return; // Exit early for column drops
            }

            // Handle task drops
            const taskPath = data;
            
            // Find the target column - prefer the one with data attribute, fallback to finding parent
            let targetColumnId = columnEl.dataset.columnId;
            if (!targetColumnId) {
                // If dropped on a child element, find the parent column
                const parentColumn = (e.target as HTMLElement).closest('.kanban-view__column');
                targetColumnId = parentColumn?.getAttribute('data-column-id') || undefined;
            }

            if (taskPath && targetColumnId && targetColumnId !== 'uncategorized') {
                // Get task from cache since we no longer maintain local tasks array
                const task = await this.plugin.cacheManager.getCachedTaskInfo(taskPath);
                if (task) {
                    try {
                        // Map current grouping to actual TaskInfo property
                        let propertyToUpdate: keyof TaskInfo;
                        let valueToSet: any;
                        
                        switch (this.currentQuery.groupKey) {
                            case 'status':
                                propertyToUpdate = 'status';
                                valueToSet = targetColumnId;
                                break;
                            case 'priority':
                                propertyToUpdate = 'priority';
                                valueToSet = targetColumnId;
                                break;
                            case 'context':
                                propertyToUpdate = 'contexts';
                                // For contexts, set as array with single value
                                valueToSet = [targetColumnId];
                                break;
                            case 'project':
                                propertyToUpdate = 'projects';
                                // For projects, set as array with single value
                                valueToSet = targetColumnId === 'No Project' ? [] : [targetColumnId];
                                break;
                            default:
                                throw new Error(`Unsupported groupBy: ${this.currentQuery.groupKey}`);
                        }
                        
                        await this.plugin.updateTaskProperty(task, propertyToUpdate, valueToSet, { silent: true });
                        new Notice(`Task moved to "${this.formatColumnTitle(targetColumnId, this.currentQuery.groupKey)}"`);
                    } catch (error) {
                        console.error('Failed to move task:', error);
                        new Notice('Failed to move task');
                        // Refresh to revert any optimistic updates
                        this.refresh();
                    }
                }
            }
        });
    }

    /**
     * Render board using DOMReconciler for efficient updates
     */
    private renderBoardFromGroupedTasksWithReconciler(groupedTasks: Map<string, TaskInfo[]>) {
        if (!this.boardContainer) return;

        // Get or create board element
        let boardEl = this.boardContainer.querySelector('.kanban-view__board') as HTMLElement;
        if (!boardEl) {
            boardEl = this.boardContainer.createDiv({ cls: 'kanban-view__board' });
        }
        
        // Get all possible columns from the grouped tasks
        const allColumns = Array.from(groupedTasks.keys()).sort();

        // Initialize column order if empty
        if (this.columnOrder.length === 0) {
            this.columnOrder = [...allColumns];
            if (this.columnOrder.length > 0) {
                this.saveColumnOrder();
            }
        }

        // Add any new columns that aren't in our order yet
        let orderChanged = false;
        allColumns.forEach(columnId => {
            if (!this.columnOrder.includes(columnId)) {
                this.columnOrder.push(columnId);
                orderChanged = true;
            }
        });

        // Save column order if it changed
        if (orderChanged) {
            this.saveColumnOrder();
        }

        // Create column data in the stored order
        const orderedColumns = this.columnOrder.map(columnId => ({
            id: columnId,
            tasks: groupedTasks.get(columnId) || []
        }));

        // Use DOMReconciler to update the columns
        this.plugin.domReconciler.updateList(
            boardEl,
            orderedColumns,
            (column) => column.id,
            (column) => this.createColumnElement(column.id, column.tasks),
            (element, column) => this.updateColumnElement(element, column.id, column.tasks)
        );

        // Update task elements tracking
        this.taskElements.clear();
        const taskCards = boardEl.querySelectorAll('.task-card[data-task-path]');
        taskCards.forEach(card => {
            const taskPath = (card as HTMLElement).dataset.taskPath;
            if (taskPath) {
                this.taskElements.set(taskPath, card as HTMLElement);
            }
        });
    }

    /**
     * Create column element for reconciler
     */
    private createColumnElement(columnId: string, tasks: TaskInfo[]): HTMLElement {
        const columnEl = document.createElement('div');
        columnEl.className = 'kanban-view__column';
        columnEl.dataset.columnId = columnId;

        // Add column status classes for styling
        if (columnId === 'uncategorized') {
            columnEl.classList.add('kanban-view__column--uncategorized');
        }

        // Column header
        const headerEl = columnEl.createDiv({ cls: 'kanban-view__column-header' });
        
        // Make columns draggable for reordering
        headerEl.draggable = true;
        headerEl.dataset.columnId = columnId;
        this.addColumnDragHandlers(headerEl);
        
        // Title line
        const title = this.formatColumnTitle(columnId, this.currentQuery.groupKey || 'none');
        headerEl.createEl('div', { text: title, cls: 'kanban-view__column-title' });
        
        // Count line
        headerEl.createEl('div', { 
            text: `${tasks.length} tasks`, 
            cls: 'kanban-view__column-count' 
        });

        // Column body for tasks
        const bodyEl = columnEl.createDiv({ cls: 'kanban-view__column-body' });
        
        // Create tasks container
        const tasksContainer = bodyEl.createDiv({ cls: 'kanban-view__tasks-container' });
        
        if (tasks.length === 0) {
            // Empty column placeholder
            const emptyEl = tasksContainer.createDiv({ 
                cls: 'kanban-view__column-empty',
                text: 'No tasks'
            });
            
            // Make empty columns droppable
            this.addColumnDropHandlers(emptyEl);
        } else {
            // Use DOMReconciler for tasks within this container
            this.plugin.domReconciler.updateList(
                tasksContainer,
                tasks,
                (task) => task.path,
                (task) => this.createTaskCardElement(task),
                (element, task) => this.updateTaskCardElement(element, task)
            );
        }
        
        // Add "Add Card" button
        const addCardButton = bodyEl.createEl('button', {
            cls: 'kanban-view__add-card-button',
            text: '+ Add a card'
        });
        addCardButton.addEventListener('click', () => {
            this.openTaskCreationModalForColumn(columnId);
        });
        
        // Add drop handlers to the column
        this.addColumnDropHandlers(columnEl);
        
        return columnEl;
    }

    /**
     * Update column element for reconciler
     */
    private updateColumnElement(element: HTMLElement, columnId: string, tasks: TaskInfo[]): void {
        // Update count
        const countEl = element.querySelector('.kanban-view__column-count');
        if (countEl) {
            countEl.textContent = `${tasks.length} tasks`;
        }

        // Update body
        const bodyEl = element.querySelector('.kanban-view__column-body') as HTMLElement;
        if (bodyEl) {
            // Preserve the add card button
            const addCardButton = bodyEl.querySelector('.kanban-view__add-card-button');
            
            // Get or create tasks container
            let tasksContainer = bodyEl.querySelector('.kanban-view__tasks-container') as HTMLElement;
            if (!tasksContainer) {
                tasksContainer = bodyEl.createDiv({ cls: 'kanban-view__tasks-container' });
                // Insert before add button if it exists
                if (addCardButton) {
                    bodyEl.insertBefore(tasksContainer, addCardButton);
                } else {
                    bodyEl.appendChild(tasksContainer);
                }
            }
            
            if (tasks.length === 0) {
                // Clear tasks container and show empty state
                tasksContainer.empty();
                const emptyEl = tasksContainer.createDiv({ 
                    cls: 'kanban-view__column-empty',
                    text: 'No tasks'
                });
                this.addColumnDropHandlers(emptyEl);
            } else {
                // Remove empty state if it exists
                const emptyEl = tasksContainer.querySelector('.kanban-view__column-empty');
                if (emptyEl) {
                    emptyEl.remove();
                }
                
                // Use DOMReconciler for task cards within this container
                this.plugin.domReconciler.updateList(
                    tasksContainer,
                    tasks,
                    (task) => task.path,
                    (task) => this.createTaskCardElement(task),
                    (element, task) => this.updateTaskCardElement(element, task)
                );
            }
        }
    }

    /**
     * Create task card element for reconciler
     */
    private createTaskCardElement(task: TaskInfo): HTMLElement {
        const taskCard = createTaskCard(task, this.plugin, {
            showDueDate: true,
            showCheckbox: false,
            showTimeTracking: true
        });
        taskCard.draggable = true;
        this.addDragHandlers(taskCard, task);
        // Update task elements tracking
        this.taskElements.set(task.path, taskCard);
        return taskCard;
    }

    /**
     * Update task card element for reconciler
     */
    private updateTaskCardElement(element: HTMLElement, task: TaskInfo): void {
        updateTaskCard(element, task, this.plugin, {
            showDueDate: true,
            showCheckbox: false,
            showTimeTracking: true
        });
        // Ensure task elements tracking is updated
        this.taskElements.set(task.path, element);
    }

    // Debounced refresh to avoid multiple rapid refreshes
    private debouncedRefresh = debounce(() => {
        this.refresh();
    }, 150);

    private formatColumnTitle(id: string, groupBy: TaskGroupKey): string {
        switch (groupBy) {
            case 'status':
                return this.plugin.statusManager.getStatusConfig(id)?.label || id;
            case 'priority':
                return this.plugin.priorityManager.getPriorityConfig(id)?.label || id;
            case 'context':
                return id === 'uncategorized' ? 'Uncategorized' : `@${id}`;
            case 'project':
                return id === 'No Project' ? 'No Project' : `+${id}`;
            case 'due':
                return id;
            case 'none':
            default:
                return id;
        }
    }


    /**
     * Open task creation modal with pre-populated values based on column
     */
    private openTaskCreationModalForColumn(columnId: string): void {
        // Determine pre-populated values based on current grouping
        let prePopulatedValues: Partial<TaskInfo> = {};
        
        switch (this.currentQuery.groupKey) {
            case 'status':
                if (columnId !== 'uncategorized') {
                    prePopulatedValues.status = columnId;
                }
                break;
            case 'priority':
                if (columnId !== 'uncategorized') {
                    prePopulatedValues.priority = columnId;
                }
                break;
            case 'context':
                if (columnId !== 'uncategorized') {
                    prePopulatedValues.contexts = [columnId];
                }
                break;
            case 'project':
                if (columnId !== 'No Project') {
                    prePopulatedValues.projects = [columnId];
                }
                break;
        }
        
        // Open the task creation modal with pre-populated values
        this.plugin.openTaskCreationModal(prePopulatedValues);
    }

}
