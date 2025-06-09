import { format } from 'date-fns';
import { TFile, Menu, setIcon } from 'obsidian';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';
import { calculateTotalTimeSpent, isRecurringTaskDueOn, getEffectiveTaskStatus, shouldUseRecurringTaskUI, getRecurringTaskCompletionText } from '../utils/helpers';

export interface TaskCardOptions {
    showDueDate: boolean;
    showCheckbox: boolean;
    showArchiveButton: boolean;
    showTimeTracking: boolean;
    showRecurringControls: boolean;
    groupByDate: boolean;
    targetDate?: Date;
}

export const DEFAULT_TASK_CARD_OPTIONS: TaskCardOptions = {
    showDueDate: true,
    showCheckbox: false,
    showArchiveButton: false,
    showTimeTracking: false,
    showRecurringControls: true,
    groupByDate: false
};

/**
 * Create a minimalist, unified task card element
 */
export function createTaskCard(task: TaskInfo, plugin: TaskNotesPlugin, options: Partial<TaskCardOptions> = {}): HTMLElement {
    const opts = { ...DEFAULT_TASK_CARD_OPTIONS, ...options };
    const targetDate = opts.targetDate || plugin.selectedDate;
    
    // Determine effective status for recurring tasks
    const effectiveStatus = task.recurrence 
        ? getEffectiveTaskStatus(task, targetDate)
        : task.status;
    
    // Main container
    const card = document.createElement('div');
    const isActivelyTracked = plugin.getActiveTimeSession(task) !== null;
    const isCompleted = plugin.statusManager.isCompletedStatus(effectiveStatus);
    const isRecurring = !!task.recurrence;
    card.className = `tasknotes-card tasknotes-card--normal tasknotes-card--flex task-card ${effectiveStatus} ${task.archived ? 'archived' : ''} ${isActivelyTracked ? 'actively-tracked' : ''} ${isCompleted ? 'task-completed' : ''} ${isRecurring ? 'task-recurring' : ''}`;
    card.dataset.taskPath = task.path;
    
    // Apply priority as left border color
    const priorityConfig = plugin.priorityManager.getPriorityConfig(task.priority);
    if (priorityConfig) {
        card.style.setProperty('--priority-color', priorityConfig.color);
        card.style.borderLeftColor = priorityConfig.color;
    }
    
    // Completion checkbox (if enabled)
    if (opts.showCheckbox) {
        const checkbox = card.createEl('input', { 
            type: 'checkbox',
            cls: 'task-checkbox'
        });
        checkbox.checked = plugin.statusManager.isCompletedStatus(effectiveStatus);
        
        checkbox.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                if (task.recurrence) {
                    await plugin.toggleRecurringTaskComplete(task, targetDate);
                } else {
                    await plugin.toggleTaskStatus(task);
                }
            } catch (error) {
                // Error handling and user feedback is now handled by the wrapper methods
                console.error('Error in task checkbox handler:', error);
            }
        });
    }
    
    // Status indicator dot
    const statusConfig = plugin.statusManager.getStatusConfig(effectiveStatus);
    const statusDot = card.createEl('span', { cls: 'status-dot' });
    if (statusConfig) {
        statusDot.style.backgroundColor = statusConfig.color;
    }
    
    // Recurring task indicator
    if (task.recurrence) {
        const recurringIndicator = card.createEl('div', { 
            cls: 'recurring-indicator',
            attr: { 'aria-label': `Recurring: ${task.recurrence.frequency}` }
        });
        
        // Use Obsidian's built-in rotate-ccw icon for recurring tasks
        setIcon(recurringIndicator, 'rotate-ccw');
    }
    
    // Main content container
    const contentContainer = card.createEl('div', { cls: 'task-content' });
    
    // Context menu icon (appears on hover)
    const contextIcon = card.createEl('div', { 
        cls: 'task-context-icon',
        attr: { 
            'aria-label': 'Task options',
            'title': 'More options'
        }
    });
    
    // Use Obsidian's built-in pencil icon
    setIcon(contextIcon, 'pencil');
    
    contextIcon.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await showTaskContextMenu(e as MouseEvent, task.path, plugin, targetDate);
    });
    
    // First line: Task title
    const titleEl = contentContainer.createEl('div', { 
        cls: 'task-title', 
        text: task.title
    });
    if (plugin.statusManager.isCompletedStatus(effectiveStatus)) {
        titleEl.classList.add('completed');
    }
    
    // Second line: Metadata
    const metadataLine = contentContainer.createEl('div', { cls: 'task-metadata-line' });
    const metadataItems: string[] = [];
    
    // Recurrence info (if recurring)
    if (task.recurrence) {
        metadataItems.push(`Recurring: ${task.recurrence.frequency}`);
    }
    
    // Due date (if has due date)
    if (task.due) {
        const dueDate = new Date(task.due);
        const today = new Date();
        const isToday = dueDate.toDateString() === today.toDateString();
        const isOverdue = dueDate < today;
        
        if (isToday) {
            metadataItems.push('Due: Today');
        } else if (isOverdue) {
            metadataItems.push(`Due: ${format(dueDate, 'MMM d')} (overdue)`);
        } else {
            metadataItems.push(`Due: ${format(dueDate, 'MMM d')}`);
        }
    }
    
    // Scheduled date (if has scheduled date)
    if (task.scheduled) {
        const scheduledDate = new Date(task.scheduled);
        const today = new Date();
        const isToday = scheduledDate.toDateString() === today.toDateString();
        const isPast = scheduledDate < today;
        
        if (isToday) {
            metadataItems.push('Scheduled: Today');
        } else if (isPast) {
            metadataItems.push(`Scheduled: ${format(scheduledDate, 'MMM d')} (past)`);
        } else {
            metadataItems.push(`Scheduled: ${format(scheduledDate, 'MMM d')}`);
        }
    }
    
    // Contexts (if has contexts)
    if (task.contexts && task.contexts.length > 0) {
        metadataItems.push(`@${task.contexts.join(', @')}`);
    }
    
    // Time tracking (if has time estimate or logged time)
    const timeSpent = calculateTotalTimeSpent(task.timeEntries || []);
    if (task.timeEstimate || timeSpent > 0) {
        const timeInfo: string[] = [];
        if (timeSpent > 0) {
            timeInfo.push(`${plugin.formatTime(timeSpent)} spent`);
        }
        if (task.timeEstimate) {
            timeInfo.push(`${plugin.formatTime(task.timeEstimate)} estimated`);
        }
        metadataItems.push(timeInfo.join(', '));
    }
    
    // Populate metadata line
    if (metadataItems.length > 0) {
        metadataLine.textContent = metadataItems.join(' • ');
    } else {
        metadataLine.style.display = 'none';
    }
    
    // Add click handlers
    card.addEventListener('click', (e) => {
        if (e.target === card.querySelector('.task-checkbox')) {
            return; // Let checkbox handle its own click
        }
        
        if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd + Click: Open source note
            const file = plugin.app.vault.getAbstractFileByPath(task.path);
            if (file instanceof TFile) {
                plugin.app.workspace.getLeaf(false).openFile(file);
            }
        } else {
            // Left-click: Open edit modal
            plugin.openTaskEditModal(task);
        }
    });
    
    // Right-click: Context menu
    card.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const path = card.dataset.taskPath;
        if (!path) return;

        // Pass the file path to the context menu - it will fetch fresh data
        await showTaskContextMenu(e, path, plugin, targetDate);
    });
    
    // Hover preview
    card.addEventListener('mouseover', (event) => {
        const file = plugin.app.vault.getAbstractFileByPath(task.path);
        if (file) {
            plugin.app.workspace.trigger('hover-link', {
                event,
                source: 'tasknotes-task-card',
                hoverParent: card,
                targetEl: card,
                linktext: task.path,
                sourcePath: task.path
            });
        }
    });
    
    return card;
}

