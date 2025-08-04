import { App, FuzzySuggestModal, FuzzyMatch, setIcon, Notice, SuggestModal } from 'obsidian';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';

export interface ContextsAction {
    context: string;
    title: string;
    icon: string;
}

export class ContextsModal extends SuggestModal<ContextsAction> {
    private plugin: TaskNotesPlugin;
    private tasks: TaskInfo[];
    private actions: ContextsAction[];

    constructor(app: App, tasks: TaskInfo[], plugin: TaskNotesPlugin) {
        super(app);
        this.tasks = tasks;
        this.plugin = plugin;
        
        this.setPlaceholder('Add context...');
        this.setInstructions([
            { command: '↑↓', purpose: 'to navigate' },
            { command: '↵', purpose: 'to execute' },
            { command: 'esc', purpose: 'to dismiss' },
        ]);
        
        // Set modal title for accessibility
        this.titleEl.setText(`Quick actions: ${tasks.length == 1 ? tasks[0].title : `${tasks.length} tasks`}`);
        this.titleEl.setAttribute('id', 'task-action-palette-title');
        
        // Set aria attributes on the modal
        this.containerEl.setAttribute('aria-labelledby', 'task-action-palette-title');
        this.containerEl.setAttribute('role', 'dialog');
        this.containerEl.setAttribute('aria-modal', 'true');
        this.containerEl.addClass('task-contexts-modal');
    }

    getSuggestions(query: string): ContextsAction[] {
        const currentValues = this.tasks
            .map(task => task.contexts || [])
            .reduce((acc, curr) => acc.filter(item => curr.includes(item)));

        const contexts = this.plugin.cacheManager.getAllContexts();
        if (!contexts.includes(query)) {
            contexts.push(query);
        }

        return contexts
            .filter(context => context && typeof context === 'string')
            .filter(context => 
                context.toLowerCase().includes(query.toLowerCase()) &&
                !currentValues.includes(context)
            )
            .slice(0, 10)
            .map(context => ({
                context: context,
                title: context,
                icon: 'map-pin-plus',
            }));
    }

    renderSuggestion(action: ContextsAction, el: HTMLElement) {
        const container = el.createDiv({ cls: 'task-action-palette__suggestion' });
        
        // Icon
        const iconEl = container.createDiv({ cls: 'task-action-palette__icon' });
        setIcon(iconEl, action.icon);
        
        // Content
        const contentEl = container.createDiv({ cls: 'task-action-palette__content' });
        
        // Title
        contentEl.createDiv({ 
            cls: 'task-action-palette__title',
            text: action.title 
        });
    }

    async onChooseSuggestion(action: ContextsAction, evt: MouseEvent | KeyboardEvent) {
        try {
            // Refresh task data to ensure we have the latest information
            const freshTasks = await Promise.all(this.tasks.map(task => this.plugin.cacheManager.getTaskInfo(task.path)));
            if (!freshTasks || freshTasks.length === 0) {
                new Notice('Task not found');
                return;
            }

            await Promise.all(freshTasks.map(task =>
                task && (!task.contexts || !task.contexts?.includes(action.context)) ?
                    this.plugin.updateTaskProperty(task, 'contexts', [...(task.contexts ?? []), action.context]) :
                    Promise.resolve()));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error updating contexts:', {
                error: errorMessage,
                taskPaths: this.tasks.map(task => task.path)
            });
            new Notice(`Failed to execute action: ${errorMessage}`);
        }
    }
}
