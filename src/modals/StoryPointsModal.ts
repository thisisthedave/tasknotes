import { App, FuzzySuggestModal, FuzzyMatch, setIcon, Notice, SuggestModal } from 'obsidian';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';

export interface PointsAction {
    points: number;
    title: string;
    icon: string;
}
export namespace PointsAction {
    export function lookupIcon(points: number): string {
        if (!points || points < 0) {
            return 'signal-zero';
        }
        if (points <= 2) {
            return 'signal-low';
        }
        if (points <= 3) {
            return 'signal-medium';
        }
        if (points <= 5) {
            return 'signal';
        }
        return 'signal';
    }
}

export const DEFAULT_POINT_SUGGESTIONS: PointsAction[] = [
  {
    points: -1,
    title: 'No estimate',
    icon: PointsAction.lookupIcon(-1)
  },
  {
    points: 1,
    title: '1 point',
    icon: PointsAction.lookupIcon(1)
  },
  {
    points: 2,
    title: '2 points',
    icon: PointsAction.lookupIcon(2)    
  },
  {
    points: 3,
    title: '3 points',
    icon: PointsAction.lookupIcon(3)
  },
  {
    points: 5,
    title: '5 points',
    icon: PointsAction.lookupIcon(5)
  },
  {
    points: 8,
    title: '8 points',
    icon: PointsAction.lookupIcon(8)
  },
];

export class StoryPointsModal extends SuggestModal<PointsAction> {
    private plugin: TaskNotesPlugin;
    private tasks: TaskInfo[];
    private actions: PointsAction[];

    constructor(app: App, tasks: TaskInfo[], plugin: TaskNotesPlugin) {
        super(app);
        this.tasks = tasks;
        this.plugin = plugin;
        
        this.setPlaceholder('Change points estimate to...');
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
        this.containerEl.addClass('task-story-points-modal');
    }

    getSuggestions(query: string): PointsAction[] {
        const defaultSuggestions = DEFAULT_POINT_SUGGESTIONS.filter(action => {
            return action.title.toLowerCase().includes(query.toLowerCase());
        });
        if (defaultSuggestions.length > 0) {
            return defaultSuggestions;
        }

        // If no default suggestions match try to make an action
        const points = parseInt(query, 10);
        if (!isNaN(points) && points >= -1) {
            return [{
                points: points,
                title: `${points} point${points !== 1 ? 's' : ''}`,
                icon: PointsAction.lookupIcon(points)
            }];
        }

        return [];
    }

    renderSuggestion(action: PointsAction, el: HTMLElement) {
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

    async onChooseSuggestion(action: PointsAction, evt: MouseEvent | KeyboardEvent) {
        try {
            // Refresh task data to ensure we have the latest information
            const freshTasks: TaskInfo[] = (await Promise.all(this.tasks.map(task => this.plugin.cacheManager.getTaskInfo(task.path))))
                .filter(task => task !== null && task !== undefined) as TaskInfo[];
            if (!freshTasks || freshTasks.length === 0) {
                new Notice('Task not found');
                return;
            }

            await this.plugin.batchUpdateTasksProperty(freshTasks!, 'points', action.points);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error updating story point estimate:', {
                error: errorMessage,
                taskPaths: this.tasks.map(task => task.path)
            });
            new Notice(`Failed to execute action: ${errorMessage}`);
        }
    }
}

export function showPointsModal(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[]
): void {
    if (tasks && tasks.length > 0) {
        const modal = new StoryPointsModal(plugin.app, tasks, plugin);
        modal.open();
    }
}
