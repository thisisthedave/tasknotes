import { App, Notice, TFile, Setting, Editor, MarkdownView } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import TaskNotesPlugin from '../main';
import { BaseTaskModal } from './BaseTaskModal';
import { ensureFolderExists } from '../utils/helpers';
import { generateTaskFilename, generateUniqueFilename, FilenameContext } from '../utils/filenameGenerator';
import { CALENDAR_VIEW_TYPE, TaskFrontmatter, TaskInfo, TimeEntry, EVENT_TASK_UPDATED } from '../types';
import { ParsedTaskData } from '../utils/TasksPluginParser';

export interface TaskConversionOptions {
	parsedData?: ParsedTaskData;
	editor?: Editor;
	lineNumber?: number;
}

export class TaskCreationModal extends BaseTaskModal {
	details: string = '';
	
	// UI elements for filename preview
	private filenamePreview: HTMLElement | null = null;
	private dueDateInput: HTMLInputElement | null = null;

	// Task conversion options
	private conversionOptions: TaskConversionOptions;
  
	constructor(app: App, plugin: TaskNotesPlugin, conversionOptions?: TaskConversionOptions) {
		super(app, plugin);
		this.conversionOptions = conversionOptions || {};
	}

	protected initializeFormData(): void {
		// Check if we have parsed data to pre-populate
		if (this.conversionOptions.parsedData) {
			this.populateFromParsedData(this.conversionOptions.parsedData);
		} else {
			// Initialize with default values
			this.priority = this.plugin.settings.defaultTaskPriority;
			this.status = this.plugin.settings.defaultTaskStatus;
			
			// Pre-populate due date with selected date from calendar or today
			const selectedDate = this.plugin.selectedDate || new Date();
			this.dueDate = format(selectedDate, 'yyyy-MM-dd');
			
			// Initialize scheduled date as empty by default
			this.scheduledDate = '';
		}
	}

	private populateFromParsedData(data: ParsedTaskData): void {
		// Reset all fields to ensure clean state for this conversion
		this.title = data.title || '';
		this.priority = data.priority || this.plugin.settings.defaultTaskPriority;
		this.status = data.status || this.plugin.settings.defaultTaskStatus;
		this.dueDate = data.dueDate || ''; // Always reset due date
		this.scheduledDate = ''; // Always reset scheduled date for converted tasks
		this.details = ''; // Reset details too
		
		// Update input field if it exists
		if (this.dueDateInput) {
			this.dueDateInput.value = this.dueDate;
		}
		
		// Set other optional fields if available
		if (data.scheduledDate) {
			// Note: TaskNotes doesn't have scheduled date, but we could use start date
			// or add it to details
			this.details = `Scheduled: ${data.scheduledDate}\n${this.details}`.trim();
		}
		
		if (data.startDate) {
			// Note: TaskNotes doesn't have start date, add to details
			this.details = `Start: ${data.startDate}\n${this.details}`.trim();
		}
		
		if (data.createdDate) {
			this.details = `Originally created: ${data.createdDate}\n${this.details}`.trim();
		}
		
		if (data.doneDate) {
			this.details = `Completed on: ${data.doneDate}\n${this.details}`.trim();
		}
		
		// Handle recurrence
		if (data.recurrence && data.recurrence !== 'none') {
			// Map parsed recurrence to valid BaseTaskModal types
			const validRecurrenceTypes: ('none' | 'daily' | 'weekly' | 'monthly' | 'yearly')[] = 
				['none', 'daily', 'weekly', 'monthly', 'yearly'];
			
			if (validRecurrenceTypes.includes(data.recurrence as any)) {
				this.recurrence = data.recurrence as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
			} else {
				// For custom recurrence patterns, add to details instead
				this.details = `Recurrence: ${data.recurrence}\n${this.details}`.trim();
			}
			
			if (data.recurrenceData) {
				if (data.recurrenceData.days_of_week) {
					this.daysOfWeek = data.recurrenceData.days_of_week;
				}
				if (data.recurrenceData.day_of_month) {
					this.dayOfMonth = data.recurrenceData.day_of_month.toString();
				}
				if (data.recurrenceData.month_of_year) {
					this.monthOfYear = data.recurrenceData.month_of_year.toString();
				}
			}
		}
	}

