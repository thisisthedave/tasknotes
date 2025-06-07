import { App, Notice, TFile } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import TaskNotesPlugin from '../main';
import { BaseTaskModal } from './BaseTaskModal';
import { ensureFolderExists } from '../utils/helpers';
import { generateTaskFilename, generateUniqueFilename, FilenameContext } from '../utils/filenameGenerator';
import { CALENDAR_VIEW_TYPE, TaskFrontmatter, TaskInfo, TimeEntry, EVENT_TASK_UPDATED } from '../types';

export class TaskCreationModal extends BaseTaskModal {
	details: string = '';
	
	// UI elements for filename preview
	private filenamePreview: HTMLElement | null = null;
  
	constructor(app: App, plugin: TaskNotesPlugin) {
		super(app, plugin);
	}

	protected initializeFormData(): void {
		// Initialize with default values
		this.priority = this.plugin.settings.defaultTaskPriority;
		this.status = this.plugin.settings.defaultTaskStatus;
		
		// Pre-populate due date with selected date from calendar or today
		const selectedDate = this.plugin.selectedDate || new Date();
		this.dueDate = format(selectedDate, 'yyyy-MM-dd');
	}
  
	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('task-creation-modal');
		contentEl.createEl('h2', { text: 'Create new task' });

		// Initialize form data
		this.initializeFormData();

		// Cache autocomplete data
		this.getExistingContexts().then(contexts => this.existingContexts = contexts);
		this.getExistingTags().then(tags => this.existingTags = tags);
		
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
			textarea.addEventListener('input', (e) => {
				this.details = (e.target as HTMLTextAreaElement).value;
			});
		});
		
		// Due Date
		this.createFormGroup(contentEl, 'Due date', (container) => {
			this.createDueDateInput(container);
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
		// Validate required fields
		if (!this.title || !this.title.trim()) {
			new Notice('Title is required');
			return;
		}

		if (this.title.length > 200) {
			new Notice('Title is too long (max 200 characters)');
			return;
		}

		// Validate recurrence fields
		if (this.recurrence === 'weekly' && this.daysOfWeek.length === 0) {
			new Notice('Please select at least one day for weekly recurrence');
			return;
		}

		if (this.recurrence === 'monthly' && (!this.dayOfMonth || parseInt(this.dayOfMonth) < 1 || parseInt(this.dayOfMonth) > 31)) {
			new Notice('Please enter a valid day of month (1-31)');
			return;
		}

		if (this.recurrence === 'yearly') {
			if (!this.monthOfYear || !this.dayOfMonth) {
				new Notice('Please select month and day for yearly recurrence');
				return;
			}
			if (parseInt(this.dayOfMonth) < 1 || parseInt(this.dayOfMonth) > 31) {
				new Notice('Please enter a valid day of month (1-31)');
				return;
			}
		}

		try {
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

			// Prepare frontmatter
			const frontmatter: any = {
				title: this.title,
				status: this.status,
				priority: this.priority,
				tags: tagsArray,
				dateCreated: new Date().toISOString(),
				dateModified: new Date().toISOString()
			};

			if (this.dueDate) {
				frontmatter.due = this.dueDate;
			}

			if (contextsArray.length > 0) {
				frontmatter.contexts = contextsArray;
			}

			if (this.timeEstimate > 0) {
				frontmatter.timeEstimate = this.timeEstimate;
			}

			// Add recurrence data
			if (this.recurrence !== 'none') {
				frontmatter.recurrence = {
					frequency: this.recurrence
				};

				if (this.recurrence === 'weekly' && this.daysOfWeek.length > 0) {
					frontmatter.recurrence.days_of_week = this.daysOfWeek;
				}

				if (this.recurrence === 'monthly' && this.dayOfMonth) {
					frontmatter.recurrence.day_of_month = parseInt(this.dayOfMonth);
				}

				if (this.recurrence === 'yearly') {
					if (this.monthOfYear) {
						frontmatter.recurrence.month_of_year = parseInt(this.monthOfYear);
					}
					if (this.dayOfMonth) {
						frontmatter.recurrence.day_of_month = parseInt(this.dayOfMonth);
					}
				}
			}

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

			new Notice(`Task created: ${this.title}`);
			this.close();

			// If calendar view is open, update it to show the new task
			const leaves = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);
			if (leaves.length > 0) {
				const calendarView = leaves[0].view as any;
				if (calendarView && typeof calendarView.refresh === 'function') {
					calendarView.refresh();
				}
			}

		} catch (error) {
			console.error('Failed to create task:', error);
			new Notice('Failed to create task. Please try again.');
		}
	}
}