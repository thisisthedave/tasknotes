import { TFile, Notice } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { TaskInfo, TimeEntry, EVENT_TASK_UPDATED } from '../types';

export class TaskService {
    constructor(private plugin: TaskNotesPlugin) {}

    /**
     * Toggle the status of a task between completed and open
     */
    async toggleStatus(task: TaskInfo): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            new Notice(`Cannot find task file: ${task.path}`);
            return;
        }

        // Determine new status
        const isCurrentlyCompleted = this.plugin.statusManager.isCompletedStatus(task.status);
        const newStatus = isCurrentlyCompleted 
            ? this.plugin.settings.defaultTaskStatus // Revert to default open status
            : this.plugin.statusManager.getCompletedStatuses()[0] || 'done'; // Set to first completed status

        try {
            await this.updateProperty(task, 'status', newStatus);
            new Notice(`Task marked as '${this.plugin.statusManager.getStatusConfig(newStatus)?.label || newStatus}'`);
        } catch (error) {
            console.error('Failed to toggle task status:', error);
            new Notice('Failed to update task status');
        }
    }

    /**
     * Update a single property of a task using safe frontmatter processing
     */
    async updateProperty(task: TaskInfo, property: keyof TaskInfo, value: any, options: { silent?: boolean } = {}): Promise<void> {
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
            if (!(file instanceof TFile)) {
                new Notice(`Cannot find task file: ${task.path}`);
                return;
            }
            
            // Create a local modified copy of the task to update UI immediately
            const updatedTask = { ...task } as Record<string, any>;
            updatedTask[property] = value;
            
            // Special handling for status changes - update completedDate in local copy
            if (property === 'status' && !task.recurrence) {
                if (this.plugin.statusManager.isCompletedStatus(value)) {
                    updatedTask.completedDate = format(new Date(), 'yyyy-MM-dd');
                } else {
                    updatedTask.completedDate = undefined;
                }
            }
            
            // Process the file first
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                // Use property name directly since we're working with frontmatter
                const fieldName = property as string;
                
                // Handle special cases for certain properties
                if (property === 'status') {
                    frontmatter[fieldName] = value;
                    
                    // Update completed date when marking as complete (non-recurring tasks only)
                    if (!task.recurrence) {
                        if (this.plugin.statusManager.isCompletedStatus(value)) {
                            frontmatter.completedDate = format(new Date(), 'yyyy-MM-dd');
                        } else {
                            // Remove completed date when marking as incomplete
                            if (frontmatter.completedDate) {
                                delete frontmatter.completedDate;
                            }
                        }
                    }
                } else if (property === 'due' && !value) {
                    // Remove empty due dates
                    delete frontmatter[fieldName];
                } else {
                    frontmatter[fieldName] = value;
                }
            });

            // Clear cache for this specific file and trigger refresh
            this.plugin.notifyDataChanged(task.path, false, false);
            
            // Give the cache a moment to clear and then get fresh data
            setTimeout(async () => {
                try {
                    // Get the fresh task data directly from cache manager
                    const freshTask = await this.plugin.cacheManager.getTaskInfo(task.path, true);
                    
                    // Emit the UI update with fresh data from cache, or fallback to optimistic update
                    this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
                        path: task.path,
                        updatedTask: freshTask || (updatedTask as TaskInfo)
                    });
                } catch (error) {
                    console.error('Failed to get fresh task data:', error);
                    // Emit with optimistic update as fallback
                    this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
                        path: task.path,
                        updatedTask: (updatedTask as TaskInfo)
                    });
                }
            }, 50);
            
            if (!options.silent) {
                if (property === 'status') {
                    const statusConfig = this.plugin.statusManager.getStatusConfig(value);
                    new Notice(`Task marked as '${statusConfig?.label || value}'`);
                } else {
                    new Notice(`Task ${property} updated`);
                }
            }
        } catch (error) {
            console.error(`Failed to update task ${property}:`, error);
            new Notice(`Failed to update task ${property}`);
            
            // Revert optimistic update on error
            this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
                path: task.path,
                updatedTask: task
            });
        }
    }

    /**
     * Toggle the archive status of a task
     */
    async toggleArchive(task: TaskInfo): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            new Notice(`Cannot find task file: ${task.path}`);
            return;
        }

        const archiveTag = this.plugin.fieldMapper.getMapping().archiveTag;
        const isCurrentlyArchived = task.archived;

        try {
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                // Toggle archived property
                if (isCurrentlyArchived) {
                    delete frontmatter.archived;
                    
                    // Remove archive tag from tags array if present
                    if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
                        frontmatter.tags = frontmatter.tags.filter((tag: string) => tag !== archiveTag);
                        if (frontmatter.tags.length === 0) {
                            delete frontmatter.tags;
                        }
                    }
                } else {
                    frontmatter.archived = true;
                    
                    // Add archive tag to tags array
                    if (!frontmatter.tags) {
                        frontmatter.tags = [];
                    } else if (!Array.isArray(frontmatter.tags)) {
                        frontmatter.tags = [frontmatter.tags];
                    }
                    
                    if (!frontmatter.tags.includes(archiveTag)) {
                        frontmatter.tags.push(archiveTag);
                    }
                }
            });

            // Notify about the change
            this.plugin.notifyDataChanged(task.path);
            
            const action = isCurrentlyArchived ? 'unarchived' : 'archived';
            new Notice(`Task ${action}`);
        } catch (error) {
            console.error('Failed to toggle task archive:', error);
            new Notice('Failed to update task archive status');
        }
    }

    /**
     * Start time tracking for a task
     */
    async startTimeTracking(task: TaskInfo): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            new Notice(`Cannot find task file: ${task.path}`);
            return;
        }

        // Check if already tracking
        const activeSession = this.plugin.getActiveTimeSession(task);
        if (activeSession) {
            new Notice('Time tracking is already active for this task');
            return;
        }

        try {
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                if (!frontmatter.timeEntries) {
                    frontmatter.timeEntries = [];
                }

                // Add new time entry with start time
                const newEntry: TimeEntry = {
                    startTime: new Date().toISOString(),
                    description: 'Work session'
                };

                frontmatter.timeEntries.push(newEntry);
            });

            this.plugin.notifyDataChanged(task.path);
            new Notice('Time tracking started');
        } catch (error) {
            console.error('Failed to start time tracking:', error);
            new Notice('Failed to start time tracking');
        }
    }

    /**
     * Stop time tracking for a task
     */
    async stopTimeTracking(task: TaskInfo): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            new Notice(`Cannot find task file: ${task.path}`);
            return;
        }

        const activeSession = this.plugin.getActiveTimeSession(task);
        if (!activeSession) {
            new Notice('No active time tracking session for this task');
            return;
        }

        try {
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                if (frontmatter.timeEntries && Array.isArray(frontmatter.timeEntries)) {
                    // Find and update the active session
                    const entryIndex = frontmatter.timeEntries.findIndex((entry: TimeEntry) => 
                        entry.startTime === activeSession.startTime && !entry.endTime
                    );

                    if (entryIndex !== -1) {
                        frontmatter.timeEntries[entryIndex].endTime = new Date().toISOString();
                    }
                }
            });

            this.plugin.notifyDataChanged(task.path);
            new Notice('Time tracking stopped');
        } catch (error) {
            console.error('Failed to stop time tracking:', error);
            new Notice('Failed to stop time tracking');
        }
    }

    /**
     * Toggle completion status for recurring tasks on a specific date
     */
    async toggleRecurringTaskComplete(task: TaskInfo, date?: Date): Promise<void> {
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
            if (!(file instanceof TFile)) {
                new Notice(`Cannot find task file: ${task.path}`);
                return;
            }

            if (!task.recurrence) {
                throw new Error('Task is not recurring');
            }

            // Use the provided date or fall back to the currently selected date
            const targetDate = date || this.plugin.selectedDate;
            const dateStr = format(targetDate, 'yyyy-MM-dd');
            
            // Check current completion status for this date
            const completeInstances = Array.isArray(task.complete_instances) ? task.complete_instances : [];
            const currentComplete = completeInstances.includes(dateStr);
            const newComplete = !currentComplete;
            
            // Create a local modified copy for immediate UI feedback
            const updatedTask = { ...task };
            
            // Process the frontmatter
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                // Ensure complete_instances array exists
                if (!frontmatter.complete_instances) {
                    frontmatter.complete_instances = [];
                }
                
                const completeDates: string[] = frontmatter.complete_instances;
                
                if (newComplete) {
                    // Add date to completed instances if not already present
                    if (!completeDates.includes(dateStr)) {
                        frontmatter.complete_instances = [...completeDates, dateStr];
                    }
                } else {
                    // Remove date from completed instances
                    frontmatter.complete_instances = completeDates.filter(d => d !== dateStr);
                }
            });
            
            // Update the local copy for UI feedback
            if (newComplete) {
                updatedTask.complete_instances = [...completeInstances, dateStr];
            } else {
                updatedTask.complete_instances = completeInstances.filter(d => d !== dateStr);
            }
            
            // Notify cache about the change - clear cache but don't trigger full UI refresh 
            this.plugin.notifyDataChanged(task.path, false, false);
            
            // Get the fresh task data from cache after the file update
            const freshTasks = await this.plugin.cacheManager.getTaskInfoForDate(this.plugin.selectedDate, true);
            const freshTask = freshTasks.find(t => t.path === task.path);
            
            // Emit the UI update with fresh data from cache, or fallback to optimistic update
            this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
                path: task.path,
                updatedTask: freshTask || updatedTask
            });
            
            const action = newComplete ? 'completed' : 'marked incomplete';
            new Notice(`Recurring task ${action} for ${format(targetDate, 'MMM d')}`);
        } catch (error) {
            console.error('Failed to toggle recurring task completion:', error);
            new Notice('Failed to update recurring task');
            
            // Revert optimistic update on error
            this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
                path: task.path,
                updatedTask: task
            });
        }
    }
}
