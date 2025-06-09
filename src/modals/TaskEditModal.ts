import { App, Notice, TFile, Setting } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { BaseTaskModal } from './BaseTaskModal';
import { TaskInfo, EVENT_TASK_UPDATED } from '../types';

export class TaskEditModal extends BaseTaskModal {
    task: TaskInfo;

    constructor(app: App, plugin: TaskNotesPlugin, task: TaskInfo) {
        super(app, plugin);
        this.task = task;
    }

    protected initializeFormData(): void {
        // Initialize form fields with current task data
        this.title = this.task.title;
        this.dueDate = this.task.due || '';
        this.scheduledDate = this.task.scheduled || '';
        this.priority = this.task.priority;
        this.status = this.task.status;
        this.contexts = this.task.contexts ? this.task.contexts.join(', ') : '';
        this.tags = this.task.tags ? this.task.tags.filter(tag => tag !== this.plugin.settings.taskTag).join(', ') : '';
        this.timeEstimate = this.task.timeEstimate || 0;
        this.recurrence = this.task.recurrence?.frequency || 'none';
        
        if (this.task.recurrence) {
            // Convert stored abbreviations to full names for UI display
            this.daysOfWeek = this.convertAbbreviationsToFullNames(this.task.recurrence.days_of_week || []);
            this.dayOfMonth = this.task.recurrence.day_of_month?.toString() || '';
            this.monthOfYear = this.task.recurrence.month_of_year?.toString() || '';
        }
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass('tasknotes-plugin', 'task-edit-modal');
        new Setting(contentEl)
            .setName('Edit task')
            .setHeading();

        // Initialize form data and cache autocomplete data
        this.initializeFormData();
        this.existingContexts = await this.getExistingContexts();
        this.existingTags = await this.getExistingTags();

        // Title with character count
        this.createFormGroup(contentEl, 'Title', (container) => {
            this.createTitleInputWithCounter(container, 200);
            
            // Auto-focus on the title field for immediate editing
            const input = container.querySelector('input');
            if (input) {
                setTimeout(() => input.focus(), 50);
            }
        });

        // Due Date
        this.createFormGroup(contentEl, 'Due date', (container) => {
            this.createDueDateInput(container);
        });

        // Scheduled Date
        this.createFormGroup(contentEl, 'Scheduled date', (container) => {
            this.createScheduledDateInput(container);
        });

        // Priority
        this.createFormGroup(contentEl, 'Priority', (container) => {
            this.createPriorityDropdown(container);
        });

        // Status
        this.createFormGroup(contentEl, 'Status', (container) => {
            this.createStatusDropdown(container);
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

        // Metadata footer
        this.createMetadataFooter(contentEl);

        // Action buttons
        this.createActionButtons(contentEl);

        // Keyboard shortcuts
        contentEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.saveTask();
            }
        });
    }

    protected createActionButtons(container: HTMLElement): void {
        const buttonContainer = container.createDiv({ cls: 'modal-form__buttons' });
        
        // Open Note button
        const openButton = buttonContainer.createEl('button', { 
            text: 'Open note', 
            cls: 'modal-form__button modal-form__button--tertiary' 
        });
        openButton.addEventListener('click', () => {
            this.openNote();
        });

        // Save button
        const saveButton = buttonContainer.createEl('button', { 
            text: 'Save', 
            cls: 'modal-form__button modal-form__button--primary' 
        });
        saveButton.addEventListener('click', () => {
            this.saveTask();
        });
        
        // Cancel button
        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel', 
            cls: 'modal-form__button modal-form__button--secondary' 
        });
        cancelButton.addEventListener('click', () => {
            this.close();
        });
    }

    protected async handleSubmit(): Promise<void> {
        await this.saveTask();
    }

    private createMetadataFooter(container: HTMLElement): void {
        const footer = container.createDiv({ cls: 'task-edit-modal__metadata' });
        
        const metadataContainer = footer.createDiv({ cls: 'task-edit-modal__metadata-container' });
        
        if (this.task.dateCreated) {
            const createdDate = new Date(this.task.dateCreated);
            metadataContainer.createDiv({
                cls: 'task-edit-modal__metadata-item',
                text: `Created: ${format(createdDate, 'MMM d, yyyy \'at\' h:mm a')}`
            });
        }
        
        if (this.task.dateModified) {
            const modifiedDate = new Date(this.task.dateModified);
            metadataContainer.createDiv({
                cls: 'task-edit-modal__metadata-item',
                text: `Modified: ${format(modifiedDate, 'MMM d, yyyy \'at\' h:mm a')}`
            });
        }
    }

    private openNote(): void {
        const file = this.app.vault.getAbstractFileByPath(this.task.path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file);
            this.close();
        }
    }

    async saveTask() {
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
            const file = this.app.vault.getAbstractFileByPath(this.task.path);
            if (!(file instanceof TFile)) {
                new Notice('Could not find task file');
                return;
            }

            // Prepare contexts and tags arrays
            const contextsArray = this.contexts ? this.contexts.split(',').map(c => c.trim()).filter(c => c) : [];
            const tagsArray = this.tags ? this.tags.split(',').map(t => t.trim()).filter(t => t) : [];
            
            // Add task tag if not present
            if (!tagsArray.includes(this.plugin.settings.taskTag)) {
                tagsArray.unshift(this.plugin.settings.taskTag);
            }

            // Update the task file
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                // Create updated TaskInfo object
                const updatedTaskData: Partial<TaskInfo> = {
                    title: this.title,
                    priority: this.priority,
                    status: this.status,
                    due: this.dueDate || undefined,
                    scheduled: this.scheduledDate || undefined,
                    contexts: contextsArray.length > 0 ? contextsArray : undefined,
                    timeEstimate: this.timeEstimate > 0 ? this.timeEstimate : undefined,
                    dateModified: new Date().toISOString()
                };

                // Handle completion date for status changes
                if (this.plugin.statusManager.isCompletedStatus(this.status) && !this.task.recurrence) {
                    if (!this.task.completedDate) {
                        updatedTaskData.completedDate = format(new Date(), 'yyyy-MM-dd');
                    }
                } else if (!this.plugin.statusManager.isCompletedStatus(this.status)) {
                    updatedTaskData.completedDate = undefined;
                }

                // Handle recurrence
                if (this.recurrence !== 'none') {
                    updatedTaskData.recurrence = {
                        frequency: this.recurrence
                    };

                    if (this.recurrence === 'weekly' && this.daysOfWeek.length > 0) {
                        // Convert full names back to abbreviations for storage
                        updatedTaskData.recurrence.days_of_week = this.convertFullNamesToAbbreviations(this.daysOfWeek);
                    }

                    if (this.recurrence === 'monthly' && this.dayOfMonth) {
                        updatedTaskData.recurrence.day_of_month = parseInt(this.dayOfMonth);
                    }

                    if (this.recurrence === 'yearly') {
                        if (this.monthOfYear) {
                            updatedTaskData.recurrence.month_of_year = parseInt(this.monthOfYear);
                        }
                        if (this.dayOfMonth) {
                            updatedTaskData.recurrence.day_of_month = parseInt(this.dayOfMonth);
                        }
                    }
                } else {
                    updatedTaskData.recurrence = undefined;
                }

                // Preserve complete_instances for recurring tasks
                if (this.task.complete_instances) {
                    updatedTaskData.complete_instances = this.task.complete_instances;
                }

                // Use field mapper to update frontmatter with proper field mapping
                const mappedUpdates = this.plugin.fieldMapper.mapToFrontmatter(updatedTaskData, this.plugin.settings.taskTag);
                
                // Apply all updates to frontmatter
                Object.keys(mappedUpdates).forEach(key => {
                    if (mappedUpdates[key] !== undefined) {
                        frontmatter[key] = mappedUpdates[key];
                    }
                });

                // Remove fields that are now undefined
                if (updatedTaskData.due === undefined) {
                    delete frontmatter[this.plugin.fieldMapper.toUserField('due')];
                }
                if (updatedTaskData.scheduled === undefined) {
                    delete frontmatter[this.plugin.fieldMapper.toUserField('scheduled')];
                }
                if (updatedTaskData.contexts === undefined) {
                    delete frontmatter[this.plugin.fieldMapper.toUserField('contexts')];
                }
                if (updatedTaskData.timeEstimate === undefined) {
                    delete frontmatter[this.plugin.fieldMapper.toUserField('timeEstimate')];
                }
                if (updatedTaskData.completedDate === undefined) {
                    delete frontmatter[this.plugin.fieldMapper.toUserField('completedDate')];
                }
                if (updatedTaskData.recurrence === undefined) {
                    delete frontmatter[this.plugin.fieldMapper.toUserField('recurrence')];
                }

                // Tags are handled separately (not via field mapper)
                frontmatter.tags = tagsArray;
            });

            // Create updated TaskInfo for cache and events
            const updatedTask: TaskInfo = {
                ...this.task,
                title: this.title,
                priority: this.priority,
                status: this.status,
                due: this.dueDate || undefined,
                scheduled: this.scheduledDate || undefined,
                contexts: contextsArray.length > 0 ? contextsArray : undefined,
                tags: tagsArray,
                timeEstimate: this.timeEstimate > 0 ? this.timeEstimate : undefined,
                dateModified: new Date().toISOString(),
                recurrence: this.recurrence !== 'none' ? {
                    frequency: this.recurrence,
                    days_of_week: this.recurrence === 'weekly' ? this.convertFullNamesToAbbreviations(this.daysOfWeek) : undefined,
                    day_of_month: (this.recurrence === 'monthly' || this.recurrence === 'yearly') && this.dayOfMonth ? parseInt(this.dayOfMonth) : undefined,
                    month_of_year: this.recurrence === 'yearly' && this.monthOfYear ? parseInt(this.monthOfYear) : undefined
                } : undefined
            };

            // Handle completion date for non-recurring tasks
            if (this.plugin.statusManager.isCompletedStatus(this.status) && !updatedTask.recurrence) {
                updatedTask.completedDate = this.task.completedDate || format(new Date(), 'yyyy-MM-dd');
            } else if (!this.plugin.statusManager.isCompletedStatus(this.status)) {
                updatedTask.completedDate = undefined;
            }

            // Update cache proactively
            await this.plugin.cacheManager.updateTaskInfoInCache(this.task.path, updatedTask);

            // Emit task updated event
            this.plugin.emitter.emit(EVENT_TASK_UPDATED, {
                path: this.task.path,
                originalTask: this.task,
                updatedTask: updatedTask
            });

            new Notice('Task updated successfully');
            this.close();

        } catch (error) {
            console.error('Failed to save task:', error);
            new Notice('Failed to save task. Please try again.');
        }
    }
}
