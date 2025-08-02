import { App, Modal, Setting, setIcon, TAbstractFile, TFile, AbstractInputSuggest, setTooltip } from 'obsidian';
import TaskNotesPlugin from '../main';
import { DateContextMenu } from '../components/DateContextMenu';
import { PriorityContextMenu } from '../components/PriorityContextMenu';
import { StatusContextMenu } from '../components/StatusContextMenu';
import { RecurrenceContextMenu } from '../components/RecurrenceContextMenu';
import { getDatePart, getTimePart, combineDateAndTime } from '../utils/dateUtils';
import { ProjectSelectModal } from './ProjectSelectModal';

export abstract class TaskModal extends Modal {
    plugin: TaskNotesPlugin;
    
    // Core task properties
    protected title = '';
    protected details = '';
    protected dueDate = '';
    protected scheduledDate = '';
    protected priority = 'normal';
    protected status = 'open';
    protected contexts = '';
    protected projects = '';
    protected tags = '';
    protected timeEstimate = 0;
    protected points = 0;
    protected recurrenceRule = '';
    
    // Project link storage
    protected selectedProjectFiles: TAbstractFile[] = [];
    
    // UI elements
    protected titleInput: HTMLInputElement;
    protected detailsInput: HTMLTextAreaElement;
    protected contextsInput: HTMLInputElement;
    protected projectsInput: HTMLInputElement;
    protected tagsInput: HTMLInputElement;
    protected pointsInput: HTMLInputElement;
    protected projectsList: HTMLElement;
    protected actionBar: HTMLElement;
    protected detailsContainer: HTMLElement;
    protected isExpanded = false;

    constructor(app: App, plugin: TaskNotesPlugin) {
        super(app);
        this.plugin = plugin;
    }

    abstract initializeFormData(): Promise<void>;
    abstract handleSave(): Promise<void>;
    abstract getModalTitle(): string;

    onOpen() {
        this.containerEl.addClass('tasknotes-plugin', 'minimalist-task-modal');
        this.titleEl.textContent = this.getModalTitle();
        
        this.initializeFormData().then(() => {
            this.createModalContent();
            this.focusTitleInput();
        });
    }

    protected createModalContent(): void {
        const { contentEl } = this;
        contentEl.empty();

        // Create main container
        const container = contentEl.createDiv('minimalist-modal-container');

        // Create title input (prominent)
        this.createTitleInput(container);

        // Create action bar with icons
        this.createActionBar(container);

        // Create collapsible details section
        this.createDetailsSection(container);

        // Create save/cancel buttons
        this.createActionButtons(container);
    }

    protected createTitleInput(container: HTMLElement): void {
        const titleContainer = container.createDiv('title-input-container');
        
        this.titleInput = titleContainer.createEl('input', {
            type: 'text',
            cls: 'title-input',
            placeholder: 'What needs to be done?'
        });
        
        this.titleInput.value = this.title;
        this.titleInput.addEventListener('input', (e) => {
            this.title = (e.target as HTMLInputElement).value;
        });
    }

    protected createActionBar(container: HTMLElement): void {
        this.actionBar = container.createDiv('action-bar');

        // Due date icon
        this.createActionIcon(this.actionBar, 'calendar', 'Set due date', (icon, event) => {
            this.showDateContextMenu(event, 'due');
        }, 'due-date');

        // Scheduled date icon
        this.createActionIcon(this.actionBar, 'calendar-clock', 'Set scheduled date', (icon, event) => {
            this.showDateContextMenu(event, 'scheduled');
        }, 'scheduled-date');

        // Status icon
        this.createActionIcon(this.actionBar, 'dot-square', 'Set status', (icon, event) => {
            this.showStatusContextMenu(event);
        }, 'status');

        // Priority icon
        this.createActionIcon(this.actionBar, 'star', 'Set priority', (icon, event) => {
            this.showPriorityContextMenu(event);
        }, 'priority');

        // Recurrence icon
        this.createActionIcon(this.actionBar, 'refresh-ccw', 'Set recurrence', (icon, event) => {
            this.showRecurrenceContextMenu(event);
        }, 'recurrence');

        // Update icon states based on current values
        this.updateIconStates();
    }

