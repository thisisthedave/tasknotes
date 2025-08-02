import { Editor, TFile, Notice, EditorPosition } from 'obsidian';
import TaskNotesPlugin from '../main';
import { TasksPluginParser, ParsedTaskData } from '../utils/TasksPluginParser';
import { NaturalLanguageParser } from './NaturalLanguageParser';
import { TaskCreationData } from '../types';
import { getCurrentTimestamp, combineDateAndTime } from '../utils/dateUtils';
import { calculateDefaultDate } from '../utils/helpers';
import { StatusManager } from './StatusManager';
import { PriorityManager } from './PriorityManager';
import { dispatchTaskUpdate } from '../editor/TaskLinkOverlay';

export class InstantTaskConvertService {
    private plugin: TaskNotesPlugin;
    private statusManager: StatusManager;
    private priorityManager: PriorityManager;
    private nlParser: NaturalLanguageParser;

    constructor(
        plugin: TaskNotesPlugin,
        statusManager: StatusManager,
        priorityManager: PriorityManager
    ) {
        this.plugin = plugin;
        this.statusManager = statusManager;
        this.priorityManager = priorityManager;
        this.nlParser = new NaturalLanguageParser(
            plugin.settings.customStatuses,
            plugin.settings.customPriorities,
            plugin.settings.nlpDefaultToScheduled
        );
    }

    /**
     * Batch convert all checkbox tasks in the current note to TaskNotes (optimized version)
     */
    async batchConvertAllTasks(editor: Editor): Promise<void> {
        try {
            // Find all checkbox tasks in the current note
            const checkboxTasks = this.findAllCheckboxTasks(editor);
            
            if (checkboxTasks.length === 0) {
                new Notice('No checkbox tasks found in the current note.');
                return;
            }
            
            new Notice(`Converting ${checkboxTasks.length} task${checkboxTasks.length === 1 ? '' : 's'}...`);
            
            // Batch process tasks for better performance
            const result = await this.batchConvertTasksOptimized(editor, checkboxTasks);
            
            // Show summary
            if (result.failures.length === 0) {
                new Notice(`✅ Successfully converted ${result.successCount} task${result.successCount === 1 ? '' : 's'} to TaskNotes!`);
            } else {
                let message = `Converted ${result.successCount} task${result.successCount === 1 ? '' : 's'}.`;
                if (result.failures.length > 0) {
                    message += ` ${result.failures.length} failed.`;
                }
                new Notice(message);
                
                // Log failures for debugging
                console.warn('Batch conversion failures:', result.failures);
            }
            
        } catch (error) {
            console.error('Error during batch task conversion:', error);
            new Notice('Failed to perform batch conversion. Please try again.');
        }
    }

    /**
     * Optimized batch conversion that processes tasks in parallel and minimizes editor operations
     */
    private async batchConvertTasksOptimized(
        editor: Editor, 
        checkboxTasks: Array<{ lineNumber: number; line: string }>
    ): Promise<{ successCount: number; failures: Array<{ lineNumber: number; error: string }> }> {
        const failures: Array<{ lineNumber: number; error: string }> = [];
        const taskFiles: Array<{ lineNumber: number; line: string; file: TFile; linkText: string }> = [];
        
        // Phase 1: Parse all tasks and create files in parallel
        const parsePromises = checkboxTasks.map(async (task) => {
            try {
                const parsedData = await this.parseTaskForBatch(task.line);
                if (!parsedData) {
                    throw new Error('Failed to parse task');
                }
                
                const file = await this.createTaskFile(parsedData);
                const linkText = this.generateLinkText(task.line, file);
                
                return { lineNumber: task.lineNumber, line: task.line, file, linkText };
            } catch (error) {
                failures.push({
                    lineNumber: task.lineNumber + 1,
                    error: error instanceof Error ? error.message : String(error)
                });
                return null;
            }
        });
        
        // Wait for all file creation operations to complete
        const results = await Promise.all(parsePromises);
        
        // Filter out failed operations
        for (const result of results) {
            if (result) {
                taskFiles.push(result);
            }
        }
        
        // Phase 2: Replace all task lines in a single editor operation
        if (taskFiles.length > 0) {
            this.replaceAllTaskLines(editor, taskFiles);
        }
        
        // Phase 3: Let the editor handle task link overlay rendering naturally
        // No manual overlay refresh needed - editor will detect the link changes automatically
        
        return { successCount: taskFiles.length, failures };
    }

