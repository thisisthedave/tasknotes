import { ItemView, WorkspaceLeaf, Notice, Menu } from 'obsidian';
import TaskNotesPlugin from '../main';
import { 
	KANBAN_VIEW_TYPE, 
	TaskInfo, 
	KanbanBoardConfig, 
	KanbanGroupByField,
	EVENT_DATA_CHANGED,
	EVENT_TASK_UPDATED 
} from '../types';
import { createTaskCard, updateTaskCard } from '../ui/TaskCard';
import { DOMReconciler } from '../utils/DOMReconciler';

interface KanbanFilters {
	contexts: string[];
	showArchived: boolean;
}

export class KanbanView extends ItemView {
	plugin: TaskNotesPlugin;
	private kanbanContainerEl: HTMLElement;
	private currentBoardId: string;
	private filters: KanbanFilters = {
		contexts: [],
		showArchived: false
	};
	
	private domReconciler: DOMReconciler;
	private unsubscribeDataChanged?: () => void;
	private unsubscribeTaskUpdated?: () => void;
	
	constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.domReconciler = new DOMReconciler();
		
		// Set default board
		this.currentBoardId = this.plugin.settings.kanbanBoards[0]?.id || 'default-status-board';
	}

	getViewType(): string {
		return KANBAN_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Kanban Board';
	}

	getIcon(): string {
		return 'layout-grid';
	}

	async onOpen() {
		// Set up event listeners
		this.unsubscribeDataChanged = this.plugin.emitter.on(EVENT_DATA_CHANGED, this.refreshBoard.bind(this));
		this.unsubscribeTaskUpdated = this.plugin.emitter.on(EVENT_TASK_UPDATED, ({ path, updatedTask }) => {
			this.handleTaskUpdate(path, updatedTask);
		});
		
		await this.render();
	}

	async onClose() {
		// Clean up event listeners
		if (this.unsubscribeDataChanged) {
			this.unsubscribeDataChanged();
		}
		if (this.unsubscribeTaskUpdated) {
			this.unsubscribeTaskUpdated();
		}
	}

	async render() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('kanban-view');

		// Create header
		await this.renderHeader(contentEl);

		// Create board container
		this.kanbanContainerEl = contentEl.createDiv('kanban-board-container');
		
		await this.refreshBoard();
	}

	private async renderHeader(container: HTMLElement) {
		const header = container.createDiv('kanban-header');

		// Header top row - Board selector and actions
		const headerTop = header.createDiv('kanban-header-top');
		
		// Board info section
		const boardInfo = headerTop.createDiv('kanban-board-info');
		
		// Board selector
		const boardSelectorContainer = boardInfo.createDiv('kanban-board-selector');
		boardSelectorContainer.createSpan({ text: 'Board:', cls: 'kanban-label' });
		
		const boardSelect = boardSelectorContainer.createEl('select', { cls: 'kanban-select' });
		
		// Populate board options
		this.plugin.settings.kanbanBoards.forEach(board => {
			const option = boardSelect.createEl('option', {
				value: board.id,
				text: board.name
			});
			if (board.id === this.currentBoardId) {
				option.selected = true;
			}
		});
		
		// Add "Create New Board" option
		boardSelect.createEl('option', {
			value: '__create_new__',
			text: '+ Create New Board'
		});

		boardSelect.addEventListener('change', async (e) => {
			const target = e.target as HTMLSelectElement;
			if (target.value === '__create_new__') {
				await this.createNewBoard();
				// Reset to current board
				target.value = this.currentBoardId;
			} else {
				this.currentBoardId = target.value;
				await this.refreshBoard();
			}
		});

		// Actions section
		const actions = headerTop.createDiv('kanban-actions');
		
		// Configure button with icon
		const configButton = actions.createEl('button', { 
			cls: 'kanban-config-button'
		});
		configButton.createSpan({ text: '⚙️', cls: 'kanban-button-icon' });
		configButton.createSpan({ text: 'Configure' });
		configButton.addEventListener('click', () => {
			// Open settings to Kanban tab
			(this.app as any).setting.open();
			(this.app as any).setting.openTabById('kanban');
		});

		// Refresh button with icon
		const refreshButton = actions.createEl('button', { 
			cls: 'kanban-refresh-button'
		});
		refreshButton.createSpan({ text: '🔄', cls: 'kanban-button-icon' });
		refreshButton.createSpan({ text: 'Refresh' });
		refreshButton.addEventListener('click', () => {
			this.plugin.notifyDataChanged(undefined, true);
		});

		// Filters section
		const filtersContainer = header.createDiv('kanban-filters');
		
		// Context filter
		const contextContainer = filtersContainer.createDiv('kanban-filter');
		contextContainer.createSpan({ text: 'Contexts:', cls: 'kanban-label' });
		
		const contextSelect = contextContainer.createEl('select', { 
			cls: 'kanban-select',
			attr: { multiple: 'true', size: '1' }
		});
		
		// Add "All contexts" option
		const allOption = contextSelect.createEl('option', {
			value: '',
			text: 'All contexts'
		});
		if (this.filters.contexts.length === 0) {
			allOption.selected = true;
		}
		
		// Get all unique contexts from tasks
		const allContexts = await this.getAllContexts();
		allContexts.forEach(context => {
			const option = contextSelect.createEl('option', {
				value: context,
				text: `@${context}`
			});
			if (this.filters.contexts.includes(context)) {
				option.selected = true;
			}
		});

		contextSelect.addEventListener('change', async () => {
			const selectedValues = Array.from(contextSelect.selectedOptions).map(opt => opt.value).filter(v => v !== '');
			this.filters.contexts = selectedValues;
			await this.refreshBoard();
		});

		// Archive toggle with better styling
		const archiveContainer = filtersContainer.createDiv('kanban-filter');
		const archiveLabel = archiveContainer.createEl('label', { cls: 'kanban-checkbox-label' });
		
		const archiveCheckbox = archiveLabel.createEl('input', { type: 'checkbox' });
		archiveCheckbox.checked = this.filters.showArchived;
		archiveLabel.createSpan({ text: 'Show Archived Tasks' });

		archiveCheckbox.addEventListener('change', async () => {
			this.filters.showArchived = archiveCheckbox.checked;
			await this.refreshBoard();
		});
	}

	private async createNewBoard() {
		const name = prompt('Enter board name:', 'New Board');
		if (!name) return;

		const newBoard: KanbanBoardConfig = {
			id: `board-${Date.now()}`,
			name: name,
			groupByField: 'status',
			columnOrder: ['open', 'in-progress', 'done']
		};

		this.plugin.settings.kanbanBoards.push(newBoard);
		await this.plugin.saveSettings();
		
		this.currentBoardId = newBoard.id;
		await this.render(); // Re-render to update board selector
	}

	private async getAllContexts(): Promise<string[]> {
		// Get all tasks and extract unique contexts
		const allTasks = await this.plugin.cacheManager.getTasksForDate(new Date());
		const contexts = new Set<string>();
		
		allTasks.forEach((task: TaskInfo) => {
			if (task.contexts) {
				task.contexts.forEach((context: string) => contexts.add(context));
			}
		});
		
		return Array.from(contexts).sort();
	}

	/**
	 * Handle incremental task updates - much more efficient than full re-render
	 */
	private handleTaskUpdate(path: string, updatedTask: TaskInfo | null): void {
		if (!this.kanbanContainerEl) return;

		const currentBoard = this.plugin.settings.kanbanBoards.find(b => b.id === this.currentBoardId);
		if (!currentBoard) return;

		// Find existing task card in DOM
		const existingCardEl = this.kanbanContainerEl.querySelector(`[data-task-path="${path}"]`) as HTMLElement;
		
		// Handle task deletion or if it's no longer a task
		if (!updatedTask) {
			if (existingCardEl) {
				this.removeTaskCard(existingCardEl);
			}
			return;
		}

		// Check if this task should be visible based on current filters
		const shouldBeVisible = this.shouldTaskBeVisible(updatedTask);
		
		if (!shouldBeVisible) {
			// Task should be hidden - remove it if it exists
			if (existingCardEl) {
				this.removeTaskCard(existingCardEl);
			}
			return;
		}

		// Determine which column this task belongs to
		const newColumnValue = this.getTaskColumnValue(updatedTask, currentBoard);
		const newColumnEl = this.kanbanContainerEl.querySelector(`[data-column-value="${newColumnValue}"] .kanban-column-body`) as HTMLElement;
		
		if (!newColumnEl) {
			// Column doesn't exist, fall back to full refresh
			this.refreshBoard();
			return;
		}

		if (existingCardEl) {
			// Task card already exists - check if it needs to move columns
			const currentColumnEl = existingCardEl.closest('.kanban-column-body') as HTMLElement;
			const currentColumnValue = currentColumnEl?.getAttribute('data-column-value');

			if (currentColumnValue === newColumnValue) {
				// Same column - just update the card content in place
				updateTaskCard(existingCardEl, updatedTask, this.plugin);
			} else {
				// Different column - move the card
				this.moveTaskCard(existingCardEl, currentColumnEl, newColumnEl);
				updateTaskCard(existingCardEl, updatedTask, this.plugin);
			}
		} else {
			// Task card doesn't exist - create and add it
			const newCardEl = createTaskCard(updatedTask, this.plugin);
			this.setupCardInteractions(newCardEl, updatedTask);
			newColumnEl.appendChild(newCardEl);
		}

		// Update column counts
		this.updateColumnCounts();
	}

	/**
	 * Check if a task should be visible based on current filters
	 */
	private shouldTaskBeVisible(task: TaskInfo): boolean {
		// Archive filter
		if (!this.filters.showArchived && task.archived) return false;
		
		// Context filter
		if (this.filters.contexts.length > 0) {
			if (!task.contexts || !task.contexts.some((context: string) => this.filters.contexts.includes(context))) {
				return false;
			}
		}
		
		return true;
	}

	/**
	 * Remove a task card from the DOM and update counts
	 */
	private removeTaskCard(cardEl: HTMLElement): void {
		const columnEl = cardEl.closest('.kanban-column-body') as HTMLElement;
		cardEl.remove();
		if (columnEl) {
			this.updateColumnCount(columnEl);
		}
	}

	/**
	 * Move a task card from one column to another
	 */
	private moveTaskCard(cardEl: HTMLElement, fromColumnEl: HTMLElement, toColumnEl: HTMLElement): void {
		cardEl.remove();
		toColumnEl.appendChild(cardEl);
		
		// Update counts for both columns
		this.updateColumnCount(fromColumnEl);
		this.updateColumnCount(toColumnEl);
	}

	/**
	 * Update the task count for a specific column
	 */
	private updateColumnCount(columnBodyEl: HTMLElement): void {
		const columnEl = columnBodyEl.closest('.kanban-column') as HTMLElement;
		if (!columnEl) return;

		const countEl = columnEl.querySelector('.kanban-column-count') as HTMLElement;
		if (!countEl) return;

		const taskCount = columnBodyEl.querySelectorAll('[data-task-path]').length;
		countEl.textContent = taskCount.toString();
	}

	/**
	 * Update all column counts
	 */
	private updateColumnCounts(): void {
		const columnBodyEls = this.kanbanContainerEl.querySelectorAll('.kanban-column-body');
		columnBodyEls.forEach((columnBodyEl) => {
			this.updateColumnCount(columnBodyEl as HTMLElement);
		});
	}

	/**
	 * Set up drag/drop and click interactions for a task card
	 */
	private setupCardInteractions(cardEl: HTMLElement, task: TaskInfo): void {
		// Make card draggable first
		this.makeDraggable(cardEl, task);
		
		// Add click handlers - need to be careful not to interfere with drag
		cardEl.addEventListener('click', (e) => {
			// Don't handle clicks if we just finished dragging
			if (cardEl.hasClass('is-dragging') || cardEl.dataset.justDragged === 'true') {
				return;
			}
			
			if (e.ctrlKey || e.metaKey) {
				// Ctrl+Click: open source file
				this.openTaskFile(task);
			} else {
				// Regular click: open edit modal
				this.plugin.openTaskEditModal(task);
			}
		});

		// Add context menu
		cardEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showTaskContextMenu(e, task, cardEl);
		});
	}

	private async refreshBoard() {
		if (!this.kanbanContainerEl) return;

		const currentBoard = this.plugin.settings.kanbanBoards.find(b => b.id === this.currentBoardId);
		if (!currentBoard) return;

		// Get all tasks
		const allTasks = await this.plugin.cacheManager.getTasksForDate(new Date());
		
		// Apply filters
		const filteredTasks = allTasks.filter((task: TaskInfo) => {
			return this.shouldTaskBeVisible(task);
		});

		// Group tasks by the current board's grouping field
		const groupedTasks = this.groupTasks(filteredTasks, currentBoard);
		
		// Render the board
		this.renderBoard(groupedTasks, currentBoard);
	}

	private groupTasks(tasks: TaskInfo[], board: KanbanBoardConfig): Map<string, TaskInfo[]> {
		const groups = new Map<string, TaskInfo[]>();
		
		// Initialize groups based on column order
		board.columnOrder.forEach(columnValue => {
			groups.set(columnValue, []);
		});
		
		// Add an "Uncategorized" group for tasks that don't fit
		groups.set('uncategorized', []);

		tasks.forEach(task => {
			let groupKey = 'uncategorized';
			
			switch (board.groupByField) {
				case 'status':
					if (task.status && board.columnOrder.includes(task.status)) {
						groupKey = task.status;
					}
					break;
				case 'priority':
					if (task.priority && board.columnOrder.includes(task.priority)) {
						groupKey = task.priority;
					}
					break;
				case 'context':
					// For context, use the first context that matches a column
					if (task.contexts) {
						const matchingContext = task.contexts.find(context => board.columnOrder.includes(context));
						if (matchingContext) {
							groupKey = matchingContext;
						}
					}
					break;
			}
			
			groups.get(groupKey)?.push(task);
		});

		return groups;
	}

	private renderBoard(groupedTasks: Map<string, TaskInfo[]>, board: KanbanBoardConfig) {
		this.kanbanContainerEl.empty();

		const boardEl = this.kanbanContainerEl.createDiv('kanban-board');
		
		// Render columns
		board.columnOrder.forEach(columnValue => {
			this.renderColumn(boardEl, columnValue, groupedTasks.get(columnValue) || [], board);
		});

		// Render uncategorized column if it has tasks
		const uncategorizedTasks = groupedTasks.get('uncategorized') || [];
		if (uncategorizedTasks.length > 0) {
			this.renderColumn(boardEl, 'uncategorized', uncategorizedTasks, board);
		}
	}

	private renderColumn(container: HTMLElement, columnValue: string, tasks: TaskInfo[], board: KanbanBoardConfig) {
		const column = container.createDiv('kanban-column');
		column.setAttribute('data-column-value', columnValue);

		// Column header
		const header = column.createDiv('kanban-column-header');
		
		let displayName = columnValue;
		if (board.groupByField === 'status') {
			const statusConfig = this.plugin.settings.customStatuses.find(s => s.value === columnValue);
			displayName = statusConfig?.label || columnValue;
		} else if (board.groupByField === 'priority') {
			const priorityConfig = this.plugin.settings.customPriorities.find(p => p.value === columnValue);
			displayName = priorityConfig?.label || columnValue;
		}

		header.createSpan({ text: displayName, cls: 'kanban-column-title' });
		header.createSpan({ text: `${tasks.length}`, cls: 'kanban-column-count' });

		// Column body (droppable area)
		const body = column.createDiv('kanban-column-body');
		body.setAttribute('data-column-value', columnValue);
		
		// Make column droppable
		this.makeDroppable(body, columnValue, board);

		// Render task cards
		tasks.forEach(task => {
			const cardEl = createTaskCard(task, this.plugin);
			body.appendChild(cardEl);
			
			// Set up all interactions
			this.setupCardInteractions(cardEl, task);
		});
	}

	private makeDraggable(cardEl: HTMLElement, task: TaskInfo) {
		cardEl.draggable = true;
		cardEl.setAttribute('data-task-path', task.path);
		
		// Add visual cursor feedback
		cardEl.style.cursor = 'grab';

		cardEl.addEventListener('dragstart', (e) => {
			if (e.dataTransfer) {
				e.dataTransfer.setData('text/plain', task.path);
				e.dataTransfer.effectAllowed = 'move';
			}
			cardEl.addClass('is-dragging');
			cardEl.style.cursor = 'grabbing';
			
			// Mark that we're dragging to prevent click events
			cardEl.dataset.justDragged = 'true';
		});

		cardEl.addEventListener('dragend', () => {
			cardEl.removeClass('is-dragging');
			cardEl.style.cursor = 'grab';
			
			// Clear the drag flag after a short delay
			setTimeout(() => {
				delete cardEl.dataset.justDragged;
			}, 100);
		});
		
		// Prevent click events during drag
		cardEl.addEventListener('mousedown', (e) => {
			// Clear any previous drag flags when starting a new interaction
			delete cardEl.dataset.justDragged;
		});
	}

	private makeDroppable(columnEl: HTMLElement, columnValue: string, board: KanbanBoardConfig) {
		columnEl.addEventListener('dragover', (e) => {
			e.preventDefault();
			e.dataTransfer!.dropEffect = 'move';
			columnEl.addClass('is-dragover');
		});

		columnEl.addEventListener('dragleave', () => {
			columnEl.removeClass('is-dragover');
		});

		columnEl.addEventListener('drop', async (e) => {
			e.preventDefault();
			columnEl.removeClass('is-dragover');

			const taskPath = e.dataTransfer?.getData('text/plain');
			if (!taskPath) return;

			// Find the task
			const allTasks = await this.plugin.cacheManager.getTasksForDate(new Date());
			const task = allTasks.find((t: TaskInfo) => t.path === taskPath);
			if (!task) return;

			// Don't update if dropping on the same column
			const currentValue = this.getTaskColumnValue(task, board);
			if (currentValue === columnValue) return;

			// Update the task property
			try {
				await this.plugin.updateTaskProperty(task, board.groupByField as keyof TaskInfo, columnValue);
				new Notice(`Task moved to ${columnValue}`);
			} catch (error) {
				console.error('Error updating task:', error);
				new Notice('Failed to update task');
			}
		});
	}

	private getTaskColumnValue(task: TaskInfo, board: KanbanBoardConfig): string {
		switch (board.groupByField) {
			case 'status':
				return task.status;
			case 'priority':
				return task.priority;
			case 'context':
				return task.contexts?.[0] || 'uncategorized';
			default:
				return 'uncategorized';
		}
	}

	private async openTaskFile(task: TaskInfo) {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (file) {
			await this.app.workspace.getLeaf(true).openFile(file as any);
		}
	}

	private showTaskContextMenu(event: MouseEvent, task: TaskInfo, cardEl: HTMLElement) {
		const menu = new Menu();

		// Edit task
		menu.addItem((item) => {
			item.setTitle('Edit task')
				.setIcon('edit')
				.onClick(() => {
					this.plugin.openTaskEditModal(task);
				});
		});

		// Open file
		menu.addItem((item) => {
			item.setTitle('Open file')
				.setIcon('file-text')
				.onClick(() => {
					this.openTaskFile(task);
				});
		});

		menu.addSeparator();

		// Archive/Unarchive
		menu.addItem((item) => {
			item.setTitle(task.archived ? 'Unarchive' : 'Archive')
				.setIcon('archive')
				.onClick(async () => {
					await this.plugin.toggleTaskArchive(task);
				});
		});

		// Time tracking
		const activeTimeSession = this.plugin.getActiveTimeSession(task);
		if (activeTimeSession) {
			menu.addItem((item) => {
				item.setTitle('Stop time tracking')
					.setIcon('stop-circle')
					.onClick(async () => {
						await this.plugin.stopTimeTracking(task);
					});
			});
		} else {
			menu.addItem((item) => {
				item.setTitle('Start time tracking')
					.setIcon('play-circle')
					.onClick(async () => {
						await this.plugin.startTimeTracking(task);
					});
			});
		}

		menu.showAtMouseEvent(event);
	}
}
