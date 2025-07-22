import { format } from 'date-fns';
import { TFile, Menu, setIcon, Notice, Modal, App } from 'obsidian';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';
import { calculateTotalTimeSpent, getEffectiveTaskStatus, getRecurrenceDisplayText, filterEmptyProjects } from '../utils/helpers';
import { 
    formatDateTimeForDisplay,
    isTodayTimeAware,
    isOverdueTimeAware,
    getDatePart,
    getTimePart
} from '../utils/dateUtils';
import { DateContextMenu } from '../components/DateContextMenu';
import { PriorityContextMenu } from '../components/PriorityContextMenu';
import { RecurrenceContextMenu } from '../components/RecurrenceContextMenu';
import { StatusContextMenu } from '../components/StatusContextMenu';
import { ProjectSelectModal } from 'src/modals/ProjectSelectModal';

export interface TaskCardOptions {
    showDueDate: boolean;
    showCheckbox: boolean;
    showArchiveButton: boolean;
    showTimeTracking: boolean;
    showRecurringControls: boolean;
    groupByDate: boolean;
    targetDate?: Date;
    draggable: boolean;
}

export const DEFAULT_TASK_CARD_OPTIONS: TaskCardOptions = {
    showDueDate: true,
    showCheckbox: false,
    showArchiveButton: false,
    showTimeTracking: false,
    showRecurringControls: true,
    groupByDate: false,
    draggable: false
};

/**
 * Helper function to attach date context menu click handlers
 */
function attachDateClickHandler(
    span: HTMLElement, 
    task: TaskInfo, 
    plugin: TaskNotesPlugin, 
    dateType: 'due' | 'scheduled'
): void {
    span.addEventListener('click', (e) => {
        e.stopPropagation(); // Don't trigger card click
        const menu = createDateContextMenu(plugin, [task], dateType);
        menu.show(e as MouseEvent);
    });
}

/**
 * Create a DateContextMenu for a given task and date type
 */
function createDateContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
    dateType: 'due' | 'scheduled'
): DateContextMenu {
    const currentValue = tasks.length == 1 ? (dateType === 'due' ? tasks[0].due : tasks[0].scheduled) : undefined;
    return new DateContextMenu({
        currentValue: getDatePart(currentValue || ''),
        currentTime: getTimePart(currentValue || ''),
        onSelect: async (dateValue, timeValue) => {
            try {
                let finalValue: string | undefined;
                if (!dateValue) {
                    finalValue = undefined;
                } else if (timeValue) {
                    finalValue = `${dateValue}T${timeValue}`;
                } else {
                    finalValue = dateValue;
                }
                await Promise.all(tasks.map(task => plugin.updateTaskProperty(task, dateType, finalValue)));
            } catch (error) {
                console.error(`Error updating ${dateType} date:`, error);
                new Notice(`Failed to update ${dateType} date`);
            }
        }
    });
}

export function showDateContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
    dateType: 'due' | 'scheduled',
    showAtElement: HTMLElement
): void {
    const menu = createDateContextMenu(plugin, tasks, dateType);
    menu.showAtElement(showAtElement);
}

function createPriorityContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
): PriorityContextMenu {
    const menu = new PriorityContextMenu({
        currentValue: tasks.length == 1 ? tasks[0].priority : undefined,
        onSelect: async (newPriority) => {
            try {
                await Promise.all(tasks.map(task => plugin.updateTaskProperty(task, 'priority', newPriority)));
            } catch (error) {
                console.error('Error updating priority:', error);
                new Notice('Failed to update priority');
            }
        },
        plugin: plugin
    });
    return menu;
}

export function showProjectModal(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[]
): void {
    if (tasks && tasks.length > 0) {
        const modal = new ProjectSelectModal(plugin.app, plugin, async (file) => {
            try {
                // fileToLinktext expects TFile, so cast safely since we know these are markdown files
                const updates = tasks.map(task => {
                    const linkText = plugin.app.metadataCache.fileToLinktext(file as TFile, task.path || '', true);
                    const projectLink = `[[${linkText}]]`;
                    
                    if (task.projects && task.projects.includes(projectLink)) {
                        return Promise.resolve(); // Already includes this project, skip
                    }

                    // add the project link to the task's projects
                    return plugin.updateTaskProperty(task, 'projects', [...(task.projects || []), projectLink]);
                });

                // Wait for all updates to complete
                await Promise.all(updates);
            } catch (error) {
                console.error('Error updating recurrence:', error);
                new Notice('Failed to update recurrence');
            }
        });
        modal.open();
    }
}

export function showPriorityContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
    showAtElement: HTMLElement
): void {
    if (tasks && tasks.length > 0) {
        const menu = createPriorityContextMenu(plugin, tasks);
        menu.showAtElement(showAtElement);
    }
}

function createRecurrenceContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
): RecurrenceContextMenu {
    const menu = new RecurrenceContextMenu({
        currentValue: typeof tasks[0].recurrence === 'string' ? tasks[0].recurrence : undefined,
        onSelect: async (newRecurrence: string) => {
            try {
                await Promise.all(tasks.map(task => plugin.updateTaskProperty(task, 'recurrence', newRecurrence)));
            } catch (error) {
                console.error('Error updating recurrence:', error);
                new Notice('Failed to update recurrence');
            }
        },
        app: plugin.app
    });
    return menu;
}

