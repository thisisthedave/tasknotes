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

export class ScheduledDateModal extends Modal {
    private task: TaskInfo;
    private plugin: TaskNotesPlugin;
    private scheduledDateInput: HTMLInputElement;
    private scheduledTimeInput: HTMLInputElement;
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

        new Setting(contentEl)
            .setName('Set scheduled date')
            .setHeading();

        // Task title display
        contentEl.createEl('p', { 
            text: `Task: ${this.task.title}`,
            cls: 'scheduled-date-modal__task-title'
        });

        // Scheduled date input
        new Setting(contentEl)
            .setName('Scheduled date')
            .setDesc('Enter scheduled date or leave empty to remove scheduled date')
            .addText(text => {
                this.scheduledDateInput = text.inputEl;
                this.scheduledDateInput.setAttribute('aria-label', 'Scheduled date for task');
                text.setPlaceholder('YYYY-MM-DD')
                    .setValue(getDatePart(this.task.scheduled || ''));

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
            .setDesc('Add a specific time to the scheduled date')
            .addToggle(toggle => {
                this.includeTimeCheckbox = toggle.toggleEl as HTMLInputElement;
                toggle.setValue(hasTimeComponent(this.task.scheduled || ''))
                    .onChange((value) => {
                        this.scheduledTimeInput.style.display = value ? 'block' : 'none';
                        if (!value) {
                            this.scheduledTimeInput.value = '';
                        } else if (!this.scheduledTimeInput.value) {
                            // Default to current time
                            const now = new Date();
                            this.scheduledTimeInput.value = format(now, 'HH:mm');
                        }
                    });
            });

        // Scheduled time input (initially hidden)
        new Setting(contentEl)
            .setName('Time')
            .setDesc('Time in 24-hour format (HH:MM)')
            .addText(text => {
                this.scheduledTimeInput = text.inputEl;
                this.scheduledTimeInput.setAttribute('aria-label', 'Scheduled time for task');
                text.setPlaceholder('HH:MM')
                    .setValue(getTimePart(this.task.scheduled || '') || '');

                // Set input type to time for better UX
                text.inputEl.type = 'time';
                
                // Initially hide if no time component
                text.inputEl.style.display = hasTimeComponent(this.task.scheduled || '') ? 'block' : 'none';
                
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
        buttonsContainer.createEl('button', { 
            text: 'Today', 
            cls: 'modal-form__button modal-form__button--quick-date',
            attr: { 'aria-label': 'Set scheduled date to today' }
        })
            .addEventListener('click', () => {
                this.scheduledDateInput.value = format(new Date(), 'yyyy-MM-dd');
            });

        // Tomorrow button
        buttonsContainer.createEl('button', { 
            text: 'Tomorrow', 
            cls: 'modal-form__button modal-form__button--quick-date',
            attr: { 'aria-label': 'Set scheduled date to tomorrow' }
        })
            .addEventListener('click', () => {
                this.scheduledDateInput.value = format(add(new Date(), { days: 1 }), 'yyyy-MM-dd');
            });

        // Next week button
        buttonsContainer.createEl('button', { 
            text: 'Next week', 
            cls: 'modal-form__button modal-form__button--quick-date',
            attr: { 'aria-label': 'Set scheduled date to next week' }
        })
            .addEventListener('click', () => {
                this.scheduledDateInput.value = format(add(new Date(), { weeks: 1 }), 'yyyy-MM-dd');
            });

        // Now button (today with current time)
        buttonsContainer.createEl('button', { 
            text: 'Now', 
            cls: 'modal-form__button modal-form__button--quick-date',
            attr: { 'aria-label': 'Set scheduled date and time to now' }
        })
            .addEventListener('click', () => {
                const now = new Date();
                this.scheduledDateInput.value = format(now, 'yyyy-MM-dd');
                this.scheduledTimeInput.value = format(now, 'HH:mm');
                this.includeTimeCheckbox.checked = true;
                this.scheduledTimeInput.style.display = 'block';
            });

        // Clear button
        buttonsContainer.createEl('button', { 
            text: 'Clear', 
            cls: 'modal-form__button modal-form__button--quick-date modal-form__button--quick-date--clear',
            attr: { 'aria-label': 'Clear scheduled date' }
        })
            .addEventListener('click', () => {
                this.scheduledDateInput.value = '';
                this.scheduledTimeInput.value = '';
                this.includeTimeCheckbox.checked = false;
                this.scheduledTimeInput.style.display = 'none';
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
        const dateValue = this.scheduledDateInput.value.trim();
        const timeValue = this.scheduledTimeInput.value.trim();
        const includeTime = this.includeTimeCheckbox.checked;
        
        // Build the final date/datetime value
        let finalValue: string | undefined;
        
        if (!dateValue) {
            finalValue = undefined; // Clear the scheduled date
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
            this.scheduledDateInput.setAttribute('aria-invalid', 'true');
            setTimeout(() => {
                errorEl.remove();
                this.scheduledDateInput.removeAttribute('aria-invalid');
            }, 3000);
            return;
        }

        try {
            // Use the TaskService to update the property with proper cache timing
            await this.plugin.taskService.updateProperty(
                this.task, 
                'scheduled', 
                finalValue
            );
            this.close();
        } catch (error) {
            console.error('Failed to update scheduled date:', error);
            const errorEl = this.contentEl.createEl('div', { 
                text: 'Failed to update scheduled date. Please try again.',
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