	private async cacheAutocompleteData(): Promise<void> {
		try {
			this.existingContexts = await this.getExistingContexts();
			this.existingTags = await this.getExistingTags();
		} catch (error) {
			console.error('Error caching autocomplete data:', error);
		}
	}
  
	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('task-creation-modal');
		new Setting(contentEl)
			.setName('Create new task')
			.setHeading();

		// Initialize form data
		this.initializeFormData();

		// Cache autocomplete data
		this.cacheAutocompleteData();
		
		// Title with character count and filename preview updates
		this.createFormGroup(contentEl, 'Title', (container) => {
			const inputContainer = container.createDiv({ cls: 'input-with-counter' });
			const input = inputContainer.createEl('input', { 
				type: 'text',
				cls: 'form-input title-input',
				attr: { 
					placeholder: 'Enter task title...',
					maxlength: '200'
				}
			});
			const counter = inputContainer.createDiv({ 
				cls: 'character-counter',
				text: '0/200'
			});
			
			// Set initial value if pre-populated
			if (this.title) {
				input.value = this.title;
				this.updateCharCounter(counter, this.title.length, 200);
				this.updateFilenamePreview();
			}
			
			input.addEventListener('input', (e) => {
				const value = (e.target as HTMLInputElement).value;
				this.title = value;
				this.updateCharCounter(counter, value.length, 200);
				this.updateFilenamePreview();
			});
			
			// Auto-focus on the title field
			setTimeout(() => input.focus(), 50);
		});
		
		// Filename preview
		this.createFormGroup(contentEl, 'Filename preview', (container) => {
			this.filenamePreview = container.createDiv({ 
				cls: 'filename-preview',
				text: 'Enter a title to see filename preview...'
			});
		});
		
		// Details
		this.createFormGroup(contentEl, 'Details', (container) => {
			const textarea = container.createEl('textarea', {
				cls: 'form-input',
				attr: { 
					placeholder: 'Optional details or description...',
					rows: '3'
				}
			});
			
			// Set initial value if pre-populated
			if (this.details) {
				textarea.value = this.details;
			}
			
			textarea.addEventListener('input', (e) => {
				this.details = (e.target as HTMLTextAreaElement).value;
			});
		});
		
		// Due Date
		this.createFormGroup(contentEl, 'Due date', (container) => {
			this.createDueDateInputWithRef(container);
		});
		
		// Scheduled Date
		this.createFormGroup(contentEl, 'Scheduled date', (container) => {
			this.createScheduledDateInput(container);
		});
		
		// Priority
		this.createFormGroup(contentEl, 'Priority', (container) => {
			this.createPriorityDropdown(container);
			// Add filename preview update listener
			const select = container.querySelector('select');
			if (select) {
				select.addEventListener('change', () => {
					this.updateFilenamePreview();
				});
			}
		});
		
		// Status
		this.createFormGroup(contentEl, 'Status', (container) => {
			this.createStatusDropdown(container);
			// Add filename preview update listener
			const select = container.querySelector('select');
			if (select) {
				select.addEventListener('change', () => {
					this.updateFilenamePreview();
				});
			}
		});
		
		// Contexts with autocomplete
		this.createFormGroup(contentEl, 'Contexts', (container) => {
			this.createAutocompleteInput(
				container,
				'contexts',
				() => this.existingContexts,
				(value) => { this.contexts = value; }
			);
		});
		
		// Tags with autocomplete
		this.createFormGroup(contentEl, 'Tags', (container) => {
			this.createAutocompleteInput(
				container,
				'tags',
				() => this.existingTags,
				(value) => { this.tags = value; }
			);
		});
		
		// Time Estimate
		this.createFormGroup(contentEl, 'Time estimate', (container) => {
			this.createTimeEstimateInput(container);
		});
		
		// Recurrence
		this.createFormGroup(contentEl, 'Recurrence', (container) => {
			this.createRecurrenceDropdown(container);
		});
		
		// Action buttons
		this.createActionButtons(contentEl);
		
