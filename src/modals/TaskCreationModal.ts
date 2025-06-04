import { App, Modal, Notice, TFile } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import TaskNotesPlugin from '../main';
import { ensureFolderExists } from '../utils/helpers';
import { generateTaskFilename, generateUniqueFilename, FilenameContext } from '../utils/filenameGenerator';
import { CALENDAR_VIEW_TYPE, TaskFrontmatter, TaskInfo, TimeEntry } from '../types';

export class TaskCreationModal extends Modal {
	plugin: TaskNotesPlugin;
	title: string = '';
	details: string = '';
	dueDate: string = '';
	priority: string = 'normal';
	status: string = 'open';
	contexts: string = '';
	tags: string = '';
	timeEstimate: number = 0;
	recurrence: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' = 'none';
	daysOfWeek: string[] = [];
	dayOfMonth: string = '';
	monthOfYear: string = '';
	
	// UI elements for filename preview
	private filenamePreview: HTMLElement | null = null;
  
	constructor(app: App, plugin: TaskNotesPlugin) {
		super(app);
		this.plugin = plugin;
	}
	
	// Get existing contexts from task cache for autocomplete
	async getExistingContexts(): Promise<string[]> {
		try {
			// Fetching existing contexts
			
			// Use the actual task data from a current date to get real tasks
			const currentDate = new Date();
			const allTaskDates: TaskInfo[] = [];
			
			// Get tasks from multiple recent dates to build comprehensive list
			for (let i = -30; i <= 30; i++) {
				const checkDate = new Date(currentDate);
				checkDate.setDate(currentDate.getDate() + i);
				try {
					const tasksForDate = await this.plugin.fileIndexer.getTaskInfoForDate(checkDate);
					allTaskDates.push(...tasksForDate);
				} catch (err) {
					// Ignore errors for individual dates
				}
			}
			
			const contexts = new Set<string>();
			allTaskDates.forEach(task => {
				if (task && task.contexts) {
					task.contexts.forEach((context: string) => contexts.add(context));
				}
			});
			
			const result = Array.from(contexts).sort();
			// Found contexts
			return result;
		} catch (error) {
			// Could not fetch existing contexts
			return [];
		}
	}
	
	// Get existing tags from task cache for autocomplete
	async getExistingTags(): Promise<string[]> {
		try {
			// Fetching existing tags
			
			// Use the actual task data from a current date to get real tasks
			const currentDate = new Date();
			const allTaskDates: TaskInfo[] = [];
			
			// Get tasks from multiple recent dates to build comprehensive list
			for (let i = -30; i <= 30; i++) {
				const checkDate = new Date(currentDate);
				checkDate.setDate(currentDate.getDate() + i);
				try {
					const tasksForDate = await this.plugin.fileIndexer.getTaskInfoForDate(checkDate);
					allTaskDates.push(...tasksForDate);
				} catch (err) {
					// Ignore errors for individual dates
				}
			}
			
			const tags = new Set<string>();
			allTaskDates.forEach(task => {
				if (task && task.tags) {
					task.tags.forEach((tag: string) => {
						// Skip the default task tag
						if (tag !== this.plugin.settings.taskTag) {
							tags.add(tag);
						}
					});
				}
			});
			
			const result = Array.from(tags).sort();
			// Found tags
			return result;
		} catch (error) {
			// Could not fetch existing tags
			return [];
		}
	}
  
	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('task-creation-modal');
		contentEl.createEl('h2', { text: 'Create new task' });
		
		// Title with character count
		this.createFormGroup(contentEl, 'Title', (container) => {
			const inputContainer = container.createDiv({ cls: 'input-with-counter' });
			const input = inputContainer.createEl('input', { 
				type: 'text',
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
				counter.textContent = `${value.length}/200`;
				
				// Update counter color based on length
				if (value.length > 180) {
					counter.addClass('warning');
				} else {
					counter.removeClass('warning');
				}
				
				// Update filename preview
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
				attr: { 
					placeholder: 'Optional details or description...',
					rows: '3'
				}
			});
			textarea.addEventListener('input', (e) => {
				this.details = (e.target as HTMLTextAreaElement).value;
			});
		});
		
