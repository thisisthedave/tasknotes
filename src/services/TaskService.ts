import { EVENT_TASK_DELETED, EVENT_TASK_UPDATED, TaskCreationData, TaskInfo, TimeEntry, IWebhookNotifier } from '../types';
import { FilenameContext, generateTaskFilename, generateUniqueFilename } from '../utils/filenameGenerator';
import { Notice, TFile, normalizePath, stringifyYaml } from 'obsidian';
import { TemplateData, mergeTemplateFrontmatter, processTemplate } from '../utils/templateProcessor';
import { addDTSTARTToRecurrenceRule, ensureFolderExists, updateToNextScheduledOccurrence } from '../utils/helpers';
import { formatDateForStorage, getCurrentDateString, getCurrentTimestamp } from '../utils/dateUtils';
import { format } from 'date-fns';

import TaskNotesPlugin from '../main';

export class TaskService {
    private webhookNotifier?: IWebhookNotifier;
    
    constructor(private plugin: TaskNotesPlugin) {}
    
    /**
     * Set webhook notifier for triggering webhook events
     * Called after HTTPAPIService is initialized to avoid circular dependencies
     */
    setWebhookNotifier(notifier: IWebhookNotifier): void {
        this.webhookNotifier = notifier;
    }

    /**
     * Process a folder path template with task and date variables
     * 
     * This method enables dynamic folder creation by replacing template variables 
     * with actual values from the task data and current date.
     * 
     * Supported task variables:
     * - {{context}} - First context from the task's contexts array
     * - {{project}} - First project from the task's projects array  
     * - {{priority}} - Task priority (e.g., "high", "medium", "low")
     * - {{status}} - Task status (e.g., "todo", "in-progress", "done")
     * - {{title}} - Task title (sanitized for folder names)
     * 
     * Supported date variables:
     * - {{year}} - Current year (e.g., "2025")
     * - {{month}} - Current month with leading zero (e.g., "08")
     * - {{day}} - Current day with leading zero (e.g., "15")
     * - {{date}} - Full current date (e.g., "2025-08-15")
     * 
     * @param folderTemplate - The template string with variables to process
     * @param taskData - Optional task data for variable substitution
     * @param date - Date to use for date variables (defaults to current date)
     * @returns Processed folder path with variables replaced
     * 
     * @example
     * processFolderTemplate("Tasks/{{year}}/{{month}}", taskData)
     * // Returns: "Tasks/2025/08"
     * 
     * @example 
     * processFolderTemplate("{{project}}/{{priority}}", taskData)
     * // Returns: "ProjectName/high"
     */
    private processFolderTemplate(folderTemplate: string, taskData?: TaskCreationData, date: Date = new Date()): string {
        if (!folderTemplate) {
            return folderTemplate;
        }

        let processedPath = folderTemplate;
        
        // Replace task variables if taskData is provided
        if (taskData) {
            // Handle single context (first one if multiple)
            const context = Array.isArray(taskData.contexts) && taskData.contexts.length > 0 
                ? taskData.contexts[0] 
                : '';
            processedPath = processedPath.replace(/\{\{context\}\}/g, context);
            
            // Handle single project (first one if multiple) 
            const project = Array.isArray(taskData.projects) && taskData.projects.length > 0
                ? taskData.projects[0]
                : '';
            processedPath = processedPath.replace(/\{\{project\}\}/g, project);
            
            // Handle priority
            const priority = taskData.priority || '';
            processedPath = processedPath.replace(/\{\{priority\}\}/g, priority);
            
            // Handle status
            const status = taskData.status || '';
            processedPath = processedPath.replace(/\{\{status\}\}/g, status);
            
            // Handle title (sanitized for folder names)
            const title = taskData.title ? taskData.title.replace(/[<>:"/\\|?*]/g, '_') : '';
            processedPath = processedPath.replace(/\{\{title\}\}/g, title);
        }
        
        // Replace date variables with current date values
        processedPath = processedPath.replace(/\{\{year\}\}/g, format(date, 'yyyy'));
        processedPath = processedPath.replace(/\{\{month\}\}/g, format(date, 'MM'));
        processedPath = processedPath.replace(/\{\{day\}\}/g, format(date, 'dd'));
        processedPath = processedPath.replace(/\{\{date\}\}/g, format(date, 'yyyy-MM-dd'));
        
        return processedPath;
    }

    /**
     * Create a new task file with all the necessary setup
     * This is the central method for task creation used by all components
     */
    async createTask(taskData: TaskCreationData): Promise<{ file: TFile; taskInfo: TaskInfo }> {
        try {
            // Validate required fields
            if (!taskData.title || !taskData.title.trim()) {
                throw new Error('Title is required');
            }

            if (taskData.title.length > 200) {
                throw new Error('Title is too long (max 200 characters)');
            }

            // Apply defaults for missing fields
            const title = taskData.title.trim();
            const priority = taskData.priority || this.plugin.settings.defaultTaskPriority;
            const status = taskData.status || this.plugin.settings.defaultTaskStatus;
            const dateCreated = taskData.dateCreated || getCurrentTimestamp();
            const dateModified = taskData.dateModified || getCurrentTimestamp();

            // Prepare contexts, projects, and tags arrays
            const contextsArray = taskData.contexts || [];
            const projectsArray = taskData.projects || [];
            // Handle tags based on identification method
            let tagsArray = taskData.tags || [];
            
            // Only add task tag if using tag-based identification
            if (this.plugin.settings.taskIdentificationMethod === 'tag') {
                if (!tagsArray.includes(this.plugin.settings.taskTag)) {
                    tagsArray = [this.plugin.settings.taskTag, ...tagsArray];
                }
            }

            // Generate filename
            const filenameContext: FilenameContext = {
                title: title,
                priority: priority,
                status: status,
                date: new Date(),
                dueDate: taskData.due,
                scheduledDate: taskData.scheduled
            };

            const baseFilename = generateTaskFilename(filenameContext, this.plugin.settings);
            
            // Determine folder based on creation context
            // Process folder templates with task and date variables for dynamic folder organization
            let folder = '';
            if (taskData.creationContext === 'inline-conversion') {
                // For inline conversion, use the inline task folder setting with variable support
                const inlineFolder = this.plugin.settings.inlineTaskConvertFolder || '';
                if (inlineFolder.trim()) {
                    // Inline folder is configured, use it
                    if (inlineFolder.includes('{{currentNotePath}}')) {
                        // Get current file's folder path
                        const currentFile = this.plugin.app.workspace.getActiveFile();
                        const currentFolderPath = currentFile?.parent?.path || '';
                        folder = inlineFolder.replace(/\{\{currentNotePath\}\}/g, currentFolderPath);
                    } else {
                        folder = inlineFolder;
                    }
                    // Process task and date variables in the inline folder path
                    folder = this.processFolderTemplate(folder, taskData);
                } else {
                    // Fallback to default tasks folder when inline folder is empty (#128)
                    const tasksFolder = this.plugin.settings.tasksFolder || '';
                    folder = this.processFolderTemplate(tasksFolder, taskData);
                }
            } else {
                // For manual creation and other contexts, use the general tasks folder
                const tasksFolder = this.plugin.settings.tasksFolder || '';
                folder = this.processFolderTemplate(tasksFolder, taskData);
            }
            
            // Ensure folder exists
            if (folder) {
                await ensureFolderExists(this.plugin.app.vault, folder);
            }
            
            // Generate unique filename
            const uniqueFilename = await generateUniqueFilename(baseFilename, folder, this.plugin.app.vault);
            const fullPath = folder ? `${folder}/${uniqueFilename}.md` : `${uniqueFilename}.md`;

            // Create complete TaskInfo object with all the data
            const completeTaskData: Partial<TaskInfo> = {
                title: title,
                status: status,
                priority: priority,
                due: taskData.due || undefined,
                scheduled: taskData.scheduled || undefined,
                contexts: contextsArray.length > 0 ? contextsArray : undefined,
                projects: projectsArray.length > 0 ? projectsArray : undefined,
                timeEstimate: taskData.timeEstimate && taskData.timeEstimate > 0 ? taskData.timeEstimate : undefined,
                points: taskData.points && taskData.points > 0 ? taskData.points : undefined,
                dateCreated: dateCreated,
                dateModified: dateModified,
                recurrence: taskData.recurrence || undefined,
                reminders: taskData.reminders && taskData.reminders.length > 0 ? taskData.reminders : undefined,
                icsEventId: taskData.icsEventId || undefined
            };

            // Use field mapper to convert to frontmatter with proper field mapping
            const frontmatter = this.plugin.fieldMapper.mapToFrontmatter(completeTaskData, this.plugin.settings.taskTag, this.plugin.settings.storeTitleInFilename);
            
            // Handle task identification based on settings
            if (this.plugin.settings.taskIdentificationMethod === 'property') {
                const propName = this.plugin.settings.taskPropertyName;
                const propValue = this.plugin.settings.taskPropertyValue;
                if (propName && propValue) {
                    // Coerce boolean-like strings to actual booleans for compatibility with Obsidian properties
                    const lower = propValue.toLowerCase();
                    const coercedValue = (lower === 'true' || lower === 'false') ? (lower === 'true') : propValue;
                    frontmatter[propName] = coercedValue as any;
                }
                // Remove task tag from tags array if using property identification
                const filteredTags = tagsArray.filter((tag: string) => tag !== this.plugin.settings.taskTag);
                if (filteredTags.length > 0) {
                    frontmatter.tags = filteredTags;
                }
            } else {
                // Tags are handled separately (not via field mapper)
                frontmatter.tags = tagsArray;
            }

            // Apply template processing (both frontmatter and body)
            const templateResult = await this.applyTemplate(taskData);
            
            // Merge template frontmatter with base frontmatter
            // User-defined values take precedence over template frontmatter
            const finalFrontmatter = mergeTemplateFrontmatter(frontmatter, templateResult.frontmatter);
            
            // Prepare file content
            const yamlHeader = stringifyYaml(finalFrontmatter);
            let content = `---\n${yamlHeader}---\n\n`;
            
            // Add processed body content if any
            if (templateResult.body && templateResult.body.trim()) {
                content += `${templateResult.body.trim()}\n\n`;
            }

            // Create the file
            const file = await this.plugin.app.vault.create(fullPath, content);

            // Create final TaskInfo object for cache and events
            // Ensure required fields are present by using the complete task data as base
            const taskInfo: TaskInfo = {
                ...completeTaskData,
                ...finalFrontmatter,
                // Ensure required fields are always defined
                title: finalFrontmatter.title || completeTaskData.title || title,
                status: finalFrontmatter.status || completeTaskData.status || status,
                priority: finalFrontmatter.priority || completeTaskData.priority || priority,
                path: file.path,
                tags: tagsArray,
                archived: false
            };

            // Wait for fresh data and update cache
            try {
                // Wait for the metadata cache to have the updated data for new tasks
                if (this.plugin.cacheManager.waitForFreshTaskData) {
                    await this.plugin.cacheManager.waitForFreshTaskData(file, { title: taskInfo.title });
                }
                this.plugin.cacheManager.updateTaskInfoInCache(file.path, taskInfo);
            } catch (cacheError) {
                console.error('Error updating cache for new task:', cacheError);
            }

            // Emit task created event
            this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
                path: file.path,
                updatedTask: taskInfo
            });

            // Trigger webhook for task creation
            if (this.webhookNotifier) {
                try {
                    await this.webhookNotifier.triggerWebhook('task.created', { task: taskInfo });
                } catch (error) {
                    console.warn('Failed to trigger webhook for task creation:', error);
                }
            }

            return { file, taskInfo };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error creating task:', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                taskData
            });
            
