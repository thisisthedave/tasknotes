import { App, Modal, Notice, TFile } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import ChronoSyncPlugin from '../main';
import { ensureFolderExists } from '../utils/helpers';
import { CALENDAR_VIEW_TYPE } from '../types';
import { CalendarView } from '../views/CalendarView';

export class TaskCreationModal extends Modal {
	plugin: ChronoSyncPlugin;
	title: string = '';
	details: string = '';
	dueDate: string = '';
	priority: 'low' | 'normal' | 'high' = 'normal';
	contexts: string = '';
	tags: string = '';
	recurrence: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' = 'none';
	daysOfWeek: string[] = [];
	dayOfMonth: string = '';
  
	constructor(app: App, plugin: ChronoSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}
  
	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('task-creation-modal');
		contentEl.createEl('h2', { text: 'Create new task' });
		
		// Title
		this.createFormGroup(contentEl, 'Title', (container) => {
			const input = container.createEl('input', { type: 'text' });
			input.addEventListener('input', (e) => {
				this.title = (e.target as HTMLInputElement).value;
			});
		});
		
		// Details
		this.createFormGroup(contentEl, 'Details', (container) => {
			const textarea = container.createEl('textarea');
			textarea.rows = 3;
			textarea.addEventListener('input', (e) => {
				this.details = (e.target as HTMLTextAreaElement).value;
			});
		});
		
		// Due Date
		this.createFormGroup(contentEl, 'Due date', (container) => {
			const input = container.createEl('input', { type: 'date' });
			input.addEventListener('change', (e) => {
				this.dueDate = (e.target as HTMLInputElement).value;
			});
		});
		
		// Priority
		this.createFormGroup(contentEl, 'Priority', (container) => {
			const select = container.createEl('select');
			
			const options = [
				{ value: 'low', text: 'Low' },
				{ value: 'normal', text: 'Normal' },
				{ value: 'high', text: 'High' }
			];
			
			options.forEach(option => {
				const optEl = select.createEl('option', { value: option.value, text: option.text });
				if (option.value === this.plugin.settings.defaultTaskPriority) {
					optEl.selected = true;
					this.priority = option.value as 'low' | 'normal' | 'high';
				}
			});
			
			select.addEventListener('change', (e) => {
				this.priority = (e.target as HTMLSelectElement).value as 'low' | 'normal' | 'high';
			});
		});
		
		// Contexts
		this.createFormGroup(contentEl, 'Contexts (comma-separated)', (container) => {
			const input = container.createEl('input', { type: 'text' });
			input.addEventListener('input', (e) => {
				this.contexts = (e.target as HTMLInputElement).value;
			});
		});
		
		// Tags
		this.createFormGroup(contentEl, 'Tags (comma-separated)', (container) => {
			const input = container.createEl('input', { type: 'text' });
			input.addEventListener('input', (e) => {
				this.tags = (e.target as HTMLInputElement).value;
			});
		});
		
		// Recurrence
		this.createFormGroup(contentEl, 'Recurrence', (container) => {
			const select = container.createEl('select');
			
			const options = [
				{ value: 'none', text: 'None' },
				{ value: 'daily', text: 'Daily' },
				{ value: 'weekly', text: 'Weekly' },
				{ value: 'monthly', text: 'Monthly' },
				{ value: 'yearly', text: 'Yearly' }
			];
			
			options.forEach(option => {
				select.createEl('option', { value: option.value, text: option.text });
			});
			
			select.addEventListener('change', (e) => {
				this.recurrence = (e.target as HTMLSelectElement).value as any;
				this.updateRecurrenceOptions(contentEl);
			});
		});
		
