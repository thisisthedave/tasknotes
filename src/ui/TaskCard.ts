import { format } from 'date-fns';
import { TFile } from 'obsidian';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';
import { calculateTotalTimeSpent, isRecurringTaskDueOn, getEffectiveTaskStatus } from '../utils/helpers';

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
    showCheckbox: true,
    showArchiveButton: false,
    showTimeTracking: false,
    showRecurringControls: true,
    groupByDate: false
};

/**
 * Create a reusable task card element
 */
export function createTaskCard(task: TaskInfo, plugin: TaskNotesPlugin, options: Partial<TaskCardOptions> = {}): HTMLElement {
    const opts = { ...DEFAULT_TASK_CARD_OPTIONS, ...options };
    const targetDate = opts.targetDate || plugin.selectedDate;
    
    // Determine effective status for recurring tasks
    const effectiveStatus = task.recurrence 
        ? getEffectiveTaskStatus(task, targetDate)
        : task.status;
    
    // Check if task is due on target date
    const targetDateStr = format(targetDate, 'yyyy-MM-dd');
    const isDueOnTargetDate = task.recurrence 
        ? isRecurringTaskDueOn(task, targetDate)
        : task.due === targetDateStr;
    
    const item = document.createElement('div');
    item.className = `agenda-item task-item ${effectiveStatus} ${task.archived ? 'archived' : ''}`;
    item.dataset.taskPath = task.path;
    
    // Task checkbox (if enabled)
    if (opts.showCheckbox) {
        const checkbox = item.createEl('input', { 
            type: 'checkbox',
            cls: 'task-checkbox'
        });
        checkbox.checked = plugin.statusManager.isCompletedStatus(effectiveStatus);
        
        checkbox.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (task.recurrence) {
                await plugin.taskService.toggleRecurringTaskComplete(task, targetDate);
            } else {
                await plugin.taskService.toggleStatus(task);
            }
        });
    }
    
    // Task content container
    const content = item.createDiv({ cls: 'item-content' });
    
    // Title with priority indicator
    const titleContainer = content.createDiv({ cls: 'item-title-container' });
    
    // Priority indicator
    const priorityConfig = plugin.priorityManager.getPriorityConfig(task.priority);
    if (priorityConfig) {
        const priorityBadge = titleContainer.createSpan({ 
            cls: `priority-badge priority-${task.priority}`, 
            text: priorityConfig.label,
            attr: { title: `Priority: ${priorityConfig.label}` }
        });
        priorityBadge.style.setProperty('--priority-color', priorityConfig.color);
    }
    
    // Task title
    const titleEl = titleContainer.createDiv({ 
        cls: 'item-title', 
        text: task.title
    });
    if (plugin.statusManager.isCompletedStatus(effectiveStatus)) {
        titleEl.classList.add('completed');
    }
    
    // Add recurring indicator
    if (task.recurrence) {
        const recurIcon = titleEl.createSpan({ 
            cls: 'recurring-indicator',
            text: '⟳',
            attr: { title: `${task.recurrence.frequency} recurring task` }
        });
        titleEl.prepend(recurIcon);
    }
    
    // Metadata section
    const meta = content.createDiv({ cls: 'item-meta' });
    
    // Status badge
    const statusConfig = plugin.statusManager.getStatusConfig(effectiveStatus);
    const statusBadge = meta.createSpan({ 
        cls: `status-badge status-${effectiveStatus}`, 
        text: statusConfig?.label || effectiveStatus
    });
    if (statusConfig) {
        statusBadge.style.setProperty('background', statusConfig.color);
    }
    
    // Due date (if enabled and not grouping by date)
    if (opts.showDueDate && !opts.groupByDate && task.due) {
        const dueSpan = meta.createSpan({ cls: 'due-date' });
        const dueDate = new Date(task.due);
        
        if (isDueOnTargetDate) {
            dueSpan.classList.add('due-today');
            dueSpan.textContent = 'Today';
        } else {
            dueSpan.textContent = format(dueDate, 'MMM d');
        }
    }
    
    // Contexts
    if (task.contexts && task.contexts.length > 0) {
        const contextContainer = meta.createSpan({ cls: 'contexts' });
        task.contexts.forEach(context => {
            contextContainer.createSpan({ cls: 'context-tag', text: `@${context}` });
        });
    }
    
    // Time tracking info (if enabled)
    if (opts.showTimeTracking) {
        const timeSpent = calculateTotalTimeSpent(task.timeEntries || []);
        if (task.timeEstimate || timeSpent > 0) {
            const timeContainer = meta.createSpan({ cls: 'time-info' });
            
            if (timeSpent > 0) {
                const progress = task.timeEstimate ? 
                    Math.round((timeSpent / task.timeEstimate) * 100) : 0;
                
                timeContainer.createSpan({ 
                    cls: 'time-spent', 
                    text: plugin.formatTime(timeSpent)
                });
                
                if (task.timeEstimate) {
                    timeContainer.createSpan({ cls: 'time-separator', text: ' / ' });
                    timeContainer.createSpan({ 
                        cls: 'time-estimate', 
                        text: plugin.formatTime(task.timeEstimate)
                    });
                    
                    if (progress > 100) {
                        timeContainer.classList.add('over-estimate');
                    }
                }
            } else if (task.timeEstimate) {
                timeContainer.createSpan({ 
                    cls: 'time-estimate', 
                    text: `Est: ${plugin.formatTime(task.timeEstimate)}`
                });
            }
        }
    }
    
    // Archive button (if enabled)
    if (opts.showArchiveButton) {
        const archiveButton = meta.createEl('button', {
            cls: `archive-button ${task.archived ? 'archived' : ''}`,
            text: task.archived ? 'Unarchive' : 'Archive',
            attr: { title: task.archived ? 'Unarchive this task' : 'Archive this task' }
        });
        
        archiveButton.addEventListener('click', async (e) => {
            e.stopPropagation();
            await plugin.taskService.toggleArchive(task);
        });
    }
    
    // Recurring task controls (if enabled and task is recurring)
    if (opts.showRecurringControls && task.recurrence) {
        const recurringControls = content.createDiv({ cls: 'recurring-controls' });
        
        const isCompleted = plugin.statusManager.isCompletedStatus(effectiveStatus);
        const toggleButton = recurringControls.createEl('button', { 
            cls: `recurring-toggle ${isCompleted ? 'mark-incomplete' : 'mark-complete'}`,
            text: isCompleted ? 'Mark incomplete' : 'Mark complete',
            attr: {
                'aria-label': `${isCompleted ? 'Mark incomplete' : 'Mark complete'} for ${format(targetDate, 'MMM d')}`,
                'title': `Toggle completion for ${format(targetDate, 'MMM d')}`
            }
        });
        
        toggleButton.addEventListener('click', async (e) => {
            e.stopPropagation();
            await plugin.taskService.toggleRecurringTaskComplete(task, targetDate);
        });
    }
    
    // Add click handler to open task
    item.addEventListener('click', () => {
        const file = plugin.app.vault.getAbstractFileByPath(task.path);
        if (file instanceof TFile) {
            plugin.app.workspace.getLeaf(false).openFile(file);
        }
    });
    
    // Add hover preview
    item.addEventListener('mouseover', (event) => {
        const file = plugin.app.vault.getAbstractFileByPath(task.path);
        if (file) {
            plugin.app.workspace.trigger('hover-link', {
                event,
                source: 'tasknotes-task-card',
                hoverParent: item,
                targetEl: item,
                linktext: task.path,
                sourcePath: task.path
            });
        }
    });
    
    return item;
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
    element.className = `agenda-item task-item ${effectiveStatus} ${task.archived ? 'archived' : ''}`;
    
    // Update checkbox if present
    const checkbox = element.querySelector('.task-checkbox') as HTMLInputElement;
    if (checkbox) {
        checkbox.checked = plugin.statusManager.isCompletedStatus(effectiveStatus);
    }
    
    // Update title
    const titleEl = element.querySelector('.item-title') as HTMLElement;
    if (titleEl) {
        titleEl.textContent = task.title;
        titleEl.classList.toggle('completed', plugin.statusManager.isCompletedStatus(effectiveStatus));
    }
    
    // Update status badge
    const statusBadge = element.querySelector('.status-badge') as HTMLElement;
    if (statusBadge) {
        const statusConfig = plugin.statusManager.getStatusConfig(effectiveStatus);
        statusBadge.textContent = statusConfig?.label || effectiveStatus;
        statusBadge.className = `status-badge status-${effectiveStatus}`;
        if (statusConfig) {
            statusBadge.style.setProperty('background', statusConfig.color);
        }
    }
    
    // Update recurring toggle button if present
    const recurringToggle = element.querySelector('.recurring-toggle') as HTMLButtonElement;
    if (recurringToggle && task.recurrence) {
        const isCompleted = plugin.statusManager.isCompletedStatus(effectiveStatus);
        recurringToggle.className = `recurring-toggle ${isCompleted ? 'mark-incomplete' : 'mark-complete'}`;
        recurringToggle.textContent = isCompleted ? 'Mark incomplete' : 'Mark complete';
    }
    
    // Add update animation
    element.classList.add('task-updated');
    setTimeout(() => {
        element.classList.remove('task-updated');
    }, 1000);
}