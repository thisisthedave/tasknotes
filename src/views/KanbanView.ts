import { ItemView, WorkspaceLeaf, Notice, Menu } from 'obsidian';
import TaskNotesPlugin from '../main';
import { 
    KANBAN_VIEW_TYPE, 
    EVENT_DATA_CHANGED, 
    EVENT_TASK_UPDATED, 
    TaskInfo 
} from '../types';
import { createTaskCard, updateTaskCard } from '../ui/TaskCard';

export class KanbanView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // UI elements
    private boardContainer: HTMLElement | null = null;
    
    // View state
    private tasks: TaskInfo[] = [];
    private currentGroupBy: 'status' | 'priority' | 'context' = 'status';
    private showArchived: boolean = false;
    private taskElements: Map<string, HTMLElement> = new Map(); // For granular updates
    private searchQuery: string = '';

    // Event listeners
    private listeners: (() => void)[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
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
            this.updateTaskInView(path, updatedTask);
        });
        this.listeners.push(taskUpdateListener);
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

        this.renderHeader(container);
        
        this.boardContainer = container.createDiv({ cls: 'kanban-board-container' });

        await this.loadAndRenderBoard();
    }

    private renderHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: 'kanban-header' });

        // Top row: Board selector and actions
        const topRow = header.createDiv({ cls: 'kanban-header-top' });

        const boardSelectorContainer = topRow.createDiv({ cls: 'kanban-board-selector' });
        const boardInfo = boardSelectorContainer.createDiv({ cls: 'kanban-board-info' });
        boardInfo.createEl('h2', { text: 'Group by:', cls: 'kanban-board-title' });
        
        const groupBySelect = boardInfo.createEl('select', { cls: 'kanban-select' });
        
        const groupOptions = [
            { value: 'status', label: 'Status' },
            { value: 'priority', label: 'Priority' },
            { value: 'context', label: 'Context' }
        ];

        groupOptions.forEach(option => {
            const optionEl = groupBySelect.createEl('option', { 
                value: option.value, 
                text: option.label 
            });
            if (option.value === this.currentGroupBy) {
                optionEl.selected = true;
            }
        });

        groupBySelect.addEventListener('change', async () => {
            this.currentGroupBy = groupBySelect.value as 'status' | 'priority' | 'context';
            await this.loadAndRenderBoard();
        });


        const actions = topRow.createDiv({ cls: 'kanban-actions' });
        
        // Add new task button
        const newTaskButton = actions.createEl('button', { 
            cls: 'kanban-new-task-button tasknotes-button tasknotes-button-primary',
            text: 'New Task'
        });
        newTaskButton.addEventListener('click', () => {
            this.plugin.openTaskCreationModal();
        });

        // Bottom row: Filters and stats
        const filtersRow = header.createDiv({ cls: 'kanban-filters' });
        
        // Simple filter controls
        const filterControls = filtersRow.createDiv({ cls: 'kanban-filter-controls' });
        
        // Search input
        const searchInput = filterControls.createEl('input', { 
            type: 'text',
            placeholder: 'Search tasks...',
            cls: 'kanban-search-input'
        });
        searchInput.value = this.searchQuery;
        searchInput.addEventListener('input', async () => {
            this.searchQuery = searchInput.value;
            await this.loadAndRenderBoard();
        });

        // Archived toggle
        const archivedLabel = filterControls.createEl('label', { cls: 'kanban-checkbox-label' });
        const archivedCheckbox = archivedLabel.createEl('input', { type: 'checkbox' });
        archivedCheckbox.checked = this.showArchived;
        archivedLabel.createSpan({ text: 'Show archived' });
        archivedCheckbox.addEventListener('change', async () => {
            this.showArchived = archivedCheckbox.checked;
            await this.loadAndRenderBoard();
        });

        // Board stats
        const statsContainer = filtersRow.createDiv({ cls: 'kanban-stats' });
        this.updateBoardStats(statsContainer);
    }

    private updateBoardStats(container: HTMLElement) {
        container.empty();
        
        if (this.tasks.length === 0) return;

        const totalTasks = this.tasks.length;
        const completedTasks = this.tasks.filter(task => 
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
            // Fetch all tasks from the cache. The Kanban view is not date-specific.
            this.tasks = await this.plugin.cacheManager.getTasksForDate(new Date(), true);

            // Filter tasks based on view settings
            const filteredTasks = this.tasks.filter(task => {
                // Filter by archived status
                if (!this.showArchived && task.archived) return false;
                
                // Filter by search query
                if (this.searchQuery.trim()) {
                    const query = this.searchQuery.toLowerCase();
                    const matchesTitle = task.title.toLowerCase().includes(query);
                    const matchesContexts = task.contexts?.some(context => 
                        context.toLowerCase().includes(query)
                    ) || false;
                    if (!matchesTitle && !matchesContexts) return false;
                }
                
                return true;
            });

            this.renderBoard(filteredTasks);
            
            // Update stats after rendering
            const statsContainer = this.contentEl.querySelector('.kanban-stats') as HTMLElement;
            if (statsContainer) {
                this.updateBoardStats(statsContainer);
            }
        } catch (error) {
            console.error("Error loading Kanban board:", error);
            new Notice("Failed to load Kanban board. See console for details.");
            this.boardContainer.empty();
            this.boardContainer.createDiv({ cls: 'kanban-error', text: 'Error loading board.' });
        }
    }

    private renderBoard(tasks: TaskInfo[]) {
        if (!this.boardContainer) return;
        this.boardContainer.empty();
        this.taskElements.clear();

        const boardEl = this.boardContainer.createDiv({ cls: 'kanban-board' });

        // Group tasks by the current grouping field
        const groupedTasks = this.groupTasks(tasks, this.currentGroupBy);
        
        // Get all possible columns from the actual tasks
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
        const title = this.formatColumnTitle(columnId, this.currentGroupBy);
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
            // Sort tasks within column by priority, then by title
            const sortedTasks = [...tasks].sort((a, b) => {
                // First by completion status (incomplete first)
                const aCompleted = this.plugin.statusManager.isCompletedStatus(a.status);
                const bCompleted = this.plugin.statusManager.isCompletedStatus(b.status);
                if (aCompleted !== bCompleted) {
                    return aCompleted ? 1 : -1;
                }
                
                // Then by priority
                const priorityCompare = this.plugin.priorityManager.comparePriorities(a.priority, b.priority);
                if (priorityCompare !== 0) return priorityCompare;
                
                // Finally by title
                return a.title.localeCompare(b.title);
            });

            sortedTasks.forEach(task => {
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
        if (!this.boardContainer) return;
        
        // Get current tasks
        const filteredTasks = this.tasks.filter(task => {
            if (!this.showArchived && task.archived) return false;
            if (this.searchQuery.trim()) {
                const query = this.searchQuery.toLowerCase();
                const matchesTitle = task.title.toLowerCase().includes(query);
                const matchesContexts = task.contexts?.some(context => 
                    context.toLowerCase().includes(query)
                ) || false;
                if (!matchesTitle && !matchesContexts) return false;
            }
            return true;
        });

        const boardEl = this.boardContainer.querySelector('.kanban-board') as HTMLElement;
        if (!boardEl) return;

        boardEl.empty();
        this.taskElements.clear();

        // Group tasks by the current grouping field
        const groupedTasks = this.groupTasks(filteredTasks, this.currentGroupBy);
        
        // Render columns in the stored order
        this.columnOrder.forEach(columnId => {
            if (groupedTasks.has(columnId)) {
                const columnTasks = groupedTasks.get(columnId) || [];
                this.renderColumn(boardEl, columnId, columnTasks);
            }
        });

        // Add any new columns that aren't in our order yet
        const allColumns = Array.from(groupedTasks.keys());
        allColumns.forEach(columnId => {
            if (!this.columnOrder.includes(columnId)) {
                this.columnOrder.push(columnId);
                const columnTasks = groupedTasks.get(columnId) || [];
                this.renderColumn(boardEl, columnId, columnTasks);
            }
        });
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
                const task = this.tasks.find(t => t.path === taskPath);
                if (task) {
                    try {
                        // Map current grouping to actual TaskInfo property
                        let propertyToUpdate: keyof TaskInfo;
                        let valueToSet: any;
                        
                        switch (this.currentGroupBy) {
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
                                throw new Error(`Unsupported groupBy: ${this.currentGroupBy}`);
                        }
                        
                        await this.plugin.updateTaskProperty(task, propertyToUpdate, valueToSet, { silent: true });
                        new Notice(`Task moved to "${this.formatColumnTitle(targetColumnId, this.currentGroupBy)}"`);
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

    private groupTasks(tasks: TaskInfo[], groupByField: 'status' | 'priority' | 'context'): Map<string, TaskInfo[]> {
        const grouped = new Map<string, TaskInfo[]>();
        
        tasks.forEach(task => {
            let keys: string[] = [];
            switch (groupByField) {
                case 'status':
                    keys.push(task.status || 'open');
                    break;
                case 'priority':
                    keys.push(task.priority || 'normal');
                    break;
                case 'context':
                    keys = task.contexts && task.contexts.length > 0 ? task.contexts : ['uncategorized'];
                    break;
            }
            
            keys.forEach(key => {
                if (!grouped.has(key)) {
                    grouped.set(key, []);
                }
                grouped.get(key)!.push(task);
            });
        });
        return grouped;
    }
    
    private updateTaskInView(path: string, updatedTask: TaskInfo) {
        // Skip if not currently rendered or if task is filtered out
        if (!this.showArchived && updatedTask.archived) {
            // Task was archived and we're not showing archived tasks - remove it
            this.tasks = this.tasks.filter(t => t.path !== path);
            const taskElement = this.taskElements.get(path);
            if (taskElement) {
                taskElement.remove();
                this.taskElements.delete(path);
            }
            return;
        }

        // Update task in local state
        const taskIndex = this.tasks.findIndex(t => t.path === path);
        if (taskIndex !== -1) {
            this.tasks[taskIndex] = updatedTask;
        } else {
            // Task is new to this view, add it
            this.tasks.push(updatedTask);
        }

        const taskElement = this.taskElements.get(path);

        if (taskElement) {
            // Determine if the task needs to move columns
            const currentColumnEl = taskElement.closest('.kanban-column');
            const currentColumnId = (currentColumnEl as HTMLElement)?.dataset?.columnId;
            
            let newColumnId: string;
            switch(this.currentGroupBy) {
                case 'status': 
                    newColumnId = updatedTask.status || 'open'; 
                    break;
                case 'priority': 
                    newColumnId = updatedTask.priority || 'normal'; 
                    break;
                case 'context': 
                    newColumnId = updatedTask.contexts && updatedTask.contexts.length > 0 ? updatedTask.contexts[0] : 'uncategorized';
                    break;
                default:
                    newColumnId = 'uncategorized';
            }

            if (currentColumnId !== newColumnId) {
                // Task moved to a new column - do a full refresh to avoid DOM issues
                this.debounceRefresh();
            } else {
                // Task updated within the same column - just update the card
                updateTaskCard(taskElement, updatedTask, this.plugin);
            }
        } else {
            // Task element not found, do a delayed refresh to avoid race conditions
            this.debounceRefresh();
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

    private formatColumnTitle(id: string, groupBy: 'status' | 'priority' | 'context'): string {
        switch (groupBy) {
            case 'status':
                return this.plugin.statusManager.getStatusConfig(id)?.label || id;
            case 'priority':
                return this.plugin.priorityManager.getPriorityConfig(id)?.label || id;
            case 'context':
                return id === 'uncategorized' ? 'Uncategorized' : `@${id}`;
        }
        return id;
    }

}