    protected createActionIcon(
        container: HTMLElement, 
        iconName: string, 
        tooltip: string,
        onClick: (icon: HTMLElement, event: MouseEvent) => void,
        dataType?: string
    ): HTMLElement {
        const iconContainer = container.createDiv('action-icon');
        iconContainer.setAttribute('aria-label', tooltip);
        // Store initial tooltip for later updates but don't set title attribute
        iconContainer.setAttribute('data-initial-tooltip', tooltip);
        
        // Add data attribute for easier identification
        if (dataType) {
            iconContainer.setAttribute('data-type', dataType);
        }
        
        const icon = iconContainer.createSpan('icon');
        setIcon(icon, iconName);
        
        iconContainer.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick(iconContainer, event);
        });

        return iconContainer;
    }

    protected createDetailsSection(container: HTMLElement): void {
        this.detailsContainer = container.createDiv('details-container');
        if (!this.isExpanded) {
            this.detailsContainer.style.display = 'none';
        }

        // Title field appears in details section for:
        // 1. Edit modals (always)
        // 2. Creation modals when NLP is enabled (since the main title input is replaced by NLP textarea)
        const isEditModal = this.getModalTitle() === 'Edit task';
        const isCreationWithNLP = this.getModalTitle() === 'Create task' && this.plugin.settings.enableNaturalLanguageInput;
        
        if (isEditModal || isCreationWithNLP) {
            const titleLabel = this.detailsContainer.createDiv('detail-label');
            titleLabel.textContent = 'Title';
            
            const titleInputDetailed = this.detailsContainer.createEl('input', {
                type: 'text',
                cls: 'title-input-detailed',
                placeholder: 'Task title...'
            });
            
            titleInputDetailed.value = this.title;
            titleInputDetailed.addEventListener('input', (e) => {
                this.title = (e.target as HTMLInputElement).value;
            });
            
            // Store reference for creation modals with NLP
            if (isCreationWithNLP && !this.titleInput) {
                this.titleInput = titleInputDetailed;
            }
        }

        // Details textarea (only for creation modals, not edit modals)
        if (this.getModalTitle() !== 'Edit task') {
            const detailsLabel = this.detailsContainer.createDiv('detail-label');
            detailsLabel.textContent = 'Details';
            
            this.detailsInput = this.detailsContainer.createEl('textarea', {
                cls: 'details-input',
                placeholder: 'Add more details...'
            });
            
            this.detailsInput.value = this.details;
            this.detailsInput.addEventListener('input', (e) => {
                this.details = (e.target as HTMLTextAreaElement).value;
            });
        }

        // Additional form fields (contexts, tags, etc.) can be added here
        this.createAdditionalFields(this.detailsContainer);
    }

    protected createAdditionalFields(container: HTMLElement): void {
        // Projects - now using note selection instead of text input
        new Setting(container)
            .setName('Projects')
            .addButton(button => {
                button.setButtonText('Add Project')
                    .setTooltip('Select a project note using fuzzy search')
                    .onClick(() => {
                        const modal = new ProjectSelectModal(this.app, this.plugin, (file) => {
                            this.addProject(file);
                        });
                        modal.open();
                    });
                // Add consistent button classes for transparent styling
                button.buttonEl.addClasses(['tn-btn', 'tn-btn--ghost']);
            });

        // Projects list container
        this.projectsList = container.createDiv({ cls: 'task-projects-list' });
        // Don't render immediately - will be rendered after form data is initialized

        // Contexts input with autocomplete
        new Setting(container)
            .setName('Contexts')
            .addText(text => {
                text.setPlaceholder('context1, context2')
                    .setValue(this.contexts)
                    .onChange(value => {
                        this.contexts = value;
                    });
                
                // Store reference to input element
                this.contextsInput = text.inputEl;
                
                // Add autocomplete functionality
                new ContextSuggest(this.app, text.inputEl, this.plugin);
            });

        // Tags input with autocomplete
        new Setting(container)
            .setName('Tags')
            .addText(text => {
                text.setPlaceholder('tag1, tag2')
                    .setValue(this.tags)
                    .onChange(value => {
                        this.tags = value;
                    });
                
                // Store reference to input element
                this.tagsInput = text.inputEl;
                
                // Add autocomplete functionality
                new TagSuggest(this.app, text.inputEl, this.plugin);
            });

        // Time estimate
        new Setting(container)
            .setName('Time estimate (minutes)')
            .addText(text => {
                text.setPlaceholder('30')
                    .setValue(this.timeEstimate.toString())
                    .onChange(value => {
                        this.timeEstimate = parseInt(value) || 0;
                    });
            });

        // Story points estimate
        new Setting(container)
            .setName('Story points estimate')
            .addText(text => {
                text.setPlaceholder('2')
                    .setValue(this.points.toString())
                    .onChange(value => {
                        this.points = parseInt(value) || 0;
                    });

                    // Store reference to input element
                this.pointsInput = text.inputEl;
            });
    }


    protected createActionButtons(container: HTMLElement): void {
        const buttonContainer = container.createDiv('button-container');

        // Add "Open note" button for edit modals only
        if (this.getModalTitle() === 'Edit task') {
            const openNoteButton = buttonContainer.createEl('button', {
                cls: 'open-note-button',
                text: 'Open note'
            });
            
            openNoteButton.addEventListener('click', async () => {
                await (this as any).openTaskNote();
            });

            // Spacer to push Save/Cancel to the right
            buttonContainer.createDiv('button-spacer');
        }

        // Save button
        const saveButton = buttonContainer.createEl('button', {
            cls: 'save-button',
            text: 'Save'
        });
        
        saveButton.addEventListener('click', async () => {
            await this.handleSave();
            this.close();
        });

        // Cancel button
        const cancelButton = buttonContainer.createEl('button', {
            cls: 'cancel-button',
            text: 'Cancel'
        });
        
        cancelButton.addEventListener('click', () => {
            this.close();
        });
    }

    protected expandModal(): void {
        if (this.isExpanded) return;
        
        this.isExpanded = true;
        this.detailsContainer.style.display = 'block';
        this.containerEl.addClass('expanded');
        
        // Animate the expansion
        this.detailsContainer.style.opacity = '0';
        this.detailsContainer.style.transform = 'translateY(-10px)';
        
        setTimeout(() => {
            this.detailsContainer.style.opacity = '1';
            this.detailsContainer.style.transform = 'translateY(0)';
        }, 50);
    }

    protected showDateContextMenu(event: MouseEvent, type: 'due' | 'scheduled'): void {
        const currentValue = type === 'due' ? this.dueDate : this.scheduledDate;
        const title = type === 'due' ? 'Set Due Date' : 'Set Scheduled Date';
        
        const menu = new DateContextMenu({
            currentValue: currentValue ? getDatePart(currentValue) : undefined,
            currentTime: currentValue ? getTimePart(currentValue) : undefined,
            title: title,
            onSelect: (value: string | null, time: string | null) => {
                if (value) {
                    // Combine date and time if both are provided
                    const finalValue = time ? combineDateAndTime(value, time) : value;
                    
                    if (type === 'due') {
                        this.dueDate = finalValue;
                    } else {
                        this.scheduledDate = finalValue;
                    }
                } else {
                    // Clear the date
                    if (type === 'due') {
                        this.dueDate = '';
                    } else {
                        this.scheduledDate = '';
                    }
                }
                this.updateDateIconState();
            }
        });
        
        menu.show(event);
    }

    protected showStatusContextMenu(event: MouseEvent): void {
        const menu = new StatusContextMenu({
            currentValue: this.status,
            onSelect: (value) => {
                this.status = value;
                this.updateStatusIconState();
            },
            plugin: this.plugin
        });
        
        menu.show(event);
    }

    protected showPriorityContextMenu(event: MouseEvent): void {
        const menu = new PriorityContextMenu({
            currentValue: this.priority,
            onSelect: (value) => {
                this.priority = value;
                this.updatePriorityIconState();
            },
            plugin: this.plugin
        });
        
        menu.show(event);
    }

    protected showRecurrenceContextMenu(event: MouseEvent): void {
        const menu = new RecurrenceContextMenu({
            currentValue: this.recurrenceRule,
            onSelect: (value) => {
                this.recurrenceRule = value || '';
                this.updateRecurrenceIconState();
            },
            app: this.app
        });
        
        menu.show(event);
    }

    protected updateDateIconState(): void {
        this.updateIconStates();
    }

    protected updateStatusIconState(): void {
        this.updateIconStates();
    }

    protected updatePriorityIconState(): void {
        this.updateIconStates();
    }

    protected updateRecurrenceIconState(): void {
        this.updateIconStates();
    }


    protected getDefaultStatus(): string {
        // Get the first status (lowest order) as default
        const statusConfigs = this.plugin.settings.customStatuses;
        if (statusConfigs && statusConfigs.length > 0) {
            const sortedStatuses = [...statusConfigs].sort((a, b) => a.order - b.order);
            return sortedStatuses[0].value;
        }
        return 'open'; // fallback
    }

    protected getDefaultPriority(): string {
        // Get the priority with lowest weight as default
        const priorityConfigs = this.plugin.settings.customPriorities;
        if (priorityConfigs && priorityConfigs.length > 0) {
            const sortedPriorities = [...priorityConfigs].sort((a, b) => a.weight - b.weight);
            return sortedPriorities[0].value;
        }
        return 'normal'; // fallback
    }

    protected getRecurrenceDisplayText(): string {
        if (!this.recurrenceRule) return '';
        
        // Parse RRULE patterns into human-readable text
        const rule = this.recurrenceRule;
        
        if (rule.includes('FREQ=DAILY')) {
            return 'Daily';
        } else if (rule.includes('FREQ=WEEKLY')) {
            if (rule.includes('INTERVAL=2')) {
                return 'Every 2 weeks';
            } else if (rule.includes('BYDAY=MO,TU,WE,TH,FR')) {
                return 'Weekdays';
            } else if (rule.includes('BYDAY=')) {
                // Extract day for display
                const dayMatch = rule.match(/BYDAY=([A-Z]{2})/);
                if (dayMatch) {
                    const dayMap: Record<string, string> = {
                        'SU': 'Sunday', 'MO': 'Monday', 'TU': 'Tuesday', 
                        'WE': 'Wednesday', 'TH': 'Thursday', 'FR': 'Friday', 'SA': 'Saturday'
                    };
                    return `Weekly on ${dayMap[dayMatch[1]] || dayMatch[1]}`;
                }
                return 'Weekly';
            } else {
                return 'Weekly';
            }
        } else if (rule.includes('FREQ=MONTHLY')) {
            if (rule.includes('INTERVAL=3')) {
                return 'Every 3 months';
            } else if (rule.includes('BYMONTHDAY=')) {
                const dayMatch = rule.match(/BYMONTHDAY=(\d+)/);
                if (dayMatch) {
                    return `Monthly on the ${this.getOrdinal(parseInt(dayMatch[1]))}`;
                }
                return 'Monthly';
            } else if (rule.includes('BYDAY=')) {
                return 'Monthly (by weekday)';
            } else {
                return 'Monthly';
            }
        } else if (rule.includes('FREQ=YEARLY')) {
            if (rule.includes('BYMONTH=') && rule.includes('BYMONTHDAY=')) {
                const monthMatch = rule.match(/BYMONTH=(\d+)/);
                const dayMatch = rule.match(/BYMONTHDAY=(\d+)/);
                if (monthMatch && dayMatch) {
                    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 
                                      'July', 'August', 'September', 'October', 'November', 'December'];
                    const month = monthNames[parseInt(monthMatch[1])];
                    const day = this.getOrdinal(parseInt(dayMatch[1]));
                    return `Yearly on ${month} ${day}`;
                }
            }
            return 'Yearly';
        }
        
        // Check for end conditions
        let endText = '';
        if (rule.includes('COUNT=')) {
            const countMatch = rule.match(/COUNT=(\d+)/);
            if (countMatch) {
                endText = ` (${countMatch[1]} times)`;
            }
        } else if (rule.includes('UNTIL=')) {
            const untilMatch = rule.match(/UNTIL=(\d{8})/);
            if (untilMatch) {
                const date = untilMatch[1];
                const formatted = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
                endText = ` (until ${formatted})`;
            }
        }
        
        // Fallback for custom patterns
        return 'Custom' + endText;
    }

    private getOrdinal(n: number): string {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    protected updateIconStates(): void {
        if (!this.actionBar) return;

        // Update due date icon
        const dueDateIcon = this.actionBar.querySelector('[data-type="due-date"]') as HTMLElement;
        if (dueDateIcon) {
            if (this.dueDate) {
                dueDateIcon.classList.add('has-value');
                setTooltip(dueDateIcon, `Due: ${this.dueDate}`, { placement: 'top' });
            } else {
                dueDateIcon.classList.remove('has-value');
                setTooltip(dueDateIcon, 'Set due date', { placement: 'top' });
            }
        }

        // Update scheduled date icon
        const scheduledDateIcon = this.actionBar.querySelector('[data-type="scheduled-date"]') as HTMLElement;
        if (scheduledDateIcon) {
            if (this.scheduledDate) {
                scheduledDateIcon.classList.add('has-value');
                setTooltip(scheduledDateIcon, `Scheduled: ${this.scheduledDate}`, { placement: 'top' });
            } else {
                scheduledDateIcon.classList.remove('has-value');
                setTooltip(scheduledDateIcon, 'Set scheduled date', { placement: 'top' });
            }
        }

        // Update status icon
        const statusIcon = this.actionBar.querySelector('[data-type="status"]') as HTMLElement;
        if (statusIcon) {
            // Find the status config to get the label and color
            const statusConfig = this.plugin.settings.customStatuses.find(s => s.value === this.status);
            const statusLabel = statusConfig ? statusConfig.label : this.status;
            
            if (this.status && statusConfig && statusConfig.value !== this.getDefaultStatus()) {
                statusIcon.classList.add('has-value');
                setTooltip(statusIcon, `Status: ${statusLabel}`, { placement: 'top' });
            } else {
                statusIcon.classList.remove('has-value');
                setTooltip(statusIcon, 'Set status', { placement: 'top' });
            }

            // Apply status color to the icon
            const iconEl = statusIcon.querySelector('.icon') as HTMLElement;
            if (iconEl && statusConfig && statusConfig.color) {
                iconEl.style.color = statusConfig.color;
            } else if (iconEl) {
                iconEl.style.color = ''; // Reset to default
            }
        }

        // Update priority icon
        const priorityIcon = this.actionBar.querySelector('[data-type="priority"]') as HTMLElement;
        if (priorityIcon) {
            // Find the priority config to get the label and color
            const priorityConfig = this.plugin.settings.customPriorities.find(p => p.value === this.priority);
            const priorityLabel = priorityConfig ? priorityConfig.label : this.priority;
            
            if (this.priority && priorityConfig && priorityConfig.value !== this.getDefaultPriority()) {
                priorityIcon.classList.add('has-value');
                setTooltip(priorityIcon, `Priority: ${priorityLabel}`, { placement: 'top' });
            } else {
                priorityIcon.classList.remove('has-value');
                setTooltip(priorityIcon, 'Set priority', { placement: 'top' });
            }

            // Apply priority color to the icon
            const iconEl = priorityIcon.querySelector('.icon') as HTMLElement;
            if (iconEl && priorityConfig && priorityConfig.color) {
                iconEl.style.color = priorityConfig.color;
            } else if (iconEl) {
                iconEl.style.color = ''; // Reset to default
            }
        }

        // Update recurrence icon
        const recurrenceIcon = this.actionBar.querySelector('[data-type="recurrence"]') as HTMLElement;
        if (recurrenceIcon) {
            if (this.recurrenceRule && this.recurrenceRule.trim()) {
                recurrenceIcon.classList.add('has-value');
                setTooltip(recurrenceIcon, `Recurrence: ${this.getRecurrenceDisplayText()}`, { placement: 'top' });
            } else {
                recurrenceIcon.classList.remove('has-value');
                setTooltip(recurrenceIcon, 'Set recurrence', { placement: 'top' });
            }
        }
    }

    protected focusTitleInput(): void {
        setTimeout(() => {
            this.titleInput.focus();
            this.titleInput.select();
        }, 100);
    }

    protected addProject(file: TAbstractFile): void {
        // Avoid duplicates
        if (this.selectedProjectFiles.some(existing => existing.path === file.path)) {
            return;
        }

        this.selectedProjectFiles.push(file);
        this.updateProjectsFromFiles();
        this.renderProjectsList();
    }

    protected removeProject(file: TAbstractFile): void {
        this.selectedProjectFiles = this.selectedProjectFiles.filter(
            existing => existing.path !== file.path
        );
        this.updateProjectsFromFiles();
        this.renderProjectsList();
    }

    protected updateProjectsFromFiles(): void {
        // Convert selected files to markdown links using generateMarkdownLink
        const currentFile = this.app.workspace.getActiveFile();
        const sourcePath = currentFile?.path || '';
        
        this.projects = this.selectedProjectFiles.map(file => {
            // fileToLinktext expects TFile, so cast safely since we know these are markdown files
            const linkText = this.app.metadataCache.fileToLinktext(file as TFile, sourcePath, true);
            return `[[${linkText}]]`;
        }).join(', ');
    }

    protected initializeProjectsFromStrings(projects: string[]): void {
        // Convert project strings to files
        // This handles both old plain string projects and new [[link]] format
        this.selectedProjectFiles = [];
        
        for (const projectString of projects) {
            // Skip null, undefined, or empty strings
            if (!projectString || typeof projectString !== 'string' || projectString.trim() === '') {
                continue;
            }
            
            // Check if it's a wiki link format
            const linkMatch = projectString.match(/^\[\[([^\]]+)\]\]$/);
            if (linkMatch) {
                const linkPath = linkMatch[1];
                const file = this.app.metadataCache.getFirstLinkpathDest(linkPath, '');
                if (file) {
                    this.selectedProjectFiles.push(file);
                }
            } else {
                // For backwards compatibility, try to find a file with this name
                const files = this.app.vault.getMarkdownFiles();
                const matchingFile = files.find(f => 
                    f.basename === projectString || 
                    f.name === projectString + '.md'
                );
                if (matchingFile) {
                    this.selectedProjectFiles.push(matchingFile);
                }
            }
        }
        
        this.updateProjectsFromFiles();
        // Don't render immediately - let the caller decide when to render
    }

    protected renderProjectsList(): void {
        if (!this.projectsList) return;
        
        this.projectsList.empty();

        if (this.selectedProjectFiles.length === 0) {
            return;
        }

        this.selectedProjectFiles.forEach(file => {
            const projectItem = this.projectsList.createDiv({ cls: 'task-project-item' });
            
            // Info container
            const infoEl = projectItem.createDiv({ cls: 'task-project-info' });
            
            // File name
            const nameEl = infoEl.createSpan({ cls: 'task-project-name' });
            nameEl.textContent = file.name;
            
            // File path (if different from name)
            if (file.path !== file.name) {
                const pathEl = infoEl.createDiv({ cls: 'task-project-path' });
                pathEl.textContent = file.path;
            }
            
            // Remove button
            const removeBtn = projectItem.createEl('button', { 
                cls: 'task-project-remove',
                text: '×'
            });
            setTooltip(removeBtn, 'Remove project', { placement: 'top' });
            removeBtn.addEventListener('click', () => {
                this.removeProject(file);
            });
        });
    }

    protected validateForm(): boolean {
        return this.title.trim().length > 0;
    }
}

