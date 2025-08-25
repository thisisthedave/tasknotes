import { Menu } from 'obsidian';
import TaskNotesPlugin from '../main';
import { PriorityConfig, TaskInfo } from '../types';

export interface PriorityContextMenuOptions {
    currentValue?: string;
    onSelect: (value: string) => void;
    plugin: TaskNotesPlugin;
}

export class PriorityContextMenu {
    private menu: Menu;
    private options: PriorityContextMenuOptions;
    private sortedPriorities: PriorityConfig[];

    constructor(options: PriorityContextMenuOptions) {
        this.menu = new Menu();
        this.options = options;
        this.buildMenu();
    }

    private buildMenu(): void {
        const priorities = this.options.plugin.settings.customPriorities;
        
        // Sort by weight (higher weight = more important)
        this.sortedPriorities = [...priorities].sort((a, b) => b.weight - a.weight);
        
        this.sortedPriorities.forEach(priority => {
            this.menu.addItem(item => {
                let title = priority.label;
                
                // Use consistent icon for all items
                item.setIcon('star');
                
                // Highlight current selection with visual indicator
                if (priority.value === this.options.currentValue) {
                    title = `✓ ${priority.label}`;
                }
                
                item.setTitle(title);
                
                item.onClick(async () => {
                    this.options.onSelect(priority.value);
                });
            });
        });
    }


    public show(event: MouseEvent): void {
        this.menu.showAtMouseEvent(event);
        
        // Apply color styling after menu is shown
        setTimeout(() => {
            this.applyColorStyling();
        }, 10);
    }

    public showAtElement(element: HTMLElement): void {
        this.menu.showAtPosition({
            x: element.getBoundingClientRect().left,
            y: element.getBoundingClientRect().bottom + 4
        });
        
        // Apply color styling after menu is shown
        setTimeout(() => {
            this.applyColorStyling();
        }, 10);
    }

    private applyColorStyling(): void {
        const menuEl = document.querySelector('.menu');
        
        if (!menuEl) return;
        
        const menuItems = menuEl.querySelectorAll('.menu-item');
        
        this.sortedPriorities.forEach((priority, index) => {
            const menuItem = menuItems[index] as HTMLElement;
            if (menuItem && priority.color) {
                const iconEl = menuItem.querySelector('.menu-item-icon');
                if (iconEl) {
                    (iconEl as HTMLElement).style.color = priority.color;
                }
            }
        });
    }
}

export function createPriorityContextMenu(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[],
): PriorityContextMenu {
    const menu = new PriorityContextMenu({
        currentValue: tasks.length == 1 ? tasks[0].priority : undefined,
        onSelect: async (newPriority) => {
            plugin.batchUpdateTasksProperty(tasks, 'priority', newPriority);
        },
        plugin: plugin
    });
    return menu;
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

