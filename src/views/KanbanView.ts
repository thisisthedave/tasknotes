import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
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
        
        const refreshButton = actions.createEl('button', { cls: 'kanban-refresh-button' });
        refreshButton.createSpan({ cls: 'kanban-button-icon', text: '🔄' });
        refreshButton.createSpan({ text: 'Refresh' });
        refreshButton.addEventListener('click', () => this.refresh());

        // Bottom row: Filters
        const filtersRow = header.createDiv({ cls: 'kanban-filters' });
        
        const showArchivedFilter = filtersRow.createDiv({ cls: 'kanban-filter' });
        const archivedLabel = showArchivedFilter.createEl('label', { cls: 'kanban-checkbox-label' });
        const archivedCheckbox = archivedLabel.createEl('input', { type: 'checkbox' });
        archivedCheckbox.checked = this.showArchived;
        archivedLabel.createSpan({ text: 'Show archived' });
        archivedCheckbox.addEventListener('change', async () => {
            this.showArchived = archivedCheckbox.checked;
            await this.loadAndRenderBoard();
        });
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
                return this.showArchived || !task.archived;
            });

            this.renderBoard(filteredTasks);
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
            this.boardContainer.createDiv({ text: "Please select or create a board in settings." });
            return;
        }

        const boardEl = this.boardContainer.createDiv({ cls: 'kanban-board' });

        // Group tasks by the specified field
        const groupedTasks = this.groupTasks(tasks, boardConfig.groupByField);

        // Render columns in the specified order
        boardConfig.columnOrder.forEach(columnId => {
            const columnTasks = groupedTasks.get(columnId) || [];
            this.renderColumn(boardEl, columnId, columnTasks, boardConfig);
        });

        // Optionally, render a column for uncategorized tasks
        if (groupedTasks.has('uncategorized')) {
            this.renderColumn(boardEl, 'uncategorized', groupedTasks.get('uncategorized')!, boardConfig);
        }
    }

    private renderColumn(container: HTMLElement, columnId: string, tasks: TaskInfo[], boardConfig: KanbanBoardConfig) {
        const columnEl = container.createDiv({ cls: 'kanban-column' });
        columnEl.dataset.columnId = columnId;

        // Column header
        const headerEl = columnEl.createDiv({ cls: 'kanban-column-header' });
        const title = this.formatColumnTitle(columnId, boardConfig.groupByField);
        headerEl.createEl('h3', { text: title, cls: 'kanban-column-title' });
        headerEl.createSpan({ text: tasks.length.toString(), cls: 'kanban-column-count' });
        
        // Column body for tasks
        const bodyEl = columnEl.createDiv({ cls: 'kanban-column-body' });
        tasks.forEach(task => {
            const taskCard = createTaskCard(task, this.plugin, {
                showDueDate: true,
                showCheckbox: false
            });
            taskCard.draggable = true;
            this.addDragHandlers(taskCard, task);
            bodyEl.appendChild(taskCard);
            this.taskElements.set(task.path, taskCard);
        });
        
        // Add drop handlers to the column
        this.addColumnDropHandlers(columnEl, boardConfig);
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