/**
 * Context suggestion object for compatibility with other plugins
 */
interface ContextSuggestion {
    value: string;
    display: string;
    type: 'context';
    toString(): string;
}

/**
 * Context suggestion provider using AbstractInputSuggest
 */
class ContextSuggest extends AbstractInputSuggest<ContextSuggestion> {
    private plugin: TaskNotesPlugin;
    private input: HTMLInputElement;
    
    constructor(app: App, inputEl: HTMLInputElement, plugin: TaskNotesPlugin) {
        super(app, inputEl);
        this.plugin = plugin;
        this.input = inputEl;
    }
    
    protected async getSuggestions(query: string): Promise<ContextSuggestion[]> {
        // Handle comma-separated values
        const currentValues = this.input.value.split(',').map((v: string) => v.trim());
        const currentQuery = currentValues[currentValues.length - 1];
        
        if (!currentQuery) return [];
        
        const contexts = this.plugin.cacheManager.getAllContexts();
        return contexts
            .filter(context => context && typeof context === 'string')
            .filter(context => 
                context.toLowerCase().includes(currentQuery.toLowerCase()) &&
                !currentValues.slice(0, -1).includes(context)
            )
            .slice(0, 10)
            .map(context => ({
                value: context,
                display: context,
                type: 'context' as const,
                toString() { return this.value; }
            }));
    }
    