export function showRecurrenceContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
    showAtElement: HTMLElement
): void {
    if (tasks && tasks.length > 0) {
        const menu = createRecurrenceContextMenu(plugin, tasks);
        menu.showAtElement(showAtElement);
    }
}

function createStatusContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
): StatusContextMenu {
    const menu = new StatusContextMenu({
        currentValue: tasks[0].status,
        onSelect: async (newStatus: string) => {
            try {
                await Promise.all(tasks.map(task => plugin.updateTaskProperty(task, 'status', newStatus)));
            } catch (error) {
                console.error('Error updating status:', error);
                new Notice('Failed to update status');
            }
        },
        plugin: plugin
    });
    return menu;
}

export function showStatusContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
    showAtElement: HTMLElement
): void {
    if (tasks && tasks.length > 0) {
        const menu = createStatusContextMenu(plugin, tasks);
        menu.showAtElement(showAtElement);
    }
}

export async function copyTaskTitleToClipboard(tasks: TaskInfo[]) {
    // Use the fresh task data that showTaskContextMenu just fetched
    try {
        if (tasks.length > 0) {
            const markdownList = tasks
                .map(task => `[[${task.title}]]\n`)
                .join('');
            await navigator.clipboard.writeText(markdownList);
        }
        new Notice('Task title copied to clipboard');
    } catch (error) {
        new Notice('Failed to copy to clipboard');
    }
}


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
    
    // Main container with BEM class structure
    const card = document.createElement('div');
    const isActivelyTracked = plugin.getActiveTimeSession(task) !== null;
    const isCompleted = plugin.statusManager.isCompletedStatus(effectiveStatus);
    const isRecurring = !!task.recurrence;
    
    // Build BEM class names
    const cardClasses = ['task-card'];
    
    // Add modifiers
    if (isCompleted) cardClasses.push('task-card--completed');
    if (task.archived) cardClasses.push('task-card--archived');
    if (isActivelyTracked) cardClasses.push('task-card--actively-tracked');
    if (isRecurring) cardClasses.push('task-card--recurring');
    if (opts.showCheckbox) cardClasses.push('task-card--checkbox-enabled');
    
    // Add priority modifier
    if (task.priority) {
        cardClasses.push(`task-card--priority-${task.priority}`);
    }
    
    // Add status modifier
    if (effectiveStatus) {
        cardClasses.push(`task-card--status-${effectiveStatus}`);
    }
    
    
    card.className = cardClasses.join(' ');
    card.tabIndex = 0; // Make it focusable
    card.dataset.taskPath = task.path;
    card.dataset.key = task.path; // For DOMReconciler compatibility
    card.dataset.status = effectiveStatus;
    
    // Apply priority and status colors as CSS custom properties
    const priorityConfig = plugin.priorityManager.getPriorityConfig(task.priority);
    if (priorityConfig) {
        card.style.setProperty('--priority-color', priorityConfig.color);
    }
    
    const statusConfig = plugin.statusManager.getStatusConfig(effectiveStatus);
    if (statusConfig) {
        card.style.setProperty('--current-status-color', statusConfig.color);
    }

    // Completion checkbox (if enabled)
    if (opts.draggable) {
        // Make the container draggable
        card.draggable = true;
        // card.setAttribute('data-view-index', index.toString());
        
        // Add drag handle
        const dragHandle = card.createDiv({
            cls: 'filter-bar__view-drag-handle',
            title: 'Drag to reorder'
        });
    }
    
    // Completion checkbox (if enabled)
    if (opts.showCheckbox) {
        const checkbox = card.createEl('input', { 
            type: 'checkbox',
            cls: 'task-card__checkbox'
        });
        // checkbox.checked = plugin.statusManager.isCompletedStatus(effectiveStatus);
        
        checkbox.addEventListener('click', async (e) => {
            e.stopPropagation();
            // try {
            //     if (task.recurrence) {
            //         await plugin.toggleRecurringTaskComplete(task, targetDate);
            //     } else {
            //         await plugin.toggleTaskStatus(task);
            //     }
            // } catch (error) {
            //     const errorMessage = error instanceof Error ? error.message : String(error);
            //     console.error('Error in task checkbox handler:', {
            //         error: errorMessage,
            //         taskPath: task.path
            //     });
            //     new Notice(`Failed to toggle task status: ${errorMessage}`);
            // }
        });
    }
    
    // Status indicator dot
    const statusDot = card.createEl('span', { cls: 'task-card__status-dot' });
    if (statusConfig) {
        statusDot.style.borderColor = statusConfig.color;
    }
    
    // Add click handler to cycle through statuses (original functionality)
    statusDot.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            if (task.recurrence) {
                // For recurring tasks, toggle completion for the target date
                const updatedTask = await plugin.toggleRecurringTaskComplete(task, targetDate);
                
                // Immediately update the visual state of the status dot
                const newEffectiveStatus = getEffectiveTaskStatus(updatedTask, targetDate);
                const newStatusConfig = plugin.statusManager.getStatusConfig(newEffectiveStatus);
                const isNowCompleted = plugin.statusManager.isCompletedStatus(newEffectiveStatus);
                
                // Update status dot border color
                if (newStatusConfig) {
                    statusDot.style.borderColor = newStatusConfig.color;
                }
                
                // Update the card's completion state and classes
                const cardClasses = ['task-card'];
                if (isNowCompleted) {
                    cardClasses.push('task-card--completed');
                }
                if (task.archived) cardClasses.push('task-card--archived');
                if (plugin.getActiveTimeSession(task)) cardClasses.push('task-card--actively-tracked');
                if (task.recurrence) cardClasses.push('task-card--recurring');
                if (task.priority) cardClasses.push(`task-card--priority-${task.priority}`);
                if (newEffectiveStatus) cardClasses.push(`task-card--status-${newEffectiveStatus}`);
                
                card.className = cardClasses.join(' ');
                card.dataset.status = newEffectiveStatus;
                
                // Update the title completion styling
                const titleEl = card.querySelector('.task-card__title') as HTMLElement;
                if (titleEl) {
                    titleEl.classList.toggle('completed', isNowCompleted);
                }
            } else {
                // For regular tasks, cycle to next status
                // Get fresh task data to ensure we have the latest status
                const freshTask = await plugin.cacheManager.getTaskInfo(task.path);
                if (!freshTask) {
                    new Notice('Task not found');
                    return;
                }
                
                const currentStatus = freshTask.status || 'open';
                const nextStatus = plugin.statusManager.getNextStatus(currentStatus);
                await plugin.updateTaskProperty(freshTask, 'status', nextStatus);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error cycling task status:', {
                error: errorMessage,
                taskPath: task.path
            });
            new Notice(`Failed to update task status: ${errorMessage}`);
        }
    });

    // Priority indicator dot
    if (task.priority && priorityConfig) {
        const priorityDot = card.createEl('span', { 
            cls: 'task-card__priority-dot',
            attr: { 'aria-label': `Priority: ${priorityConfig.label}` }
        });
        priorityDot.style.borderColor = priorityConfig.color;

        // Add click context menu for priority
        priorityDot.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger card click
            const menu = createPriorityContextMenu(plugin, [task]);
            menu.show(e as MouseEvent);
        });
    }
    
    // Recurring task indicator
    if (task.recurrence) {
        const recurringIndicator = card.createEl('div', { 
            cls: 'task-card__recurring-indicator',
            attr: { 
                'aria-label': `Recurring: ${getRecurrenceDisplayText(task.recurrence)} (click to change)`,
                'title': `Recurring: ${getRecurrenceDisplayText(task.recurrence)} (click to change)`
            }
        });
        
        // Use Obsidian's built-in rotate-ccw icon for recurring tasks
        setIcon(recurringIndicator, 'rotate-ccw');
        
        // Add click context menu for recurrence
        recurringIndicator.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger card click
            const menu = createRecurrenceContextMenu(plugin, [task]);
            menu.show(e as MouseEvent);
        });
    }
    
    // Project indicator (if task is used as a project)
    // Create placeholder that will be updated asynchronously
    const projectIndicatorPlaceholder = card.createEl('div', { 
        cls: 'task-card__project-indicator-placeholder',
        attr: { style: 'display: none;' }
    });
    
    plugin.projectSubtasksService.isTaskUsedAsProject(task.path).then((isProject: boolean) => {
        if (isProject) {
            projectIndicatorPlaceholder.className = 'task-card__project-indicator';
            projectIndicatorPlaceholder.removeAttribute('style');
            projectIndicatorPlaceholder.setAttribute('aria-label', 'This task is used as a project (click to filter subtasks)');
            projectIndicatorPlaceholder.setAttribute('title', 'This task is used as a project (click to filter subtasks)');
            
            // Use Obsidian's built-in folder icon for project tasks
            setIcon(projectIndicatorPlaceholder, 'folder');
            
            // Add click handler to filter subtasks
            projectIndicatorPlaceholder.addEventListener('click', async (e) => {
                e.stopPropagation(); // Don't trigger card click
                try {
                    await plugin.applyProjectSubtaskFilter(task);
                } catch (error) {
                    console.error('Error filtering project subtasks:', error);
                    new Notice('Failed to filter project subtasks');
                }
            });
        } else {
            projectIndicatorPlaceholder.remove();
        }
    }).catch((error: any) => {
        console.error('Error checking if task is used as project:', error);
        projectIndicatorPlaceholder.remove();
    });
    
    // Main content container
    const contentContainer = card.createEl('div', { cls: 'task-card__content' });
    
    // Context menu icon (appears on hover)
    const contextIcon = card.createEl('div', { 
        cls: 'task-card__context-menu',
        attr: { 
            'aria-label': 'Task options',
            'title': 'More options'
        }
    });
    
    // Use Obsidian's built-in ellipsis-vertical icon
    setIcon(contextIcon, 'ellipsis-vertical');
    
    contextIcon.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await showTaskContextMenu(e as MouseEvent, task.path, plugin, targetDate);
    });
    
    // First line: Task title
    const titleEl = contentContainer.createEl('div', { 
        cls: 'task-card__title',
        text: task.title
    });
    if (plugin.statusManager.isCompletedStatus(effectiveStatus)) {
        titleEl.classList.add('completed');
    }
    
    // Second line: Metadata
    const metadataLine = contentContainer.createEl('div', { cls: 'task-card__metadata' });
    const metadataElements: HTMLElement[] = [];
    
    // Recurrence info (if recurring)
    if (task.recurrence) {
        const frequencyDisplay = getRecurrenceDisplayText(task.recurrence);
        const recurringSpan = metadataLine.createEl('span');
        recurringSpan.textContent = `Recurring: ${frequencyDisplay}`;
        metadataElements.push(recurringSpan);
    }
    
    // Due date (if has due date) - with hover menu
    if (task.due) {
        const isDueToday = isTodayTimeAware(task.due);
        const isDueOverdue = isOverdueTimeAware(task.due);
        
        let dueDateText = '';
        if (isDueToday) {
            // For today, show time if available
            const timeDisplay = formatDateTimeForDisplay(task.due, {
                dateFormat: '',
                timeFormat: 'h:mm a',
                showTime: true
            });
            if (timeDisplay.trim() === '') {
                dueDateText = 'Due: Today';
            } else {
                dueDateText = `Due: Today at ${timeDisplay}`;
            }
        } else if (isDueOverdue) {
            // For overdue, show date and time if available
            const display = formatDateTimeForDisplay(task.due, {
                dateFormat: 'MMM d',
                timeFormat: 'h:mm a',
                showTime: true
            });
            dueDateText = `Due: ${display} (overdue)`;
        } else {
            // For future dates, show date and time if available
            const display = formatDateTimeForDisplay(task.due, {
                dateFormat: 'MMM d',
                timeFormat: 'h:mm a',
                showTime: true
            });
            dueDateText = `Due: ${display}`;
        }

        const dueDateSpan = metadataLine.createEl('span', { 
            cls: 'task-card__metadata-date task-card__metadata-date--due',
            text: dueDateText
        });

        // Add click context menu for due date
        attachDateClickHandler(dueDateSpan, task, plugin, 'due');

        metadataElements.push(dueDateSpan);
    }
    
    // Scheduled date (if has scheduled date) - with hover menu
    if (task.scheduled) {
        const isScheduledToday = isTodayTimeAware(task.scheduled);
        const isScheduledPast = isOverdueTimeAware(task.scheduled);
        
        let scheduledDateText = '';
        if (isScheduledToday) {
            // For today, show time if available
            const timeDisplay = formatDateTimeForDisplay(task.scheduled, {
                dateFormat: '',
                timeFormat: 'h:mm a',
                showTime: true
            });
            if (timeDisplay.trim() === '') {
                scheduledDateText = 'Scheduled: Today';
            } else {
                scheduledDateText = `Scheduled: Today at ${timeDisplay}`;
            }
        } else if (isScheduledPast) {
            // For past dates, show date and time if available
            const display = formatDateTimeForDisplay(task.scheduled, {
                dateFormat: 'MMM d',
                timeFormat: 'h:mm a',
                showTime: true
            });
            scheduledDateText = `Scheduled: ${display} (past)`;
        } else {
            // For future dates, show date and time if available
            const display = formatDateTimeForDisplay(task.scheduled, {
                dateFormat: 'MMM d',
                timeFormat: 'h:mm a',
                showTime: true
            });
            scheduledDateText = `Scheduled: ${display}`;
        }

        const scheduledSpan = metadataLine.createEl('span', { 
            cls: 'task-card__metadata-date task-card__metadata-date--scheduled',
            text: scheduledDateText
        });

        // Add click context menu for scheduled date
        attachDateClickHandler(scheduledSpan, task, plugin, 'scheduled');

        metadataElements.push(scheduledSpan);
    }
    
    // Contexts (if has contexts)
    if (task.contexts && task.contexts.length > 0) {
        const contextsSpan = metadataLine.createEl('span');
        contextsSpan.textContent = `@${task.contexts.join(', @')}`;
        metadataElements.push(contextsSpan);
    }
    
    // Projects (if has projects)
    const filteredProjects = filterEmptyProjects(task.projects || []);
    if (filteredProjects.length > 0) {
        const projectsSpan = metadataLine.createEl('span');
        renderProjectLinks(projectsSpan, filteredProjects, plugin);
        metadataElements.push(projectsSpan);
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
        const timeSpan = metadataLine.createEl('span');
        timeSpan.textContent = timeInfo.join(', ');
        metadataElements.push(timeSpan);
    }
    
    // Add separators between metadata elements
    if (metadataElements.length > 0) {
        // Insert separators between elements
        for (let i = 1; i < metadataElements.length; i++) {
            const separator = metadataLine.createEl('span', { 
                cls: 'task-card__metadata-separator',
                text: ' • ' 
            });
            // Insert separator before each element (except first)
            metadataElements[i].insertAdjacentElement('beforebegin', separator);
        }
    } else {
        metadataLine.style.display = 'none';
    }
    
    // Add click handlers
    card.addEventListener('click', async (e) => {
        if (e.target === card.querySelector('.task-card__checkbox')) {
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
            await plugin.openTaskEditModal(task);
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
export async function showTaskContextMenu(event: MouseEvent, taskPath: string, plugin: TaskNotesPlugin, targetDate: Date) {
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
                item.setTitle(`${statusConfig.label}`);
                item.setIcon('circle');
                if (isSelected) {
                    item.setIcon('check');
                }
                item.onClick(async () => {
                    try {
                        // Use the fresh task data that showTaskContextMenu just fetched
                        await plugin.updateTaskProperty(task, 'status', statusConfig.value);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        console.error('Error updating task status:', {
                            error: errorMessage,
                            taskPath: task.path
                        });
                        new Notice(`Failed to update task status: ${errorMessage}`);
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
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        console.error('Error toggling recurring task completion:', {
                            error: errorMessage,
                            taskPath: task.path
                        });
                        new Notice(`Failed to toggle recurring task completion: ${errorMessage}`);
                    }
                });
            });
        }
        
        menu.addSeparator();
        
        // Direct priority options (no submenu to avoid issues)
        plugin.priorityManager.getPrioritiesByWeight().forEach(priorityConfig => {
            menu.addItem((item) => {
                const isSelected = task.priority === priorityConfig.value;
                item.setTitle(`Priority: ${priorityConfig.label}`);
                item.setIcon('flag');
                if (isSelected) {
                    item.setIcon('check');
                }
                item.onClick(async () => {
                    try {
                        // Use the fresh task data that showTaskContextMenu just fetched
                        await plugin.updateTaskProperty(task, 'priority', priorityConfig.value);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        console.error('Error updating task priority:', {
                            error: errorMessage,
                            taskPath: task.path
                        });
                        new Notice(`Failed to update task priority: ${errorMessage}`);
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
            item.setTitle(activeSession ? 'Stop time tracking' : 'Start time tracking');
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
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error('Error toggling task archive:', {
                        error: errorMessage,
                        taskPath: task.path
                    });
                    new Notice(`Failed to toggle task archive: ${errorMessage}`);
                }
            });
        });
        
        menu.addSeparator();
        
        // Open Note
        menu.addItem((item) => {
            item.setTitle('Open note');
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
            item.setTitle('Copy task title');
            item.setIcon('copy');
            item.onClick(async () => {
                copyTaskTitleToClipboard([task]);
            });
        });
        
        menu.addSeparator();
        
                
        // Add Project
        menu.addItem((item) => {
            item.setTitle('Add project...');
            item.setIcon('folder-plus');
            item.onClick(() => {
                showProjectModal(plugin, [task]);
            });
        });

        // Create subtask
        menu.addItem((item) => {
            item.setTitle('Create subtask');
            item.setIcon('plus');
            item.onClick(() => {
                // Create a subtask with the current task as the project reference
                const taskFile = plugin.app.vault.getAbstractFileByPath(task.path);
                if (taskFile instanceof TFile) {
                    const projectReference = `[[${taskFile.basename}]]`;
                    plugin.openTaskCreationModal({
                        projects: [projectReference]
                    });
                }
            });
        });
        
        // Delete Task
        menu.addItem((item) => {
            item.setTitle('Delete task');
            item.setIcon('trash');
            item.onClick(async () => {
                try {
                    await showDeleteConfirmationModal(task, plugin);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error('Error deleting task:', {
                        error: errorMessage,
                        taskPath: task.path
                    });
                    new Notice(`Failed to delete task: ${errorMessage}`);
                }
            });
        });
    
        menu.showAtMouseEvent(event);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error creating context menu:', {
            error: errorMessage,
            taskPath
        });
        new Notice(`Failed to create context menu: ${errorMessage}`);
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
    
    // Update main element classes using BEM structure
    const isActivelyTracked = plugin.getActiveTimeSession(task) !== null;
    const isCompleted = plugin.statusManager.isCompletedStatus(effectiveStatus);
    const isRecurring = !!task.recurrence;
    
    // Build BEM class names for update
    const cardClasses = ['task-card'];
    
    // Add modifiers
    if (isCompleted) cardClasses.push('task-card--completed');
    if (task.archived) cardClasses.push('task-card--archived');
    if (isActivelyTracked) cardClasses.push('task-card--actively-tracked');
    if (isRecurring) cardClasses.push('task-card--recurring');
    
    // Add priority modifier
    if (task.priority) {
        cardClasses.push(`task-card--priority-${task.priority}`);
    }
    
    // Add status modifier
    if (effectiveStatus) {
        cardClasses.push(`task-card--status-${effectiveStatus}`);
    }
    
    
    element.className = cardClasses.join(' ');
    element.dataset.status = effectiveStatus;
    
    // Update priority and status colors
    const priorityConfig = plugin.priorityManager.getPriorityConfig(task.priority);
    if (priorityConfig) {
        element.style.setProperty('--priority-color', priorityConfig.color);
    }
    
    const statusConfig = plugin.statusManager.getStatusConfig(effectiveStatus);
    if (statusConfig) {
        element.style.setProperty('--current-status-color', statusConfig.color);
    }
    
    // Update checkbox if present
    const checkbox = element.querySelector('.task-card__checkbox') as HTMLInputElement;
    if (checkbox) {
        checkbox.checked = plugin.statusManager.isCompletedStatus(effectiveStatus);
    }
    
    // Update status dot
    const statusDot = element.querySelector('.task-card__status-dot') as HTMLElement;
    if (statusDot && statusConfig) {
        statusDot.style.borderColor = statusConfig.color;
    }
    
    // Update priority indicator
    const existingPriorityDot = element.querySelector('.task-card__priority-dot') as HTMLElement;
    if (task.priority && priorityConfig && !existingPriorityDot) {
        // Add priority dot if task has priority but no dot exists
        const priorityDot = element.createEl('span', { 
            cls: 'task-card__priority-dot',
            attr: { 'aria-label': `Priority: ${priorityConfig.label}` }
        });
        priorityDot.style.borderColor = priorityConfig.color;
        statusDot?.insertAdjacentElement('afterend', priorityDot);
    } else if (!task.priority && existingPriorityDot) {
        // Remove priority dot if task no longer has priority
        existingPriorityDot.remove();
    } else if (task.priority && priorityConfig && existingPriorityDot) {
        // Update existing priority dot
        existingPriorityDot.style.borderColor = priorityConfig.color;
        existingPriorityDot.setAttribute('aria-label', `Priority: ${priorityConfig.label}`);
    }
    
    // Update recurring indicator
    const existingRecurringIndicator = element.querySelector('.task-card__recurring-indicator');
    if (task.recurrence && !existingRecurringIndicator) {
        // Add recurring indicator if task is now recurring but didn't have one
        const recurringIndicator = element.createEl('span', { 
            cls: 'task-card__recurring-indicator',
            attr: { 'aria-label': `Recurring: ${getRecurrenceDisplayText(task.recurrence)}` }
        });
        statusDot?.insertAdjacentElement('afterend', recurringIndicator);
    } else if (!task.recurrence && existingRecurringIndicator) {
        // Remove recurring indicator if task is no longer recurring
        existingRecurringIndicator.remove();
    } else if (task.recurrence && existingRecurringIndicator) {
        // Update existing recurring indicator
        const frequencyDisplay = getRecurrenceDisplayText(task.recurrence);
        existingRecurringIndicator.setAttribute('aria-label', `Recurring: ${frequencyDisplay}`);
    }
    
    // Update project indicator
    const existingProjectIndicator = element.querySelector('.task-card__project-indicator');
    const existingPlaceholder = element.querySelector('.task-card__project-indicator-placeholder');
    
    plugin.projectSubtasksService.isTaskUsedAsProject(task.path).then((isProject: boolean) => {
        if (isProject && !existingProjectIndicator && !existingPlaceholder) {
            // Add project indicator if task is now used as a project but didn't have one
            const projectIndicator = element.createEl('div', { 
                cls: 'task-card__project-indicator',
                attr: { 
                    'aria-label': 'This task is used as a project (click to filter subtasks)',
                    'title': 'This task is used as a project (click to filter subtasks)'
                }
            });
            setIcon(projectIndicator, 'folder');
            
            // Add click handler to filter subtasks
            projectIndicator.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await plugin.applyProjectSubtaskFilter(task);
                } catch (error) {
                    console.error('Error filtering project subtasks:', error);
                    new Notice('Failed to filter project subtasks');
                }
            });
            
            // Insert after recurring indicator or priority dot
            const insertAfter = element.querySelector('.task-card__recurring-indicator') || 
                               element.querySelector('.task-card__priority-dot') ||
                               element.querySelector('.task-card__status-dot');
            insertAfter?.insertAdjacentElement('afterend', projectIndicator);
        } else if (!isProject && (existingProjectIndicator || existingPlaceholder)) {
            // Remove project indicator if task is no longer used as a project
            existingProjectIndicator?.remove();
            existingPlaceholder?.remove();
        }
    }).catch((error: any) => {
        console.error('Error checking if task is used as project in update:', error);
    });
    
    // Update title
    const titleEl = element.querySelector('.task-card__title') as HTMLElement;
    if (titleEl) {
        titleEl.textContent = task.title;
        titleEl.classList.toggle('completed', plugin.statusManager.isCompletedStatus(effectiveStatus));
    }
    
    // Update metadata line
    const metadataLine = element.querySelector('.task-card__metadata') as HTMLElement;
    if (metadataLine) {
        // Clear the metadata line and rebuild with DOM elements to support project links
        metadataLine.innerHTML = '';
        const metadataElements: HTMLElement[] = [];
        
        // Recurrence info (if recurring)
        if (task.recurrence) {
            const frequencyDisplay = getRecurrenceDisplayText(task.recurrence);
            const recurringSpan = metadataLine.createEl('span');
            recurringSpan.textContent = `Recurring: ${frequencyDisplay}`;
            metadataElements.push(recurringSpan);
        }
        
        // Due date (if has due date)
        if (task.due) {
            const isDueToday = isTodayTimeAware(task.due);
            const isDueOverdue = isOverdueTimeAware(task.due);
            
            let dueDateText = '';
            if (isDueToday) {
                // For today, show time if available
                const timeDisplay = formatDateTimeForDisplay(task.due, {
                    dateFormat: '',
                    timeFormat: 'h:mm a',
                    showTime: true
                });
                if (timeDisplay.trim() === '') {
                    dueDateText = 'Due: Today';
                } else {
                    dueDateText = `Due: Today at ${timeDisplay}`;
                }
            } else if (isDueOverdue) {
                // For overdue, show date and time if available
                const display = formatDateTimeForDisplay(task.due, {
                    dateFormat: 'MMM d',
                    timeFormat: 'h:mm a',
                    showTime: true
                });
                dueDateText = `Due: ${display} (overdue)`;
            } else {
                // For future dates, show date and time if available
                const display = formatDateTimeForDisplay(task.due, {
                    dateFormat: 'MMM d',
                    timeFormat: 'h:mm a',
                    showTime: true
                });
                dueDateText = `Due: ${display}`;
            }

            const dueDateSpan = metadataLine.createEl('span', { 
                cls: 'task-card__metadata-date task-card__metadata-date--due',
                text: dueDateText
            });
            
            // Re-attach click context menu for due date
            attachDateClickHandler(dueDateSpan, task, plugin, 'due');
            
            metadataElements.push(dueDateSpan);
        }
        
        // Scheduled date (if has scheduled date)
        if (task.scheduled) {
            const isScheduledToday = isTodayTimeAware(task.scheduled);
            const isScheduledPast = isOverdueTimeAware(task.scheduled);
            
            let scheduledDateText = '';
            if (isScheduledToday) {
                // For today, show time if available
                const timeDisplay = formatDateTimeForDisplay(task.scheduled, {
                    dateFormat: '',
                    timeFormat: 'h:mm a',
                    showTime: true
                });
                if (timeDisplay.trim() === '') {
                    scheduledDateText = 'Scheduled: Today';
                } else {
                    scheduledDateText = `Scheduled: Today at ${timeDisplay}`;
                }
            } else if (isScheduledPast) {
                // For past dates, show date and time if available
                const display = formatDateTimeForDisplay(task.scheduled, {
                    dateFormat: 'MMM d',
                    timeFormat: 'h:mm a',
                    showTime: true
                });
                scheduledDateText = `Scheduled: ${display} (past)`;
            } else {
                // For future dates, show date and time if available
                const display = formatDateTimeForDisplay(task.scheduled, {
                    dateFormat: 'MMM d',
                    timeFormat: 'h:mm a',
                    showTime: true
                });
                scheduledDateText = `Scheduled: ${display}`;
            }

            const scheduledSpan = metadataLine.createEl('span', { 
                cls: 'task-card__metadata-date task-card__metadata-date--scheduled',
                text: scheduledDateText
            });
            
            // Re-attach click context menu for scheduled date
            attachDateClickHandler(scheduledSpan, task, plugin, 'scheduled');
            
            metadataElements.push(scheduledSpan);
        }
        
        // Contexts (if has contexts)
        if (task.contexts && task.contexts.length > 0) {
            const contextsSpan = metadataLine.createEl('span');
            contextsSpan.textContent = `@${task.contexts.join(', @')}`;
            metadataElements.push(contextsSpan);
        }
        
        // Projects (if has projects) - use specialized rendering for links
        const filteredProjects = filterEmptyProjects(task.projects || []);
        if (filteredProjects.length > 0) {
            const projectsSpan = metadataLine.createEl('span');
            renderProjectLinks(projectsSpan, filteredProjects, plugin);
            metadataElements.push(projectsSpan);
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
            const timeSpan = metadataLine.createEl('span');
            timeSpan.textContent = timeInfo.join(', ');
            metadataElements.push(timeSpan);
        }
        
        // Add separators between metadata elements
        if (metadataElements.length > 0) {
            // Insert separators between elements
            for (let i = 1; i < metadataElements.length; i++) {
                const separator = metadataLine.createEl('span', { 
                    cls: 'task-card__metadata-separator',
                    text: ' • ' 
                });
                // Insert separator before each element (except first)
                metadataElements[i].insertAdjacentElement('beforebegin', separator);
            }
            metadataLine.style.display = '';
        } else {
            metadataLine.style.display = 'none';
        }
    }
    
    // Animation is now handled separately - don't add it here during reconciler updates
}

