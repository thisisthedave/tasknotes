import { TFile, setIcon, Notice, Modal, App, setTooltip } from 'obsidian';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';
import { TaskContextMenu } from '../components/TaskContextMenu';
import { calculateTotalTimeSpent, getEffectiveTaskStatus, getRecurrenceDisplayText, filterEmptyProjects } from '../utils/helpers';
import { 
    formatDateTimeForDisplay,
    isTodayTimeAware,
    isOverdueTimeAware,
    getDatePart,
    getTimePart
} from '../utils/dateUtils';
import { DateContextMenu } from '../components/DateContextMenu';
import { createPriorityContextMenu, PriorityContextMenu } from '../components/PriorityContextMenu';
import { createRecurrenceContextMenu, RecurrenceContextMenu } from '../components/RecurrenceContextMenu';
import { StatusContextMenu } from '../components/StatusContextMenu';
import { ProjectSelectModal } from '../modals/ProjectSelectModal';
import { DEFAULT_POINT_SUGGESTIONS, StoryPointsModal } from '../modals/StoryPointsModal';
import { TagsModal } from '../modals/TagsModal';
import { ContextsModal } from '../modals/ContextsModal';
import { ReminderModal } from '../modals/ReminderModal';

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
                plugin.batchUpdateTasksProperty(tasks, dateType, finalValue);
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

function createStatusContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
): StatusContextMenu {
    const menu = new StatusContextMenu({
        currentValue: tasks[0].status,
        onSelect: async (newStatus: string) => {
            await plugin.batchUpdateTasksProperty(tasks, 'status', newStatus);
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
    const targetDate = opts.targetDate || plugin.selectedDate || new Date();
    
    // Determine effective status for recurring tasks
    const effectiveStatus = task.recurrence 
        ? getEffectiveTaskStatus(task, targetDate)
        : task.status;
    
    // Main container with BEM class structure
    const card = document.createElement('div');
    
    // Store task path for circular reference detection
    (card as any)._taskPath = task.path;
    
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

    // Chevron position preference
    if (plugin.settings?.subtaskChevronPosition === 'left') {
        cardClasses.push('task-card--chevron-left');
    }

    // Add project modifier (for issue #355)
    const hasProjects = filterEmptyProjects(task.projects || []).length > 0;
    if (hasProjects) {
        cardClasses.push('task-card--has-projects');
    }
    
    card.className = cardClasses.join(' ');
    card.tabIndex = 0; // Make it focusable
    card.dataset.taskPath = task.path;
    card.dataset.key = task.path; // For DOMReconciler compatibility
    card.dataset.status = effectiveStatus;
    
    // Create main row container for horizontal layout
    const mainRow = card.createEl('div', { cls: 'task-card__main-row' });
    
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
        const checkbox = mainRow.createEl('input', { 
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
    const statusDot = mainRow.createEl('span', { cls: 'task-card__status-dot' });
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
        const priorityDot = mainRow.createEl('span', { 
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
        const recurringIndicator = mainRow.createEl('div', { 
            cls: 'task-card__recurring-indicator',
            attr: { 
                'aria-label': `Recurring: ${getRecurrenceDisplayText(task.recurrence)} (click to change)`
            }
        });
        setTooltip(recurringIndicator, `Recurring: ${getRecurrenceDisplayText(task.recurrence)} (click to change)`, { placement: 'top' });
        
        // Use Obsidian's built-in rotate-ccw icon for recurring tasks
        setIcon(recurringIndicator, 'rotate-ccw');
        
        // Add click context menu for recurrence
        recurringIndicator.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger card click
            const menu = createRecurrenceContextMenu(plugin, [task]);
            menu.show(e as MouseEvent);
        });
    }
    
    // Reminder indicator (if task has reminders)
    if (task.reminders && task.reminders.length > 0) {
        const reminderIndicator = mainRow.createEl('div', {
            cls: 'task-card__reminder-indicator',
            attr: {
                'aria-label': `${task.reminders.length} reminder${task.reminders.length > 1 ? 's' : ''} set (click to manage)`
            }
        });
        
        const count = task.reminders.length;
        const tooltip = count === 1 ? '1 reminder set (click to manage)' : `${count} reminders set (click to manage)`;
        setTooltip(reminderIndicator, tooltip, { placement: 'top' });
        
        // Use Obsidian's built-in bell icon for reminders
        setIcon(reminderIndicator, 'bell');
        
        // Add click handler to open reminder modal
        reminderIndicator.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger card click
            const modal = new ReminderModal(
                plugin.app,
                plugin,
                task,
                async (reminders) => {
                    try {
                        await plugin.updateTaskProperty(task, 'reminders', reminders.length > 0 ? reminders : undefined);
                    } catch (error) {
                        console.error('Error updating reminders:', error);
                        new Notice('Failed to update reminders');
                    }
                }
            );
            modal.open();
        });
    }
    
    // Project indicator (if task is used as a project)
    // Create placeholder that will be updated asynchronously
    const projectIndicatorPlaceholder = mainRow.createEl('div', { 
        cls: 'task-card__project-indicator-placeholder',
        attr: { style: 'display: none;' }
    });
    
    // Chevron for expandable subtasks (if feature is enabled)
    const chevronPlaceholder = mainRow.createEl('div', {
        cls: 'task-card__chevron-placeholder',
        attr: { style: 'display: none;' }
    });
    
    plugin.projectSubtasksService.isTaskUsedAsProject(task.path).then((isProject: boolean) => {
        if (isProject) {
            projectIndicatorPlaceholder.className = 'task-card__project-indicator';
            projectIndicatorPlaceholder.removeAttribute('style');
            projectIndicatorPlaceholder.setAttribute('aria-label', 'This task is used as a project (click to filter subtasks)');
            setTooltip(projectIndicatorPlaceholder, 'This task is used as a project (click to filter subtasks)', { placement: 'top' });
            
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
            
            // Add chevron for expandable subtasks if feature is enabled
            if (plugin.settings?.showExpandableSubtasks) {
                chevronPlaceholder.className = 'task-card__chevron';
                chevronPlaceholder.removeAttribute('style');
                
                const isExpanded = plugin.expandedProjectsService?.isExpanded(task.path) || false;
                if (isExpanded) {
                    chevronPlaceholder.classList.add('task-card__chevron--expanded');
                }
                
                chevronPlaceholder.setAttribute('aria-label', isExpanded ? 'Collapse subtasks' : 'Expand subtasks');
                setTooltip(chevronPlaceholder, isExpanded ? 'Collapse subtasks' : 'Expand subtasks', { placement: 'top' });
                
                // Use Obsidian's built-in chevron-right icon
                setIcon(chevronPlaceholder, 'chevron-right');
                
                // Add click handler to toggle expansion
                chevronPlaceholder.addEventListener('click', async (e) => {
                    e.stopPropagation(); // Don't trigger card click
                    try {
                        if (!plugin.expandedProjectsService) {
                            console.error('ExpandedProjectsService not initialized');
                            new Notice('Service not available. Please try reloading the plugin.');
                            return;
                        }
                        
                        const newExpanded = plugin.expandedProjectsService.toggle(task.path);
                        chevronPlaceholder.classList.toggle('task-card__chevron--expanded', newExpanded);
                        chevronPlaceholder.setAttribute('aria-label', newExpanded ? 'Collapse subtasks' : 'Expand subtasks');
                        setTooltip(chevronPlaceholder, newExpanded ? 'Collapse subtasks' : 'Expand subtasks', { placement: 'top' });
                        
                        // Toggle subtasks display
                        await toggleSubtasks(card, task, plugin, newExpanded);
                    } catch (error) {
                        console.error('Error toggling subtasks:', error);
                        new Notice('Failed to toggle subtasks');
                    }
                });
                
                // If already expanded, show subtasks
                if (isExpanded) {
                    toggleSubtasks(card, task, plugin, true).catch(error => {
                        console.error('Error showing initial subtasks:', error);
                    });
                }
            }
        } else {
            projectIndicatorPlaceholder.remove();
            chevronPlaceholder.remove();
        }
    }).catch((error: any) => {
        console.error('Error checking if task is used as project:', error);
        projectIndicatorPlaceholder.remove();
        chevronPlaceholder.remove();
    });
    
    // Main content container
    const contentContainer = mainRow.createEl('div', { cls: 'task-card__content' });
    
    // Context menu icon (appears on hover)
    const contextIcon = mainRow.createEl('div', { 
        cls: 'task-card__context-menu',
        attr: { 
            'aria-label': 'Task options'
        }
    });
    
    // Use Obsidian's built-in ellipsis-vertical icon
    setIcon(contextIcon, 'ellipsis-vertical');
    setTooltip(contextIcon, 'Task options', { placement: 'top' });
    
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
    
    // Story points (if has story points)
    if (task.points && task.points > 0) {
        const pointsSpan = metadataLine.createEl('span');
        pointsSpan.textContent = `${task.points} pts`;
        metadataElements.push(pointsSpan);
    }

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
        
        const contextMenu = new TaskContextMenu({
            task: task,
            plugin: plugin,
            targetDate: targetDate,
            onUpdate: () => {
                // Trigger refresh of views
                plugin.app.workspace.trigger('tasknotes:refresh-views');
            }
        });
        
        contextMenu.show(event);
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
    const targetDate = opts.targetDate || plugin.selectedDate || new Date();
    
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

    // Chevron position preference
    if (plugin.settings?.subtaskChevronPosition === 'left') {
        cardClasses.push('task-card--chevron-left');
    }

    element.className = cardClasses.join(' ');
    element.dataset.status = effectiveStatus;
    
    // Get the main row container
    const mainRow = element.querySelector('.task-card__main-row') as HTMLElement;
    
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
    if (task.priority && priorityConfig && !existingPriorityDot && mainRow) {
        // Add priority dot if task has priority but no dot exists (and mainRow exists)
        const priorityDot = mainRow.createEl('span', { 
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
        const recurringIndicator = mainRow.createEl('span', { 
            cls: 'task-card__recurring-indicator',
            attr: { 'aria-label': `Recurring: ${getRecurrenceDisplayText(task.recurrence)}` }
        });
        setIcon(recurringIndicator, 'rotate-ccw');
        statusDot?.insertAdjacentElement('afterend', recurringIndicator);
    } else if (!task.recurrence && existingRecurringIndicator) {
        // Remove recurring indicator if task is no longer recurring
        existingRecurringIndicator.remove();
    } else if (task.recurrence && existingRecurringIndicator) {
        // Update existing recurring indicator
        const frequencyDisplay = getRecurrenceDisplayText(task.recurrence);
        existingRecurringIndicator.setAttribute('aria-label', `Recurring: ${frequencyDisplay}`);
    }

    // Update reminder indicator
    const existingReminderIndicator = element.querySelector('.task-card__reminder-indicator');
    if (task.reminders && task.reminders.length > 0 && !existingReminderIndicator) {
        // Add reminder indicator if task has reminders but didn't have one
        const reminderIndicator = mainRow.createEl('div', {
            cls: 'task-card__reminder-indicator',
            attr: {
                'aria-label': `${task.reminders.length} reminder${task.reminders.length > 1 ? 's' : ''} set (click to manage)`
            }
        });
        
        const count = task.reminders.length;
        const tooltip = count === 1 ? '1 reminder set (click to manage)' : `${count} reminders set (click to manage)`;
        setTooltip(reminderIndicator, tooltip, { placement: 'top' });
        
        setIcon(reminderIndicator, 'bell');
        
        // Add click handler to open reminder modal
        reminderIndicator.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger card click
            const modal = new ReminderModal(
                plugin.app,
                plugin,
                task,
                async (reminders) => {
                    try {
                        await plugin.updateTaskProperty(task, 'reminders', reminders.length > 0 ? reminders : undefined);
                    } catch (error) {
                        console.error('Error updating reminders:', error);
                        new Notice('Failed to update reminders');
                    }
                }
            );
            modal.open();
        });
        
        // Insert after the recurring indicator or status dot
        const insertAfter = existingRecurringIndicator || statusDot;
        insertAfter?.insertAdjacentElement('afterend', reminderIndicator);
    } else if ((!task.reminders || task.reminders.length === 0) && existingReminderIndicator) {
        // Remove reminder indicator if task no longer has reminders
        existingReminderIndicator.remove();
    } else if (task.reminders && task.reminders.length > 0 && existingReminderIndicator) {
        // Update existing reminder indicator
        const count = task.reminders.length;
        const tooltip = count === 1 ? '1 reminder set (click to manage)' : `${count} reminders set (click to manage)`;
        existingReminderIndicator.setAttribute('aria-label', `${count} reminder${count > 1 ? 's' : ''} set (click to manage)`);
        setTooltip(existingReminderIndicator as HTMLElement, tooltip, { placement: 'top' });
    }
    
    // Update project indicator
    const existingProjectIndicator = element.querySelector('.task-card__project-indicator');
    const existingPlaceholder = element.querySelector('.task-card__project-indicator-placeholder');
    
    plugin.projectSubtasksService.isTaskUsedAsProject(task.path).then((isProject: boolean) => {
        // Update project indicator
        if (isProject && !existingProjectIndicator && !existingPlaceholder) {
            // Add project indicator if task is now used as a project but didn't have one
            const projectIndicator = mainRow.createEl('div', { 
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
        
        // Update chevron for expandable subtasks
        const existingChevron = element.querySelector('.task-card__chevron') as HTMLElement;
        const existingChevronPlaceholder = element.querySelector('.task-card__chevron-placeholder');
        
        if (isProject && plugin.settings?.showExpandableSubtasks && !existingChevron && !existingChevronPlaceholder) {
            // Add chevron if task is now used as a project and feature is enabled
            const chevron = mainRow.createEl('div', { 
                cls: 'task-card__chevron',
                attr: { 
                    'aria-label': 'Expand subtasks',
                    'title': 'Expand subtasks'
                }
            });
            
            const isExpanded = plugin.expandedProjectsService?.isExpanded(task.path) || false;
            if (isExpanded) {
                chevron.classList.add('task-card__chevron--expanded');
                chevron.setAttribute('aria-label', 'Collapse subtasks');
                setTooltip(chevron, 'Collapse subtasks', { placement: 'top' });
            } else {
                setTooltip(chevron, 'Expand subtasks', { placement: 'top' });
            }
            
            setIcon(chevron, 'chevron-right');
            
            // Add click handler to toggle expansion
            chevron.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    if (!plugin.expandedProjectsService) {
                        console.error('ExpandedProjectsService not initialized in update');
                        new Notice('Service not available. Please try reloading the plugin.');
                        return;
                    }
                    
                    const newExpanded = plugin.expandedProjectsService.toggle(task.path);
                    chevron.classList.toggle('task-card__chevron--expanded', newExpanded);
                    chevron.setAttribute('aria-label', newExpanded ? 'Collapse subtasks' : 'Expand subtasks');
                    setTooltip(chevron, newExpanded ? 'Collapse subtasks' : 'Expand subtasks', { placement: 'top' });
                    
                    // Toggle subtasks display
                    await toggleSubtasks(element, task, plugin, newExpanded);
                } catch (error) {
                    console.error('Error toggling subtasks:', error);
                    new Notice('Failed to toggle subtasks');
                }
            });
            
            // Insert after project indicator
            const projectIndicator = element.querySelector('.task-card__project-indicator');
            projectIndicator?.insertAdjacentElement('afterend', chevron);
            
            // If already expanded, show subtasks
            if (isExpanded) {
                chevron.classList.add('task-card__chevron--expanded');
                chevron.setAttribute('aria-label', 'Collapse subtasks');
                setTooltip(chevron, 'Collapse subtasks', { placement: 'top' });
                
                toggleSubtasks(element, task, plugin, true).catch(error => {
                    console.error('Error showing initial subtasks in update:', error);
                });
            }
        } else if ((!isProject || !plugin.settings?.showExpandableSubtasks) && (existingChevron || existingChevronPlaceholder)) {
            // Remove chevron if task is no longer used as a project or feature is disabled
            existingChevron?.remove();
            existingChevronPlaceholder?.remove();
            // Also remove any existing subtasks container with proper cleanup
            const subtasksContainer = element.querySelector('.task-card__subtasks') as HTMLElement;
            if (subtasksContainer) {
                // Clean up the click handler
                const clickHandler = (subtasksContainer as any)._clickHandler;
                if (clickHandler) {
                    subtasksContainer.removeEventListener('click', clickHandler);
                    delete (subtasksContainer as any)._clickHandler;
                }
                subtasksContainer.remove();
            }
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
        
        // Story points (if has story points)
        if (task.points && task.points > 0) {
            const pointsSpan = metadataLine.createEl('span');
            pointsSpan.textContent = `${task.points} pts`;
            metadataElements.push(pointsSpan);
        }
        
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


export function toggleTaskCardSelection(taskCards: HTMLElement[]): void {
    for (const taskCard of taskCards) {
        // Assuming `containerDiv` is your <div>
        const checkbox = taskCard.querySelector('input[type="checkbox"]') as HTMLInputElement;
    
        if (checkbox) {
            checkbox.checked = !checkbox.checked; // toggle
            checkbox.dispatchEvent(new Event('change', { bubbles: true })); // notify listeners
        }
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

/**
 * Clean up event listeners and resources for a task card
 */
export function cleanupTaskCard(card: HTMLElement): void {
    // Clean up subtasks container if it exists
    const subtasksContainer = card.querySelector('.task-card__subtasks') as HTMLElement;
    if (subtasksContainer) {
        // Clean up the click handler
        const clickHandler = (subtasksContainer as any)._clickHandler;
        if (clickHandler) {
            subtasksContainer.removeEventListener('click', clickHandler);
            delete (subtasksContainer as any)._clickHandler;
        }
    }
    
    // Note: Other event listeners on the card itself are automatically cleaned up 
    // when the card is removed from the DOM. We only need to manually clean up
    // listeners that we store references to.
}

/**
 * Toggle subtasks display for a project task card
 */
async function toggleSubtasks(card: HTMLElement, task: TaskInfo, plugin: TaskNotesPlugin, expanded: boolean): Promise<void> {
    try {
        let subtasksContainer = card.querySelector('.task-card__subtasks') as HTMLElement;
        
        if (expanded) {
            
            // Show subtasks
            if (!subtasksContainer) {
                // Create subtasks container after the main content
                subtasksContainer = document.createElement('div');
                subtasksContainer.className = 'task-card__subtasks';
                
                // Prevent clicks inside subtasks container from bubbling to parent card
                const clickHandler = (e: Event) => {
                    e.stopPropagation();
                };
                subtasksContainer.addEventListener('click', clickHandler);
                
                // Store handler reference for cleanup
                (subtasksContainer as any)._clickHandler = clickHandler;
                
                card.appendChild(subtasksContainer);
            }
            
            // Clear existing content properly (this will clean up subtask event listeners)
            while (subtasksContainer.firstChild) {
                subtasksContainer.removeChild(subtasksContainer.firstChild);
            }
        
        // Show loading state
        const loadingEl = subtasksContainer.createEl('div', { 
            cls: 'task-card__subtasks-loading',
            text: 'Loading subtasks...'
        });
        
        try {
            // Get the file for this task
            const file = plugin.app.vault.getAbstractFileByPath(task.path);
            if (!(file instanceof TFile)) {
                throw new Error('Task file not found');
            }
            
            // Get subtasks
            if (!plugin.projectSubtasksService) {
                throw new Error('projectSubtasksService not initialized');
            }
            
            const subtasks = await plugin.projectSubtasksService.getTasksLinkedToProject(file);
            
            // Apply current filter to subtasks if available
            // For now, we'll show all subtasks to keep the implementation simple
            // Future enhancement: Apply the current view's filter to subtasks
            // This could be implemented by accessing the FilterService's evaluateFilterNode method
            
            // Remove loading indicator
            loadingEl.remove();
            
            if (subtasks.length === 0) {
                subtasksContainer.createEl('div', {
                    cls: 'task-card__subtasks-loading',
                    text: 'No subtasks found'
                });
                return;
            }
            
            // Sort subtasks
            const sortedSubtasks = plugin.projectSubtasksService.sortTasks(subtasks);
            
            // Build parent chain by traversing up the DOM hierarchy
            const buildParentChain = (element: HTMLElement): string[] => {
                const chain: string[] = [];
                let current = element.closest('.task-card');
                
                while (current) {
                    const taskPath = (current as any)._taskPath;
                    if (taskPath) {
                        chain.unshift(taskPath); // Add to beginning
                    }
                    // Find next parent task card (skip current)
                    current = current.parentElement?.closest('.task-card') as HTMLElement;
                }
                return chain;
            };
            
            const parentChain = buildParentChain(card);
            
            // Render each subtask (but prevent circular references)
            for (const subtask of sortedSubtasks) {
                // Check for circular reference in the parent chain
                if (parentChain.includes(subtask.path)) {
                    console.warn('Circular reference detected in task chain:', {
                        subtask: subtask.path,
                        parentChain,
                        cycle: [...parentChain, subtask.path]
                    });
                    continue;
                }
                
                const subtaskCard = createTaskCard(subtask, plugin, {
                    showDueDate: true,
                    showCheckbox: false,
                    showArchiveButton: false,
                    showTimeTracking: false,
                    showRecurringControls: true,
                    groupByDate: false
                });
                
                // Add subtask modifier class
                subtaskCard.classList.add('task-card--subtask');
                
                subtasksContainer.appendChild(subtaskCard);
            }
            
        } catch (error) {
            console.error('Error loading subtasks:', error);
            loadingEl.textContent = 'Failed to load subtasks';
        }
        
    } else {
        // Hide subtasks
        if (subtasksContainer) {
            // Clean up the click handler
            const clickHandler = (subtasksContainer as any)._clickHandler;
            if (clickHandler) {
                subtasksContainer.removeEventListener('click', clickHandler);
                delete (subtasksContainer as any)._clickHandler;
            }
            
            // Remove the container (this will also clean up child elements and their listeners)
            subtasksContainer.remove();
        }
    }
    } catch (error) {
        console.error('Error in toggleSubtasks:', error);
        throw error;
    }
}

/**
 * Refresh expanded subtasks in parent task cards when a subtask is updated
 * This ensures that when a subtask is modified, any parent task cards that have
 * that subtask expanded will refresh their subtasks display
 */
export async function refreshParentTaskSubtasks(
    updatedTask: TaskInfo, 
    plugin: TaskNotesPlugin, 
    container: HTMLElement
): Promise<void> {
    // Only process if the updated task has projects (i.e., is a subtask)
    if (!updatedTask || !updatedTask.projects || updatedTask.projects.length === 0) {
        return;
    }
    
    // Wait for cache to contain the updated task data to prevent race condition
    // Try to get the updated task from cache, with a short retry loop
    let attempts = 0;
    const maxAttempts = 10; // Max 100ms wait
    while (attempts < maxAttempts) {
        try {
            const cachedTask = await plugin.cacheManager.getTaskInfo(updatedTask.path);
            if (cachedTask && cachedTask.dateModified === updatedTask.dateModified) {
                // Cache has been updated
                break;
            }
        } catch (error) {
            // Cache not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, 10));
        attempts++;
    }
    
    // Find all expanded project task cards in the container
    const expandedChevrons = container.querySelectorAll('.task-card__chevron--expanded');
    
    for (const chevron of expandedChevrons) {
        const taskCard = chevron.closest('.task-card') as HTMLElement;
        if (!taskCard) continue;
        
        const projectTaskPath = taskCard.dataset.taskPath;
        if (!projectTaskPath) continue;
        
        // Check if this project task is referenced by the updated subtask
        const projectFile = plugin.app.vault.getAbstractFileByPath(projectTaskPath);
        if (!(projectFile instanceof TFile)) continue;
        
        const projectFileName = projectFile.basename;
        
        // Check if the updated task references this project
        const isSubtaskOfThisProject = updatedTask.projects.some(project => {
            if (project.startsWith('[[') && project.endsWith(']]')) {
                const linkedNoteName = project.slice(2, -2).trim();
                // Check both exact match and resolved file match
                const resolvedFile = plugin.app.metadataCache.getFirstLinkpathDest(linkedNoteName, '');
                return linkedNoteName === projectFileName || 
                       (resolvedFile && resolvedFile.path === projectTaskPath);
            }
            return project === projectFileName || project === projectTaskPath;
        });
        
        if (isSubtaskOfThisProject) {
            // Find the subtasks container
            const subtasksContainer = taskCard.querySelector('.task-card__subtasks') as HTMLElement;
            if (subtasksContainer) {
                // Re-render the subtasks by calling toggleSubtasks
                try {
                    // Get the parent task info
                    const parentTask = await plugin.cacheManager.getTaskInfo(projectTaskPath);
                    if (parentTask) {
                        // Clear and re-render subtasks
                        await toggleSubtasks(taskCard, parentTask, plugin, true);
                    }
                } catch (error) {
                    console.error('Error refreshing parent task subtasks:', error);
                }
            }
        }
    }
}
