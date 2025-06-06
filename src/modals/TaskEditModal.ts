import { App, Modal, Notice, TFile } from 'obsidian';
import { format } from 'date-fns';
import * as YAML from 'yaml';
import TaskNotesPlugin from '../main';
import { TaskInfo } from '../types';

export class TaskEditModal extends Modal {
    plugin: TaskNotesPlugin;
    task: TaskInfo;
    
    // Form fields
    title: string;
    details: string;
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

    constructor(app: App, plugin: TaskNotesPlugin, task: TaskInfo) {
        super(app);
        this.plugin = plugin;
        this.task = task;
        
        // Initialize form fields with current task data
        this.title = task.title;
        this.details = ''; // Note: details are not stored in TaskInfo, will be extracted from file content
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

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass('task-edit-modal');
        contentEl.createEl('h2', { text: 'Edit Task' });

        // Title
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

        // Details
        this.createFormGroup(contentEl, 'Details', (container) => {
            const textarea = container.createEl('textarea', {
                value: this.details,
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

        // Contexts
        this.createFormGroup(contentEl, 'Contexts (comma-separated)', (container) => {
            const input = container.createEl('input', { 
                type: 'text',
                value: this.contexts,
                attr: { placeholder: 'work, home, urgent...' }
            });
            input.addEventListener('input', (e) => {
                this.contexts = (e.target as HTMLInputElement).value;
            });
        });

        // Tags
        this.createFormGroup(contentEl, 'Tags (comma-separated)', (container) => {
            const input = container.createEl('input', { 
                type: 'text',
                value: this.tags,
                attr: { placeholder: 'important, review, research...' }
            });
            input.addEventListener('input', (e) => {
                this.tags = (e.target as HTMLInputElement).value;
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

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
        
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => {
            this.close();
        });
        
        const saveButton = buttonContainer.createEl('button', { text: 'Save Changes', cls: 'create-button' });
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
        
        const daysContainer = container.createDiv({ cls: 'days-container' });
        
        const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const shortDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        
        daysOfWeek.forEach((day, index) => {
            const dayRow = daysContainer.createDiv({ cls: 'day-row' });
            
            const label = dayRow.createEl('label', { cls: 'day-checkbox-label' });
            const checkbox = label.createEl('input', { 
                type: 'checkbox',
                cls: 'day-checkbox'
            });
            
            checkbox.dataset.day = shortDays[index];
            checkbox.checked = this.daysOfWeek.includes(shortDays[index]);
            
            label.appendChild(document.createTextNode(' ' + day));
            
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
            // Prepare updated task data
            const updatedTask: Partial<TaskInfo> = {
                ...this.task,
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

            // Update the task file
            const file = this.app.vault.getAbstractFileByPath(this.task.path);
            if (file && file instanceof TFile) {
                const content = await this.app.vault.read(file);
                const yamlData = this.plugin.fieldMapper.mapToFrontmatter(updatedTask);
                const newContent = this.updateYamlFrontmatterContent(content, yamlData);
                await this.app.vault.modify(file, newContent);

                new Notice('Task updated successfully');
                this.close();

                // Notify all views that data has changed
                this.plugin.notifyDataChanged();
            } else {
                new Notice('Task file not found');
            }

        } catch (error) {
            console.error('Error updating task:', error);
            new Notice('Error updating task. Check the console for details.');
        }
    }

    /**
     * Update YAML frontmatter in content with new data
     */
    private updateYamlFrontmatterContent(content: string, yamlData: any): string {
        // Find the end of the YAML frontmatter
        if (!content.startsWith('---')) {
            // No frontmatter, add it
            const yamlStr = YAML.stringify(yamlData);
            return `---\n${yamlStr}---\n\n${content}`;
        }
        
        const endOfFrontmatter = content.indexOf('---', 3);
        if (endOfFrontmatter === -1) {
            // Malformed frontmatter, replace with new
            const yamlStr = YAML.stringify(yamlData);
            return `---\n${yamlStr}---\n\n${content.substring(3)}`;
        }
        
        // Replace the frontmatter
        const restOfContent = content.substring(endOfFrontmatter + 3);
        const yamlStr = YAML.stringify(yamlData);
        return `---\n${yamlStr}---${restOfContent}`;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}