import { App, FuzzySuggestModal, FuzzyMatch, Notice, setIcon } from 'obsidian';
import { format } from 'date-fns';
import { TaskInfo } from '../types';
import { isPastDate, isToday, hasTimeComponent, getDatePart, parseDate } from '../utils/dateUtils';
import TaskNotesPlugin from '../main';

export interface ScheduleTaskOptions {
    date?: Date;
    time?: string;
    allDay?: boolean;
}

export class UnscheduledTasksSelectorModal extends FuzzySuggestModal<TaskInfo> {
    private plugin: TaskNotesPlugin;
    private tasks: TaskInfo[];
    private onScheduleTask: (task: TaskInfo | null, options?: ScheduleTaskOptions) => void;
    private defaultScheduleOptions?: ScheduleTaskOptions;

    constructor(
        app: App, 
        plugin: TaskNotesPlugin, 
        onScheduleTask: (task: TaskInfo | null, options?: ScheduleTaskOptions) => void,
        defaultScheduleOptions?: ScheduleTaskOptions
    ) {
        super(app);
        this.plugin = plugin;
        this.onScheduleTask = onScheduleTask;
        this.defaultScheduleOptions = defaultScheduleOptions;
        
        this.setPlaceholder('Type to search for an unscheduled task...');
        this.setInstructions([
            { command: '↑↓', purpose: 'to navigate' },
            { command: '↵', purpose: 'to schedule task' },
            { command: 'esc', purpose: 'to dismiss' },
        ]);
        
        // Set modal title for accessibility
        this.titleEl.setText('Schedule Task');
        this.titleEl.setAttribute('id', 'unscheduled-tasks-selector-title');
        
        // Set aria attributes on the modal
        this.containerEl.setAttribute('aria-labelledby', 'unscheduled-tasks-selector-title');
        this.containerEl.setAttribute('role', 'dialog');
        this.containerEl.setAttribute('aria-modal', 'true');
        
        // Add CSS class to fix positioning
        this.containerEl.addClass('unscheduled-tasks-selector-modal');
        
        // Load tasks
        this.loadUnscheduledTasks();
    }

    async loadUnscheduledTasks() {
        try {
            // Get all task paths and then get their task info
            const allTaskPaths = this.plugin.cacheManager.getAllTaskPaths();
            const allTasksPromises = Array.from(allTaskPaths).map(path => 
                this.plugin.cacheManager.getTaskInfo(path)
            );
            const allTasks = (await Promise.all(allTasksPromises)).filter((task): task is TaskInfo => task !== null);
            
            // Filter to only unscheduled, non-completed, non-archived tasks
            this.tasks = allTasks.filter((task: TaskInfo) => 
                !task.archived && 
                !this.plugin.statusManager.isCompletedStatus(task.status) &&
                !task.scheduled
            );
        } catch (error) {
            console.error('Error loading unscheduled tasks:', error);
            this.tasks = [];
        }
    }

    getItems(): TaskInfo[] {
        // Sort by due date and priority
        return this.tasks.sort((a, b) => {
            // Sort by due date first (overdue tasks come first)
            if (a.due && !b.due) return -1;
            if (!a.due && b.due) return 1;
            if (a.due && b.due) {
                const dateCompare = a.due.localeCompare(b.due);
                if (dateCompare !== 0) return dateCompare;
            }
            
            // Then by priority (high -> normal -> low)
            const priorityOrder: Record<string, number> = { high: 0, normal: 1, low: 2 };
            const aPriority = priorityOrder[a.priority] ?? 1;
            const bPriority = priorityOrder[b.priority] ?? 1;
            if (aPriority !== bPriority) return aPriority - bPriority;
            
            // Finally by title
            return a.title.localeCompare(b.title);
        });
    }

    getItemText(task: TaskInfo): string {
        return task.title;
    }

    renderSuggestion(item: FuzzyMatch<TaskInfo>, el: HTMLElement): void {
        const task = item.item;
        
        // Clear the element
        el.empty();
        el.addClass('unscheduled-tasks-selector__suggestion');
        
        // Create main content container
        const contentEl = el.createDiv({ cls: 'unscheduled-tasks-selector__content' });
        
        // Task title
        const titleEl = contentEl.createDiv({ 
            cls: 'unscheduled-tasks-selector__title'
        });
        titleEl.innerHTML = this.highlight(item, task.title);
        
        // Create metadata container
        const metaEl = contentEl.createDiv({ cls: 'unscheduled-tasks-selector__meta' });
        
        // Priority indicator
        if (task.priority) {
            const priorityEl = metaEl.createSpan({
                text: task.priority.toUpperCase(),
                cls: `unscheduled-tasks-selector__priority priority-${task.priority.toLowerCase()}`
            });
        }
        
        // Due date if exists
        if (task.due) {
            const dueEl = metaEl.createSpan({ cls: 'unscheduled-tasks-selector__due' });
            
            const dueDateStr = hasTimeComponent(task.due) 
                ? format(parseDate(task.due), 'MMM d, h:mm a')
                : format(parseDate(task.due), 'MMM d');
            
            if (isPastDate(getDatePart(task.due))) {
                dueEl.addClass('overdue');
                dueEl.setText(`⚠️ Overdue: ${dueDateStr}`);
            } else if (isToday(getDatePart(task.due))) {
                dueEl.addClass('due-today');
                dueEl.setText(`📅 Due today: ${dueDateStr}`);
            } else {
                dueEl.setText(`Due: ${dueDateStr}`);
            }
        }
        
        // Time estimate if exists
        if (task.timeEstimate) {
            const timeEl = metaEl.createSpan({
                text: `~${task.timeEstimate}min`,
                cls: 'unscheduled-tasks-selector__time-estimate'
            });
        }
        
        // Add schedule icon
        const scheduleIcon = contentEl.createDiv({ cls: 'unscheduled-tasks-selector__schedule-icon' });
        setIcon(scheduleIcon, 'calendar-plus');
    }

    private highlight(item: FuzzyMatch<TaskInfo>, text: string): string {
        const matches = item.match.matches;
        if (!matches || matches.length === 0) {
            return text;
        }
        
        let result = '';
        let lastIndex = 0;
        
        for (const match of matches) {
            // Add text before the match
            result += text.slice(lastIndex, match[0]);
            // Add highlighted match
            result += `<mark>${text.slice(match[0], match[1] + 1)}</mark>`;
            lastIndex = match[1] + 1;
        }
        
        // Add remaining text
        result += text.slice(lastIndex);
        return result;
    }

    onChooseItem(task: TaskInfo, evt: MouseEvent | KeyboardEvent): void {
        // Schedule the task with default options or prompt for options
        this.onScheduleTask(task, this.defaultScheduleOptions);
    }

    onNoSuggestion(): void {
        // Show message when no tasks match
        const el = this.resultContainerEl.createDiv({ cls: 'unscheduled-tasks-selector__no-results' });
        el.setText('No unscheduled tasks found. All tasks are either scheduled, completed, or archived.');
    }
}