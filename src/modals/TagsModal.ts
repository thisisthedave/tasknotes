import { App, FuzzySuggestModal, FuzzyMatch, setIcon, Notice, SuggestModal } from 'obsidian';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';

export interface TagsAction {
    tag: string;
    title: string;
    icon: string;
}

export class TagsModal extends SuggestModal<TagsAction> {
    private plugin: TaskNotesPlugin;
    private tasks: TaskInfo[];
    private actions: TagsAction[];

    constructor(app: App, tasks: TaskInfo[], plugin: TaskNotesPlugin) {
        super(app);
        this.tasks = tasks;
        this.plugin = plugin;
        
        this.setPlaceholder('Add tag...');
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
        this.containerEl.addClass('task-tags-modal');
    }

    getSuggestions(query: string): TagsAction[] {
        const currentValues = this.tasks
            .map(task => task.tags || [])
            .reduce((acc, curr) => acc.filter(item => curr.includes(item)));

        const tags = this.plugin.cacheManager.getAllTags();
        if (!tags.includes(query)) {
            tags.push(query);
        }
        return tags
            .filter(tag => tag && typeof tag === 'string')
            .filter(tag => 
                tag.toLowerCase().includes(query.toLowerCase()) &&
                !currentValues.includes(tag)
            )
            .slice(0, 10)
            .map(tag => ({
                tag: tag,
                title: tag,
                icon: 'tag',
            }));
    }

    renderSuggestion(action: TagsAction, el: HTMLElement) {
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

    async onChooseSuggestion(action: TagsAction, evt: MouseEvent | KeyboardEvent) {
        try {
            // Refresh task data to ensure we have the latest information
            const freshTasks = await Promise.all(this.tasks.map(task => this.plugin.cacheManager.getTaskInfo(task.path)));
            if (!freshTasks || freshTasks.length === 0) {
                new Notice('Task not found');
                return;
            }
            
            await Promise.all(freshTasks.map(task =>
                task && (!task.tags || !task.tags?.includes(action.tag)) ?
                    this.plugin.updateTaskProperty(task, 'tags', [...(task.tags ?? []), action.tag]) :
                    Promise.resolve()));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error updating tags:', {
                error: errorMessage,
                taskPaths: this.tasks.map(task => task.path)
            });
            new Notice(`Failed to execute action: ${errorMessage}`);
        }
    }
}

export function showTagsModal(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[]
): void {
    if (tasks && tasks.length > 0) {
        const modal = new TagsModal(plugin.app, tasks, plugin);
        modal.open();
    }
}

