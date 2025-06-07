import { ItemView, WorkspaceLeaf, Notice, Menu } from 'obsidian';
import TaskNotesPlugin from '../main';
import { 
    KANBAN_VIEW_TYPE, 
    EVENT_DATA_CHANGED, 
    EVENT_TASK_UPDATED, 
    TaskInfo,
    FilterQuery,
    TaskGroupKey
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

    // Event listeners
    private listeners: (() => void)[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Initialize with saved state or default query for Kanban
        const savedQuery = this.plugin.viewStateManager?.getFilterState(KANBAN_VIEW_TYPE);
        this.currentQuery = savedQuery || {
            searchQuery: undefined,
            status: 'all',
            contexts: undefined,
            priorities: undefined,
            dateRange: undefined,
            showArchived: false,
            sortKey: 'priority',
            sortDirection: 'desc',
            groupKey: 'status' // Kanban default grouping
        };
        
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
        this.listeners.forEach(unsubscribe => unsubscribe());
        this.listeners = [];

        const dataListener = this.plugin.emitter.on(EVENT_DATA_CHANGED, () => this.refresh());
        this.listeners.push(dataListener);

        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, ({ path, updatedTask }) => {
            this.refresh(); // Simpler approach - just refresh on task updates
        });
        this.listeners.push(taskUpdateListener);
        
        // Listen for filter service data changes
        const filterDataListener = this.plugin.filterService.on('data-changed', () => {
            this.refresh();
        });
        this.listeners.push(filterDataListener);
    }

    async onOpen() {
        this.contentEl.empty();
        await this.render();
    }

    async onClose() {
        this.listeners.forEach(unsubscribe => unsubscribe());
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = null;
        }
        
        // Clean up FilterBar
        if (this.filterBar) {
            this.filterBar.destroy();
            this.filterBar = null;
        }
        
        this.contentEl.empty();
    }

    async refresh() {
        // Full re-render on refresh
        await this.render();
    }

    async render() {
        const container = this.contentEl;
        container.empty();
        container.addClass('kanban-view');

        await this.renderHeader(container);
        
        this.boardContainer = container.createDiv({ cls: 'kanban-board-container' });

        await this.loadAndRenderBoard();
    }

    private async renderHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: 'kanban-header' });

        // FilterBar container
        const filterBarContainer = header.createDiv({ cls: 'kanban-filter-bar-container' });
        
        // Get filter options from FilterService
        const filterOptions = await this.plugin.filterService.getFilterOptions();
        
        // Create FilterBar with Kanban configuration
        this.filterBar = new FilterBar(
            filterBarContainer,
            this.currentQuery,
            filterOptions,
            {
                showSearch: true,
                showGroupBy: true, // Allow changing grouping field
                showSortBy: true,
                showAdvancedFilters: true,
                allowedSortKeys: ['priority', 'title', 'due'],
                allowedGroupKeys: ['status', 'priority', 'context']
            }
        );
        
        // Listen for filter changes
        this.filterBar.on('queryChange', (newQuery: FilterQuery) => {
            this.currentQuery = newQuery;
            // Save the filter state
            this.plugin.viewStateManager.setFilterState(KANBAN_VIEW_TYPE, newQuery);
            this.loadAndRenderBoard();
        });

        // Actions row
        const actionsRow = header.createDiv({ cls: 'kanban-header-actions' });
        
        // Add new task button
        const newTaskButton = actionsRow.createEl('button', { 
            cls: 'kanban-new-task-button tasknotes-button tasknotes-button-primary',
            text: 'New Task'
        });
        newTaskButton.addEventListener('click', () => {
            this.plugin.openTaskCreationModal();
        });

        // Board stats
        const statsContainer = header.createDiv({ cls: 'kanban-stats' });
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
                cls: 'board-stats-simple'
            });
        }
    }

    private async loadAndRenderBoard() {
        if (!this.boardContainer) return;
        this.boardContainer.empty();
        this.boardContainer.createDiv({ cls: 'loading-indicator', text: 'Loading board...' });

        try {
            // Get grouped tasks from FilterService
            const groupedTasks = await this.plugin.filterService.getGroupedTasks(this.currentQuery);
            
            // Render the grouped tasks directly
            this.renderBoardFromGroupedTasks(groupedTasks);
            
            // Calculate stats from all tasks
            const allTasks = Array.from(groupedTasks.values()).flat();
            
            // Update stats after rendering
            const statsContainer = this.contentEl.querySelector('.kanban-stats') as HTMLElement;
            if (statsContainer) {
                this.updateBoardStats(statsContainer, allTasks);
            }
        } catch (error) {
            console.error("Error loading Kanban board:", error);
            new Notice("Failed to load Kanban board. See console for details.");
            this.boardContainer.empty();
            this.boardContainer.createDiv({ cls: 'kanban-error', text: 'Error loading board.' });
        }
    }

    private renderBoardFromGroupedTasks(groupedTasks: Map<string, TaskInfo[]>) {
        if (!this.boardContainer) return;
        this.boardContainer.empty();
        this.taskElements.clear();

        const boardEl = this.boardContainer.createDiv({ cls: 'kanban-board' });
        
        // Get all possible columns from the grouped tasks
        const allColumns = Array.from(groupedTasks.keys()).sort();

        // Render columns
        allColumns.forEach(columnId => {
            const columnTasks = groupedTasks.get(columnId) || [];
            this.renderColumn(boardEl, columnId, columnTasks);
        });
    }


    private renderColumn(container: HTMLElement, columnId: string, tasks: TaskInfo[]) {
        const columnEl = container.createDiv({ cls: 'kanban-column' });
        columnEl.dataset.columnId = columnId;

        // Add column status classes for styling
        if (columnId === 'uncategorized') {
            columnEl.addClass('uncategorized-column');
        }

        // Column header
        const headerEl = columnEl.createDiv({ cls: 'kanban-column-header' });
        
        // Make columns draggable for reordering
        headerEl.draggable = true;
        headerEl.dataset.columnId = columnId;
        this.addColumnDragHandlers(headerEl);
        
        // Title line
        const title = this.formatColumnTitle(columnId, this.currentQuery.groupKey);
        headerEl.createEl('div', { text: title, cls: 'kanban-column-title' });
        
        // Count line
        headerEl.createEl('div', { 
            text: `${tasks.length} tasks`, 
            cls: 'kanban-column-count' 
        });

        
        // Column body for tasks
        const bodyEl = columnEl.createDiv({ cls: 'kanban-column-body' });
        
        if (tasks.length === 0) {
            // Empty column placeholder
            const emptyEl = bodyEl.createDiv({ 
                cls: 'kanban-column-empty',
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
            headerEl.classList.add('is-dragging-column');
        });

        headerEl.addEventListener('dragend', () => {
            headerEl.classList.remove('is-dragging-column');
        });

        headerEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                const data = e.dataTransfer.getData('text/plain');
                if (data.startsWith('column:')) {
                    e.dataTransfer.dropEffect = 'move';
                    headerEl.classList.add('column-drop-target');
                }
            }
        });

        headerEl.addEventListener('dragleave', () => {
            headerEl.classList.remove('column-drop-target');
        });

        headerEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            headerEl.classList.remove('column-drop-target');

            const data = e.dataTransfer?.getData('text/plain');
            if (data?.startsWith('column:')) {
                const sourceColumnId = data.replace('column:', '');
                const targetColumnId = headerEl.dataset.columnId;

                if (sourceColumnId && targetColumnId && sourceColumnId !== targetColumnId) {
                    await this.reorderColumns(sourceColumnId, targetColumnId);
                }
            }
        });
    }

    private columnOrder: string[] = [];

    private async reorderColumns(sourceColumnId: string, targetColumnId: string) {
        // Get current column order or create it from DOM
        if (this.columnOrder.length === 0) {
            const columns = this.boardContainer?.querySelectorAll('.kanban-column');
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

        // Re-render the board with new order
        this.renderBoardWithOrder();
    }

    private async renderBoardWithOrder() {
        // This method is no longer used - FilterService handles grouping
        // Keeping for potential future use with column reordering
        console.log('renderBoardWithOrder is deprecated - using FilterService instead');
    }

    private addDragHandlers(card: HTMLElement, task: TaskInfo) {
        card.addEventListener('dragstart', (e) => {
            if (e.dataTransfer) {
                e.dataTransfer.setData('text/plain', task.path);
                e.dataTransfer.effectAllowed = 'move';
            }
            setTimeout(() => card.classList.add('is-dragging'), 0);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('is-dragging');
        });
    }

    private addColumnDropHandlers(columnEl: HTMLElement) {
        columnEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            columnEl.classList.add('is-dragover');
        });

        columnEl.addEventListener('dragleave', () => {
            columnEl.classList.remove('is-dragover');
        });

        columnEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            columnEl.classList.remove('is-dragover');

            const taskPath = e.dataTransfer?.getData('text/plain');
            const targetColumnId = columnEl.dataset.columnId;

            if (taskPath && targetColumnId && targetColumnId !== 'uncategorized') {
                // Get task from cache since we no longer maintain local tasks array
                const task = this.plugin.cacheManager.getCachedTaskInfo(taskPath);
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

    private formatColumnTitle(id: string, groupBy: TaskGroupKey): string {
        switch (groupBy) {
            case 'status':
                return this.plugin.statusManager.getStatusConfig(id)?.label || id;
            case 'priority':
                return this.plugin.priorityManager.getPriorityConfig(id)?.label || id;
            case 'context':
                return id === 'uncategorized' ? 'Uncategorized' : `@${id}`;
            case 'due':
                return id;
            case 'none':
            default:
                return id;
        }
    }

}