		// Keyboard shortcuts
		contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				this.close();
			} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.createTask();
			}
		});
	}

	protected createActionButtons(container: HTMLElement): void {
		const buttonContainer = container.createDiv({ cls: 'button-container' });
		
		const createButton = buttonContainer.createEl('button', { 
			text: 'Create task', 
			cls: 'create-button' 
		});
		createButton.addEventListener('click', () => {
			this.createTask();
		});
		
		const cancelButton = buttonContainer.createEl('button', { 
			text: 'Cancel', 
			cls: 'cancel-button' 
		});
		cancelButton.addEventListener('click', () => {
			this.close();
		});
	}

	protected async handleSubmit(): Promise<void> {
		await this.createTask();
	}

	private updateFilenamePreview() {
		if (!this.filenamePreview) return;
		
		if (!this.title || !this.title.trim()) {
			this.filenamePreview.textContent = 'Enter a title to see filename preview...';
			this.filenamePreview.className = 'filename-preview';
			return;
		}
		
		try {
			const filenameContext: FilenameContext = {
				title: this.title,
				priority: this.priority,
				status: this.status,
				date: new Date()
			};
			
			const filename = generateTaskFilename(filenameContext, this.plugin.settings);
			this.filenamePreview.textContent = `${filename}.md`;
			this.filenamePreview.className = 'filename-preview filename-preview-valid';
		} catch (error) {
			this.filenamePreview.textContent = 'Error generating filename preview';
			this.filenamePreview.className = 'filename-preview filename-preview-error';
		}
	}

	async createTask() {
		if (!await this.validateAndPrepareTask()) {
			return;
		}

		try {
			const file = await this.performTaskCreation();
			
			// If this is a conversion, replace the original line with a link
			if (this.conversionOptions.editor && this.conversionOptions.lineNumber !== undefined) {
				await this.replaceOriginalTaskLine(file);
			}
			
			new Notice(`Task created: ${this.title}`);
			this.close();
		} catch (error) {
			console.error('Failed to create task:', error);
			new Notice('Failed to create task. Please try again.');
		}
	}

	/**
	 * Replace the original Tasks Plugin line with a link to the new TaskNote
	 */
	private async replaceOriginalTaskLine(file: TFile): Promise<void> {
		if (!this.conversionOptions.editor || this.conversionOptions.lineNumber === undefined) {
			return;
		}

		const editor = this.conversionOptions.editor;
		const lineNumber = this.conversionOptions.lineNumber;
		
		// Create link text with hyphen prefix
		const linkText = `- [[${file.path}|${this.title}]]`;
		
		// Replace the entire line with the link
		const lineStart = { line: lineNumber, ch: 0 };
		const lineEnd = { line: lineNumber, ch: editor.getLine(lineNumber).length };
		
		editor.replaceRange(linkText, lineStart, lineEnd);
	}

	/**
	 * Validate form and prepare for task creation
	 */
	private async validateAndPrepareTask(): Promise<boolean> {
		// Validate required fields
		if (!this.title || !this.title.trim()) {
			new Notice('Title is required');
			return false;
		}

		if (this.title.length > 200) {
			new Notice('Title is too long (max 200 characters)');
			return false;
		}

		// Validate recurrence fields
		if (this.recurrence === 'weekly' && this.daysOfWeek.length === 0) {
			new Notice('Please select at least one day for weekly recurrence');
			return false;
		}

		if (this.recurrence === 'monthly' && (!this.dayOfMonth || parseInt(this.dayOfMonth) < 1 || parseInt(this.dayOfMonth) > 31)) {
			new Notice('Please enter a valid day of month (1-31)');
			return false;
		}

		if (this.recurrence === 'yearly') {
			if (!this.monthOfYear || !this.dayOfMonth) {
				new Notice('Please select month and day for yearly recurrence');
				return false;
			}
			if (parseInt(this.dayOfMonth) < 1 || parseInt(this.dayOfMonth) > 31) {
				new Notice('Please enter a valid day of month (1-31)');
				return false;
			}
		}

		return true;
	}

	/**
	 * Perform the actual task creation
	 */
	private async performTaskCreation(): Promise<TFile> {
		// Prepare contexts and tags arrays
		const contextsArray = this.contexts ? this.contexts.split(',').map(c => c.trim()).filter(c => c) : [];
		const tagsArray = this.tags ? this.tags.split(',').map(t => t.trim()).filter(t => t) : [];
		
		// Add task tag
		tagsArray.unshift(this.plugin.settings.taskTag);

		// Generate filename
		const filenameContext: FilenameContext = {
			title: this.title,
			priority: this.priority,
			status: this.status,
			date: new Date()
		};

		const baseFilename = generateTaskFilename(filenameContext, this.plugin.settings);
		const folder = this.plugin.settings.tasksFolder || '';
		
		// Ensure folder exists
		if (folder) {
			await ensureFolderExists(this.app.vault, folder);
		}
		
		// Generate unique filename
		const uniqueFilename = await generateUniqueFilename(baseFilename, folder, this.app.vault);
		const fullPath = folder ? `${folder}/${uniqueFilename}.md` : `${uniqueFilename}.md`;

		// Create TaskInfo object with all the data
		const taskData: Partial<TaskInfo> = {
			title: this.title,
			status: this.status,
			priority: this.priority,
			due: this.dueDate || undefined,
			scheduled: this.scheduledDate || undefined,
			contexts: contextsArray.length > 0 ? contextsArray : undefined,
			timeEstimate: this.timeEstimate > 0 ? this.timeEstimate : undefined,
			dateCreated: new Date().toISOString(),
			dateModified: new Date().toISOString()
		};

		// Add recurrence data
		if (this.recurrence !== 'none') {
			taskData.recurrence = {
				frequency: this.recurrence
			};

			if (this.recurrence === 'weekly' && this.daysOfWeek.length > 0) {
				// Convert full names to abbreviations for storage
				taskData.recurrence.days_of_week = this.convertFullNamesToAbbreviations(this.daysOfWeek);
			}

			if (this.recurrence === 'monthly' && this.dayOfMonth) {
				taskData.recurrence.day_of_month = parseInt(this.dayOfMonth);
			}

			if (this.recurrence === 'yearly') {
				if (this.monthOfYear) {
					taskData.recurrence.month_of_year = parseInt(this.monthOfYear);
				}
				if (this.dayOfMonth) {
					taskData.recurrence.day_of_month = parseInt(this.dayOfMonth);
				}
			}
		}

		// Use field mapper to convert to frontmatter with proper field mapping
		const frontmatter = this.plugin.fieldMapper.mapToFrontmatter(taskData, this.plugin.settings.taskTag);
		
		// Tags are handled separately (not via field mapper)
		frontmatter.tags = tagsArray;

		// Prepare file content
		const yamlHeader = YAML.stringify(frontmatter);
		let content = `---\n${yamlHeader}---\n\n`;
		
		if (this.details && this.details.trim()) {
			content += `${this.details.trim()}\n\n`;
		}

		// Create the file
		const file = await this.app.vault.create(fullPath, content);

		// Create TaskInfo object for cache and events
		const taskInfo: TaskInfo = {
			...frontmatter,
			path: file.path,
			tags: tagsArray,
			archived: false
		};

		// Update cache proactively
		await this.plugin.cacheManager.updateTaskInfoInCache(file.path, taskInfo);

		// Emit task created event
		this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
			path: file.path,
			updatedTask: taskInfo
		});

		// If calendar view is open, update it to show the new task
		const leaves = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);
		if (leaves.length > 0) {
			const calendarView = leaves[0].view as any;
			if (calendarView && typeof calendarView.refresh === 'function') {
				calendarView.refresh();
			}
		}

		return file;
	}

	/**
	 * Create due date input with reference for later updates
	 */
	private createDueDateInputWithRef(container: HTMLElement): void {
		this.dueDateInput = container.createEl('input', {
			type: 'date',
			cls: 'form-input'
		});

		// Set the value to the current dueDate property
		this.dueDateInput.value = this.dueDate || '';

		this.dueDateInput.addEventListener('change', (e) => {
			this.dueDate = (e.target as HTMLInputElement).value;
		});
	}
}