export function setTaskCardSelected(taskCard: HTMLElement, selected: boolean): void {
    // Assuming `containerDiv` is your <div>
    const checkbox = taskCard.querySelector('input[type="checkbox"]') as HTMLInputElement;

    if (checkbox && checkbox.checked !== selected) {
        checkbox.checked = selected; // toggle
        checkbox.dispatchEvent(new Event('change', { bubbles: true })); // notify listeners
    }
}


export function toggleTaskCardSelection(taskCard: HTMLElement): void {
    // Assuming `containerDiv` is your <div>
    const checkbox = taskCard.querySelector('input[type="checkbox"]') as HTMLInputElement;

    if (checkbox) {
        checkbox.checked = !checkbox.checked; // toggle
        checkbox.dispatchEvent(new Event('change', { bubbles: true })); // notify listeners
    }
}

export function isTaskCardSelected(taskCard: HTMLElement): boolean {
    // Assuming `containerDiv` is your <div>
    const checkbox = taskCard.querySelector('input[type="checkbox"]') as HTMLInputElement;
    return checkbox ? checkbox.checked : false;
}


/**
 * Confirmation modal for task deletion
 */
class DeleteTaskConfirmationModal extends Modal {
    private tasks: TaskInfo[] | null = null;
    private customTitle: string | null = null;
    private plugin: TaskNotesPlugin;
    private onConfirm: () => Promise<void>;