/**
 * Show context menu for task card
 */
async function showTaskContextMenu(event: MouseEvent, taskPath: string, plugin: TaskNotesPlugin, targetDate: Date) {
    try {
        // Always fetch fresh task data - ignore any stale captured data
        const task = await plugin.cacheManager.getTaskInfo(taskPath);
        if (!task) {
            console.error(`No task found for path: ${taskPath}`);
            return;
        }
        
        
        const menu = new Menu();
        
        // For recurring tasks, only show non-completion statuses
        // For regular tasks, show all statuses
        const availableStatuses = task.recurrence 
            ? plugin.statusManager.getNonCompletionStatuses()
            : plugin.statusManager.getAllStatuses();
        
        // Direct status options (no submenu to avoid issues)
        availableStatuses.forEach(statusConfig => {
            menu.addItem((item) => {
                const isSelected = task.status === statusConfig.value;
                item.setTitle(`${isSelected ? '✓ ' : ''}${statusConfig.label}`);
                item.setIcon('circle');
                if (isSelected) {
                    item.setIcon('check-circle');
                }
                item.onClick(async () => {
                    try {
                        // Use the fresh task data that showTaskContextMenu just fetched
                        await plugin.updateTaskProperty(task, 'status', statusConfig.value);
                    } catch (error) {
                        // Error handling and user feedback is now handled by the wrapper method
                        console.error('Error updating task status:', error);
                    }
                });
            });
        });
        
        // Add completion toggle for recurring tasks
        if (task.recurrence) {
            menu.addSeparator();
            
            // Check current completion status for this date
            const dateStr = format(targetDate, 'yyyy-MM-dd');
            const isCompletedForDate = task.complete_instances?.includes(dateStr) || false;
            
            menu.addItem((item) => {
                item.setTitle(isCompletedForDate ? 'Mark incomplete for this date' : 'Mark complete for this date');
                item.setIcon(isCompletedForDate ? 'x' : 'check');
                item.onClick(async () => {
                    try {
                        await plugin.toggleRecurringTaskComplete(task, targetDate);
                    } catch (error) {
                        console.error('Error toggling recurring task completion:', error);
                    }
                });
            });
        }
        
        menu.addSeparator();
        
        // Direct priority options (no submenu to avoid issues)
        plugin.priorityManager.getPrioritiesByWeight().forEach(priorityConfig => {
            menu.addItem((item) => {
                const isSelected = task.priority === priorityConfig.value;
                item.setTitle(`${isSelected ? '✓ ' : ''}Priority: ${priorityConfig.label}`);
                item.setIcon('flag');
                if (isSelected) {
                    item.setIcon('flag-triangle-right');
                }
                item.onClick(async () => {
                    try {
                        // Use the fresh task data that showTaskContextMenu just fetched
                        await plugin.updateTaskProperty(task, 'priority', priorityConfig.value);
                    } catch (error) {
                        // Error handling and user feedback is now handled by the wrapper method
                        console.error('Error updating task priority:', error);
                    }
                });
            });
        });
        
        menu.addSeparator();
        
        // Set Due Date
        menu.addItem((item) => {
            item.setTitle('Set due date...');
            item.setIcon('calendar');
            item.onClick(() => {
                // Use the fresh task data that showTaskContextMenu just fetched
                plugin.openDueDateModal(task);
            });
        });
        
        // Set Scheduled Date
        menu.addItem((item) => {
            item.setTitle('Set scheduled date...');
            item.setIcon('calendar-clock');
            item.onClick(() => {
                // Use the fresh task data that showTaskContextMenu just fetched
                plugin.openScheduledDateModal(task);
            });
        });
        
        menu.addSeparator();
        
        // Time Tracking - determine current state from fresh task data
        menu.addItem((item) => {
            const activeSession = plugin.getActiveTimeSession(task);
            item.setTitle(activeSession ? 'Stop Time Tracking' : 'Start Time Tracking');
            item.setIcon(activeSession ? 'pause' : 'play');
            item.onClick(async () => {
                // Use the fresh task data that showTaskContextMenu just fetched
                const activeSession = plugin.getActiveTimeSession(task);
                if (activeSession) {
                    await plugin.stopTimeTracking(task);
                } else {
                    await plugin.startTimeTracking(task);
                }
            });
        });
        
        // Archive/Unarchive
        menu.addItem((item) => {
            item.setTitle(task.archived ? 'Unarchive' : 'Archive');
            item.setIcon(task.archived ? 'archive-restore' : 'archive');
            item.onClick(async () => {
                try {
                    // Use the fresh task data that showTaskContextMenu just fetched
                    await plugin.toggleTaskArchive(task);
                } catch (error) {
                    // Error handling and user feedback is now handled by the wrapper method
                    console.error('Error toggling task archive:', error);
                }
            });
        });
        
        menu.addSeparator();
        
        // Open Note
        menu.addItem((item) => {
            item.setTitle('Open Note');
            item.setIcon('file-text');
            item.onClick(() => {
                const file = plugin.app.vault.getAbstractFileByPath(taskPath);
                if (file instanceof TFile) {
                    plugin.app.workspace.getLeaf(false).openFile(file);
                }
            });
        });
        
        // Copy Task Title
        menu.addItem((item) => {
            item.setTitle('Copy Task Title');
            item.setIcon('copy');
            item.onClick(() => {
                // Use the fresh task data that showTaskContextMenu just fetched
                navigator.clipboard.writeText(task.title);
            });
        });
    
        menu.showAtMouseEvent(event);
    } catch (error) {
        console.error(`Error creating context menu for task ${taskPath}:`, error);
    }
}