    /**
     * Instantly convert a checkbox task to a TaskNote without showing the modal
     * Supports multi-line selection where additional lines become task details
     */
    async instantConvertTask(editor: Editor, lineNumber: number): Promise<void> {
        try {
            // Validate input parameters
            const validationResult = this.validateInputParameters(editor, lineNumber);
            if (!validationResult.isValid) {
                new Notice(validationResult.error || 'Invalid input parameters.');
                return;
            }

            // Check for multi-line selection and extract details
            const selectionInfo = this.extractSelectionInfo(editor, lineNumber);
            const currentLine = selectionInfo.taskLine;
            const details = selectionInfo.details;
            
            
            // Parse the current line for Tasks plugin format, with NLP fallback
            let parsedData: ParsedTaskData;
            
            const taskLineInfo = TasksPluginParser.parseTaskLine(currentLine);
            
            if (!taskLineInfo.isTaskLine) {
                // Line is not a checkbox task, but we can still convert it to a tasknote
                // Extract the line content as the task title, removing any leading list markers
                const taskTitle = this.extractLineContentAsTitle(currentLine);
                
                if (!taskTitle.trim()) {
                    new Notice('Current line is empty or contains no valid content.');
                    return;
                }
                
                // Try NLP parsing first if enabled for better metadata extraction
                if (this.plugin.settings.enableNaturalLanguageInput) {
                    const nlpResult = this.tryNLPFallback(taskTitle, details || '');
                    if (nlpResult) {
                        parsedData = nlpResult;
                    } else {
                        // Fallback to basic task data with just the title
                        parsedData = {
                            title: taskTitle,
                            isCompleted: false
                        };
                    }
                } else {
                    // Create basic task data with just the title
                    parsedData = {
                        title: taskTitle,
                        isCompleted: false
                    };
                }
            } else {
                // Line is a checkbox task, process normally
                if (taskLineInfo.error || !taskLineInfo.parsedData) {
                    new Notice(`Error parsing task: ${taskLineInfo.error || 'No data extracted'}`);
                    return;
                }
                
                // Check if Tasks plugin parsing was sufficient (has meaningful metadata)
                const hasMetadata = this.hasUsefulMetadata(taskLineInfo.parsedData);
                
                if (!hasMetadata && this.plugin.settings.enableNaturalLanguageInput) {
                    // Fallback to NLP if Tasks plugin parsing only extracted basic title
                    const nlpResult = this.tryNLPFallback(currentLine, details || '');
                    if (nlpResult) {
                        parsedData = nlpResult;
                    } else {
                        parsedData = taskLineInfo.parsedData;
                    }
                } else {
                    parsedData = taskLineInfo.parsedData;
                }
            }

            // Validate final parsed data before proceeding
            const taskValidation = this.validateTaskData(parsedData);
            if (!taskValidation.isValid) {
                new Notice(taskValidation.error || 'Invalid task data.');
                return;
            }

            // Create the task file with default settings and details
            const file = await this.createTaskFile(parsedData, details);
            
            // Replace the original line(s) with a link (includes race condition protection)
            const replaceResult = await this.replaceOriginalTaskLines(editor, selectionInfo, file, parsedData.title);
            
            if (!replaceResult.success) {
                new Notice(replaceResult.error || 'Failed to replace task line.');
                // Clean up the created file since replacement failed
                try {
                    await this.plugin.app.vault.delete(file);
                } catch (cleanupError) {
                    console.warn('Failed to clean up created file after replacement failure:', cleanupError);
                }
                return;
            }
            
            new Notice(`Task converted: ${parsedData.title}`);
            
            // Trigger immediate refresh of task link overlays to show the inline widget
            await this.refreshTaskLinkOverlays(editor, file);
            
        } catch (error) {
            console.error('Error during instant task conversion:', error);
            if (error.message.includes('file already exists')) {
                new Notice('A file with this name already exists. Please try again or rename the task.');
            } else if (error.message.includes('invalid characters')) {
                new Notice('Task title contains invalid characters for filename.');
            } else {
                new Notice('Failed to convert task. Please try again.');
            }
        }
    }