    constructor(
        app: App,
        target: TaskInfo | TaskInfo[] | string,
        plugin: TaskNotesPlugin,
        onConfirm: () => Promise<void>
    ) {
        super(app);
        this.plugin = plugin;
        this.onConfirm = onConfirm;

        if (typeof target === "string") {
            this.customTitle = target;
        } else if (Array.isArray(target)) {
            this.tasks = target;
        } else {
            this.tasks = [target];
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "Delete Task" });

        const description = contentEl.createEl("p");

        if (this.customTitle) {
            // Custom message string
            description.appendText(`Are you sure you want to delete "${this.customTitle}"?`);
        } else if (this.tasks) {
            if (this.tasks.length === 1) {
                description.appendText('Are you sure you want to delete the task "');
                description.createEl("strong", { text: this.tasks[0].title });
                description.appendText('"?');
            } else {
                description.appendText(`Are you sure you want to delete these ${this.tasks.length} tasks?`);
            }
        }

        contentEl.createEl("p", {
            cls: "mod-warning",
            text: "This action cannot be undone. The task file(s) will be permanently deleted.",
        });

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.marginTop = '20px';

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            this.close();
        });

        const deleteButton = buttonContainer.createEl('button', { 
            text: 'Delete',
            cls: 'mod-warning'
        });
        deleteButton.style.backgroundColor = 'var(--color-red)';
        deleteButton.style.color = 'white';
        
        deleteButton.addEventListener('click', async () => {
            try {
                await this.onConfirm();
                this.close();
                new Notice(
                    this.tasks && this.tasks.length > 1
                        ? 'Tasks deleted successfully'
                        : 'Task deleted successfully'
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                new Notice(`Failed to delete task: ${errorMessage}`);
                console.error('Error in delete confirmation:', error);
            }
        });

        cancelButton.focus();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}


