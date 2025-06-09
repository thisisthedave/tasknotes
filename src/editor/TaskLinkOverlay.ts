import { Extension, RangeSetBuilder, StateField, Transaction } from '@codemirror/state';
import {
    Decoration,
    DecorationSet,
    EditorView,
} from '@codemirror/view';
import { editorLivePreviewField, MarkdownView } from 'obsidian';
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
            // Validate inputs
            if (!plugin || !transaction) {
                return Decoration.none;
            }
            
            if (!transaction.state) {
                console.warn('Invalid transaction state in task link overlay update');
                return Decoration.none;
            }
        
            // Only process if overlay is enabled in settings
            if (!plugin.settings || !plugin.settings.enableTaskLinkOverlay) {
                return Decoration.none;
            }

            // Only process in Live Preview mode
            try {
                const isLivePreview = transaction.state.field(editorLivePreviewField);
                if (!isLivePreview) {
                    return Decoration.none;
                }
            } catch (error) {
                console.debug('Error checking live preview mode:', error);
                return Decoration.none;
            }

            try {
                // Rebuild if we've been marked for refresh (from EVENT_TASK_UPDATED)
                if (refreshController && refreshController.needsRefresh) {
                    refreshController.needsRefresh = false;
                    return buildTaskLinkDecorations(transaction.state, plugin, activeWidgets);
                }

                // Skip cursor/selection changes - we don't need to rebuild for those anymore

                // Only rebuild decorations on document changes
                if (!transaction.docChanged && oldState !== Decoration.none) {
                    return oldState.map(transaction.changes);
                }

                return buildTaskLinkDecorations(transaction.state, plugin, activeWidgets);
            } catch (error) {
                console.error('Error updating task link overlay decorations:', error);
                return Decoration.none;
            }
        },
        
        provide(field: StateField<DecorationSet>): Extension {
            return EditorView.decorations.from(field);
        },
    });
}

