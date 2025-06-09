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
        
        // Build inline content with proper DOM creation
        
        // Task title (allow more text)
        const titleText = this.taskInfo.title.length > 30 ? this.taskInfo.title.slice(0, 27) + '...' : this.taskInfo.title;
        const titleSpan = container.createEl('span', { text: titleText });
        titleSpan.style.marginRight = '6px';
        
        // Status indicator dot (after text)
        const statusConfig = this.plugin.statusManager.getStatusConfig(this.taskInfo.status);
        const statusColor = statusConfig?.color || '#666';
        const statusDot = container.createEl('span', { 
            text: '●',
            attr: { title: `Status: ${this.taskInfo.status}` }
        });
        statusDot.style.color = statusColor;
        statusDot.style.marginRight = '4px';
        
        // Priority indicator dot (after status, for all priorities)
        if (this.taskInfo.priority) {
            const priorityConfig = this.plugin.priorityManager.getPriorityConfig(this.taskInfo.priority);
            if (priorityConfig) {
                const priorityDot = container.createEl('span', { 
                    text: '●',
                    attr: { title: `Priority: ${priorityConfig.label}` }
                });
                priorityDot.style.color = priorityConfig.color;
                priorityDot.style.marginRight = '4px';
            }
        }

        // Due date info with calendar icon
        if (this.taskInfo.due) {
            const dueDateSpan = container.createEl('span', {
                attr: { title: `Due: ${format(new Date(this.taskInfo.due), 'MMM d, yyyy')}` }
            });
            dueDateSpan.style.marginRight = '4px';
            dueDateSpan.style.opacity = '0.7';
            dueDateSpan.style.fontSize = '0.9em';
            
            const calendarIcon = dueDateSpan.createEl('span');
            calendarIcon.style.display = 'inline-block';
            calendarIcon.style.width = '12px';
            calendarIcon.style.height = '12px';
            calendarIcon.style.marginRight = '8px';
            setIcon(calendarIcon, 'calendar');
            
            dueDateSpan.appendText(format(new Date(this.taskInfo.due), 'MMM d'));
        }

        // Scheduled date info with clock icon
        if (this.taskInfo.scheduled && (!this.taskInfo.due || this.taskInfo.scheduled !== this.taskInfo.due)) {
            const scheduledSpan = container.createEl('span', {
                attr: { title: `Scheduled: ${format(new Date(this.taskInfo.scheduled), 'MMM d, yyyy')}` }
            });
            scheduledSpan.style.marginRight = '4px';
            scheduledSpan.style.opacity = '0.7';
            scheduledSpan.style.fontSize = '0.9em';
            
            const clockIcon = scheduledSpan.createEl('span');
            clockIcon.style.display = 'inline-block';
            clockIcon.style.width = '12px';
            clockIcon.style.height = '12px';
            clockIcon.style.marginRight = '8px';
            setIcon(clockIcon, 'clock');
            
            scheduledSpan.appendText(format(new Date(this.taskInfo.scheduled), 'MMM d'));
        }
        
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
            this.taskInfo.archived === other.taskInfo.archived &&
            this.taskInfo.due === other.taskInfo.due &&
            this.taskInfo.scheduled === other.taskInfo.scheduled
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