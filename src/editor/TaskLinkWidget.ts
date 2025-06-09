import { EditorView, WidgetType } from '@codemirror/view';
import { TFile, setIcon } from 'obsidian';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';
import { format } from 'date-fns';

export class TaskLinkWidget extends WidgetType {
    private taskInfo: TaskInfo;
    private plugin: TaskNotesPlugin;
    private originalText: string;
    private displayText?: string;

    constructor(taskInfo: TaskInfo, plugin: TaskNotesPlugin, originalText: string, displayText?: string) {
        super();
        this.taskInfo = taskInfo;
        this.plugin = plugin;
        this.originalText = originalText;
        this.displayText = displayText;
    }

    toDOM(view: EditorView): HTMLElement {
        // Create a standalone inline task preview with unique styling
        const container = document.createElement('span');
        
        // Build class names including priority modifier
        const classNames = ['tasknotes-plugin', 'task-inline-preview'];
        if (this.taskInfo.priority) {
            classNames.push(`task-inline-preview--priority-${this.taskInfo.priority}`);
        }
        container.className = classNames.join(' ');
        
        // Build inline content with simple structure
        let content = '';
        
        // Task title (allow more text)
        const titleText = this.taskInfo.title.length > 30 ? this.taskInfo.title.slice(0, 27) + '...' : this.taskInfo.title;
        content += `<span style="margin-right: 6px;">${titleText}</span>`;
        
        // Status indicator dot (after text)
        const statusConfig = this.plugin.statusManager.getStatusConfig(this.taskInfo.status);
        const statusColor = statusConfig?.color || '#666';
        content += `<span style="color: ${statusColor}; margin-right: 4px;" title="Status: ${this.taskInfo.status}">●</span>`;
        
        // Priority indicator dot (after status, for all priorities)
        if (this.taskInfo.priority) {
            const priorityConfig = this.plugin.priorityManager.getPriorityConfig(this.taskInfo.priority);
            if (priorityConfig) {
                content += `<span style="color: ${priorityConfig.color}; margin-right: 4px;" title="Priority: ${priorityConfig.label}">●</span>`;
            }
        }
        
        container.innerHTML = content;
        
        // Add Lucide pencil icon
        const pencilIcon = container.createEl('span', { 
            cls: 'task-inline-preview__pencil',
            attr: { 'title': 'Task options' },
            text: ''
        });
        pencilIcon.style.cssText = 'opacity: 0.5; cursor: pointer; margin-left: 4px; display: inline-block; width: 12px; height: 12px;';
        setIcon(pencilIcon, 'pencil');
        
        // Store data for interactions
        container.dataset.taskPath = this.taskInfo.path;
        container.dataset.originalText = this.originalText;
        
        // Click handler - open task edit modal (same as TaskCard)
        container.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Check if clicking the pencil icon for context menu
            const target = e.target as HTMLElement;
            if (target === pencilIcon || pencilIcon.contains(target) || target.closest('.task-inline-preview__pencil')) {
                this.showTaskContextMenu(e, container);
                return;
            }
            
            if (e.ctrlKey || e.metaKey) {
                // Ctrl/Cmd + Click: Open source note
                const file = this.plugin.app.vault.getAbstractFileByPath(this.taskInfo.path);
                if (file instanceof TFile) {
                    this.plugin.app.workspace.getLeaf(false).openFile(file);
                }
            } else {
                // Left-click: Open edit modal
                this.plugin.openTaskEditModal(this.taskInfo);
            }
        });
        
        // Right-click - show context menu (same as task cards)
        container.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await this.showTaskContextMenu(e, container);
        });
        
        // Hover preview (same as TaskCard)
        container.addEventListener('mouseover', (event) => {
            const file = this.plugin.app.vault.getAbstractFileByPath(this.taskInfo.path);
            if (file) {
                this.plugin.app.workspace.trigger('hover-link', {
                    event,
                    source: 'tasknotes-task-card',
                    hoverParent: container,
                    targetEl: container,
                    linktext: this.taskInfo.path,
                    sourcePath: this.taskInfo.path
                });
            }
        });
        
        return container;
    }

    /**
     * Show the same context menu used by task cards
     */
    private async showTaskContextMenu(event: MouseEvent, container: HTMLElement): Promise<void> {
        try {
            // Import the showTaskContextMenu function from TaskCard
            const { showTaskContextMenu } = await import('../ui/TaskCard');
            const targetDate = this.plugin.selectedDate || new Date();
            await showTaskContextMenu(event, this.taskInfo.path, this.plugin, targetDate);
        } catch (error) {
            console.error(`Error showing context menu for task ${this.taskInfo.path}:`, error);
            // Fallback to edit modal
            this.plugin.openTaskEditModal(this.taskInfo);
        }
    }

    /**
     * Check if this widget should be updated when task data changes
     */
    eq(other: WidgetType): boolean {
        if (!(other instanceof TaskLinkWidget)) {
            return false;
        }
        return (
            this.taskInfo.path === other.taskInfo.path &&
            this.taskInfo.status === other.taskInfo.status &&
            this.taskInfo.title === other.taskInfo.title &&
            this.taskInfo.priority === other.taskInfo.priority &&
            this.taskInfo.archived === other.taskInfo.archived
        );
    }

    /**
     * Indicate this widget should be treated as atomic for editing purposes
     */
    ignoreEvent(): boolean {
        return false;
    }

    /**
     * This widget should be inline, not block
     */
    get estimatedHeight(): number {
        return -1; // Indicates inline widget
    }

    /**
     * Ensure this is treated as an inline widget
     */
    get block(): boolean {
        return false;
    }
}