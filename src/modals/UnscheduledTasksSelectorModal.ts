import { App, FuzzySuggestModal, FuzzyMatch, setIcon, TFile, Notice } from 'obsidian';
import { format } from 'date-fns';
import { TaskInfo } from '../types';
import { isPastDate, isToday, hasTimeComponent, getDatePart, parseDateToLocal } from '../utils/dateUtils';
import { filterEmptyProjects } from '../utils/helpers';
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
        this.renderHighlightedText(titleEl, item, task.title);
        
        // Create metadata container
        const metaEl = contentEl.createDiv({ cls: 'unscheduled-tasks-selector__meta' });
        
        // Priority indicator
        if (task.priority) {
            metaEl.createSpan({
                text: task.priority.toUpperCase(),
                cls: `unscheduled-tasks-selector__priority priority-${(task.priority || 'normal').toLowerCase()}`
            });
        }
        
        // Due date if exists
        if (task.due) {
            const dueEl = metaEl.createSpan({ cls: 'unscheduled-tasks-selector__due' });
            
            const dueDateStr = hasTimeComponent(task.due) 
                ? format(parseDateToLocal(task.due), 'MMM d, h:mm a')
                : format(parseDateToLocal(task.due), 'MMM d');
            
            if (isPastDate(getDatePart(task.due))) {
                dueEl.addClass('overdue');
                const warningIcon = dueEl.createSpan();
                setIcon(warningIcon, 'alert-triangle');
                dueEl.createSpan({ text: ` Overdue: ${dueDateStr}` });
            } else if (isToday(getDatePart(task.due))) {
                dueEl.addClass('due-today');
                const calendarIcon = dueEl.createSpan();
                setIcon(calendarIcon, 'calendar');
                dueEl.createSpan({ text: ` Due today: ${dueDateStr}` });
            } else {
                dueEl.setText(`Due: ${dueDateStr}`);
            }
        }
        
        // Time estimate if exists
        if (task.timeEstimate) {
            metaEl.createSpan({
                text: `~${task.timeEstimate}min`,
                cls: 'unscheduled-tasks-selector__time-estimate'
            });
        }
        
        // Contexts if exists
        if (task.contexts && task.contexts.length > 0) {
            const contextsEl = metaEl.createSpan({ cls: 'unscheduled-tasks-selector__contexts' });
            contextsEl.textContent = `@${task.contexts.join(', @')}`;
        }
        
        // Projects if exists
        const filteredProjects = filterEmptyProjects(task.projects || []);
        if (filteredProjects.length > 0) {
            const projectsEl = metaEl.createSpan({ cls: 'unscheduled-tasks-selector__projects' });
            renderProjectLinksForSelector(projectsEl, filteredProjects, this.plugin);
        }
        
        // Add schedule icon
        const scheduleIcon = contentEl.createDiv({ cls: 'unscheduled-tasks-selector__schedule-icon' });
        setIcon(scheduleIcon, 'calendar-plus');
    }

    private renderHighlightedText(container: HTMLElement, item: FuzzyMatch<TaskInfo>, text: string): void {
        container.empty();
        const matches = item.match.matches;
        if (!matches || matches.length === 0) {
            container.textContent = text;
            return;
        }
        
        let lastIndex = 0;
        for (const match of matches) {
            // Add text before the match
            if (match[0] > lastIndex) {
                container.appendText(text.slice(lastIndex, match[0]));
            }
            // Add highlighted match
            container.createEl('mark', { text: text.slice(match[0], match[1] + 1) });
            lastIndex = match[1] + 1;
        }
        // Add remaining text
        if (lastIndex < text.length) {
            container.appendText(text.slice(lastIndex));
        }
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

/**
 * Check if a project string is in wikilink format [[Note Name]]
 */
function isWikilinkProject(project: string): boolean {
    return project.startsWith('[[') && project.endsWith(']]');
}

/**
 * Render project links in a container element for selector modals
 */
function renderProjectLinksForSelector(container: HTMLElement, projects: string[], plugin: TaskNotesPlugin): void {
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
                cls: 'unscheduled-tasks-selector__project-link internal-link',
                text: noteName,
                attr: { 'data-href': noteName }
            });
            
            // Add click handler to open the note
            linkEl.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Resolve the link to get the actual file
                const file = plugin.app.metadataCache.getFirstLinkpathDest(noteName, '');
                if (file instanceof TFile) {
                    // Open the file in the current leaf
                    await plugin.app.workspace.getLeaf(false).openFile(file);
                } else {
                    // File not found, show notice
                    new Notice(`Note "${noteName}" not found`);
                }
            });
        } else {
            // Plain text project
            const textNode = document.createTextNode(project);
            container.appendChild(textNode);
        }
    });
}