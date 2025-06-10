import { TFile, Notice } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { TaskInfo, TimeEntry, EVENT_TASK_UPDATED } from '../types';
import { getCurrentTimestamp, getCurrentDateString } from '../utils/dateUtils';

export class TaskService {
    constructor(private plugin: TaskNotesPlugin) {}

    /**
     * Toggle the status of a task between completed and open
     */
    async toggleStatus(task: TaskInfo): Promise<TaskInfo> {
        try {
            // Determine new status
            const isCurrentlyCompleted = this.plugin.statusManager.isCompletedStatus(task.status);
            const newStatus = isCurrentlyCompleted 
                ? this.plugin.settings.defaultTaskStatus // Revert to default open status
                : this.plugin.statusManager.getCompletedStatuses()[0] || 'done'; // Set to first completed status

            return await this.updateProperty(task, 'status', newStatus);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error toggling task status:', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                taskPath: task.path,
                currentStatus: task.status
            });
            
            throw new Error(`Failed to toggle task status: ${errorMessage}`);
        }
    }

    /**
     * Update a single property of a task following the deterministic data flow pattern
     */
    async updateProperty(task: TaskInfo, property: keyof TaskInfo, value: any, options: { silent?: boolean } = {}): Promise<TaskInfo> {
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
            if (!(file instanceof TFile)) {
                throw new Error(`Cannot find task file: ${task.path}`);
            }
            
            // Step 1: Construct new state in memory
            const updatedTask = { ...task } as Record<string, any>;
            updatedTask[property] = value;
            updatedTask.dateModified = getCurrentTimestamp();
            
            // Handle derivative changes for status updates
            if (property === 'status' && !task.recurrence) {
                if (this.plugin.statusManager.isCompletedStatus(value)) {
                    updatedTask.completedDate = getCurrentDateString();
                } else {
                    updatedTask.completedDate = undefined;
                }
            }
            
            // Step 2: Persist to file
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                // Use field mapper to get the correct frontmatter property name
                const fieldName = this.plugin.fieldMapper.toUserField(property as keyof import('../types').FieldMapping);
                
                if (property === 'status') {
                    frontmatter[fieldName] = value;
                    
                    // Update completed date when marking as complete (non-recurring tasks only)
                    if (!task.recurrence) {
                        const completedDateField = this.plugin.fieldMapper.toUserField('completedDate');
                        if (this.plugin.statusManager.isCompletedStatus(value)) {
                            frontmatter[completedDateField] = getCurrentDateString();
                        } else {
                            // Remove completed date when marking as incomplete
                            if (frontmatter[completedDateField]) {
                                delete frontmatter[completedDateField];
                            }
                        }
                    }
                } else if ((property === 'due' || property === 'scheduled') && !value) {
                    // Remove empty due/scheduled dates
                    delete frontmatter[fieldName];
                } else {
                    frontmatter[fieldName] = value;
                }
                
                // Always update the modification timestamp using field mapper
                const dateModifiedField = this.plugin.fieldMapper.toUserField('dateModified');
                frontmatter[dateModifiedField] = updatedTask.dateModified;
            });
            
            // Step 3: Proactively update cache
            try {
                await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask as TaskInfo);
            } catch (cacheError) {
                // Cache errors shouldn't break the operation, just log them
                console.error('Error updating task cache:', {
                    error: cacheError instanceof Error ? cacheError.message : String(cacheError),
                    taskPath: task.path
                });
            }
            
            // Step 4: Notify system of change
            try {
                this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
                    path: task.path,
                    originalTask: task,
                    updatedTask: updatedTask as TaskInfo
                });
            } catch (eventError) {
                console.error('Error emitting task update event:', {
                    error: eventError instanceof Error ? eventError.message : String(eventError),
                    taskPath: task.path
                });
                // Event emission errors shouldn't break the operation
            }
            
            // Step 5: Return authoritative data
            return updatedTask as TaskInfo;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error updating task property:', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                taskPath: task.path,
                property: String(property),
                value
            });
            
            throw new Error(`Failed to update task property: ${errorMessage}`);
        }
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
        updatedTask.dateModified = getCurrentTimestamp();
        
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
            const dateModifiedField = this.plugin.fieldMapper.toUserField('dateModified');
            
            // Toggle archived property (note: archived is handled via tags, not as a separate field)
            if (isCurrentlyArchived) {
                // Remove archive tag from tags array if present
                if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
                    frontmatter.tags = frontmatter.tags.filter((tag: string) => tag !== archiveTag);
                    if (frontmatter.tags.length === 0) {
                        delete frontmatter.tags;
                    }
                }
            } else {
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
            
            // Always update the modification timestamp using field mapper
            frontmatter[dateModifiedField] = updatedTask.dateModified;
        });
        
        // Step 3: Proactively update cache
        await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        
        // Step 4: Notify system of change
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: task.path,
            originalTask: task,
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
        updatedTask.dateModified = getCurrentTimestamp();
        
        if (!updatedTask.timeEntries) {
            updatedTask.timeEntries = [];
        }
        
        const newEntry: TimeEntry = {
            startTime: getCurrentTimestamp(),
            description: 'Work session'
        };
        updatedTask.timeEntries = [...updatedTask.timeEntries, newEntry];

        // Step 2: Persist to file
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const timeEntriesField = this.plugin.fieldMapper.toUserField('timeEntries');
            const dateModifiedField = this.plugin.fieldMapper.toUserField('dateModified');
            
            if (!frontmatter[timeEntriesField]) {
                frontmatter[timeEntriesField] = [];
            }

            // Add new time entry with start time
            frontmatter[timeEntriesField].push(newEntry);
            frontmatter[dateModifiedField] = updatedTask.dateModified;
        });

        // Step 3: Proactively update cache
        await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        
        // Step 4: Notify system of change
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: task.path,
            originalTask: task,
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
        updatedTask.dateModified = getCurrentTimestamp();
        
        if (updatedTask.timeEntries && Array.isArray(updatedTask.timeEntries)) {
            const entryIndex = updatedTask.timeEntries.findIndex((entry: TimeEntry) => 
                entry.startTime === activeSession.startTime && !entry.endTime
            );
            if (entryIndex !== -1) {
                updatedTask.timeEntries = [...updatedTask.timeEntries];
                updatedTask.timeEntries[entryIndex] = {
                    ...updatedTask.timeEntries[entryIndex],
                    endTime: getCurrentTimestamp()
                };
            }
        }

        // Step 2: Persist to file
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const timeEntriesField = this.plugin.fieldMapper.toUserField('timeEntries');
            const dateModifiedField = this.plugin.fieldMapper.toUserField('dateModified');
            
            if (frontmatter[timeEntriesField] && Array.isArray(frontmatter[timeEntriesField])) {
                // Find and update the active session
                const entryIndex = frontmatter[timeEntriesField].findIndex((entry: TimeEntry) => 
                    entry.startTime === activeSession.startTime && !entry.endTime
                );

                if (entryIndex !== -1) {
                    frontmatter[timeEntriesField][entryIndex].endTime = getCurrentTimestamp();
                }
            }
            frontmatter[dateModifiedField] = updatedTask.dateModified;
        });

        // Step 3: Proactively update cache
        await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        
        // Step 4: Notify system of change
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: task.path,
            originalTask: task,
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
        updatedTask.dateModified = getCurrentTimestamp();
        
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
            const completeInstancesField = this.plugin.fieldMapper.toUserField('completeInstances');
            const dateModifiedField = this.plugin.fieldMapper.toUserField('dateModified');
            
            // Ensure complete_instances array exists
            if (!frontmatter[completeInstancesField]) {
                frontmatter[completeInstancesField] = [];
            }
            
            const completeDates: string[] = frontmatter[completeInstancesField];
            
            if (newComplete) {
                // Add date to completed instances if not already present
                if (!completeDates.includes(dateStr)) {
                    frontmatter[completeInstancesField] = [...completeDates, dateStr];
                }
            } else {
                // Remove date from completed instances
                frontmatter[completeInstancesField] = completeDates.filter(d => d !== dateStr);
            }
            
            frontmatter[dateModifiedField] = updatedTask.dateModified;
        });
        
        // Step 3: Proactively update cache
        await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        
        // Step 4: Notify system of change
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: task.path,
            originalTask: task,
            updatedTask: updatedTask
        });
        
        // Step 5: Return authoritative data
        return updatedTask;
    }
}
