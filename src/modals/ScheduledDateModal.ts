import { App, Modal, Setting } from 'obsidian';
import { format, add, isValid, parse } from 'date-fns';
import { TaskInfo } from '../types';
import TaskNotesPlugin from '../main';

export class ScheduledDateModal extends Modal {
    private task: TaskInfo;
    private plugin: TaskNotesPlugin;
    private scheduledDateInput: HTMLInputElement;

    constructor(app: App, task: TaskInfo, plugin: TaskNotesPlugin) {
        super(app);
        this.task = task;
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        new Setting(contentEl)
            .setName('Set scheduled date')
            .setHeading();

        // Task title display
        contentEl.createEl('p', { 
            text: `Task: ${this.task.title}`,
            cls: 'task-title-display'
        });

        // Scheduled date input
        new Setting(contentEl)
            .setName('Scheduled Date')
            .setDesc('Enter scheduled date (YYYY-MM-DD) or leave empty to remove scheduled date')
            .addText(text => {
                this.scheduledDateInput = text.inputEl;
                text.setPlaceholder('YYYY-MM-DD')
                    .setValue(this.task.scheduled || '');

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

        // Quick date buttons
        const quickDatesContainer = contentEl.createDiv({ cls: 'quick-dates-container' });
        new Setting(quickDatesContainer)
            .setName('Quick options')
            .setHeading();

        const buttonsContainer = quickDatesContainer.createDiv({ cls: 'quick-date-buttons' });

        // Today button
        buttonsContainer.createEl('button', { text: 'Today', cls: 'quick-date-btn' })
            .addEventListener('click', () => {
                this.scheduledDateInput.value = format(new Date(), 'yyyy-MM-dd');
            });

        // Tomorrow button
        buttonsContainer.createEl('button', { text: 'Tomorrow', cls: 'quick-date-btn' })
            .addEventListener('click', () => {
                this.scheduledDateInput.value = format(add(new Date(), { days: 1 }), 'yyyy-MM-dd');
            });

        // Next week button
        buttonsContainer.createEl('button', { text: 'Next week', cls: 'quick-date-btn' })
            .addEventListener('click', () => {
                this.scheduledDateInput.value = format(add(new Date(), { weeks: 1 }), 'yyyy-MM-dd');
            });

        // Clear button
        buttonsContainer.createEl('button', { text: 'Clear', cls: 'quick-date-btn clear-btn' })
            .addEventListener('click', () => {
                this.scheduledDateInput.value = '';
            });

        // Action buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        
        const saveButton = buttonContainer.createEl('button', { 
            text: 'Save',
            cls: 'mod-cta'
        });
        saveButton.addEventListener('click', () => this.save());

        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel'
        });
        cancelButton.addEventListener('click', () => this.close());
    }

    private async save() {
        const dateValue = this.scheduledDateInput.value.trim();
        
        // Validate date format if not empty
        if (dateValue && !isValid(parse(dateValue, 'yyyy-MM-dd', new Date()))) {
            // Show error message
            const errorEl = this.contentEl.createEl('div', { 
                text: 'Please enter a valid date in YYYY-MM-DD format',
                cls: 'error-message'
            });
            setTimeout(() => errorEl.remove(), 3000);
            return;
        }

        try {
            // Use the TaskService to update the property with proper cache timing
            await this.plugin.taskService.updateProperty(
                this.task, 
                'scheduled', 
                dateValue || undefined
            );
            this.close();
        } catch (error) {
            console.error('Failed to update scheduled date:', error);
            const errorEl = this.contentEl.createEl('div', { 
                text: 'Failed to update scheduled date. Please try again.',
                cls: 'error-message'
            });
            setTimeout(() => errorEl.remove(), 3000);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}