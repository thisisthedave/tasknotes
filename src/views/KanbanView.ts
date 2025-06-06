import { ItemView, WorkspaceLeaf, Notice, Menu } from 'obsidian';
import TaskNotesPlugin from '../main';
import { 
    KANBAN_VIEW_TYPE, 
    EVENT_DATA_CHANGED, 
    EVENT_TASK_UPDATED, 
    TaskInfo, 
    KanbanBoardConfig 
} from '../types';
import { createTaskCard, updateTaskCard } from '../ui/TaskCard';

export class KanbanView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // UI elements
    private boardContainer: HTMLElement | null = null;
    
    // View state
    private tasks: TaskInfo[] = [];
    private currentBoardId: string | null = null;
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
        boardInfo.createEl('h2', { text: 'Board:', cls: 'kanban-board-title' });
        
        const boardSelect = boardInfo.createEl('select', { cls: 'kanban-select' });
        const boards = this.plugin.settings.kanbanBoards;

        if (boards.length > 0) {
            // Set default board if none selected
            if (!this.currentBoardId || !boards.some(b => b.id === this.currentBoardId)) {
                this.currentBoardId = boards[0].id;
            }

            boards.forEach(board => {
                const option = boardSelect.createEl('option', { value: board.id, text: board.name });
                if (board.id === this.currentBoardId) {
                    option.selected = true;
                }
            });

            boardSelect.addEventListener('change', async () => {
                this.currentBoardId = boardSelect.value;
                await this.loadAndRenderBoard();
            });
        } else {
            boardSelect.createEl('option', { text: 'No boards configured' }).disabled = true;
        }


        const actions = topRow.createDiv({ cls: 'kanban-actions' });
        
        // Add new task button
        const newTaskButton = actions.createEl('button', { 
            cls: 'kanban-new-task-button tasknotes-button tasknotes-button-primary' 
        });
        newTaskButton.createSpan({ cls: 'kanban-button-icon', text: '➕' });
        newTaskButton.createSpan({ text: 'New Task' });
        newTaskButton.addEventListener('click', () => {
            this.plugin.openTaskCreationModal();
        });
        
        const refreshButton = actions.createEl('button', { 
            cls: 'kanban-refresh-button tasknotes-button' 
        });
        refreshButton.createSpan({ cls: 'kanban-button-icon', text: '🔄' });
        refreshButton.createSpan({ text: 'Refresh' });
        refreshButton.addEventListener('click', () => this.refresh());

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

        const boardConfig = this.getCurrentBoardConfig();
        if (!boardConfig) {
            this.boardContainer.createDiv({ 
                cls: 'kanban-empty-state',
                text: "Please select or create a board in settings." 
            });
            return;
        }

        const boardEl = this.boardContainer.createDiv({ cls: 'kanban-board' });

        // Group tasks by the specified field
        const groupedTasks = this.groupTasks(tasks, boardConfig.groupByField);
        
        // Get all possible columns (from config + discovered from tasks)
        const allColumns = this.getAllColumns(groupedTasks, boardConfig);

        // Render columns in the determined order
        allColumns.forEach(columnId => {
            const columnTasks = groupedTasks.get(columnId) || [];
            this.renderColumn(boardEl, columnId, columnTasks, boardConfig);
        });
    }

    private getAllColumns(groupedTasks: Map<string, TaskInfo[]>, boardConfig: KanbanBoardConfig): string[] {
        // Just show all columns that have tasks, always
        const allColumns: string[] = [];
        const discoveredColumns = Array.from(groupedTasks.keys());
        
        // Start with configured columns that have tasks
        for (const configuredColumn of boardConfig.columnOrder) {
            if (discoveredColumns.includes(configuredColumn)) {
                allColumns.push(configuredColumn);
            }
        }
        
        // Add any other discovered columns that aren't configured
        for (const columnId of discoveredColumns) {
            if (!boardConfig.columnOrder.includes(columnId)) {
                if (columnId === 'uncategorized') {
                    // Add uncategorized at the end
                    continue;
                } else {
                    allColumns.push(columnId);
                }
            }
        }
        
        // Add uncategorized at the end if it exists
        if (discoveredColumns.includes('uncategorized')) {
            allColumns.push('uncategorized');
        }
        
        return allColumns;
    }

    private renderColumn(container: HTMLElement, columnId: string, tasks: TaskInfo[], boardConfig: KanbanBoardConfig) {
        const columnEl = container.createDiv({ cls: 'kanban-column' });
        columnEl.dataset.columnId = columnId;

        // Add column status classes for styling
        if (columnId === 'uncategorized') {
            columnEl.addClass('uncategorized-column');
        }

        // Column header
        const headerEl = columnEl.createDiv({ cls: 'kanban-column-header' });
        
        // Make all columns draggable for reordering
        headerEl.draggable = true;
        headerEl.dataset.columnId = columnId;
        this.addColumnDragHandlers(headerEl, boardConfig);
        
        // Title and count container
        const titleContainer = headerEl.createDiv({ cls: 'column-title-container' });
        const title = this.formatColumnTitle(columnId, boardConfig.groupByField);
        titleContainer.createEl('h3', { text: title, cls: 'kanban-column-title' });
        
        // Simple task count
        if (tasks.length > 0) {
            titleContainer.createSpan({ 
                text: ` (${tasks.length})`, 
                cls: 'kanban-column-count-simple' 
            });
        }

        
        // Column body for tasks
        const bodyEl = columnEl.createDiv({ cls: 'kanban-column-body' });
        
        if (tasks.length === 0) {
            // Empty column placeholder
            const emptyEl = bodyEl.createDiv({ 
                cls: 'kanban-column-empty',
                text: 'No tasks'
            });
            
            // Make empty columns droppable
            this.addColumnDropHandlers(emptyEl, boardConfig);
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
        this.addColumnDropHandlers(columnEl, boardConfig);
    }


    private addColumnDragHandlers(headerEl: HTMLElement, boardConfig: KanbanBoardConfig) {
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
                    await this.reorderColumns(sourceColumnId, targetColumnId, boardConfig);
                }
            }
        });
    }

    private async reorderColumns(sourceColumnId: string, targetColumnId: string, boardConfig: KanbanBoardConfig) {
        try {
            // Add columns to config if they're not already there
            if (!boardConfig.columnOrder.includes(sourceColumnId)) {
                boardConfig.columnOrder.push(sourceColumnId);
            }
            if (!boardConfig.columnOrder.includes(targetColumnId)) {
                boardConfig.columnOrder.push(targetColumnId);
            }

            const sourceIndex = boardConfig.columnOrder.indexOf(sourceColumnId);
            const targetIndex = boardConfig.columnOrder.indexOf(targetColumnId);

            if (sourceIndex === -1 || targetIndex === -1) return;

            // Remove source column from its current position
            const [movedColumn] = boardConfig.columnOrder.splice(sourceIndex, 1);
            
            // Insert it at the target position
            boardConfig.columnOrder.splice(targetIndex, 0, movedColumn);

            await this.plugin.saveSettings();
            this.refresh();

            new Notice(`Moved "${this.formatColumnTitle(sourceColumnId, boardConfig.groupByField)}" column`);
        } catch (error) {
            console.error('Failed to reorder columns:', error);
            new Notice('Failed to reorder columns');
        }
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

    private addColumnDropHandlers(columnEl: HTMLElement, boardConfig: KanbanBoardConfig) {
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
                        // Map groupByField to actual TaskInfo property
                        let propertyToUpdate: keyof TaskInfo;
                        let valueToSet: any;
                        
                        switch (boardConfig.groupByField) {
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
                                throw new Error(`Unsupported groupByField: ${boardConfig.groupByField}`);
                        }
                        
                        await this.plugin.taskService.updateProperty(task, propertyToUpdate, valueToSet, { silent: true });
                        new Notice(`Task moved to "${this.formatColumnTitle(targetColumnId, boardConfig.groupByField)}"`);
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
        const boardConfig = this.getCurrentBoardConfig();

        if (taskElement && boardConfig) {
            // Determine if the task needs to move columns
            const currentColumnEl = taskElement.closest('.kanban-column');
            const currentColumnId = (currentColumnEl as HTMLElement)?.dataset?.columnId;
            
            let newColumnId: string;
            switch(boardConfig.groupByField) {
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

    
    private getCurrentBoardConfig(): KanbanBoardConfig | undefined {
        return this.plugin.settings.kanbanBoards.find(b => b.id === this.currentBoardId);
    }
}
