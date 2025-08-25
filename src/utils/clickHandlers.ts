import { TFile } from 'obsidian';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';

export interface ClickHandlerOptions {
    task: TaskInfo;
    plugin: TaskNotesPlugin;
    excludeSelector?: string; // CSS selector for elements that should not trigger click behavior
    onSingleClick?: (e: MouseEvent) => Promise<void>; // Optional override for single click
    onDoubleClick?: (e: MouseEvent) => Promise<void>; // Optional override for double click
    contextMenuHandler?: (e: MouseEvent) => Promise<void>; // Optional context menu handler
}

/**
 * Creates a reusable click handler that supports single/double click distinction
 * based on user settings.
 * Ctrl/Cmd + Click: Opens source note immediately
 */
export function createTaskClickHandler(options: ClickHandlerOptions) {
    const {
        task,
        plugin,
        excludeSelector,
        onSingleClick,
        onDoubleClick,
        contextMenuHandler
    } = options;

    let clickTimeout: NodeJS.Timeout | null = null;

    const openNote = () => {
        const file = plugin.app.vault.getAbstractFileByPath(task.path);
        if (file instanceof TFile) {
            plugin.app.workspace.getLeaf(false).openFile(file);
        }
    };

    const editTask = async () => {
        await plugin.openTaskEditModal(task);
    };

    const handleSingleClick = async (e: MouseEvent) => {
        if (onSingleClick) {
            await onSingleClick(e);
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            openNote();
            return;
        }

        const action = plugin.settings.singleClickAction;
        if (action === 'edit') {
            await editTask();
        } else if (action === 'openNote') {
            openNote();
        }
    };

    const handleDoubleClick = async (e: MouseEvent) => {
        if (onDoubleClick) {
            await onDoubleClick(e);
            return;
        }

        const action = plugin.settings.doubleClickAction;
        if (action === 'edit') {
            await editTask();
        } else if (action === 'openNote') {
            openNote();
        }
    };

    const clickHandler = async (e: MouseEvent) => {
        if (excludeSelector) {
            const target = e.target as HTMLElement;
            if (target.closest(excludeSelector)) {
                return;
            }
        }

        if (plugin.settings.doubleClickAction === 'none') {
            await handleSingleClick(e);
            return;
        }

        if (clickTimeout) {
            clearTimeout(clickTimeout);
            clickTimeout = null;
            await handleDoubleClick(e);
        } else {
            clickTimeout = setTimeout(() => {
                clickTimeout = null;
                handleSingleClick(e);
            }, 250);
        }
    };

    const dblclickHandler = async (e: MouseEvent) => {
        // This is handled by the clickHandler to distinguish single/double clicks
    };

    const contextmenuHandler = async (e: MouseEvent) => {
        e.preventDefault();
        if (contextMenuHandler) {
            await contextMenuHandler(e);
        }
    };

    return {
        clickHandler,
        dblclickHandler,
        contextmenuHandler,
        cleanup: () => {
            if (clickTimeout) {
                clearTimeout(clickTimeout);
                clickTimeout = null;
            }
        }
    };
}

/**
 * Creates a standard hover preview handler for task elements
 */
export function createTaskHoverHandler(task: TaskInfo, plugin: TaskNotesPlugin) {
    return (event: MouseEvent) => {
        const file = plugin.app.vault.getAbstractFileByPath(task.path);
        if (file) {
            plugin.app.workspace.trigger('hover-link', {
                event,
                source: 'tasknotes-task-card',
                hoverParent: event.currentTarget as HTMLElement,
                targetEl: event.currentTarget as HTMLElement,
                linktext: task.path,
                sourcePath: task.path
            });
        }
    };
}