/**
 * Show delete confirmation modal and handle task deletion
 */
export async function showDeleteConfirmationModal(
    tasks: TaskInfo | TaskInfo[],
    plugin: TaskNotesPlugin
): Promise<void> {
    const taskArray = Array.isArray(tasks) ? tasks : [tasks];
    if (taskArray.length === 0) {
        return; // Nothing to delete
    }

    return new Promise((resolve, reject) => {
        const modal = new DeleteTaskConfirmationModal(
            plugin.app,
            taskArray,
            plugin,
            async () => {
                try {
                    // Delete tasks sequentially (to preserve order and handle errors)
                    for (const task of taskArray) {
                        await plugin.taskService.deleteTask(task);
                    }
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }
        );
        modal.open();
    });
}

/**
 * Check if a project string is in wikilink format [[Note Name]]
 */
function isWikilinkProject(project: string): boolean {
    return project.startsWith('[[') && project.endsWith(']]');
}

/**
 * Render project links in a container element, handling both plain text and wikilink projects
 */
function renderProjectLinks(container: HTMLElement, projects: string[], plugin: TaskNotesPlugin): void {
    container.innerHTML = '';
    
    projects.forEach((project, index) => {
        if (index > 0) {
            const separator = document.createTextNode(', ');
            container.appendChild(separator);
        }
        
        const plusText = document.createTextNode('+');
        container.appendChild(plusText);
        
        if (isWikilinkProject(project)) {
            // Extract the note name from [[Note Name]]
            const noteName = project.slice(2, -2);
            
            // Create a clickable link
            const linkEl = container.createEl('a', {
                cls: 'task-card__project-link internal-link',
                text: noteName,
                attr: { 
                    'data-href': noteName,
                    'role': 'button',
                    'tabindex': '0'
                }
            });
            
            // Add click handler to open the note
            linkEl.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                try {
                    // Resolve the link to get the actual file
                    const file = plugin.app.metadataCache.getFirstLinkpathDest(noteName, '');
                    if (file instanceof TFile) {
                        // Open the file in the current leaf
                        await plugin.app.workspace.getLeaf(false).openFile(file);
                    } else {
                        // File not found, show notice
                        new Notice(`Note "${noteName}" not found`);
                    }
                } catch (error) {
                    console.error('Error opening project link:', error);
                    new Notice(`Failed to open note "${noteName}"`);
                }
            });
            
            // Add keyboard support for accessibility
            linkEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    linkEl.click();
                }
            });
            
            // Add hover preview for the project link
            linkEl.addEventListener('mouseover', (event) => {
                const file = plugin.app.metadataCache.getFirstLinkpathDest(noteName, '');
                if (file instanceof TFile) {
                    plugin.app.workspace.trigger('hover-link', {
                        event,
                        source: 'tasknotes-project-link',
                        hoverParent: container,
                        targetEl: linkEl,
                        linktext: noteName,
                        sourcePath: file.path
                    });
                }
            });
        } else {
            // Plain text project
            const textNode = document.createTextNode(project);
            container.appendChild(textNode);
        }
    });
}
