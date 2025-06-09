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

            // Skip cursor/selection changes - we don't need to rebuild for those anymore

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

    // No longer need cursor position tracking

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
    // Create a shared refresh controller that can be accessed by the state field
    const refreshController = { needsRefresh: false };
    
    const stateField = createTaskLinkField(plugin, refreshController);
    
    // The event listener is now managed globally in main.ts and will trigger
    // decoration refresh by dispatching to all markdown editor views.
    // The state field will check refreshController.needsRefresh and rebuild accordingly.
    
    return stateField;
}

// Export the service for use elsewhere
export { TaskLinkDetectionService };