    /**
     * Extract selection information including task line and details from additional lines
     */
    private extractSelectionInfo(editor: Editor, lineNumber: number): { taskLine: string; details: string; startLine: number; endLine: number; originalContent: string[] } {
        const selection = editor.getSelection();
        
        // If there's a selection, check if the specified lineNumber is within it
        if (selection && selection.trim()) {
            const selectionRange = editor.listSelections()[0];
            const startLine = Math.min(selectionRange.anchor.line, selectionRange.head.line);
            const endLine = Math.max(selectionRange.anchor.line, selectionRange.head.line);
            
            // Only use selection if the specified lineNumber is within the selection range
            // This handles cases where instant convert button is clicked with an active selection
            if (lineNumber >= startLine && lineNumber <= endLine) {
                // Extract all lines in the selection
                const selectedLines: string[] = [];
                for (let i = startLine; i <= endLine; i++) {
                    selectedLines.push(editor.getLine(i));
                }
                
                // First line should be the task, rest become details
                const taskLine = selectedLines[0];
                const detailLines = selectedLines.slice(1);
                // Join without trimming to preserve indentation, but remove trailing whitespace only
                const details = detailLines.join('\n').trimEnd();
                
                return {
                    taskLine,
                    details,
                    startLine,
                    endLine,
                    originalContent: selectedLines
                };
            }
        }
        
        // No relevant selection, just use the specified line
        const taskLine = editor.getLine(lineNumber);
        return {
            taskLine,
            details: '',
            startLine: lineNumber,
            endLine: lineNumber,
            originalContent: [taskLine]
        };
    }

    /**
     * Validate input parameters for task conversion
     */
    private validateInputParameters(editor: Editor, lineNumber: number): { isValid: boolean; error?: string } {
        if (!editor) {
            return { isValid: false, error: 'Editor is not available.' };
        }

        const totalLines = editor.lineCount();
        if (lineNumber < 0 || lineNumber >= totalLines) {
            return { isValid: false, error: `Line number ${lineNumber} is out of bounds (0-${totalLines - 1}).` };
        }

        const line = editor.getLine(lineNumber);
        if (line === null || line === undefined) {
            return { isValid: false, error: `Cannot read line ${lineNumber}.` };
        }

        return { isValid: true };
    }

    /**
     * Validate parsed task data
     */
    private validateTaskData(parsedData: ParsedTaskData): { isValid: boolean; error?: string } {
        if (!parsedData.title || parsedData.title.trim().length === 0) {
            return { isValid: false, error: 'Task title cannot be empty.' };
        }

        if (parsedData.title.length > 200) {
            return { isValid: false, error: 'Task title is too long (max 200 characters).' };
        }

        // Validate against dangerous characters for file operations
        const basicDangerousChars = /[<>:"/\\|?*]/;
        const hasControlChars = parsedData.title.split('').some(char => {
            const code = char.charCodeAt(0);
            return code <= 31 || code === 127;
        });
        
        if (basicDangerousChars.test(parsedData.title) || hasControlChars) {
            return { isValid: false, error: 'Task title contains invalid characters for file operations.' };
        }

        // Validate date formats if present
        const dateFields = ['dueDate', 'scheduledDate', 'startDate', 'createdDate', 'doneDate'];
        for (const field of dateFields) {
            const dateValue = parsedData[field as keyof ParsedTaskData] as string;
            if (dateValue && !this.isValidDateFormat(dateValue)) {
                return { isValid: false, error: `Invalid date format in ${field}: ${dateValue}` };
            }
        }

        return { isValid: true };
    }

    /**
     * Validate date format (YYYY-MM-DD)
     */
    private isValidDateFormat(dateString: string): boolean {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateString)) {
            return false;
        }