    public renderSuggestion(contextSuggestion: ContextSuggestion, el: HTMLElement): void {
        el.textContent = contextSuggestion.display;
    }
    
    public selectSuggestion(contextSuggestion: ContextSuggestion): void {
        const currentValues = this.input.value.split(',').map((v: string) => v.trim());
        currentValues[currentValues.length - 1] = contextSuggestion.value;
        this.input.value = currentValues.join(', ') + ', ';
        
        // Trigger input event to update internal state
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
        this.input.focus();
    }
}

/**
 * Tag suggestion object for compatibility with other plugins
 */
interface TagSuggestion {
    value: string;
    display: string;
    type: 'tag';
    toString(): string;
}

/**
 * Tag suggestion provider using AbstractInputSuggest
 */
class TagSuggest extends AbstractInputSuggest<TagSuggestion> {
    private plugin: TaskNotesPlugin;
    private input: HTMLInputElement;
    
    constructor(app: App, inputEl: HTMLInputElement, plugin: TaskNotesPlugin) {
        super(app, inputEl);
        this.plugin = plugin;
        this.input = inputEl;
    }
    
    protected async getSuggestions(query: string): Promise<TagSuggestion[]> {
        // Handle comma-separated values
        const currentValues = this.input.value.split(',').map((v: string) => v.trim());
        const currentQuery = currentValues[currentValues.length - 1];
        
        if (!currentQuery) return [];
        
        const tags = this.plugin.cacheManager.getAllTags();
        return tags
            .filter(tag => tag && typeof tag === 'string')
            .filter(tag => 
                tag.toLowerCase().includes(currentQuery.toLowerCase()) &&
                !currentValues.slice(0, -1).includes(tag)
            )
            .slice(0, 10)
            .map(tag => ({
                value: tag,
                display: tag,
                type: 'tag' as const,
                toString() { return this.value; }
            }));
    }
    
    public renderSuggestion(tagSuggestion: TagSuggestion, el: HTMLElement): void {
        el.textContent = tagSuggestion.display;
    }
    
    public selectSuggestion(tagSuggestion: TagSuggestion): void {
        const currentValues = this.input.value.split(',').map((v: string) => v.trim());
        currentValues[currentValues.length - 1] = tagSuggestion.value;
        this.input.value = currentValues.join(', ') + ', ';
        
        // Trigger input event to update internal state
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
        this.input.focus();
    }
}
