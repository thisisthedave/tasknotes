import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import TaskNotesPlugin from '../main';

/**
 * CodeMirror extension for handling task drops into the editor
 */
export function createTaskDropExtension(plugin: TaskNotesPlugin): Extension {
    return EditorView.domEventHandlers({
        dragover(event: DragEvent, view: EditorView) {
            // Check if this is a task being dragged
            const taskPath = event.dataTransfer?.types.includes('text/plain') || 
                           event.dataTransfer?.types.includes('application/x-task-path');
            
            if (taskPath) {
                event.preventDefault();
                event.dataTransfer!.dropEffect = 'copy';
                return true;
            }
            return false;
        },

        drop(event: DragEvent, view: EditorView) {
            // Handle the drop asynchronously without blocking the return
            (async () => {
                try {
                    console.log('CodeMirror drop event triggered', event);
                    
                    // Get task path from drag data
                    const taskPath = event.dataTransfer?.getData('text/plain') || 
                                   event.dataTransfer?.getData('application/x-task-path');
                    
                    console.log('Task path from CodeMirror drop:', taskPath);
                    
                    if (!taskPath) {
                        console.log('No task path found in CodeMirror drop');
                        return;
                    }

                    // Verify it's actually a task by checking our cache
                    const task = await plugin.cacheManager.getTaskInfo(taskPath);
                    if (!task) {
                        console.log('Task not found in cache:', taskPath);
                        return;
                    }

                    console.log('Valid task found in CodeMirror drop:', task.title);

                    // Get drop position
                    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                    if (pos === null) {
                        console.log('Could not determine drop position');
                        return;
                    }

                    // Create a task link in the format: [[taskPath|Task Title]]
                    const taskLink = `[[${taskPath}|${task.title}]]`;
                    
                    // Insert the task link at the drop position
                    view.dispatch({
                        changes: {
                            from: pos,
                            to: pos,
                            insert: taskLink
                        }
                    });

                    console.log(`Inserted task link at position ${pos}: ${taskLink}`);

                    // Show success feedback
                    const { Notice } = await import('obsidian');
                    new Notice(`Inserted link to task: ${task.title}`);

                } catch (error) {
                    console.error('Error handling task drop in CodeMirror:', error);
                    const { Notice } = await import('obsidian');
                    new Notice('Failed to insert task link');
                }
            })();

            // Check if this is a task being dragged
            const taskPath = event.dataTransfer?.getData('text/plain') || 
                           event.dataTransfer?.getData('application/x-task-path');
            
            if (taskPath) {
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
            
            return false;
        }
    });
}