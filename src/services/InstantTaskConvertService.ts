import { Editor, TFile, Notice } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import TaskNotesPlugin from '../main';
import { TasksPluginParser, ParsedTaskData } from '../utils/TasksPluginParser';
import { generateTaskFilename, generateUniqueFilename, FilenameContext } from '../utils/filenameGenerator';
import { ensureFolderExists } from '../utils/helpers';
import { TaskFrontmatter, TaskInfo, EVENT_TASK_UPDATED } from '../types';

export class InstantTaskConvertService {
    private plugin: TaskNotesPlugin;

    constructor(plugin: TaskNotesPlugin) {
        this.plugin = plugin;
    }

    /**
     * Instantly convert a checkbox task to a TaskNote without showing the modal
     */
    async instantConvertTask(editor: Editor, lineNumber: number): Promise<void> {
        try {
            const currentLine = editor.getLine(lineNumber);
            
            // Parse the current line for Tasks plugin format
            const taskLineInfo = TasksPluginParser.parseTaskLine(currentLine);
            
            if (!taskLineInfo.isTaskLine) {
                new Notice('Current line is not a task.');
                return;
            }
            
            if (taskLineInfo.error) {
                new Notice(`Error parsing task: ${taskLineInfo.error}`);
                return;
            }
            
            if (!taskLineInfo.parsedData) {
                new Notice('Failed to parse task data from current line.');
                return;
            }

            // Create the task file with default settings
            const file = await this.createTaskFile(taskLineInfo.parsedData);
            
            // Replace the original line with a link
            await this.replaceOriginalTaskLine(editor, lineNumber, file, taskLineInfo.parsedData.title);
            
            new Notice(`Task converted: ${taskLineInfo.parsedData.title}`);
            
        } catch (error) {
            console.error('Error during instant task conversion:', error);
            new Notice('Failed to convert task. Please try again.');
        }
    }

    /**
     * Create a task file using default settings and parsed data
     */
    private async createTaskFile(parsedData: ParsedTaskData): Promise<TFile> {
        // Use default values where parsed data is missing
        const title = parsedData.title || 'Untitled Task';
        const priority = parsedData.priority || this.plugin.settings.defaultTaskPriority;
        const status = parsedData.status || this.plugin.settings.defaultTaskStatus;
        const dueDate = parsedData.dueDate || '';
        const scheduledDate = parsedData.scheduledDate || '';
        
        // Prepare contexts and tags arrays
        const contextsArray: string[] = [];
        const tagsArray = [this.plugin.settings.taskTag];

        // Generate filename
        const filenameContext: FilenameContext = {
            title: title,
            priority: priority,
            status: status,
            date: new Date()
        };

        const baseFilename = generateTaskFilename(filenameContext, this.plugin.settings);
        const folder = this.plugin.settings.tasksFolder || '';
        
        // Ensure folder exists
        if (folder) {
            await ensureFolderExists(this.plugin.app.vault, folder);
        }
        
        // Generate unique filename
        const uniqueFilename = await generateUniqueFilename(baseFilename, folder, this.plugin.app.vault);
        const fullPath = folder ? `${folder}/${uniqueFilename}.md` : `${uniqueFilename}.md`;

        // Create TaskInfo object with all the data
        const taskData: Partial<TaskInfo> = {
            title: title,
            status: status,
            priority: priority,
            due: dueDate || undefined,
            scheduled: scheduledDate || undefined,
            contexts: contextsArray.length > 0 ? contextsArray : undefined,
            dateCreated: new Date().toISOString(),
            dateModified: new Date().toISOString()
        };

        // Create frontmatter
        const frontmatter: TaskFrontmatter = {
            title: title,
            dateCreated: new Date().toISOString(),
            dateModified: new Date().toISOString(),
            status: status as 'open' | 'in-progress' | 'done',
            priority: priority as 'low' | 'normal' | 'high',
            tags: tagsArray,
            due: dueDate || undefined,
            scheduled: scheduledDate || undefined,
            contexts: contextsArray.length > 0 ? contextsArray : undefined
        };

        // Create file content
        const yamlContent = YAML.stringify(frontmatter);
        const fileContent = `---\n${yamlContent}---\n\n# ${title}\n\n<!-- Add task details below -->\n`;

        // Create the file
        const file = await this.plugin.app.vault.create(fullPath, fileContent);

        // Emit task updated event
        this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
            path: file.path,
            originalTask: null,
            updatedTask: taskData
        });

        return file;
    }

    /**
     * Replace the original Tasks Plugin line with a link to the new TaskNote
     */
    private async replaceOriginalTaskLine(editor: Editor, lineNumber: number, file: TFile, title: string): Promise<void> {
        // Create link text with hyphen prefix
        const linkText = `- [[${file.path}|${title}]]`;
        
        // Replace the entire line with the link
        const lineStart = { line: lineNumber, ch: 0 };
        const lineEnd = { line: lineNumber, ch: editor.getLine(lineNumber).length };
        
        editor.replaceRange(linkText, lineStart, lineEnd);
    }
}