		// Due Date - pre-populate with selected date from calendar
		this.createFormGroup(contentEl, 'Due date', (container) => {
			const input = container.createEl('input', { type: 'date' });
			
			// Pre-populate with selected date from calendar or today
			const selectedDate = this.plugin.selectedDate || new Date();
			const dateString = format(selectedDate, 'yyyy-MM-dd');
			input.value = dateString;
			this.dueDate = dateString;
			
			input.addEventListener('change', (e) => {
				this.dueDate = (e.target as HTMLInputElement).value;
			});
		});
		
		// Priority
		this.createFormGroup(contentEl, 'Priority', (container) => {
			const select = container.createEl('select');
			
			// Get custom priorities ordered by weight (highest first)
			const priorities = this.plugin.priorityManager.getPrioritiesByWeight();
			
			priorities.forEach(priorityConfig => {
				const optEl = select.createEl('option', { 
					value: priorityConfig.value, 
					text: priorityConfig.label 
				});
				if (priorityConfig.value === this.plugin.settings.defaultTaskPriority) {
					optEl.selected = true;
					this.priority = priorityConfig.value;
				}
			});
			
			select.addEventListener('change', (e) => {
				this.priority = (e.target as HTMLSelectElement).value;
				this.updateFilenamePreview();
			});
		});
		
		// Status
		this.createFormGroup(contentEl, 'Status', (container) => {
			const select = container.createEl('select');
			
			// Get custom statuses ordered by their order field
			const statuses = this.plugin.statusManager.getStatusesByOrder();
			
			statuses.forEach(statusConfig => {
				const optEl = select.createEl('option', { 
					value: statusConfig.value, 
					text: statusConfig.label 
				});
				if (statusConfig.value === this.plugin.settings.defaultTaskStatus) {
					optEl.selected = true;
					this.status = statusConfig.value;
				}
			});
			
			select.addEventListener('change', (e) => {
				this.status = (e.target as HTMLSelectElement).value;
				this.updateFilenamePreview();
			});
		});
		
		// Contexts with autocomplete
		this.createFormGroup(contentEl, 'Contexts (comma-separated)', (container) => {
			this.createAutocompleteInput(container, 'contexts', this.getExistingContexts.bind(this), (value) => {
				this.contexts = value;
			});
		});
		
		// Tags with autocomplete
		this.createFormGroup(contentEl, 'Tags (comma-separated)', (container) => {
			this.createAutocompleteInput(container, 'tags', this.getExistingTags.bind(this), (value) => {
				this.tags = value;
			});
		});
		
		// Time Estimate
		this.createFormGroup(contentEl, 'Time estimate', (container) => {
			const timeContainer = container.createDiv({ cls: 'time-estimate-container' });
			const input = timeContainer.createEl('input', { 
				type: 'number',
				attr: { 
					placeholder: '0',
					min: '0',
					step: '15'
				}
			});
			const label = timeContainer.createSpan({ 
				cls: 'time-unit-label',
				text: 'minutes'
			});
			
			input.addEventListener('input', (e) => {
				const value = parseInt((e.target as HTMLInputElement).value) || 0;
				this.timeEstimate = value;
				
				// Update label to show hours if >= 60 minutes
				if (value >= 60) {
					const hours = Math.floor(value / 60);
					const minutes = value % 60;
					if (minutes === 0) {
						label.textContent = `minutes (${hours}h)`;
					} else {
						label.textContent = `minutes (${hours}h ${minutes}m)`;
					}
				} else {
					label.textContent = 'minutes';
				}
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
				this.recurrence = (e.target as HTMLSelectElement).value as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
				this.updateRecurrenceOptions(contentEl);
			});
		});
		
		// The recurrence options container (will be populated based on recurrence selection)
		const recurrenceOptions = contentEl.createDiv({ cls: 'recurrence-options' });
		recurrenceOptions.addClass('is-hidden');
		
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
		