        const date = new Date(dateString);
        return date instanceof Date && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateString;
    }

    /**
     * Create a task file using default settings and parsed data
     */
    private async createTaskFile(parsedData: ParsedTaskData, details = ''): Promise<TFile> {
        // Sanitize and validate input data
        const title = this.sanitizeTitle(parsedData.title) || 'Untitled Task';
        
        // Capture parent note information (current active file)
        const currentFile = this.plugin.app.workspace.getActiveFile();
        const parentNote = currentFile ? this.plugin.app.fileManager.generateMarkdownLink(currentFile, currentFile.path) : '';
        
        // Parse due and scheduled dates from task (if present)
        const parsedDueDate = this.sanitizeDate(parsedData.dueDate);
        const parsedScheduledDate = this.sanitizeDate(parsedData.scheduledDate);
        
        // Extract time information
        const parsedDueTime = parsedData.dueTime?.trim() || undefined;
        const parsedScheduledTime = parsedData.scheduledTime?.trim() || undefined;
        
        // Apply task creation defaults if setting is enabled
        let priority: string | undefined;
        let status: string | undefined;
        let dueDate: string | undefined;
        let scheduledDate: string | undefined;
        let contextsArray: string[] = [];
        let tagsArray = [this.plugin.settings.taskTag];
        let timeEstimate: number | undefined;
        let points: number | undefined;
        let recurrence: import('../types').RecurrenceInfo | undefined;
        
        // Extract parsed tags, contexts, and projects
        const parsedTags = parsedData.tags || [];
        const parsedContexts = parsedData.contexts || [];
        const parsedProjects = parsedData.projects || [];

        if (this.plugin.settings.useDefaultsOnInstantConvert) {
            const defaults = this.plugin.settings.taskCreationDefaults;
            
            // Apply priority and status from parsed data or defaults
            priority = (parsedData.priority ? this.sanitizePriority(parsedData.priority) : '') || this.plugin.settings.defaultTaskPriority;
            status = (parsedData.status ? this.sanitizeStatus(parsedData.status) : '') || this.plugin.settings.defaultTaskStatus;
            
            // Apply due date: parsed date takes priority, then defaults
            if (parsedDueDate) {
                dueDate = parsedDueTime ? combineDateAndTime(parsedDueDate, parsedDueTime) : parsedDueDate;
            } else if (defaults.defaultDueDate !== 'none') {
                dueDate = calculateDefaultDate(defaults.defaultDueDate);
            }
            
            // Apply scheduled date: parsed date takes priority, then defaults
            if (parsedScheduledDate) {
                scheduledDate = parsedScheduledTime ? combineDateAndTime(parsedScheduledDate, parsedScheduledTime) : parsedScheduledDate;
            } else if (defaults.defaultScheduledDate !== 'none') {
                scheduledDate = calculateDefaultDate(defaults.defaultScheduledDate);
            }
            
            // Apply contexts: start with parsed contexts, then add default contexts
            contextsArray = [];
            if (parsedContexts.length > 0) {
                contextsArray.push(...parsedContexts);
            }
            if (defaults.defaultContexts) {
                const defaultContextsArray = defaults.defaultContexts.split(',').map(s => s.trim()).filter(s => s);
                contextsArray.push(...defaultContextsArray);
            }
            // Remove duplicates
            contextsArray = [...new Set(contextsArray)];
            
            // Apply tags: start with task tag, add parsed tags, then add default tags
            tagsArray = [this.plugin.settings.taskTag];
            if (parsedTags.length > 0) {
                tagsArray.push(...parsedTags);
            }
            if (defaults.defaultTags) {
                const defaultTagsArray = defaults.defaultTags.split(',').map(s => s.trim()).filter(s => s);
                tagsArray.push(...defaultTagsArray);
            }
            // Remove duplicates
            tagsArray = [...new Set(tagsArray)];
            
            // Apply time estimate
            if (defaults.defaultTimeEstimate && defaults.defaultTimeEstimate > 0) {
                timeEstimate = defaults.defaultTimeEstimate;
            }
            
            // Apply story points
            if (defaults.defaultPoints && defaults.defaultPoints > 0) {
                points = defaults.defaultPoints;
            }
            
            // Apply recurrence
            if (defaults.defaultRecurrence && defaults.defaultRecurrence !== 'none') {
                recurrence = {
                    frequency: defaults.defaultRecurrence
                };
            }
        } else {
            // Minimal behavior: only use parsed data, use "none" for unset values
            priority = (parsedData.priority ? this.sanitizePriority(parsedData.priority) : '') || 'none';
            status = (parsedData.status ? this.sanitizeStatus(parsedData.status) : '') || 'none';
            dueDate = parsedDueDate ? (parsedDueTime ? combineDateAndTime(parsedDueDate, parsedDueTime) : parsedDueDate) : undefined;
            scheduledDate = parsedScheduledDate ? (parsedScheduledTime ? combineDateAndTime(parsedScheduledDate, parsedScheduledTime) : parsedScheduledDate) : undefined;
            // Apply contexts: only use parsed contexts
            contextsArray = [];
            if (parsedContexts.length > 0) {
                contextsArray.push(...parsedContexts);
            }
            // Apply tags: start with task tag, add parsed tags
            tagsArray = [this.plugin.settings.taskTag];
            if (parsedTags.length > 0) {
                tagsArray.push(...parsedTags);
            }
            // Remove duplicates
            tagsArray = [...new Set(tagsArray)];
        }

        // Apply projects: handle default projects if enabled, otherwise just use parsed projects
        const projectsArray: string[] = [];
        
        // Apply default projects if defaults are enabled
        if (this.plugin.settings.useDefaultsOnInstantConvert) {
            const defaults = this.plugin.settings.taskCreationDefaults;
            if (defaults.defaultProjects) {
                const defaultProjectsArray = defaults.defaultProjects.split(',').map(s => s.trim()).filter(s => s);
                projectsArray.push(...defaultProjectsArray);
            }
        }
        
        // Add parsed projects
        if (parsedProjects.length > 0) {
            projectsArray.push(...parsedProjects);
        }
        
        // Remove duplicates
        const uniqueProjects = [...new Set(projectsArray)];

        // Create TaskCreationData object with all the data
        const taskData: TaskCreationData = {
            title: title,
            status: status,
            priority: priority,
            due: dueDate,
            scheduled: scheduledDate,
            contexts: contextsArray.length > 0 ? contextsArray : undefined,
            projects: uniqueProjects.length > 0 ? uniqueProjects : undefined,
            tags: tagsArray,
            timeEstimate: timeEstimate,
            recurrence: recurrence,
            details: details, // Use provided details from selection
            parentNote: parentNote, // Include parent note for template variable
            creationContext: 'inline-conversion', // Mark as inline conversion for folder logic
            dateCreated: getCurrentTimestamp(),
            dateModified: getCurrentTimestamp()
        };

        // Use the centralized task creation service
        const { file } = await this.plugin.taskService.createTask(taskData);

        return file;
    }

    /**
     * Sanitize title input
     */
    private sanitizeTitle(title: string): string {
        if (!title) return '';
        return title.trim().substring(0, 200);
    }

    /**
     * Sanitize priority input
     */
    private sanitizePriority(priority: string): string {
        const validPriorities = this.priorityManager.getAllPriorities()
            .map((p: any) => p && typeof p === 'object' ? p.value : p)
            .filter(value => value != null);
        return validPriorities.includes(priority) ? priority : '';
    }

    /**
     * Sanitize status input
     */
    private sanitizeStatus(status: string): string {
        const validStatuses = this.statusManager.getAllStatuses()
            .map((s: any) => s && typeof s === 'object' ? s.value : s)
            .filter(value => value != null);
        return validStatuses.includes(status) ? status : '';
    }

    /**
     * Sanitize date input
     */
    private sanitizeDate(dateString: string | undefined): string {
        if (!dateString || !this.isValidDateFormat(dateString)) {
            return '';
        }
        return dateString;
    }



    /**
     * Replace the original task lines (including multi-line selection) with a link to the new TaskNote
     */
    private async replaceOriginalTaskLines(
        editor: Editor, 
        selectionInfo: { taskLine: string; details: string; startLine: number; endLine: number; originalContent: string[] },
        file: TFile, 
        title: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Validate inputs
            if (!editor || !file) {
                return { success: false, error: 'Invalid editor or file reference.' };
            }

            const { startLine, endLine, originalContent } = selectionInfo;

            // Check if line numbers are still valid (race condition protection)
            const currentLineCount = editor.lineCount();
            if (startLine < 0 || endLine >= currentLineCount) {
                return { success: false, error: `Line range ${startLine}-${endLine} is no longer valid (current line count: ${currentLineCount}).` };
            }

            // Verify the content hasn't changed (race condition protection)
            for (let i = 0; i < originalContent.length; i++) {
                const currentLineContent = editor.getLine(startLine + i);
                if (currentLineContent !== originalContent[i]) {
                    return { success: false, error: 'Content has changed since parsing. Please try again.' };
                }
            }

            // Re-validate that the first line still has content (additional safety)
            const taskLineInfo = TasksPluginParser.parseTaskLine(originalContent[0]);
            const isCheckboxTask = taskLineInfo.isTaskLine;
            
            // For checkbox tasks, ensure it's still a valid task
            // For non-checkbox lines, just ensure there's still content
            if (isCheckboxTask && !taskLineInfo.isTaskLine) {
                return { success: false, error: 'First line is no longer a valid task.' };
            } else if (!isCheckboxTask && !this.extractLineContentAsTitle(originalContent[0]).trim()) {
                return { success: false, error: 'First line no longer contains valid content.' };
            }

            // Create link text preserving original format and indentation from the first line
            const originalIndentation = originalContent[0].match(/^(\s*)/)?.[1] || '';
            
            let listPrefix = '';
            if (isCheckboxTask) {
                // For checkbox tasks, preserve the list prefix without the checkbox
                const listPrefixMatch = originalContent[0].match(/^\s*((?:[-*+]|\d+\.)\s+)\[/);
                listPrefix = listPrefixMatch?.[1] || '- ';
            } else {
                // For non-checkbox lines, try to preserve existing list markers
                const bulletMatch = originalContent[0].match(/^\s*([-*+]\s+)/);
                const numberedMatch = originalContent[0].match(/^\s*(\d+\.\s+)/);
                const blockquoteMatch = originalContent[0].match(/^\s*(>\s*)/);
                
                if (bulletMatch) {
                    listPrefix = bulletMatch[1];
                } else if (numberedMatch) {
                    listPrefix = numberedMatch[1];
                } else if (blockquoteMatch) {
                    listPrefix = blockquoteMatch[1];
                } else {
                    listPrefix = '- '; // Default to bullet point
                }
            }
            
            // Get the current file context for relative link generation
            const currentFile = this.plugin.app.workspace.getActiveFile();
            const sourcePath = currentFile?.path || '';
            
            // Use Obsidian's generateMarkdownLink (respects user's link format settings)
            const properLink = this.plugin.app.fileManager.generateMarkdownLink(file, sourcePath);
            
            // Create the final line with proper indentation and original list format
            const linkText = `${originalIndentation}${listPrefix}${properLink}`;
            
            // Validate the generated link text
            if (linkText.length > 500) { // Reasonable limit for link text
                return { success: false, error: 'Generated link text is too long.' };
            }
            
            // Replace the entire selection with the link
            const rangeStart: EditorPosition = { line: startLine, ch: 0 };
            const rangeEnd: EditorPosition = { line: endLine, ch: editor.getLine(endLine).length };
            
            editor.replaceRange(linkText, rangeStart, rangeEnd);
            
            return { success: true };
            
        } catch (error) {
            console.error('Error replacing task lines:', error);
            return { success: false, error: `Failed to replace lines: ${error.message}` };
        }
    }

    /**
     * Refresh task link overlays to immediately show the inline widget for the newly created task
     */
    private async refreshTaskLinkOverlays(editor: Editor, taskFile: TFile): Promise<void> {
        try {
            // Force metadata cache to update for the new file
            // This ensures the cache has the latest task info before we trigger the overlay refresh
            await this.forceMetadataCacheUpdate(taskFile);
            
            // Small delay to allow the editor to process the line replacement and cache update
            setTimeout(() => {
                try {
                    // Access the CodeMirror instance from the editor
                    const cmEditor = (editor as any).cm;
                    if (cmEditor) {
                        // Preserve cursor position before dispatching update
                        const cursorPos = editor.getCursor();
                        
                        // Dispatch task update to trigger immediate refresh of task link overlays
                        dispatchTaskUpdate(cmEditor, taskFile.path);
                        
                        // Restore cursor position after a brief delay
                        setTimeout(() => {
                            try {
                                editor.setCursor(cursorPos);
                            } catch (error) {
                                console.debug('Error restoring cursor position:', error);
                            }
                        }, 10);
                    }
                } catch (error) {
                    console.debug('Error dispatching task update for overlays:', error);
                }
            }, 100);
        } catch (error) {
            console.debug('Error refreshing task link overlays:', error);
        }
    }

    /**
     * Force Obsidian's metadata cache to update for a newly created file
     */
    private async forceMetadataCacheUpdate(file: TFile): Promise<void> {
        try {
            // Read the file content to trigger metadata parsing
            await this.plugin.app.vault.cachedRead(file);
            
            // Force metadata cache to process the file
            // This is a workaround to ensure the cache is immediately updated
            if (this.plugin.app.metadataCache.getFileCache(file) === null) {
                // If cache is still null, trigger a manual update
                // by reading the file again with a small delay
                setTimeout(async () => {
                    try {
                        await this.plugin.app.vault.cachedRead(file);
                    } catch (error) {
                        console.debug('Error in delayed cache update:', error);
                    }
                }, 10);
            }
        } catch (error) {
            console.debug('Error forcing metadata cache update:', error);
        }
    }

    /**
     * Check if parsed data contains useful metadata beyond just the title
     */
    private hasUsefulMetadata(data: ParsedTaskData): boolean {
        return !!(
            data.dueDate ||
            data.scheduledDate ||
            data.startDate ||
            data.priority ||
            data.status ||
            data.recurrence ||
            data.createdDate ||
            data.doneDate ||
            (data.tags && data.tags.length > 0) ||
            (data.projects && data.projects.length > 0)
        );
    }

    /**
     * Attempt to parse the task using Natural Language Processing as a fallback
     */
    private tryNLPFallback(taskLine: string, details: string): ParsedTaskData | null {
        try {
            // Extract the task content (remove checkbox syntax)
            const taskContent = this.extractTaskContent(taskLine);
            if (!taskContent.trim()) {
                return null;
            }

            // Combine task line and details for NLP parsing
            const fullInput = details.trim().length > 0 
                ? `${taskContent}\n${details}`
                : taskContent;

            // Parse using NLP
            const nlpResult = this.nlParser.parseInput(fullInput);
            
            if (!nlpResult.title?.trim()) {
                return null;
            }

            // Convert NLP result to TasksPlugin ParsedTaskData format
            const parsedData: ParsedTaskData = {
                title: nlpResult.title.trim(),
                isCompleted: nlpResult.isCompleted || false,
                status: nlpResult.status,
                priority: nlpResult.priority,
                dueDate: nlpResult.dueDate,
                scheduledDate: nlpResult.scheduledDate,
                dueTime: nlpResult.dueTime,
                scheduledTime: nlpResult.scheduledTime,
                recurrence: nlpResult.recurrence,
                tags: nlpResult.tags && nlpResult.tags.length > 0 ? nlpResult.tags : undefined,
                projects: nlpResult.projects && nlpResult.projects.length > 0 ? nlpResult.projects : undefined,
                contexts: nlpResult.contexts && nlpResult.contexts.length > 0 ? nlpResult.contexts : undefined,
                // TasksPlugin specific fields that NLP doesn't have
                startDate: undefined,
                createdDate: undefined,
                doneDate: undefined,
                recurrenceData: undefined
            };

            return parsedData;
            
        } catch (error) {
            console.debug('NLP fallback parsing failed:', error);
            return null;
        }
    }

    /**
     * Extract task content from a checkbox line, removing the checkbox syntax
     */
    private extractTaskContent(line: string): string {
        // Remove checkbox markers like "- [ ]", "1. [ ]", etc.
        const cleanLine = line.replace(/^\s*(?:[-*+]|\d+\.)\s*\[[ xX]\]\s*/, '');
        return cleanLine.trim();
    }

    /**
     * Extract content from any line to use as a task title
     * This removes common list markers and prefixes while preserving the core content
     */
    private extractLineContentAsTitle(line: string): string {
        let cleanLine = line.trim();
        
        // Remove common list markers and bullet points
        cleanLine = cleanLine.replace(/^\s*[-*+]\s+/, ''); // Remove bullet points
        cleanLine = cleanLine.replace(/^\s*\d+\.\s+/, ''); // Remove numbered lists
        
        // Remove blockquote markers (for issue #262 - callouts support)
        // Handle multiple levels of blockquotes like "> > > text"
        while (cleanLine.match(/^\s*>\s*/)) {
            cleanLine = cleanLine.replace(/^\s*>\s*/, '');
        }
        
        // Remove markdown headers
        cleanLine = cleanLine.replace(/^\s*#+\s+/, '');
        
        // Remove horizontal rules (these lines shouldn't become tasks anyway)
        if (cleanLine.match(/^\s*(-{3,}|={3,})\s*$/)) {
            return '';
        }
        
        return cleanLine.trim();
    }

    /**
     * Find all checkbox tasks in the current note
     * Returns an array of tasks with their line numbers
     */
    private findAllCheckboxTasks(editor: Editor): Array<{ lineNumber: number; line: string }> {
        const tasks: Array<{ lineNumber: number; line: string }> = [];
        const totalLines = editor.lineCount();
        
        for (let lineNumber = 0; lineNumber < totalLines; lineNumber++) {
            const line = editor.getLine(lineNumber);
            
            // Check if this line is a checkbox task directly
            const taskLineInfo = TasksPluginParser.parseTaskLine(line);
            if (taskLineInfo.isTaskLine) {
                tasks.push({ lineNumber, line });
                continue;
            }
            
            // Also check if it's a checkbox task inside blockquotes (like "> - [ ] task")
            // This uses the same logic as the main conversion method
            if (line.trim().includes('[ ]') || line.trim().includes('[x]') || line.trim().includes('[X]')) {
                // Remove blockquote markers and try parsing again
                let cleanLine = line.trim();
                while (cleanLine.match(/^\s*>\s*/)) {
                    cleanLine = cleanLine.replace(/^\s*>\s*/, '');
                }
                
                const cleanedTaskLineInfo = TasksPluginParser.parseTaskLine(cleanLine);
                if (cleanedTaskLineInfo.isTaskLine) {
                    tasks.push({ lineNumber, line });
                }
            }
        }
        
        return tasks;
    }

    /**
     * Parse a task line for batch processing (simplified version of the main parsing logic)
     */
    private async parseTaskForBatch(line: string): Promise<ParsedTaskData | null> {
        try {
            const taskLineInfo = TasksPluginParser.parseTaskLine(line);
            
            if (!taskLineInfo.isTaskLine) {
                // Handle non-checkbox lines (like blockquoted tasks)
                const taskTitle = this.extractLineContentAsTitle(line);
                if (!taskTitle.trim()) {
                    return null;
                }
                
                if (this.plugin.settings.enableNaturalLanguageInput) {
                    const nlpResult = this.tryNLPFallback(taskTitle, '');
                    if (nlpResult) {
                        return nlpResult;
                    }
                }
                
                return { title: taskTitle, isCompleted: false };
            } else {
                if (taskLineInfo.error || !taskLineInfo.parsedData) {
                    return null;
                }
                
                const hasMetadata = this.hasUsefulMetadata(taskLineInfo.parsedData);
                if (!hasMetadata && this.plugin.settings.enableNaturalLanguageInput) {
                    const nlpResult = this.tryNLPFallback(line, '');
                    if (nlpResult) {
                        return nlpResult;
                    }
                }
                
                return taskLineInfo.parsedData;
            }
        } catch (error) {
            console.warn('Error parsing task for batch:', error);
            return null;
        }
    }

    /**
     * Generate link text for a task line replacement
     */
    private generateLinkText(originalLine: string, file: TFile): string {
        const originalIndentation = originalLine.match(/^(\s*)/)?.[1] || '';
        
        // Determine if this was a checkbox task
        const taskLineInfo = TasksPluginParser.parseTaskLine(originalLine);
        const isCheckboxTask = taskLineInfo.isTaskLine;
        
        let listPrefix = '';
        if (isCheckboxTask) {
            const listPrefixMatch = originalLine.match(/^\s*((?:[-*+]|\d+\.)\s+)\[/);
            listPrefix = listPrefixMatch?.[1] || '- ';
        } else {
            // For non-checkbox lines, preserve existing markers
            const bulletMatch = originalLine.match(/^\s*([-*+]\s+)/);
            const numberedMatch = originalLine.match(/^\s*(\d+\.\s+)/);
            const blockquoteMatch = originalLine.match(/^\s*(>\s*)/);
            
            if (bulletMatch) {
                listPrefix = bulletMatch[1];
            } else if (numberedMatch) {
                listPrefix = numberedMatch[1];
            } else if (blockquoteMatch) {
                listPrefix = blockquoteMatch[1];
            } else {
                listPrefix = '- ';
            }
        }
        
        const currentFile = this.plugin.app.workspace.getActiveFile();
        const sourcePath = currentFile?.path || '';
        const properLink = this.plugin.app.fileManager.generateMarkdownLink(file, sourcePath);
        
        return `${originalIndentation}${listPrefix}${properLink}`;
    }

    /**
     * Replace all task lines in a single editor operation for better performance
     */
    private replaceAllTaskLines(
        editor: Editor, 
        taskFiles: Array<{ lineNumber: number; line: string; file: TFile; linkText: string }>
    ): void {
        // Sort by line number in descending order to avoid line number shifts
        const sortedTasks = taskFiles.sort((a, b) => b.lineNumber - a.lineNumber);
        
        // Process all replacements
        for (const task of sortedTasks) {
            const lineLength = editor.getLine(task.lineNumber).length;
            editor.replaceRange(
                task.linkText,
                { line: task.lineNumber, ch: 0 },
                { line: task.lineNumber, ch: lineLength }
            );
        }
    }

}