import { Extension, RangeSetBuilder, StateField, Transaction } from '@codemirror/state';
import {
    Decoration,
    DecorationSet,
    EditorView,
} from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import TaskNotesPlugin from '../main';
import { TaskLinkDetectionService, TaskLinkInfo } from '../services/TaskLinkDetectionService';
import { TaskLinkWidget } from './TaskLinkWidget';
import { EVENT_TASK_UPDATED } from '../types';

// Create a state field factory that takes the plugin as a parameter
export function createTaskLinkField(plugin: TaskNotesPlugin, refreshController: { needsRefresh: boolean }) {
    // Track widget instances for updates
    const activeWidgets = new Map<string, TaskLinkWidget>();
    
    return StateField.define<DecorationSet>({
        create(state): DecorationSet {
            return Decoration.none;
        },
        
        update(oldState: DecorationSet, transaction: Transaction): DecorationSet {
            if (!plugin) {
                return Decoration.none;
            }
        
            // Only process if overlay is enabled in settings
            if (!plugin.settings.enableTaskLinkOverlay) {
                return Decoration.none;
            }

            // Only process in Live Preview mode
            try {
                const isLivePreview = transaction.state.field(editorLivePreviewField);
                if (!isLivePreview) {
                    return Decoration.none;
                }
            } catch (error) {
                return Decoration.none;
            }

            // Rebuild if we've been marked for refresh (from EVENT_TASK_UPDATED)
            if (refreshController.needsRefresh) {
                refreshController.needsRefresh = false;
                return buildTaskLinkDecorations(transaction.state, plugin, activeWidgets);
            }

            // Rebuild on cursor/selection changes to handle hiding/showing based on cursor position
            if (transaction.selection) {
                return buildTaskLinkDecorations(transaction.state, plugin, activeWidgets);
            }

            // Only rebuild decorations on document changes
            if (!transaction.docChanged && oldState !== Decoration.none) {
                return oldState.map(transaction.changes);
            }

            return buildTaskLinkDecorations(transaction.state, plugin, activeWidgets);
        },
        
        provide(field: StateField<DecorationSet>): Extension {
            return EditorView.decorations.from(field);
        },
    });
}

function buildTaskLinkDecorations(state: any, plugin: TaskNotesPlugin, activeWidgets: Map<string, TaskLinkWidget>): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = state.doc;
    const detectionService = plugin.taskLinkDetectionService || new TaskLinkDetectionService(plugin);
    
    // Get current file path
    const activeLeaf = plugin.app.workspace.activeLeaf;
    const activeView = activeLeaf?.view;
    const activeFile = (activeView as any)?.file;
    const currentFile = activeFile?.path;
    
    if (!currentFile) {
        return builder.finish();
    }

    // Get cursor position to determine which line the cursor is on
    const cursorPos = state.selection.main.head;
    const cursorLine = doc.lineAt(cursorPos);

    // Process the entire document text for wikilinks
    const text = doc.toString();
    const wikilinks = detectionService.findWikilinks(text);

    // Process each wikilink and check if it's a valid task link
    // Note: In State Field, we need to do this synchronously, so we'll use cached results
    for (const wikilink of wikilinks) {
        try {
            // Parse the wikilink to get the link path
            const parsed = parseWikilinkSync(wikilink.match);
            if (!parsed) continue;

            const { linkPath } = parsed;
            
            // Resolve the link path
            const resolvedPath = resolveLinkPathSync(linkPath, currentFile, plugin);
            if (!resolvedPath) continue;

            // Check if we have cached task info for this file
            const taskInfo = getTaskInfoSync(resolvedPath, plugin);
            if (taskInfo) {
                // Check if cursor is on the same line as this wikilink
                const wikilinkLine = doc.lineAt(wikilink.start);
                const isCursorOnSameLine = cursorLine.number === wikilinkLine.number;
                
                // Skip creating decoration if cursor is on the same line
                if (isCursorOnSameLine) {
                    continue;
                }

                // Create or reuse widget instance
                const widgetKey = `${resolvedPath}-${wikilink.start}-${wikilink.end}`;
                let widget = activeWidgets.get(widgetKey);
                
                if (!widget || !widget.eq(new TaskLinkWidget(taskInfo, plugin, wikilink.match, parsed.displayText))) {
                    widget = new TaskLinkWidget(taskInfo, plugin, wikilink.match, parsed.displayText);
                    activeWidgets.set(widgetKey, widget);
                }

                // Create a replacement decoration that replaces the wikilink with our widget
                const decoration = Decoration.replace({
                    widget: widget as any,
                    inclusive: true
                });

                builder.add(wikilink.start, wikilink.end, decoration);
            }
        } catch (error) {
            // If there's any error, skip this wikilink
            console.debug('Error processing wikilink:', wikilink.match, error);
            continue;
        }
    }

    return builder.finish();
}

// Synchronous helper functions for State Field context
function parseWikilinkSync(wikilinkText: string): { linkPath: string; displayText?: string } | null {
    const content = wikilinkText.slice(2, -2).trim();
    if (!content) return null;

    const pipeIndex = content.indexOf('|');
    if (pipeIndex !== -1) {
        return {
            linkPath: content.slice(0, pipeIndex).trim(),
            displayText: content.slice(pipeIndex + 1).trim()
        };
    }

    return { linkPath: content };
}

function resolveLinkPathSync(linkPath: string, sourcePath: string, plugin: TaskNotesPlugin): string | null {
    try {
        const file = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
        return file?.path || null;
    } catch (error) {
        return null;
    }
}

function getTaskInfoSync(filePath: string, plugin: TaskNotesPlugin): any {
    try {
        // Use the same cached data access pattern as the views
        // This gets the most up-to-date cached task info (updated immediately after any changes)
        const cacheManager = plugin.cacheManager;
        if (cacheManager && cacheManager.getCachedTaskInfo) {
            return cacheManager.getCachedTaskInfo(filePath);
        }
        return null;
    } catch (error) {
        return null;
    }
}


export function createTaskLinkOverlay(plugin: TaskNotesPlugin): Extension {
    // Create a shared refresh controller that can be accessed by both the state field and event handlers
    const refreshController = { needsRefresh: false };
    
    const stateField = createTaskLinkField(plugin, refreshController);
    
    // Create the refresh mechanism that follows the same pattern as views
    const refreshDecorations = () => {
        // Mark for refresh and trigger state update (same pattern as views use)
        refreshController.needsRefresh = true;
        
        plugin.app.workspace.iterateRootLeaves((leaf) => {
            if (leaf.view.getViewType() === 'markdown') {
                const editor = (leaf.view as any).editor;
                if (editor && editor.cm) {
                    // Trigger decoration rebuild by dispatching an empty transaction
                    // The state field will check needsRefresh flag and rebuild
                    editor.cm.dispatch({ effects: [] });
                }
            }
        });
    };
    
    // Subscribe to EVENT_TASK_UPDATED like other views do (this is the key!)
    const taskUpdateListener = plugin.emitter.on(EVENT_TASK_UPDATED, async ({ path, originalTask, updatedTask }) => {
        if (!path || !updatedTask) {
            return;
        }
        
        // Use the exact same immediate refresh pattern as TaskListView and KanbanView
        refreshDecorations();
    });
    
    return stateField;
}

// Export the service for use elsewhere
export { TaskLinkDetectionService };