/**
 * Update an existing task card with new data
 */
export function updateTaskCard(element: HTMLElement, task: TaskInfo, plugin: TaskNotesPlugin, options: Partial<TaskCardOptions> = {}): void {
    const opts = { ...DEFAULT_TASK_CARD_OPTIONS, ...options };
    const targetDate = opts.targetDate || plugin.selectedDate;
    
    // Update effective status
    const effectiveStatus = task.recurrence 
        ? getEffectiveTaskStatus(task, targetDate)
        : task.status;
    
    // Update main element classes
    const isActivelyTracked = plugin.getActiveTimeSession(task) !== null;
    const isCompleted = plugin.statusManager.isCompletedStatus(effectiveStatus);
    const isRecurring = !!task.recurrence;
    element.className = `tasknotes-card tasknotes-card--normal tasknotes-card--flex task-card ${effectiveStatus} ${task.archived ? 'archived' : ''} ${isActivelyTracked ? 'actively-tracked' : ''} ${isCompleted ? 'task-completed' : ''} ${isRecurring ? 'task-recurring' : ''}`;
    
    // Update priority left border color
    const priorityConfig = plugin.priorityManager.getPriorityConfig(task.priority);
    if (priorityConfig) {
        element.style.setProperty('--priority-color', priorityConfig.color);
        element.style.borderLeftColor = priorityConfig.color;
    }
    
    // Update checkbox if present
    const checkbox = element.querySelector('.task-checkbox') as HTMLInputElement;
    if (checkbox) {
        checkbox.checked = plugin.statusManager.isCompletedStatus(effectiveStatus);
    }
    
    // Update status dot
    const statusDot = element.querySelector('.status-dot') as HTMLElement;
    if (statusDot) {
        const statusConfig = plugin.statusManager.getStatusConfig(effectiveStatus);
        if (statusConfig) {
            statusDot.style.backgroundColor = statusConfig.color;
        }
    }
    
    // Update recurring indicator
    const existingRecurringIndicator = element.querySelector('.recurring-indicator');
    if (task.recurrence && !existingRecurringIndicator) {
        // Add recurring indicator if task is now recurring but didn't have one
        const recurringIndicator = element.createEl('span', { 
            cls: 'recurring-indicator',
            attr: { 'aria-label': `Recurring: ${task.recurrence.frequency}` }
        });
        statusDot.insertAdjacentElement('afterend', recurringIndicator);
    } else if (!task.recurrence && existingRecurringIndicator) {
        // Remove recurring indicator if task is no longer recurring
        existingRecurringIndicator.remove();
    } else if (task.recurrence && existingRecurringIndicator) {
        // Update existing recurring indicator
        existingRecurringIndicator.setAttribute('aria-label', `Recurring: ${task.recurrence.frequency}`);
    }
    
    // Update title
    const titleEl = element.querySelector('.task-title') as HTMLElement;
    if (titleEl) {
        titleEl.textContent = task.title;
        titleEl.classList.toggle('completed', plugin.statusManager.isCompletedStatus(effectiveStatus));
    }
    
    // Update metadata line
    const metadataLine = element.querySelector('.task-metadata-line') as HTMLElement;
    if (metadataLine) {
        const metadataItems: string[] = [];
        
        // Recurrence info (if recurring)
        if (task.recurrence) {
            metadataItems.push(`Recurring: ${task.recurrence.frequency}`);
        }
        
        // Due date (if has due date)
        if (task.due) {
            const dueDate = new Date(task.due);
            const today = new Date();
            const isToday = dueDate.toDateString() === today.toDateString();
            const isOverdue = dueDate < today;
            
            if (isToday) {
                metadataItems.push('Due: Today');
            } else if (isOverdue) {
                metadataItems.push(`Due: ${format(dueDate, 'MMM d')} (overdue)`);
            } else {
                metadataItems.push(`Due: ${format(dueDate, 'MMM d')}`);
            }
        }
        
        // Scheduled date (if has scheduled date)
        if (task.scheduled) {
            const scheduledDate = new Date(task.scheduled);
            const today = new Date();
            const isToday = scheduledDate.toDateString() === today.toDateString();
            const isPast = scheduledDate < today;
            
            if (isToday) {
                metadataItems.push('Scheduled: Today');
            } else if (isPast) {
                metadataItems.push(`Scheduled: ${format(scheduledDate, 'MMM d')} (past)`);
            } else {
                metadataItems.push(`Scheduled: ${format(scheduledDate, 'MMM d')}`);
            }
        }
        
        // Contexts (if has contexts)
        if (task.contexts && task.contexts.length > 0) {
            metadataItems.push(`@${task.contexts.join(', @')}`);
        }
        
        // Time tracking (if has time estimate or logged time)
        const timeSpent = calculateTotalTimeSpent(task.timeEntries || []);
        if (task.timeEstimate || timeSpent > 0) {
            const timeInfo: string[] = [];
            if (timeSpent > 0) {
                timeInfo.push(`${plugin.formatTime(timeSpent)} spent`);
            }
            if (task.timeEstimate) {
                timeInfo.push(`${plugin.formatTime(task.timeEstimate)} estimated`);
            }
            metadataItems.push(timeInfo.join(', '));
        }
        
        // Update metadata line
        if (metadataItems.length > 0) {
            metadataLine.textContent = metadataItems.join(' • ');
            metadataLine.style.display = '';
        } else {
            metadataLine.style.display = 'none';
        }
    }
    
    // Animation is now handled separately - don't add it here during reconciler updates
}