		// Add keyboard navigation
		contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				this.close();
			} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.createTask();
			}
		});
		
		// Set proper tab order
		const focusableElements = contentEl.querySelectorAll('input, select, textarea, button');
		focusableElements.forEach((el, index) => {
			(el as HTMLElement).tabIndex = index + 1;
		});
	}
  
	createFormGroup(container: HTMLElement, label: string, inputCallback: (container: HTMLElement) => void) {
		const group = container.createDiv({ cls: 'form-group' });
		group.createEl('label', { text: label });
		inputCallback(group);
		return group;
	}
	
	async createAutocompleteInput(
		container: HTMLElement, 
		fieldName: string, 
		getSuggestionsFn: () => Promise<string[]>, 
		onChangeFn: (value: string) => void
	) {
		const inputContainer = container.createDiv({ cls: 'autocomplete-container' });
		const input = inputContainer.createEl('input', { 
			type: 'text',
			cls: 'autocomplete-input',
			attr: { placeholder: 'Type to see suggestions...' }
		});
		
		const suggestionsContainer = inputContainer.createDiv({ cls: 'autocomplete-suggestions' });
		suggestionsContainer.addClass('is-hidden');
		
		let suggestions: string[] = [];
		let selectedIndex = -1;
		
		// Load suggestions
		try {
			suggestions = await getSuggestionsFn();
			// Loaded suggestions for fieldName
			
			// Add some fallback suggestions if none found
			if (suggestions.length === 0) {
				if (fieldName === 'contexts') {
					suggestions = ['work', 'home', 'personal', 'urgent', 'project'];
				} else if (fieldName === 'tags') {
					suggestions = ['important', 'review', 'research', 'followup', 'idea'];
				}
				// Using fallback suggestions for fieldName
			}
		} catch (error) {
			// Could not load suggestions for fieldName
			// Provide fallback suggestions on error
			if (fieldName === 'contexts') {
				suggestions = ['work', 'home', 'personal', 'urgent'];
			} else if (fieldName === 'tags') {
				suggestions = ['important', 'review', 'research', 'followup'];
			}
		}
		
		// Handle input changes
		input.addEventListener('input', (e) => {
			const value = (e.target as HTMLInputElement).value;
			onChangeFn(value);
			
			// Get the current word being typed (after last comma)
			const parts = value.split(',');
			const currentWord = parts[parts.length - 1].trim().toLowerCase();
			
			if (currentWord.length > 0) {
				// Filter suggestions based on current word
				const filteredSuggestions = suggestions.filter(suggestion => 
					suggestion.toLowerCase().includes(currentWord) &&
					!parts.slice(0, -1).map(p => p.trim()).includes(suggestion)
				);
				
				// Filtering currentWord from suggestions
				
				this.showSuggestions(suggestionsContainer, filteredSuggestions, input, onChangeFn);
				selectedIndex = -1;
			} else {
				this.hideSuggestions(suggestionsContainer);
			}
		});
		
		// Handle keyboard navigation
		input.addEventListener('keydown', (e) => {
			const suggestionElements = suggestionsContainer.querySelectorAll('.autocomplete-suggestion');
			
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, suggestionElements.length - 1);
				this.updateSelectedSuggestion(suggestionElements, selectedIndex);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, -1);
				this.updateSelectedSuggestion(suggestionElements, selectedIndex);
			} else if (e.key === 'Enter' && selectedIndex >= 0) {
				e.preventDefault();
				const selectedElement = suggestionElements[selectedIndex] as HTMLElement;
				this.applySuggestion(input, selectedElement.textContent || '', onChangeFn);
				this.hideSuggestions(suggestionsContainer);
			} else if (e.key === 'Escape') {
				this.hideSuggestions(suggestionsContainer);
				selectedIndex = -1;
			}
		});
		
		// Hide suggestions when clicking outside
		input.addEventListener('blur', () => {
			// Small delay to allow clicking on suggestions
			setTimeout(() => {
				this.hideSuggestions(suggestionsContainer);
			}, 150);
		});
	}
	
	showSuggestions(
		container: HTMLElement, 
		suggestions: string[], 
		input: HTMLInputElement, 
		onChangeFn: (value: string) => void
	) {
		container.empty();
		
		if (suggestions.length === 0) {
			container.addClass('is-hidden');
			return;
		}
		
		suggestions.slice(0, 8).forEach((suggestion, index) => {
			const suggestionEl = container.createDiv({ 
				cls: 'autocomplete-suggestion',
				text: suggestion
			});
			
			suggestionEl.addEventListener('click', () => {
				this.applySuggestion(input, suggestion, onChangeFn);
				this.hideSuggestions(container);
			});
		});
		
		container.removeClass('is-hidden');
	}
	
	applySuggestion(input: HTMLInputElement, suggestion: string, onChangeFn: (value: string) => void) {
		const currentValue = input.value;
		const parts = currentValue.split(',');
		
		// Replace the last part with the suggestion
		parts[parts.length - 1] = ' ' + suggestion;
		
		const newValue = parts.join(',');
		input.value = newValue;
		onChangeFn(newValue);
		
		// Set cursor to end
		input.setSelectionRange(newValue.length, newValue.length);
		input.focus();
	}
	
	updateSelectedSuggestion(suggestions: NodeListOf<Element>, selectedIndex: number) {
		suggestions.forEach((el, index) => {
			if (index === selectedIndex) {
				el.addClass('selected');
			} else {
				el.removeClass('selected');
			}
		});
	}
	
	hideSuggestions(container: HTMLElement) {
		container.addClass('is-hidden');
		container.empty();
	}
  
	updateRecurrenceOptions(container: HTMLElement) {
		const optionsContainer = container.querySelector('.recurrence-options');
		if (!optionsContainer) return;
		
		optionsContainer.empty();
		optionsContainer.removeClass('is-hidden');
		
		if (this.recurrence === 'weekly') {
			this.createDaysOfWeekSelector(optionsContainer as HTMLElement);
		} else if (this.recurrence === 'monthly') {
			this.createDayOfMonthSelector(optionsContainer as HTMLElement);
		} else if (this.recurrence === 'yearly') {
			this.createYearlySelector(optionsContainer as HTMLElement);
		} else {
			optionsContainer.addClass('is-hidden');
		}
	}
  
	createDaysOfWeekSelector(container: HTMLElement) {
		container.createEl('h4', { text: 'Select days of week:', cls: 'days-of-week-title' });
		
		// Container for the days of week selection
		const daysContainer = container.createDiv({ cls: 'days-container' });
		
		const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
		const shortDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
		
		// Create checkboxes in a clearer layout - one per row
		daysOfWeek.forEach((day, index) => {
			const dayRow = daysContainer.createDiv({ cls: 'day-row' });
			
			const label = dayRow.createEl('label', { cls: 'day-checkbox-label' });
			const checkbox = label.createEl('input', { 
				type: 'checkbox',
				cls: 'day-checkbox'
			});
			
			// Set data attribute for the day
			checkbox.dataset.day = shortDays[index];
			
			// Add the day name after the checkbox
			label.appendChild(document.createTextNode(' ' + day));
			
			// Add change listener
			checkbox.addEventListener('change', (e) => {
				const isChecked = (e.target as HTMLInputElement).checked;
				const day = (e.target as HTMLInputElement).dataset.day;
				
				if (isChecked && day) {
					this.daysOfWeek.push(day);
				} else if (day) {
					this.daysOfWeek = this.daysOfWeek.filter(d => d !== day);
				}
			});
		});
		
		// Add helper text
		const helperText = container.createEl('div', { 
			text: 'Select at least one day of the week on which this task should recur.',
			cls: 'recurrence-helper-text'
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
	
	createYearlySelector(container: HTMLElement) {
		// Month selector
		this.createFormGroup(container, 'Month', (group) => {
			const select = group.createEl('select');
			
			const months = [
				{ value: '1', text: 'January' },
				{ value: '2', text: 'February' },
				{ value: '3', text: 'March' },
				{ value: '4', text: 'April' },
				{ value: '5', text: 'May' },
				{ value: '6', text: 'June' },
				{ value: '7', text: 'July' },
				{ value: '8', text: 'August' },
				{ value: '9', text: 'September' },
				{ value: '10', text: 'October' },
				{ value: '11', text: 'November' },
				{ value: '12', text: 'December' }
			];
			
			months.forEach(month => {
				select.createEl('option', { value: month.value, text: month.text });
			});
			
			// Set default to current month
			const currentMonth = (new Date().getMonth() + 1).toString();
			select.value = currentMonth;
			this.monthOfYear = currentMonth;
			
			select.addEventListener('change', (e) => {
				this.monthOfYear = (e.target as HTMLSelectElement).value;
			});
		});
		
		// Day of month selector
		this.createFormGroup(container, 'Day of month', (group) => {
			const input = group.createEl('input', { type: 'number' });
			input.min = '1';
			input.max = '31';
			input.addEventListener('input', (e) => {
				this.dayOfMonth = (e.target as HTMLInputElement).value;
			});
		});
		
		// Add helper text
		const helperText = container.createEl('div', { 
			text: 'Select the month and day on which this task should recur each year.',
			cls: 'recurrence-helper-text'
		});
	}
  
	async createTask() {
		if (!this.title || !this.title.trim()) {
			new Notice('Title is required');
			return;
		}
		
		// Validate title length
		if (this.title.length > 200) {
			new Notice('Task title is too long (max 200 characters)');
			return;
		}
		
		// Validate due date if provided
		if (this.dueDate) {
			const dueDateTime = new Date(this.dueDate);
			if (isNaN(dueDateTime.getTime())) {
				new Notice('Invalid due date format');
				return;
			}
		}
		
		// Validate recurrence settings
		if (this.recurrence === 'weekly' && this.daysOfWeek.length === 0) {
			new Notice('Please select at least one day of the week for weekly recurrence');
			return;
		}
		
		if ((this.recurrence === 'monthly' || this.recurrence === 'yearly') && this.dayOfMonth) {
			const dayNum = parseInt(this.dayOfMonth);
			if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
				new Notice('Day of month must be between 1 and 31');
				return;
			}
		}
		
		try {
			// Generate filename based on settings
			const now = new Date();
			const filenameContext: FilenameContext = {
				title: this.title,
				priority: this.priority,
				status: this.status,
				date: now
			};
			
			const baseFilename = generateTaskFilename(filenameContext, this.plugin.settings);
			
			// Ensure the tasks folder exists
			await ensureFolderExists(this.app.vault, this.plugin.settings.tasksFolder);
			
			// Generate unique filename to avoid conflicts
			const uniqueFilename = await generateUniqueFilename(
				baseFilename,
				this.plugin.settings.tasksFolder,
				this.app.vault
			);
			
			// Create the task file
			const taskFilePath = `${this.plugin.settings.tasksFolder}/${uniqueFilename}.md`;
			
			// Prepare tags (always include the configured task tag)
			let tagsArray = [this.plugin.settings.taskTag];
			if (this.tags) {
				tagsArray = tagsArray.concat(
					this.tags.split(',')
						.map(tag => tag.trim())
						.filter(tag => tag.length > 0)
				);
			}
			
			// Prepare contexts
			let contextsArray: string[] = [];
			if (this.contexts) {
				contextsArray = this.contexts.split(',')
					.map(context => context.trim())
					.filter(context => context.length > 0);
			}
			
			// Create task info object
			const taskInfo: Partial<TaskInfo> = {
				title: this.title,
				status: this.status,
				priority: this.priority,
				tags: tagsArray,
				dateCreated: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
				dateModified: format(now, "yyyy-MM-dd'T'HH:mm:ss"),
			};
			
			// Add completedDate if status is completed
			if (this.plugin.statusManager.isCompletedStatus(this.status)) {
				taskInfo.completedDate = format(now, 'yyyy-MM-dd');
			}
			
			// Add optional fields through field mapping
			if (this.dueDate) {
				taskInfo.due = this.dueDate;
			}
			
			if (contextsArray.length > 0) {
				taskInfo.contexts = contextsArray;
			}
			
			if (this.timeEstimate > 0) {
				taskInfo.timeEstimate = this.timeEstimate;
				taskInfo.timeEntries = [];
			}
			
			// Add recurrence info if specified
			if (this.recurrence !== 'none') {
				taskInfo.recurrence = {
					frequency: this.recurrence
				};
				
				if (this.recurrence === 'weekly' && this.daysOfWeek.length > 0) {
					taskInfo.recurrence.days_of_week = this.daysOfWeek;
				}
				
				if (this.recurrence === 'monthly' && this.dayOfMonth) {
					taskInfo.recurrence.day_of_month = parseInt(this.dayOfMonth);
				}
				
				if (this.recurrence === 'yearly') {
					if (this.dayOfMonth) {
						taskInfo.recurrence.day_of_month = parseInt(this.dayOfMonth);
					}
					if (this.monthOfYear) {
						taskInfo.recurrence.month_of_year = parseInt(this.monthOfYear);
					}
				}
				
				taskInfo.complete_instances = [];
			}
			
			// Create final YAML with all fields mapped using the user's configured field names
			const completeYaml = this.plugin.fieldMapper.mapToFrontmatter(taskInfo);
			
			// Prepare the file content
			const content = `---\n${YAML.stringify(completeYaml)}---\n\n# ${this.title}\n\n${this.details}`;
			
			// Create the file
			await this.app.vault.create(taskFilePath, content);
			
			// Show success notice and close modal
			new Notice('Task created successfully');
			this.close();
			
			// Notify all views that data has changed
			this.plugin.notifyDataChanged();
			
		} catch (error) {
			console.error('Error creating task:', error);
			new Notice('Error creating task. Check the console for details.');
		}
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

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}