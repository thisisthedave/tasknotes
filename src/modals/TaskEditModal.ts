import { App, Modal, Notice, TFile } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { TaskInfo, EVENT_TASK_UPDATED } from '../types';

export class TaskEditModal extends Modal {
    plugin: TaskNotesPlugin;
    task: TaskInfo;
    
    // Form fields
    title: string;
    dueDate: string;
    priority: string;
    status: string;
    contexts: string;
    tags: string;
    timeEstimate: number;
    recurrence: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    daysOfWeek: string[] = [];
    dayOfMonth: string = '';
    monthOfYear: string = '';
    
    // Cached suggestions for autocomplete
    private existingContexts: string[] = [];
    private existingTags: string[] = [];

    constructor(app: App, plugin: TaskNotesPlugin, task: TaskInfo) {
        super(app);
        this.plugin = plugin;
        this.task = task;
        
        // Initialize form fields with current task data
        this.title = task.title;
        this.dueDate = task.due || '';
        this.priority = task.priority;
        this.status = task.status;
        this.contexts = task.contexts ? task.contexts.join(', ') : '';
        this.tags = task.tags ? task.tags.filter(tag => tag !== this.plugin.settings.taskTag).join(', ') : '';
        this.timeEstimate = task.timeEstimate || 0;
        this.recurrence = task.recurrence?.frequency || 'none';
        
        if (task.recurrence) {
            this.daysOfWeek = task.recurrence.days_of_week || [];
            this.dayOfMonth = task.recurrence.day_of_month?.toString() || '';
            this.monthOfYear = task.recurrence.month_of_year?.toString() || '';
        }
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass('task-edit-modal');
        contentEl.createEl('h2', { text: 'Edit Task' });

        // Load autocomplete suggestions
        this.loadSuggestions();

        // Title with character count
        this.createFormGroup(contentEl, 'Title', (container) => {
            const inputContainer = container.createDiv({ cls: 'input-with-counter' });
            const input = inputContainer.createEl('input', { 
                type: 'text',
                value: this.title,
                attr: { 
                    placeholder: 'Enter task title...',
                    maxlength: '200'
                }
            });
            const counter = inputContainer.createDiv({ 
                cls: 'character-counter',
                text: `${this.title.length}/200`
            });
            
            input.addEventListener('input', (e) => {
                const value = (e.target as HTMLInputElement).value;
                this.title = value;
                counter.textContent = `${value.length}/200`;
                
                if (value.length > 180) {
                    counter.addClass('warning');
                } else {
                    counter.removeClass('warning');
                }
            });
            
            // Auto-focus on the title field
            setTimeout(() => input.focus(), 50);
        });

        // Due Date
        this.createFormGroup(contentEl, 'Due Date', (container) => {
            const input = container.createEl('input', { 
                type: 'date',
                value: this.dueDate
            });
            
            input.addEventListener('change', (e) => {
                this.dueDate = (e.target as HTMLInputElement).value;
            });
        });

        // Priority
        this.createFormGroup(contentEl, 'Priority', (container) => {
            const select = container.createEl('select');
            
            const priorities = this.plugin.priorityManager.getPrioritiesByWeight();
            
            priorities.forEach(priorityConfig => {
                const optEl = select.createEl('option', { 
                    value: priorityConfig.value, 
                    text: priorityConfig.label 
                });
                if (priorityConfig.value === this.priority) {
                    optEl.selected = true;
                }
            });
            
            select.addEventListener('change', (e) => {
                this.priority = (e.target as HTMLSelectElement).value;
            });
        });

        // Status
        this.createFormGroup(contentEl, 'Status', (container) => {
            const select = container.createEl('select');
            
            const statuses = this.plugin.statusManager.getStatusesByOrder();
            
            statuses.forEach(statusConfig => {
                const optEl = select.createEl('option', { 
                    value: statusConfig.value, 
                    text: statusConfig.label 
                });
                if (statusConfig.value === this.status) {
                    optEl.selected = true;
                }
            });
            
            select.addEventListener('change', (e) => {
                this.status = (e.target as HTMLSelectElement).value;
            });
        });

        // Time Estimate
        this.createFormGroup(contentEl, 'Time estimate', (container) => {
            const timeContainer = container.createDiv({ cls: 'time-estimate-container' });
            const input = timeContainer.createEl('input', { 
                type: 'number',
                value: this.timeEstimate.toString(),
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
            
            // Set initial label
            this.updateTimeLabel(label, this.timeEstimate);
            
            input.addEventListener('input', (e) => {
                const value = parseInt((e.target as HTMLInputElement).value) || 0;
                this.timeEstimate = value;
                this.updateTimeLabel(label, value);
            });
        });

        // Recurrence (full-width)
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
                const optEl = select.createEl('option', { value: option.value, text: option.text });
                if (option.value === this.recurrence) {
                    optEl.selected = true;
                }
            });
            
            select.addEventListener('change', (e) => {
                this.recurrence = (e.target as HTMLSelectElement).value as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
                this.updateRecurrenceOptions(contentEl);
            });
        });

        // Recurrence options container
        const recurrenceOptions = contentEl.createDiv({ cls: 'recurrence-options' });
        this.updateRecurrenceOptions(contentEl);

        // Contexts with autocomplete (full-width)
        this.createFormGroup(contentEl, 'Contexts', (container) => {
            this.createAutocompleteInput(container, 'contexts', this.existingContexts, (value) => {
                this.contexts = value;
            });
        });

        // Tags with autocomplete (full-width)
        this.createFormGroup(contentEl, 'Tags', (container) => {
            this.createAutocompleteInput(container, 'tags', this.existingTags, (value) => {
                this.tags = value;
            });
        });

        // Footer with metadata and buttons
        const footer = contentEl.createDiv({ cls: 'modal-footer' });
        
        // Left side: read-only metadata
        const metadataContainer = footer.createDiv({ cls: 'metadata-info' });
        const createdText = metadataContainer.createSpan({ 
            cls: 'metadata-item',
            text: `Created: ${this.task.dateCreated ? format(new Date(this.task.dateCreated), 'MMM dd, yyyy') : 'Unknown'}` 
        });
        const modifiedText = metadataContainer.createSpan({ 
            cls: 'metadata-item',
            text: `Modified: ${this.task.dateModified ? format(new Date(this.task.dateModified), 'MMM dd, yyyy') : 'Unknown'}` 
        });
        
        // Right side: action buttons
        const buttonContainer = footer.createDiv({ cls: 'button-container' });
        
        const openNoteButton = buttonContainer.createEl('button', { 
            text: 'Open Note',
            cls: 'secondary-button'
        });
        openNoteButton.addEventListener('click', () => {
            this.openNote();
        });
        
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            this.close();
        });
        
        const saveButton = buttonContainer.createEl('button', { 
            text: 'Save',
            cls: 'create-button'
        });
        saveButton.addEventListener('click', () => {
            this.saveTask();
        });

        // Keyboard navigation
        contentEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.saveTask();
            }
        });
    }

    createFormGroup(container: HTMLElement, label: string, inputCallback: (container: HTMLElement) => void) {
        const group = container.createDiv({ cls: 'form-group' });
        group.createEl('label', { text: label });
        inputCallback(group);
        return group;
    }
    
    
    // Load suggestions for autocomplete using instant cache methods
    private loadSuggestions() {
        try {
            // Use instant cache methods for contexts and tags
            this.existingContexts = this.plugin.cacheManager.getAllContexts();
            
            // Filter out the default task tag from tags
            const allTags = this.plugin.cacheManager.getAllTags();
            this.existingTags = allTags.filter(tag => tag !== this.plugin.settings.taskTag);
        } catch (error) {
            // Provide fallback suggestions on error
            this.existingContexts = ['work', 'home', 'personal', 'urgent'];
            this.existingTags = ['important', 'review', 'research', 'followup'];
        }
    }
    
    private createAutocompleteInput(
        container: HTMLElement,
        fieldName: string,
        suggestions: string[],
        onChangeFn: (value: string) => void
    ) {
        const inputContainer = container.createDiv({ cls: 'autocomplete-container' });
        const input = inputContainer.createEl('input', {
            type: 'text',
            cls: 'autocomplete-input',
            value: fieldName === 'contexts' ? this.contexts : this.tags,
            attr: { placeholder: 'Type to see suggestions...' }
        });
        
        const suggestionsContainer = inputContainer.createDiv({ cls: 'autocomplete-suggestions' });
        suggestionsContainer.addClass('is-hidden');
        
        let selectedIndex = -1;
        
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
            setTimeout(() => {
                this.hideSuggestions(suggestionsContainer);
            }, 150);
        });
    }
    
    private showSuggestions(
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
    
    private applySuggestion(input: HTMLInputElement, suggestion: string, onChangeFn: (value: string) => void) {
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
    
    private updateSelectedSuggestion(suggestions: NodeListOf<Element>, selectedIndex: number) {
        suggestions.forEach((el, index) => {
            if (index === selectedIndex) {
                el.addClass('selected');
            } else {
                el.removeClass('selected');
            }
        });
    }
    
    private hideSuggestions(container: HTMLElement) {
        container.addClass('is-hidden');
        container.empty();
    }
    
    private async openNote() {
        const file = this.app.vault.getAbstractFileByPath(this.task.path);
        if (file && file instanceof TFile) {
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
            this.close();
        } else {
            new Notice('Task file not found');
        }
    }

    updateTimeLabel(label: HTMLElement, value: number) {
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
            checkbox.checked = this.daysOfWeek.includes(shortDays[index]);
            
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
            const input = group.createEl('input', { 
                type: 'number',
                value: this.dayOfMonth,
                attr: { min: '1', max: '31' }
            });
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
                const optEl = select.createEl('option', { value: month.value, text: month.text });
                if (month.value === this.monthOfYear) {
                    optEl.selected = true;
                }
            });
            
            select.addEventListener('change', (e) => {
                this.monthOfYear = (e.target as HTMLSelectElement).value;
            });
        });

        // Day of month selector
        this.createFormGroup(container, 'Day of month', (group) => {
            const input = group.createEl('input', { 
                type: 'number',
                value: this.dayOfMonth,
                attr: { min: '1', max: '31' }
            });
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

    async saveTask() {
        if (!this.title || !this.title.trim()) {
            new Notice('Title is required');
            return;
        }

        if (this.title.length > 200) {
            new Notice('Task title is too long (max 200 characters)');
            return;
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
            // Show saving state
            const saveButton = document.querySelector('.create-button') as HTMLButtonElement;
            if (saveButton) {
                saveButton.disabled = true;
                saveButton.textContent = 'Saving...';
            }

            // Prepare updated task data
            const updatedTask: Partial<TaskInfo> = {
                title: this.title,
                due: this.dueDate || undefined,
                priority: this.priority,
                status: this.status,
                timeEstimate: this.timeEstimate > 0 ? this.timeEstimate : undefined,
                dateModified: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss")
            };

            // Handle tags
            let tagsArray = [this.plugin.settings.taskTag];
            if (this.tags) {
                tagsArray = tagsArray.concat(
                    this.tags.split(',')
                        .map(tag => tag.trim())
                        .filter(tag => tag.length > 0)
                );
            }
            updatedTask.tags = tagsArray;

            // Handle contexts
            if (this.contexts) {
                updatedTask.contexts = this.contexts.split(',')
                    .map(context => context.trim())
                    .filter(context => context.length > 0);
            } else {
                updatedTask.contexts = undefined;
            }

            // Handle completion date
            if (this.plugin.statusManager.isCompletedStatus(this.status)) {
                if (!this.task.completedDate) {
                    updatedTask.completedDate = format(new Date(), 'yyyy-MM-dd');
                }
            } else {
                updatedTask.completedDate = undefined;
            }

            // Handle recurrence
            if (this.recurrence !== 'none') {
                updatedTask.recurrence = {
                    frequency: this.recurrence
                };
                
                if (this.recurrence === 'weekly' && this.daysOfWeek.length > 0) {
                    updatedTask.recurrence.days_of_week = this.daysOfWeek;
                }
                
                if (this.recurrence === 'monthly' && this.dayOfMonth) {
                    updatedTask.recurrence.day_of_month = parseInt(this.dayOfMonth);
                }
                
                if (this.recurrence === 'yearly') {
                    if (this.dayOfMonth) {
                        updatedTask.recurrence.day_of_month = parseInt(this.dayOfMonth);
                    }
                    if (this.monthOfYear) {
                        updatedTask.recurrence.month_of_year = parseInt(this.monthOfYear);
                    }
                }
                
                // Preserve existing complete instances
                updatedTask.complete_instances = this.task.complete_instances || [];
            } else {
                updatedTask.recurrence = undefined;
                updatedTask.complete_instances = undefined;
            }

            // Use the new deterministic TaskService architecture
            const file = this.app.vault.getAbstractFileByPath(this.task.path);
            if (!(file instanceof TFile)) {
                throw new Error('Task file not found');
            }

            // Step 1: Construct complete new state
            const newTaskInfo: TaskInfo = {
                ...this.task,
                ...updatedTask,
                dateModified: new Date().toISOString()
            } as TaskInfo;

            // Step 2: Persist to file using the authoritative state
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                const yamlData = this.plugin.fieldMapper.mapToFrontmatter(newTaskInfo);
                Object.assign(frontmatter, yamlData);
            });

            // Step 3: Proactively update cache
            await this.plugin.cacheManager.updateTaskInfoInCache(this.task.path, newTaskInfo);

            // Step 4: Notify system of change
            this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
                path: this.task.path,
                updatedTask: newTaskInfo
            });

            // Step 5: Success feedback and cleanup
            new Notice('Task updated successfully');
            this.close();

        } catch (error) {
            console.error('Error updating task:', error);
            new Notice('Error updating task. Check the console for details.');
            
            // Reset save button state
            const saveButton = document.querySelector('.create-button') as HTMLButtonElement;
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = 'Save';
            }
        }
    }


    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}