		// The recurrence options container (will be populated based on recurrence selection)
		const recurrenceOptions = contentEl.createDiv({ cls: 'recurrence-options' });
		(recurrenceOptions as HTMLElement).style.display = 'none';
		
		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => {
			this.close();
		});
		
		const createButton = buttonContainer.createEl('button', { text: 'Create task', cls: 'create-button' });
		createButton.addEventListener('click', () => {
			this.createTask();
		});
	}
  
	createFormGroup(container: HTMLElement, label: string, inputCallback: (container: HTMLElement) => void) {
		const group = container.createDiv({ cls: 'form-group' });
		group.createEl('label', { text: label });
		inputCallback(group);
		return group;
	}
  
	updateRecurrenceOptions(container: HTMLElement) {
		const optionsContainer = container.querySelector('.recurrence-options');
		if (!optionsContainer) return;
		
		optionsContainer.empty();
		(optionsContainer as HTMLElement).style.display = 'block';
		
		if (this.recurrence === 'weekly') {
			this.createDaysOfWeekSelector(optionsContainer as HTMLElement);
		} else if (this.recurrence === 'monthly' || this.recurrence === 'yearly') {
			this.createDayOfMonthSelector(optionsContainer as HTMLElement);
		} else {
			(optionsContainer as HTMLElement).style.display = 'none';
		}
	}
  
	createDaysOfWeekSelector(container: HTMLElement) {
		container.createEl('label', { text: 'Days of week' });
		const checkboxContainer = container.createDiv({ cls: 'checkbox-container' });
		
		const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
		const shortDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
		
		daysOfWeek.forEach((day, index) => {
			const label = checkboxContainer.createEl('label', { cls: 'checkbox-label' });
			const checkbox = label.createEl('input', { type: 'checkbox' });
			checkbox.dataset.day = shortDays[index];
			
			checkbox.addEventListener('change', (e) => {
				const isChecked = (e.target as HTMLInputElement).checked;
				const day = (e.target as HTMLInputElement).dataset.day;
				
				if (isChecked && day) {
					this.daysOfWeek.push(day);
				} else if (day) {
					this.daysOfWeek = this.daysOfWeek.filter(d => d !== day);
				}
			});
			
			label.appendChild(document.createTextNode(day));
		});
	}
  
	createDayOfMonthSelector(container: HTMLElement) {
		this.createFormGroup(container, 'Day of month', (group) => {
			const input = group.createEl('input', { type: 'number' });
			input.min = '1';
			input.max = '31';
			input.addEventListener('input', (e) => {
				this.dayOfMonth = (e.target as HTMLInputElement).value;
			});
		});
	}
  
	async createTask() {
		if (!this.title) {
			new Notice('Title is required');
			return;
		}
		
		try {
			// Generate unique ID for the task
			const now = new Date();
			const datePart = format(now, 'yyyyMMdd');
			const randomPart = Math.random().toString(36).substring(2, 5);
			const taskId = `${datePart}${randomPart}`;
			
			// Ensure the tasks folder exists
			await ensureFolderExists(this.app.vault, this.plugin.settings.tasksFolder);
			
			// Create the task file
			const taskFilePath = `${this.plugin.settings.tasksFolder}/${taskId}.md`;
			
			// Prepare tags (always include the configured task tag)
			let tagsArray = [this.plugin.settings.taskTag];
			if (this.tags) {
				tagsArray = tagsArray.concat(this.tags.split(',').map(tag => tag.trim()));
			}
			
			// Prepare contexts
			let contextsArray: string[] = [];
			if (this.contexts) {
				contextsArray = this.contexts.split(',').map(context => context.trim());
			}
			
			// Create the YAML frontmatter
			const yaml: any = {
				title: this.title,
				zettelid: taskId,
				dateCreated: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
				dateModified: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
				status: this.plugin.settings.defaultTaskStatus,
				tags: tagsArray,
				priority: this.priority,
			};
			
			// Add optional fields
			if (this.dueDate) {
				yaml.due = this.dueDate;
			}
			
			if (contextsArray.length > 0) {
				yaml.contexts = contextsArray;
			}
			
			// Add recurrence info if specified
			if (this.recurrence !== 'none') {
				yaml.recurrence = {
					frequency: this.recurrence
				};
				
				if (this.recurrence === 'weekly' && this.daysOfWeek.length > 0) {
					yaml.recurrence.days_of_week = this.daysOfWeek;
				}
				
				if ((this.recurrence === 'monthly' || this.recurrence === 'yearly') && this.dayOfMonth) {
					yaml.recurrence.day_of_month = parseInt(this.dayOfMonth);
				}
				
				yaml.complete_instances = [];
			}
			
			// Prepare the file content
			const content = `---\n${YAML.stringify(yaml)}---\n\n# ${this.title}\n\n${this.details}`;
			
			// Create the file
			await this.app.vault.create(taskFilePath, content);
			
			// Show success notice and close modal
			new Notice('Task created successfully');
			this.close();
			
			// Find calendar view and refresh it if open
			const calendarLeaf = this.plugin.getCalendarLeaf();
			if (calendarLeaf) {
				const view = calendarLeaf.view as CalendarView;
				
				// Refresh tasks view if it's active
				if (view.activeTab === 'tasks') {
					await view.refreshTaskView();
				}
				
				// Always refresh the calendar caches to update visualizations
				const monthKey = `${view.currentDate.getFullYear()}-${view.currentDate.getMonth()}`;
				await view.buildCalendarCaches(monthKey);
				
				// Reapply current colorization based on active tab
				if (view.activeTab === 'tasks') {
					view.colorizeCalendarForTasks();
				} else if (view.activeTab === 'notes') {
					view.colorizeCalendarForNotes();
				} else if (view.activeTab === 'timeblock') {
					view.colorizeCalendarForDailyNotes();
				}
			}
		} catch (error) {
			console.error('Error creating task:', error);
			new Notice('Error creating task. Check the console for details.');
		}
	}
  
	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}