function buildTaskLinkDecorations(state: any, plugin: TaskNotesPlugin, activeWidgets: Map<string, TaskLinkWidget>): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    
    // Validate inputs
    if (!state || !plugin || !activeWidgets) {
        console.warn('Invalid inputs for building task link decorations');
        return builder.finish();
    }
    
    const doc = state.doc;
    if (!doc) {
        console.warn('Invalid document state');
        return builder.finish();
    }
    
    // Validate plugin components
    if (!plugin.app || !plugin.app.workspace) {
        console.warn('Plugin app or workspace not available');
        return builder.finish();
    }
    
    const detectionService = plugin.taskLinkDetectionService || new TaskLinkDetectionService(plugin);
    
    // Get current file path
    const activeMarkdownView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeMarkdownView) {
        return builder.finish();
    }
    const currentFile = activeMarkdownView.file?.path;
    
    if (!currentFile) {
        return builder.finish();
    }

    // Validate current file path
    if (typeof currentFile !== 'string' || currentFile.length === 0) {
        console.warn('Invalid current file path');
        return builder.finish();
    }

    try {
        // Process the entire document text for wikilinks
        const text = doc.toString();
        
        // Validate document text
        if (typeof text !== 'string') {
            console.warn('Invalid document text');
            return builder.finish();
        }
        
        // Performance safeguard: skip processing extremely large documents
        if (text.length > 100000) {
            console.warn('Document too large for task link processing, skipping');
            return builder.finish();
        }
        
        const wikilinks = detectionService.findWikilinks(text);
        
        // Validate wikilinks result
        if (!Array.isArray(wikilinks)) {
            console.warn('Invalid wikilinks result from detection service');
            return builder.finish();
        }

        // Process each wikilink and check if it's a valid task link
        // Note: In State Field, we need to do this synchronously, so we'll use cached results
        for (const wikilink of wikilinks) {
            try {
                // Validate wikilink object
                if (!wikilink || typeof wikilink.match !== 'string' || 
                    typeof wikilink.start !== 'number' || typeof wikilink.end !== 'number') {
                    console.debug('Invalid wikilink object:', wikilink);
                    continue;
                }
                
                // Validate positions
                if (wikilink.start < 0 || wikilink.end <= wikilink.start || 
                    wikilink.start >= text.length || wikilink.end > text.length) {
                    console.debug('Invalid wikilink positions:', wikilink.start, wikilink.end);
                    continue;
                }
                
                // Parse the wikilink to get the link path
                const parsed = parseWikilinkSync(wikilink.match);
                if (!parsed) continue;

                const { linkPath } = parsed;
                
                // Validate link path
                if (!linkPath || typeof linkPath !== 'string' || linkPath.trim().length === 0) {
                    console.debug('Invalid link path:', linkPath);
                    continue;
                }
                
                // Resolve the link path
                const resolvedPath = resolveLinkPathSync(linkPath, currentFile, plugin);
                if (!resolvedPath) continue;

                // Check if we have cached task info for this file
                const taskInfo = getTaskInfoSync(resolvedPath, plugin);
                if (taskInfo) {
                    // Validate task info
                    if (!taskInfo.title || typeof taskInfo.title !== 'string') {
                        console.debug('Invalid task info for:', resolvedPath);
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
        
    } catch (error) {
        console.error('Error in buildTaskLinkDecorations:', error);
    }

    return builder.finish();
}

// Synchronous helper functions for State Field context
function parseWikilinkSync(wikilinkText: string): { linkPath: string; displayText?: string } | null {
    // Validate input
    if (!wikilinkText || typeof wikilinkText !== 'string') {
        return null;
    }
    
    // Validate wikilink format
    if (wikilinkText.length < 4 || !wikilinkText.startsWith('[[') || !wikilinkText.endsWith(']]')) {
        return null;
    }
    
    const content = wikilinkText.slice(2, -2).trim();
    if (!content || content.length === 0) {
        return null;
    }
    
    // Prevent processing of extremely long links
    if (content.length > 500) {
        console.debug('Wikilink content too long, skipping:', content.length);
        return null;
    }

    const pipeIndex = content.indexOf('|');
    if (pipeIndex !== -1) {
        const linkPath = content.slice(0, pipeIndex).trim();
        const displayText = content.slice(pipeIndex + 1).trim();
        
        // Validate both parts
        if (!linkPath || !displayText) {
            return null;
        }
        
        return { linkPath, displayText };
    }

    return { linkPath: content };
}

function resolveLinkPathSync(linkPath: string, sourcePath: string, plugin: TaskNotesPlugin): string | null {
    // Validate inputs
    if (!linkPath || typeof linkPath !== 'string' || linkPath.trim().length === 0) {
        return null;
    }
    
    if (!sourcePath || typeof sourcePath !== 'string') {
        return null;
    }
    
    if (!plugin || !plugin.app || !plugin.app.metadataCache) {
        return null;
    }
    
    try {
        // Sanitize link path to prevent directory traversal
        const sanitizedLinkPath = linkPath.replace(/\.\./g, '').trim();
        if (!sanitizedLinkPath) {
            return null;
        }
        
        const file = plugin.app.metadataCache.getFirstLinkpathDest(sanitizedLinkPath, sourcePath);
        
        // Validate result
        if (!file || !file.path || typeof file.path !== 'string') {
            return null;
        }
        
        return file.path;
    } catch (error) {
        console.debug('Error resolving link path:', linkPath, error);
        return null;
    }
}

function getTaskInfoSync(filePath: string, plugin: TaskNotesPlugin): any {
    // Validate inputs
    if (!filePath || typeof filePath !== 'string' || filePath.trim().length === 0) {
        return null;
    }
    
    if (!plugin) {
        return null;
    }
    
    try {
        // Validate file path format
        if (filePath.length > 260) { // Windows path limit
            console.debug('File path too long:', filePath.length);
            return null;
        }
        
        // Check for invalid characters
        const invalidChars = /[<>:"|?*\x00-\x1f\x7f]/;
        if (invalidChars.test(filePath)) {
            console.debug('File path contains invalid characters:', filePath);
            return null;
        }
        
        // Use the same cached data access pattern as the views
        // This gets the most up-to-date cached task info (updated immediately after any changes)
        const cacheManager = plugin.cacheManager;
        if (!cacheManager || !cacheManager.getCachedTaskInfo) {
            return null;
        }
        
        const taskInfo = cacheManager.getCachedTaskInfo(filePath);
        
        // Basic validation of task info structure
        if (taskInfo && typeof taskInfo === 'object' && taskInfo.title) {
            return taskInfo;
        }
        
        return null;
    } catch (error) {
        console.debug('Error getting task info for:', filePath, error);
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