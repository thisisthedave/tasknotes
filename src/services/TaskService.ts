import { TFile } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { TaskInfo, TimeEntry, EVENT_TASK_UPDATED } from '../types';

export class TaskService {
    constructor(private plugin: TaskNotesPlugin) {}

    /**
     * Toggle the status of a task between completed and open
     */
    async toggleStatus(task: TaskInfo): Promise<TaskInfo> {
        // Determine new status
        const isCurrentlyCompleted = this.plugin.statusManager.isCompletedStatus(task.status);
        const newStatus = isCurrentlyCompleted 
            ? this.plugin.settings.defaultTaskStatus // Revert to default open status
            : this.plugin.statusManager.getCompletedStatuses()[0] || 'done'; // Set to first completed status

        return await this.updateProperty(task, 'status', newStatus);
    }

    /**
     * Update a single property of a task following the deterministic data flow pattern
     */
    async updateProperty(task: TaskInfo, property: keyof TaskInfo, value: any, options: { silent?: boolean } = {}): Promise<TaskInfo> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            throw new Error(`Cannot find task file: ${task.path}`);
        }
        
        // Step 1: Construct new state in memory
        const updatedTask = { ...task } as Record<string, any>;
        updatedTask[property] = value;
        updatedTask.dateModified = new Date().toISOString();
        
        // Handle derivative changes for status updates
        if (property === 'status' && !task.recurrence) {
            if (this.plugin.statusManager.isCompletedStatus(value)) {
                updatedTask.completedDate = format(new Date(), 'yyyy-MM-dd');
            } else {
                updatedTask.completedDate = undefined;
            }
        }
        
        // Step 2: Persist to file using the authoritative state
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            // Map the complete new TaskInfo object to frontmatter fields
            const fieldName = property as string;
            
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
            
            // Always update the modification timestamp
            frontmatter.dateModified = updatedTask.dateModified;
        });
        
        // Step 3: Proactively update cache
        await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask as TaskInfo);
        
        // Step 4: Notify system of change
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: task.path,
            updatedTask: updatedTask as TaskInfo
        });
        
        // Step 5: Return authoritative data
        return updatedTask as TaskInfo;
    }

    /**
     * Toggle the archive status of a task
     */
    async toggleArchive(task: TaskInfo): Promise<TaskInfo> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            throw new Error(`Cannot find task file: ${task.path}`);
        }

        const archiveTag = this.plugin.fieldMapper.getMapping().archiveTag;
        const isCurrentlyArchived = task.archived;
        
        // Step 1: Construct new state in memory
        const updatedTask = { ...task };
        updatedTask.archived = !isCurrentlyArchived;
        updatedTask.dateModified = new Date().toISOString();
        
        // Update tags array to include/exclude archive tag
        if (!updatedTask.tags) {
            updatedTask.tags = [];
        }
        
        if (isCurrentlyArchived) {
            // Remove archive tag
            updatedTask.tags = updatedTask.tags.filter(tag => tag !== archiveTag);
        } else {
            // Add archive tag if not present
            if (!updatedTask.tags.includes(archiveTag)) {
                updatedTask.tags = [...updatedTask.tags, archiveTag];
            }
        }
        
        // Step 2: Persist to file
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
            
            // Always update the modification timestamp
            frontmatter.dateModified = updatedTask.dateModified;
        });
        
        // Step 3: Proactively update cache
        await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        
        // Step 4: Notify system of change
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: task.path,
            updatedTask: updatedTask
        });
        
        // Step 5: Return authoritative data
        return updatedTask;
    }

    /**
     * Start time tracking for a task
     */
    async startTimeTracking(task: TaskInfo): Promise<TaskInfo> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            throw new Error(`Cannot find task file: ${task.path}`);
        }

        // Check if already tracking
        const activeSession = this.plugin.getActiveTimeSession(task);
        if (activeSession) {
            throw new Error('Time tracking is already active for this task');
        }

        // Step 1: Construct new state in memory
        const updatedTask = { ...task };
        updatedTask.dateModified = new Date().toISOString();
        
        if (!updatedTask.timeEntries) {
            updatedTask.timeEntries = [];
        }
        
        const newEntry: TimeEntry = {
            startTime: new Date().toISOString(),
            description: 'Work session'
        };
        updatedTask.timeEntries = [...updatedTask.timeEntries, newEntry];

        // Step 2: Persist to file
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            if (!frontmatter.timeEntries) {
                frontmatter.timeEntries = [];
            }

            // Add new time entry with start time
            frontmatter.timeEntries.push(newEntry);
            frontmatter.dateModified = updatedTask.dateModified;
        });

        // Step 3: Proactively update cache
        await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        
        // Step 4: Notify system of change
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: task.path,
            updatedTask: updatedTask
        });
        
        // Step 5: Return authoritative data
        return updatedTask;
    }

    /**
     * Stop time tracking for a task
     */
    async stopTimeTracking(task: TaskInfo): Promise<TaskInfo> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            throw new Error(`Cannot find task file: ${task.path}`);
        }

        const activeSession = this.plugin.getActiveTimeSession(task);
        if (!activeSession) {
            throw new Error('No active time tracking session for this task');
        }

        // Step 1: Construct new state in memory
        const updatedTask = { ...task };
        updatedTask.dateModified = new Date().toISOString();
        
        if (updatedTask.timeEntries && Array.isArray(updatedTask.timeEntries)) {
            const entryIndex = updatedTask.timeEntries.findIndex((entry: TimeEntry) => 
                entry.startTime === activeSession.startTime && !entry.endTime
            );
            if (entryIndex !== -1) {
                updatedTask.timeEntries = [...updatedTask.timeEntries];
                updatedTask.timeEntries[entryIndex] = {
                    ...updatedTask.timeEntries[entryIndex],
                    endTime: new Date().toISOString()
                };
            }
        }

        // Step 2: Persist to file
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
            frontmatter.dateModified = updatedTask.dateModified;
        });

        // Step 3: Proactively update cache
        await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        
        // Step 4: Notify system of change
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: task.path,
            updatedTask: updatedTask
        });
        
        // Step 5: Return authoritative data
        return updatedTask;
    }

    /**
     * Toggle completion status for recurring tasks on a specific date
     */
    async toggleRecurringTaskComplete(task: TaskInfo, date?: Date): Promise<TaskInfo> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            throw new Error(`Cannot find task file: ${task.path}`);
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
        
        // Step 1: Construct new state in memory
        const updatedTask = { ...task };
        updatedTask.dateModified = new Date().toISOString();
        
        if (newComplete) {
            // Add date to completed instances if not already present
            if (!completeInstances.includes(dateStr)) {
                updatedTask.complete_instances = [...completeInstances, dateStr];
            }
        } else {
            // Remove date from completed instances
            updatedTask.complete_instances = completeInstances.filter(d => d !== dateStr);
        }
        
        // Step 2: Persist to file
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
            
            frontmatter.dateModified = updatedTask.dateModified;
        });
        
        // Step 3: Proactively update cache
        await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        
        // Step 4: Notify system of change
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: task.path,
            updatedTask: updatedTask
        });
        
        // Step 5: Return authoritative data
        return updatedTask;
    }
}
