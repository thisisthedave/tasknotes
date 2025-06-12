import { App, Modal, Setting } from 'obsidian';
import { format, add, isValid, parse } from 'date-fns';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';
import { 
    validateDateTimeInput, 
    hasTimeComponent, 
    getDatePart, 
    getTimePart,
    combineDateAndTime,
    addDaysToDateTime,
    getCurrentDateTimeString 
} from '../utils/dateUtils';

export class DueDateModal extends Modal {
    private task: TaskInfo;
    private plugin: TaskNotesPlugin;
    private dueDateInput: HTMLInputElement;
    private dueTimeInput: HTMLInputElement;
    private includeTimeCheckbox: HTMLInputElement;

    constructor(app: App, task: TaskInfo, plugin: TaskNotesPlugin) {
        super(app);
        this.task = task;
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('tasknotes-plugin');
        
        // Set up modal accessibility
        this.titleEl.setText('Set Due Date');
        this.titleEl.setAttribute('id', 'due-date-modal-title');
        this.containerEl.setAttribute('aria-labelledby', 'due-date-modal-title');
        this.containerEl.setAttribute('role', 'dialog');
        this.containerEl.setAttribute('aria-modal', 'true');

        new Setting(contentEl)
            .setName('Set due date')
            .setHeading();

        // Task title display
        contentEl.createEl('p', { 
            text: `Task: ${this.task.title}`,
            cls: 'due-date-modal__task-title'
        });

        // Due date input
        new Setting(contentEl)
            .setName('Due Date')
            .setDesc('Enter due date or leave empty to remove due date')
            .addText(text => {
                this.dueDateInput = text.inputEl;
                this.dueDateInput.setAttribute('aria-label', 'Due date for task');
                this.dueDateInput.setAttribute('aria-describedby', 'due-date-desc');
                text.setPlaceholder('YYYY-MM-DD')
                    .setValue(getDatePart(this.task.due || ''));

                // Set input type to date for better UX
                text.inputEl.type = 'date';
                
                // Focus the input
                setTimeout(() => text.inputEl.focus(), 100);
                
                // Handle Enter key
                text.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this.save();
                    } else if (e.key === 'Escape') {
                        this.close();
                    }
                });
            });

        // Include time checkbox
        new Setting(contentEl)
            .setName('Include time')
            .setDesc('Add a specific time to the due date')
            .addToggle(toggle => {
                this.includeTimeCheckbox = toggle.toggleEl as HTMLInputElement;
                toggle.setValue(hasTimeComponent(this.task.due || ''))
                    .onChange((value) => {
                        this.dueTimeInput.style.display = value ? 'block' : 'none';
                        if (!value) {
                            this.dueTimeInput.value = '';
                        } else if (!this.dueTimeInput.value) {
                            // Default to current time
                            const now = new Date();
                            this.dueTimeInput.value = format(now, 'HH:mm');
                        }
                    });
            });

        // Due time input (initially hidden)
        new Setting(contentEl)
            .setName('Time')
            .setDesc('Time in 24-hour format (HH:MM)')
            .addText(text => {
                this.dueTimeInput = text.inputEl;
                this.dueTimeInput.setAttribute('aria-label', 'Due time for task');
                text.setPlaceholder('HH:MM')
                    .setValue(getTimePart(this.task.due || '') || '');

                // Set input type to time for better UX
                text.inputEl.type = 'time';
                
                // Initially hide if no time component
                text.inputEl.style.display = hasTimeComponent(this.task.due || '') ? 'block' : 'none';
                
                // Handle Enter key
                text.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this.save();
                    } else if (e.key === 'Escape') {
                        this.close();
                    }
                });
            });

        // Quick date buttons
        const quickDatesContainer = contentEl.createDiv({ cls: 'modal-form__group' });
        new Setting(quickDatesContainer)
            .setName('Quick options')
            .setHeading();

        const buttonsContainer = quickDatesContainer.createDiv({ cls: 'modal-form__quick-actions' });

        // Today button
        const todayBtn = buttonsContainer.createEl('button', { 
            text: 'Today', 
            cls: 'modal-form__button modal-form__button--quick-date',
            attr: { 'aria-label': 'Set due date to today' }
        });
        todayBtn.addEventListener('click', () => {
            this.dueDateInput.value = format(new Date(), 'yyyy-MM-dd');
        });

        // Tomorrow button
        const tomorrowBtn = buttonsContainer.createEl('button', { 
            text: 'Tomorrow', 
            cls: 'modal-form__button modal-form__button--quick-date',
            attr: { 'aria-label': 'Set due date to tomorrow' }
        });
        tomorrowBtn.addEventListener('click', () => {
            this.dueDateInput.value = format(add(new Date(), { days: 1 }), 'yyyy-MM-dd');
        });

        // Next week button
        const nextWeekBtn = buttonsContainer.createEl('button', { 
            text: 'Next week', 
            cls: 'modal-form__button modal-form__button--quick-date',
            attr: { 'aria-label': 'Set due date to next week' }
        });
        nextWeekBtn.addEventListener('click', () => {
            this.dueDateInput.value = format(add(new Date(), { weeks: 1 }), 'yyyy-MM-dd');
        });

        // Now button (today with current time)
        const nowBtn = buttonsContainer.createEl('button', { 
            text: 'Now', 
            cls: 'modal-form__button modal-form__button--quick-date',
            attr: { 'aria-label': 'Set due date and time to now' }
        });
        nowBtn.addEventListener('click', () => {
            const now = new Date();
            this.dueDateInput.value = format(now, 'yyyy-MM-dd');
            this.dueTimeInput.value = format(now, 'HH:mm');
            this.includeTimeCheckbox.checked = true;
            this.dueTimeInput.style.display = 'block';
        });

        // Clear button
        const clearBtn = buttonsContainer.createEl('button', { 
            text: 'Clear', 
            cls: 'modal-form__button modal-form__button--quick-date modal-form__button--quick-date--clear',
            attr: { 'aria-label': 'Clear due date' }
        });
        clearBtn.addEventListener('click', () => {
            this.dueDateInput.value = '';
            this.dueTimeInput.value = '';
            this.includeTimeCheckbox.checked = false;
            this.dueTimeInput.style.display = 'none';
        });

        // Action buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-form__buttons' });
        
        const saveButton = buttonContainer.createEl('button', { 
            text: 'Save',
            cls: 'modal-form__button modal-form__button--primary'
        });
        saveButton.addEventListener('click', () => this.save());

        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'modal-form__button modal-form__button--secondary'
        });
        cancelButton.addEventListener('click', () => this.close());
    }

    private async save() {
        const dateValue = this.dueDateInput.value.trim();
        const timeValue = this.dueTimeInput.value.trim();
        const includeTime = this.includeTimeCheckbox.checked;
        
        // Build the final date/datetime value
        let finalValue: string | undefined;
        
        if (!dateValue) {
            finalValue = undefined; // Clear the due date
        } else if (includeTime && timeValue) {
            finalValue = combineDateAndTime(dateValue, timeValue);
        } else {
            finalValue = dateValue; // Date only
        }
        
        // Validate the final value
        if (!validateDateTimeInput(dateValue, includeTime ? timeValue : undefined)) {
            // Show error message
            const errorEl = this.contentEl.createEl('div', { 
                text: 'Please enter a valid date and time format',
                cls: 'modal-form__error',
                attr: {
                    'role': 'alert',
                    'aria-live': 'assertive'
                }
            });
            this.dueDateInput.setAttribute('aria-invalid', 'true');
            this.dueDateInput.setAttribute('aria-describedby', 'due-date-error');
            errorEl.setAttribute('id', 'due-date-error');
            setTimeout(() => {
                errorEl.remove();
                this.dueDateInput.removeAttribute('aria-invalid');
                this.dueDateInput.removeAttribute('aria-describedby');
            }, 3000);
            return;
        }

        try {
            // Use the TaskService to update the property with proper cache timing
            await this.plugin.taskService.updateProperty(
                this.task, 
                'due', 
                finalValue
            );
            this.close();
        } catch (error) {
            console.error('Failed to update due date:', error);
            const errorEl = this.contentEl.createEl('div', { 
                text: 'Failed to update due date. Please try again.',
                cls: 'modal-form__error'
            });
            setTimeout(() => errorEl.remove(), 3000);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}