            throw new Error(`Failed to create task: ${errorMessage}`);
        }
    }

    /**
     * Apply template to task (both frontmatter and body) if enabled in settings
     */
    private async applyTemplate(taskData: TaskCreationData): Promise<{ frontmatter: Record<string, any>; body: string }> {
        const defaults = this.plugin.settings.taskCreationDefaults;
        
        // Check if body template is enabled and configured
        if (!defaults.useBodyTemplate || !defaults.bodyTemplate?.trim()) {
            // No template configured, return empty frontmatter and details as body
            return {
                frontmatter: {},
                body: taskData.details?.trim() || ''
            };
        }
        
        try {
            // Normalize the template path and ensure it has .md extension
            let templatePath = normalizePath(defaults.bodyTemplate.trim());
            if (!templatePath.endsWith('.md')) {
                templatePath += '.md';
            }
            
            // Try to load the template file
            const templateFile = this.plugin.app.vault.getAbstractFileByPath(templatePath);
            if (templateFile instanceof TFile) {
                const templateContent = await this.plugin.app.vault.read(templateFile);
                
                // Prepare task data for template variables (with all final values)
                const templateTaskData: TemplateData = {
                    title: taskData.title || '',
                    priority: taskData.priority || '',
                    status: taskData.status || '',
                    contexts: Array.isArray(taskData.contexts) ? taskData.contexts : [],
                    tags: Array.isArray(taskData.tags) ? taskData.tags : [],
                    timeEstimate: taskData.timeEstimate || 0,
                    points: taskData.points || 0,
                    dueDate: taskData.due || '',
                    scheduledDate: taskData.scheduled || '',
                    details: taskData.details || '',
                    parentNote: taskData.parentNote || ''
                };
                
                // Process the complete template (frontmatter + body)
                return processTemplate(templateContent, templateTaskData);
            } else {
                // Template file not found, log error and return details as-is
                console.warn(`Task body template not found: ${templatePath}`);
                new Notice(`Task body template not found: ${templatePath}`);
                return {
                    frontmatter: {},
                    body: taskData.details?.trim() || ''
                };
            }
        } catch (error) {
            // Error reading template, log error and return details as-is
            console.error('Error reading task body template:', error);
            new Notice(`Error reading task body template: ${defaults.bodyTemplate}`);
            return {
                frontmatter: {},
                body: taskData.details?.trim() || ''
            };
        }
    }

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
     * Update a single property of multiple tasks following the deterministic data flow pattern
     */
    async batchUpdateProperty(tasks: TaskInfo[], property: keyof TaskInfo, value: any, options: { silent?: boolean } = {}): Promise<TaskInfo[]> {
        return Promise.all(tasks.map(task => this.updateProperty(task, property, value, options)));
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
            
            // Get fresh task data to prevent overwrites
            const freshTask = await this.plugin.cacheManager.getTaskInfo(task.path) || task;
            
            // Step 1: Construct new state in memory using fresh data
            const updatedTask = { ...freshTask } as Record<string, any>;
            updatedTask[property] = value;
            updatedTask.dateModified = getCurrentTimestamp();
            
            // Handle derivative changes for status updates
            if (property === 'status' && !freshTask.recurrence) {
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
                    // Coerce boolean-like status strings to actual booleans for compatibility with Obsidian checkbox properties
                    const lower = String(value).toLowerCase();
                    const coercedValue = (lower === 'true' || lower === 'false') ? (lower === 'true') : value;
                    frontmatter[fieldName] = coercedValue;
                    
                    // Update completed date when marking as complete (non-recurring tasks only)
                    // FIX: Use freshTask instead of stale task to check recurrence
                    if (!freshTask.recurrence) {
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
            
            // Step 3: Wait for fresh data and update cache
            try {
                // Wait for the metadata cache to have the updated data
                if (this.plugin.cacheManager.waitForFreshTaskData) {
                    await this.plugin.cacheManager.waitForFreshTaskData(file, { [property]: value });
                }
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
                this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
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
            
            // Trigger webhooks for property updates
            if (this.webhookNotifier) {
                try {
                    // Check if this was a completion
                    const wasCompleted = this.plugin.statusManager.isCompletedStatus(task.status);
                    const isCompleted = property === 'status' && this.plugin.statusManager.isCompletedStatus(value);
                    
                    if (property === 'status' && !wasCompleted && isCompleted) {
                        // Task was completed
                        await this.webhookNotifier.triggerWebhook('task.completed', { task: updatedTask as TaskInfo });
                    } else {
                        // Regular property update
                        await this.webhookNotifier.triggerWebhook('task.updated', { 
                            task: updatedTask as TaskInfo,
                            previous: task 
                        });
                    }
                } catch (error) {
                    console.warn('Failed to trigger webhook for property update:', error);
                }
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

        // Step 2.5: Move file based on archive operation and settings
        let movedFile = file;
        if (this.plugin.settings.moveArchivedTasks) {
            try {
                if (!isCurrentlyArchived && this.plugin.settings.archiveFolder?.trim()) {
                    // Archiving: Move to archive folder
                    const archiveFolder = this.plugin.settings.archiveFolder.trim();
                    
                    // Ensure archive folder exists
                    await ensureFolderExists(this.plugin.app.vault, archiveFolder);
                    
                    // Construct new path in archive folder
                    const newPath = `${archiveFolder}/${file.name}`;
                    
                    // Check if file already exists at destination
                    const existingFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
                    if (existingFile) {
                        throw new Error(`A file named "${file.name}" already exists in the archive folder "${archiveFolder}". Cannot move task to avoid overwriting existing file.`);
                    }
                    
                    // Move the file
                    await this.plugin.app.fileManager.renameFile(file, newPath);
                    
                    // Update the file reference and task path
                    movedFile = this.plugin.app.vault.getAbstractFileByPath(newPath) as TFile;
                    updatedTask.path = newPath;
                    
                    // Clear old cache entry and update path in task object
                    this.plugin.cacheManager.clearCacheEntry(task.path);
                } else if (isCurrentlyArchived && this.plugin.settings.tasksFolder?.trim()) {
                    // Unarchiving: Move to default tasks folder
                    const tasksFolder = this.plugin.settings.tasksFolder.trim();
                    
                    // Ensure tasks folder exists
                    await ensureFolderExists(this.plugin.app.vault, tasksFolder);
                    
                    // Construct new path in tasks folder
                    const newPath = `${tasksFolder}/${file.name}`;
                    
                    // Check if file already exists at destination
                    const existingFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
                    if (existingFile) {
                        throw new Error(`A file named "${file.name}" already exists in the tasks folder "${tasksFolder}". Cannot move task to avoid overwriting existing file.`);
                    }
                    
                    // Move the file
                    await this.plugin.app.fileManager.renameFile(file, newPath);
                    
                    // Update the file reference and task path
                    movedFile = this.plugin.app.vault.getAbstractFileByPath(newPath) as TFile;
                    updatedTask.path = newPath;
                    
                    // Clear old cache entry and update path in task object
                    this.plugin.cacheManager.clearCacheEntry(task.path);
                }
            } catch (moveError) {
                // If moving fails, show error but don't break the archive operation
                const errorMessage = moveError instanceof Error ? moveError.message : String(moveError);
                const operation = isCurrentlyArchived ? 'unarchiving' : 'archiving';
                console.error(`Error moving ${operation} task:`, errorMessage);
                new Notice(`Failed to move ${operation} task: ${errorMessage}`);
                // Continue with archive operation without moving the file
            }
        }
        
        // Step 3: Wait for fresh data and update cache
        try {
            // Wait for the metadata cache to have the updated data
            if (movedFile instanceof TFile && this.plugin.cacheManager.waitForFreshTaskData) {
                await this.plugin.cacheManager.waitForFreshTaskData(movedFile, { archived: updatedTask.archived });
            }
            await this.plugin.cacheManager.updateTaskInfoInCache(updatedTask.path, updatedTask);
        } catch (cacheError) {
            console.error('Error updating cache for archived task:', cacheError);
        }
        
        // Step 4: Notify system of change
        this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
            path: updatedTask.path,
            originalTask: task,
            updatedTask: updatedTask
        });
        
        // Trigger webhook for archive/unarchive
        if (this.webhookNotifier) {
            try {
                if (updatedTask.archived) {
                    await this.webhookNotifier.triggerWebhook('task.archived', { task: updatedTask });
                } else {
                    await this.webhookNotifier.triggerWebhook('task.unarchived', { task: updatedTask });
                }
            } catch (error) {
                console.warn('Failed to trigger webhook for task archive/unarchive:', error);
            }
        }
        
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

        // Step 3: Wait for fresh data and update cache
        try {
            // Wait for the metadata cache to have the updated time entries
            if (this.plugin.cacheManager.waitForFreshTaskData) {
                await this.plugin.cacheManager.waitForFreshTaskData(file, { timeEntries: updatedTask.timeEntries });
            }
            await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        } catch (cacheError) {
            console.error('Error updating cache for time tracking start:', cacheError);
        }
        
        // Step 4: Notify system of change
        this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
            path: task.path,
            originalTask: task,
            updatedTask: updatedTask
        });
        
        // Trigger webhook for time tracking start
        if (this.webhookNotifier) {
            try {
                await this.webhookNotifier.triggerWebhook('time.started', { 
                    task: updatedTask,
                    session: updatedTask.timeEntries?.[updatedTask.timeEntries.length - 1]
                });
            } catch (error) {
                console.warn('Failed to trigger webhook for time tracking start:', error);
            }
        }
        
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

        // Step 3: Wait for fresh data and update cache
        try {
            // Wait for the metadata cache to have the updated time entries
            if (this.plugin.cacheManager.waitForFreshTaskData) {
                await this.plugin.cacheManager.waitForFreshTaskData(file, { timeEntries: updatedTask.timeEntries });
            }
            await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        } catch (cacheError) {
            console.error('Error updating cache for time tracking stop:', cacheError);
        }
        
        // Step 4: Notify system of change
        this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
            path: task.path,
            originalTask: task,
            updatedTask: updatedTask
        });
        
        // Trigger webhook for time tracking stop
        if (this.webhookNotifier) {
            try {
                await this.webhookNotifier.triggerWebhook('time.stopped', { 
                    task: updatedTask,
                    session: updatedTask.timeEntries?.[updatedTask.timeEntries.length - 1]
                });
            } catch (error) {
                console.warn('Failed to trigger webhook for time tracking stop:', error);
            }
        }
        
        // Step 5: Return authoritative data
        return updatedTask;
    }

    /**
     * Update a task with multiple property changes following the deterministic data flow pattern
     * This is the centralized method for bulk task updates used by the TaskEditModal
     */
    async updateTask(originalTask: TaskInfo, updates: Partial<TaskInfo>): Promise<TaskInfo> {
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(originalTask.path);
            if (!(file instanceof TFile)) {
                throw new Error(`Cannot find task file: ${originalTask.path}`);
            }

            const isRenameNeeded = this.plugin.settings.storeTitleInFilename && updates.title && updates.title !== originalTask.title;
            let newPath = originalTask.path;

            if (isRenameNeeded) {
                const parentPath = file.parent ? file.parent.path : '';
                const newFilename = await generateUniqueFilename(updates.title!, parentPath, this.plugin.app.vault);
                newPath = parentPath ? `${parentPath}/${newFilename}.md` : `${newFilename}.md`;
            }

            // Check if recurrence rule changed and update scheduled date if needed
            let recurrenceUpdates: Partial<TaskInfo> = {};
            if (updates.recurrence !== undefined && updates.recurrence !== originalTask.recurrence) {
                // Recurrence rule changed, calculate new scheduled date
                const tempTask: TaskInfo = { ...originalTask, ...updates };
                const nextScheduledDate = updateToNextScheduledOccurrence(tempTask);
                if (nextScheduledDate) {
                    recurrenceUpdates.scheduled = nextScheduledDate;
                }
                
                // Add DTSTART to recurrence rule if it's missing (scenario 1: editing recurrence rule)
                if (typeof updates.recurrence === 'string' && updates.recurrence && !updates.recurrence.includes('DTSTART:')) {
                    const tempTaskWithRecurrence: TaskInfo = { ...originalTask, ...updates, ...recurrenceUpdates };
                    const updatedRecurrence = addDTSTARTToRecurrenceRule(tempTaskWithRecurrence);
                    if (updatedRecurrence) {
                        recurrenceUpdates.recurrence = updatedRecurrence;
                    }
                }
            } else if (updates.recurrence !== undefined && !originalTask.recurrence && updates.recurrence) {
                // Scenario 2: Converting non-recurring to recurring task
                if (typeof updates.recurrence === 'string' && !updates.recurrence.includes('DTSTART:')) {
                    const tempTask: TaskInfo = { ...originalTask, ...updates };
                    const updatedRecurrence = addDTSTARTToRecurrenceRule(tempTask);
                    if (updatedRecurrence) {
                        recurrenceUpdates.recurrence = updatedRecurrence;
                    }
                }
            }
            
            // Scenario 3: Scheduled date update for recurring tasks
            if (updates.scheduled !== undefined && updates.scheduled !== originalTask.scheduled && originalTask.recurrence) {
                if (typeof originalTask.recurrence === 'string' && !originalTask.recurrence.includes('DTSTART:')) {
                    const tempTask: TaskInfo = { ...originalTask, ...updates };
                    const updatedRecurrence = addDTSTARTToRecurrenceRule(tempTask);
                    if (updatedRecurrence) {
                        recurrenceUpdates.recurrence = updatedRecurrence;
                    }
                }
            }

            // Step 1: Persist frontmatter changes to the file at its original path
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                const completeTaskData: Partial<TaskInfo> = {
                    ...originalTask,
                    ...updates,
                    ...recurrenceUpdates,
                    dateModified: getCurrentTimestamp()
                };

                const mappedFrontmatter = this.plugin.fieldMapper.mapToFrontmatter(
                    completeTaskData,
                    this.plugin.settings.taskTag,
                    this.plugin.settings.storeTitleInFilename
                );

                Object.keys(mappedFrontmatter).forEach(key => {
                    if (mappedFrontmatter[key] !== undefined) {
                        frontmatter[key] = mappedFrontmatter[key];
                    }
                });

                if (updates.hasOwnProperty('due') && updates.due === undefined) delete frontmatter[this.plugin.fieldMapper.toUserField('due')];
                if (updates.hasOwnProperty('scheduled') && updates.scheduled === undefined) delete frontmatter[this.plugin.fieldMapper.toUserField('scheduled')];
                if (updates.hasOwnProperty('contexts') && updates.contexts === undefined) delete frontmatter[this.plugin.fieldMapper.toUserField('contexts')];
                if (updates.hasOwnProperty('timeEstimate') && updates.timeEstimate === undefined) delete frontmatter[this.plugin.fieldMapper.toUserField('timeEstimate')];
                if (updates.hasOwnProperty('points') && updates.points === undefined) delete frontmatter[this.plugin.fieldMapper.toUserField('points')];
                if (updates.hasOwnProperty('completedDate') && updates.completedDate === undefined) delete frontmatter[this.plugin.fieldMapper.toUserField('completedDate')];
                if (updates.hasOwnProperty('recurrence') && updates.recurrence === undefined) delete frontmatter[this.plugin.fieldMapper.toUserField('recurrence')];

                if (isRenameNeeded) {
                    delete frontmatter[this.plugin.fieldMapper.toUserField('title')];
                }

                if (updates.hasOwnProperty('tags')) {
                    frontmatter.tags = updates.tags;
                } else if (originalTask.tags) {
                    frontmatter.tags = originalTask.tags;
                }
            });

            // Step 2: Rename the file if needed, after frontmatter is updated
            if (isRenameNeeded) {
                await this.plugin.app.fileManager.renameFile(file, newPath);
            }

            // Step 3: Construct the final authoritative state
            const updatedTask: TaskInfo = {
                ...originalTask,
                ...updates,
                ...recurrenceUpdates,
                path: newPath,
                dateModified: getCurrentTimestamp()
            };

            if (updates.status !== undefined && !originalTask.recurrence) {
                if (this.plugin.statusManager.isCompletedStatus(updates.status)) {
                    if (!originalTask.completedDate) {
                        updatedTask.completedDate = getCurrentDateString();
                    }
                } else {
                    updatedTask.completedDate = undefined;
                }
            }

            // Step 4: Wait for fresh data and update cache
            if (isRenameNeeded) {
                this.plugin.cacheManager.clearCacheEntry(originalTask.path);
            }
            try {
                // Wait for the metadata cache to have the updated data
                const finalFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
                if (finalFile instanceof TFile && this.plugin.cacheManager.waitForFreshTaskData) {
                    // Wait for key changes to be reflected
                    const keyChanges: Partial<TaskInfo> = {};
                    if (updates.title !== undefined) keyChanges.title = updates.title;
                    if (updates.status !== undefined) keyChanges.status = updates.status;
                    if (updates.priority !== undefined) keyChanges.priority = updates.priority;
                    if (Object.keys(keyChanges).length > 0) {
                        await this.plugin.cacheManager.waitForFreshTaskData(finalFile, keyChanges);
                    }
                }
                await this.plugin.cacheManager.updateTaskInfoInCache(newPath, updatedTask);
            } catch (cacheError) {
                // Cache errors shouldn't break the operation, just log them
                console.error('Error updating task cache:', {
                    error: cacheError instanceof Error ? cacheError.message : String(cacheError),
                    taskPath: newPath
                });
            }

            // Step 5: Notify system of change
            try {
                this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
                    path: newPath,
                    originalTask: originalTask,
                    updatedTask: updatedTask
                });
            } catch (eventError) {
                console.error('Error emitting task update event:', {
                    error: eventError instanceof Error ? eventError.message : String(eventError),
                    taskPath: newPath
                });
                // Event emission errors shouldn't break the operation
            }

            // Trigger webhooks for task update/completion
            if (this.webhookNotifier) {
                try {
                    // Check if this was a completion
                    const wasCompleted = this.plugin.statusManager.isCompletedStatus(originalTask.status);
                    const isCompleted = this.plugin.statusManager.isCompletedStatus(updatedTask.status);
                    
                    if (!wasCompleted && isCompleted) {
                        // Task was completed
                        await this.webhookNotifier.triggerWebhook('task.completed', { task: updatedTask });
                    } else {
                        // Regular update
                        await this.webhookNotifier.triggerWebhook('task.updated', { 
                            task: updatedTask,
                            previous: originalTask 
                        });
                    }
                } catch (error) {
                    console.warn('Failed to trigger webhook for task update:', error);
                }
            }

            return updatedTask;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error updating task:', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                taskPath: originalTask.path,
                updates
            });
            
            throw new Error(`Failed to update task: ${errorMessage}`);
        }
    }

    /**
     * Delete a task file and remove it from all caches and indexes
     */
    async deleteTask(task: TaskInfo): Promise<void> {
        try {
            const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
            if (!(file instanceof TFile)) {
                throw new Error(`Cannot find task file: ${task.path}`);
            }

            // Step 1: Delete the file from the vault
            await this.plugin.app.vault.delete(file);

            // Step 2: Remove from cache and indexes (this will be done by the file delete event)
            // But we'll also do it proactively to ensure immediate UI updates
            this.plugin.cacheManager.clearCacheEntry(task.path);

            // Step 3: Emit task deleted event
            this.plugin.emitter.trigger(EVENT_TASK_DELETED, {
                path: task.path,
                deletedTask: task
            });

            // Trigger webhook for task deletion
            if (this.webhookNotifier) {
                try {
                    await this.webhookNotifier.triggerWebhook('task.deleted', { task });
                } catch (error) {
                    console.warn('Failed to trigger webhook for task deletion:', error);
                }
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error deleting task:', {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                taskPath: task.path
            });
            
            throw new Error(`Failed to delete task: ${errorMessage}`);
        }
    }

    /**
     * Toggle completion status for recurring tasks on a specific date
     */
    async toggleRecurringTaskComplete(task: TaskInfo, date?: Date): Promise<TaskInfo> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            throw new Error(`Cannot find task file: ${task.path}`);
        }

        // Get fresh task data to ensure we have the latest completion state
        const freshTask = await this.plugin.cacheManager.getTaskInfo(task.path) || task;
        
        if (!freshTask.recurrence) {
            throw new Error('Task is not recurring');
        }

        // Use the provided date or fall back to the currently selected date
        const targetDate = date || this.plugin.selectedDate;
        const dateStr = formatDateForStorage(targetDate);
        
        // Check current completion status for this date using fresh data
        const completeInstances = Array.isArray(freshTask.complete_instances) ? freshTask.complete_instances : [];
        const currentComplete = completeInstances.includes(dateStr);
        const newComplete = !currentComplete;
        
        // Step 1: Construct new state in memory using fresh data
        const updatedTask = { ...freshTask };
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

        // Add DTSTART to recurrence rule if it's missing (only when completing)
        if (newComplete && typeof updatedTask.recurrence === 'string' && !updatedTask.recurrence.includes('DTSTART:')) {
            const updatedRecurrence = addDTSTARTToRecurrenceRule(updatedTask);
            if (updatedRecurrence) {
                updatedTask.recurrence = updatedRecurrence;
            }
        }

        // Update scheduled date to next uncompleted occurrence
        const nextScheduledDate = updateToNextScheduledOccurrence(updatedTask);
        if (nextScheduledDate) {
            updatedTask.scheduled = nextScheduledDate;
        }
        
        // Step 2: Persist to file
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const completeInstancesField = this.plugin.fieldMapper.toUserField('completeInstances');
            const dateModifiedField = this.plugin.fieldMapper.toUserField('dateModified');
            const scheduledField = this.plugin.fieldMapper.toUserField('scheduled');
            const recurrenceField = this.plugin.fieldMapper.toUserField('recurrence');
            
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
            
            // Update recurrence field if it was updated with DTSTART
            if (updatedTask.recurrence !== freshTask.recurrence) {
                frontmatter[recurrenceField] = updatedTask.recurrence;
            }
            
            // Update scheduled date if it changed
            if (updatedTask.scheduled) {
                frontmatter[scheduledField] = updatedTask.scheduled;
            }
            
            frontmatter[dateModifiedField] = updatedTask.dateModified;
        });
        
        // Step 3: Wait for fresh data and update cache
        try {
            // Wait for the metadata cache to have the updated data
            if (this.plugin.cacheManager.waitForFreshTaskData) {
                const expectedChanges: Partial<TaskInfo> = {
                    complete_instances: updatedTask.complete_instances
                };
                if (updatedTask.scheduled !== freshTask.scheduled) {
                    expectedChanges.scheduled = updatedTask.scheduled;
                }
                await this.plugin.cacheManager.waitForFreshTaskData(file, expectedChanges);
            }
            await this.plugin.cacheManager.updateTaskInfoInCache(freshTask.path, updatedTask);
        } catch (cacheError) {
            console.error('Error updating cache for recurring task:', cacheError);
        }
        
        // Step 4: Notify system of change
        this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
            path: freshTask.path,
            originalTask: freshTask,
            updatedTask: updatedTask
        });
        
        // Step 5: Trigger webhook for recurring task completion
        if (newComplete && this.webhookNotifier) {
            try {
                await this.webhookNotifier.triggerWebhook('recurring.instance.completed', { 
                    task: updatedTask,
                    date: dateStr,
                    targetDate: targetDate
                });
            } catch (webhookError) {
                console.error('Error triggering recurring task completion webhook:', webhookError);
            }
        }
        
        // Step 6: Return authoritative data
        return updatedTask;
    }

    /**
     * Delete a specific time entry from a task
     */
    async deleteTimeEntry(task: TaskInfo, timeEntryIndex: number): Promise<TaskInfo> {
        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) {
            throw new Error(`Cannot find task file: ${task.path}`);
        }

        if (!task.timeEntries || !Array.isArray(task.timeEntries)) {
            throw new Error('Task has no time entries');
        }

        if (timeEntryIndex < 0 || timeEntryIndex >= task.timeEntries.length) {
            throw new Error('Invalid time entry index');
        }

        // Step 1: Construct new state in memory
        const updatedTask = { ...task };
        updatedTask.dateModified = getCurrentTimestamp();
        
        // Remove the time entry at the specified index
        updatedTask.timeEntries = task.timeEntries.filter((_, index) => index !== timeEntryIndex);

        // Step 2: Persist to file
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const timeEntriesField = this.plugin.fieldMapper.toUserField('timeEntries');
            const dateModifiedField = this.plugin.fieldMapper.toUserField('dateModified');
            
            if (frontmatter[timeEntriesField] && Array.isArray(frontmatter[timeEntriesField])) {
                // Remove the time entry at the specified index
                frontmatter[timeEntriesField] = frontmatter[timeEntriesField].filter((_: any, index: number) => index !== timeEntryIndex);
            }
            
            frontmatter[dateModifiedField] = updatedTask.dateModified;
        });

        // Step 3: Wait for fresh data and update cache
        try {
            // Wait for the metadata cache to have the updated time entries
            if (this.plugin.cacheManager.waitForFreshTaskData) {
                await this.plugin.cacheManager.waitForFreshTaskData(file, { timeEntries: updatedTask.timeEntries });
            }
            await this.plugin.cacheManager.updateTaskInfoInCache(task.path, updatedTask);
        } catch (cacheError) {
            console.error('Error updating cache for time entry deletion:', cacheError);
        }
        
        // Step 4: Notify system of change
        this.plugin.emitter.trigger(EVENT_TASK_UPDATED, {
            path: task.path,
            originalTask: task,
            updatedTask: updatedTask
        });
        
        // Step 5: Return authoritative data
        return updatedTask;
    }
    
    async reorderTasks(tasks: TaskInfo[], fromIndex: number, toIndex: number): Promise<TaskInfo[]> {
        try {
            if (fromIndex < 0 || fromIndex >= tasks.length || toIndex < 0 || toIndex >= tasks.length) {
                throw new Error("Invalid task indices for reordering");
            }

            const INITIAL_SPACING = 1000;
            const newOrders: number[] = tasks.map(t => t.sortOrder ?? NaN);
            // console.log("Prev order:\n" + tasks.map(t => `${t.sortOrder}: ${t.title}`).join("\n"));

            // --- Step 1: Lazily assign sortOrders without mutating tasks ---
            let lastSortOrder = 0;
            for (let i = 0; i < tasks.length; i++) {
                if (!Number.isFinite(newOrders[i])) {
                    const nextIndex = tasks.findIndex((t, idx) => idx > i && Number.isFinite(newOrders[idx]));
                    if (nextIndex !== -1) {
                        const nextVal = newOrders[nextIndex]!;
                        const span = nextVal - lastSortOrder;
                        const gapCount = (nextIndex - i) + 1;
                        for (let j = i; j < nextIndex; j++) {
                            newOrders[j] = lastSortOrder + (span * (j - (i - 1))) / gapCount;
                        }
                        lastSortOrder = nextVal;
                        i = nextIndex - 1; // skip ahead to the last initialized one
                    } else {
                        newOrders[i] = lastSortOrder + INITIAL_SPACING;
                        lastSortOrder = newOrders[i];
                    }
                } else {
                    lastSortOrder = newOrders[i];
                }
            }

            // --- Step 2: Move the task in the array (and reorder the newOrders array to match) ---
            const [movedTask] = tasks.splice(fromIndex, 1);
            const [movedOrder] = newOrders.splice(fromIndex, 1);
            tasks.splice(toIndex, 0, movedTask);
            newOrders.splice(toIndex, 0, movedOrder);

            // --- Step 3: Compute new sortOrder for the moved task ---
            const prevOrder = newOrders[toIndex - 1];
            const nextOrder = newOrders[toIndex + 1];
            if (prevOrder !== undefined && nextOrder !== undefined) {
                newOrders[toIndex] = (prevOrder + nextOrder) / 2;
            } else if (prevOrder === undefined && nextOrder !== undefined) {
                newOrders[toIndex] = nextOrder - INITIAL_SPACING;
            } else if (prevOrder !== undefined && nextOrder === undefined) {
                newOrders[toIndex] = prevOrder + INITIAL_SPACING;
            } else {
                newOrders[toIndex] = 0; // only task in list
            }

            // --- Step 4: Renormalize if any gaps are too small ---
            const MIN_GAP = 1e-4;
            let needsRenormalization = false;
            for (let i = 1; i < newOrders.length; i++) {
                if ((newOrders[i] - newOrders[i - 1]) < MIN_GAP) {
                    needsRenormalization = true;
                    break;
                }
            }

            if (needsRenormalization) {
                for (let i = 0; i < newOrders.length; i++) {
                    newOrders[i] = i * INITIAL_SPACING;
                }
            }

            // --- Step 5: Persist only changed sortOrders ---
            const updates = tasks.map((task, idx) => {
                if (task.sortOrder !== newOrders[idx]) {
                    return this.updateProperty(task, "sortOrder", newOrders[idx]);
                }
                return Promise.resolve(task);
            });

            const updatedTasks = await Promise.all(updates);
            // console.log("New order:\n" + updatedTasks.map(t => `${t.sortOrder}: ${t.title}`).join("\n"));

            return updatedTasks;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Error reordering tasks:", {
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
                tasks,
                fromIndex,
                toIndex
            });
            throw new Error(`Failed to reorder tasks: ${errorMessage}`);
        }
    }


}
