import { App, Modal } from 'obsidian';
import TaskNotesPlugin from '../main';

export abstract class BaseTaskModal extends Modal {
    plugin: TaskNotesPlugin;
    
    // Form field properties
    title: string = '';
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
    
    // Cached data
    protected existingContexts: string[] = [];
    protected existingTags: string[] = [];

    constructor(app: App, plugin: TaskNotesPlugin) {
        super(app);
        this.plugin = plugin;
    }

    // Abstract methods for subclasses to implement
    protected abstract initializeFormData(): void;
    protected abstract createActionButtons(container: HTMLElement): void;
    protected abstract handleSubmit(): Promise<void>;

    // Get existing contexts from cache for instant autocomplete
    async getExistingContexts(): Promise<string[]> {
        return await this.plugin.cacheManager.getAllContexts();
    }

    // Get existing tags from cache for instant autocomplete  
    async getExistingTags(): Promise<string[]> {
        const allTags = await this.plugin.cacheManager.getAllTags();
        // Filter out the default task tag
        return allTags.filter(tag => tag !== this.plugin.settings.taskTag);
    }

    protected createFormGroup(container: HTMLElement, label: string, inputCallback: (container: HTMLElement) => void): HTMLElement {
        const formGroup = container.createDiv({ cls: 'form-group' });
        formGroup.createEl('label', { text: label, cls: 'form-label' });
        const inputContainer = formGroup.createDiv({ cls: 'form-input-container' });
        inputCallback(inputContainer);
        return formGroup;
    }

    protected async createAutocompleteInput(
        container: HTMLElement, 
        fieldName: string, 
        getSuggestionsFn: () => Promise<string[]> | string[], 
        onChangeFn: (value: string) => void
    ): Promise<void> {
        const input = container.createEl('input', {
            type: 'text',
            cls: 'form-input'
        });

        input.value = (this as any)[fieldName] || '';

        input.addEventListener('input', (e) => {
            const value = (e.target as HTMLInputElement).value;
            (this as any)[fieldName] = value;
            onChangeFn(value);
        });

        input.addEventListener('focus', async () => {
            const suggestions = await getSuggestionsFn();
            this.showSuggestions(container, suggestions, input, onChangeFn);
        });

        input.addEventListener('blur', () => {
            setTimeout(() => this.hideSuggestions(container), 200);
        });

        input.addEventListener('keydown', (e) => {
            const suggestionsList = container.querySelector('.autocomplete-suggestions') as HTMLElement;
            if (!suggestionsList) return;

            const suggestions = suggestionsList.querySelectorAll('.suggestion-item');
            let selectedIndex = Array.from(suggestions).findIndex(el => el.hasClass('selected'));

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % suggestions.length;
                this.updateSelectedSuggestion(suggestions, selectedIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1;
                this.updateSelectedSuggestion(suggestions, selectedIndex);
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
                e.preventDefault();
                const selectedSuggestion = suggestions[selectedIndex].textContent;
                if (selectedSuggestion) {
                    this.applySuggestion(input, selectedSuggestion, onChangeFn);
                }
            } else if (e.key === 'Escape') {
                this.hideSuggestions(container);
            }
        });
    }

    protected showSuggestions(
        container: HTMLElement, 
        suggestions: string[], 
        input: HTMLInputElement, 
        onChangeFn: (value: string) => void
    ): void {
        this.hideSuggestions(container);

        if (suggestions.length === 0) return;

        const suggestionsList = container.createDiv({ cls: 'autocomplete-suggestions' });
        
        const inputValue = input.value.toLowerCase();
        const filteredSuggestions = suggestions.filter(suggestion => 
            suggestion.toLowerCase().includes(inputValue)
        );

        filteredSuggestions.slice(0, 10).forEach((suggestion, index) => {
            const suggestionItem = suggestionsList.createDiv({ 
                cls: 'suggestion-item',
                text: suggestion
            });

            if (index === 0) {
                suggestionItem.addClass('selected');
            }

            suggestionItem.addEventListener('click', () => {
                this.applySuggestion(input, suggestion, onChangeFn);
            });
        });
    }

    protected applySuggestion(input: HTMLInputElement, suggestion: string, onChangeFn: (value: string) => void): void {
        const currentValue = input.value;
        const lastCommaIndex = currentValue.lastIndexOf(',');
        
        let newValue: string;
        if (lastCommaIndex >= 0) {
            newValue = currentValue.substring(0, lastCommaIndex + 1) + ' ' + suggestion;
        } else {
            newValue = suggestion;
        }
        
        input.value = newValue;
        onChangeFn(newValue);
        this.hideSuggestions(input.parentElement!);
        input.focus();
    }

    protected updateSelectedSuggestion(suggestions: NodeListOf<Element>, selectedIndex: number): void {
        suggestions.forEach((suggestion, index) => {
            if (index === selectedIndex) {
                suggestion.addClass('selected');
            } else {
                suggestion.removeClass('selected');
            }
        });
    }

    protected hideSuggestions(container: HTMLElement): void {
        const existingSuggestions = container.querySelector('.autocomplete-suggestions');
        if (existingSuggestions) {
            existingSuggestions.remove();
        }
    }

    protected createTitleInputWithCounter(container: HTMLElement, maxLength: number): void {
        const titleInput = container.createEl('input', {
            type: 'text',
            cls: 'form-input title-input',
            attr: { maxlength: maxLength.toString() }
        });

        titleInput.value = this.title;

        const charCounter = container.createDiv({ cls: 'char-counter' });
        this.updateCharCounter(charCounter, this.title.length, maxLength);

        titleInput.addEventListener('input', (e) => {
            const value = (e.target as HTMLInputElement).value;
            this.title = value;
            this.updateCharCounter(charCounter, value.length, maxLength);
        });
    }

    protected updateCharCounter(counter: HTMLElement, currentLength: number, maxLength: number): void {
        counter.textContent = `${currentLength}/${maxLength}`;
        
        if (currentLength > maxLength * 0.9) {
            counter.addClass('warning');
        } else {
            counter.removeClass('warning');
        }
    }

    protected createPriorityDropdown(container: HTMLElement): void {
        const select = container.createEl('select', { cls: 'form-select' });

        this.plugin.priorityManager.getPrioritiesByWeight().forEach(priorityConfig => {
            const option = select.createEl('option', {
                value: priorityConfig.value,
                text: priorityConfig.label
            });

            if (priorityConfig.value === this.priority) {
                option.selected = true;
            }
        });

        select.addEventListener('change', (e) => {
            this.priority = (e.target as HTMLSelectElement).value;
        });
    }

    protected createStatusDropdown(container: HTMLElement): void {
        const select = container.createEl('select', { cls: 'form-select' });

        this.plugin.statusManager.getAllStatuses().forEach(statusConfig => {
            const option = select.createEl('option', {
                value: statusConfig.value,
                text: statusConfig.label
            });

            if (statusConfig.value === this.status) {
                option.selected = true;
            }
        });

        select.addEventListener('change', (e) => {
            this.status = (e.target as HTMLSelectElement).value;
        });
    }

    protected createDueDateInput(container: HTMLElement): void {
        const input = container.createEl('input', {
            type: 'date',
            cls: 'form-input'
        });

        input.value = this.dueDate;

        input.addEventListener('change', (e) => {
            this.dueDate = (e.target as HTMLInputElement).value;
        });
    }

    protected createTimeEstimateInput(container: HTMLElement): void {
        const inputContainer = container.createDiv({ cls: 'time-estimate-container' });
        
        const input = inputContainer.createEl('input', {
            type: 'number',
            cls: 'form-input time-estimate-input',
            attr: { min: '0', step: '5' }
        });

        input.value = this.timeEstimate.toString();

        const label = inputContainer.createSpan({ cls: 'time-estimate-label' });
        this.updateTimeLabel(label, this.timeEstimate);

        input.addEventListener('input', (e) => {
            const value = parseInt((e.target as HTMLInputElement).value) || 0;
            this.timeEstimate = value;
            this.updateTimeLabel(label, value);
        });
    }

    protected updateTimeLabel(label: HTMLElement, value: number): void {
        if (value === 0) {
            label.textContent = 'No estimate';
        } else if (value < 60) {
            label.textContent = `${value} minute${value === 1 ? '' : 's'}`;
        } else {
            const hours = Math.floor(value / 60);
            const minutes = value % 60;
            let text = `${hours} hour${hours === 1 ? '' : 's'}`;
            if (minutes > 0) {
                text += ` ${minutes} minute${minutes === 1 ? '' : 's'}`;
            }
            label.textContent = text;
        }
    }

    protected createRecurrenceDropdown(container: HTMLElement): void {
        const select = container.createEl('select', { cls: 'form-select' });

        const options = [
            { value: 'none', text: 'No recurrence' },
            { value: 'daily', text: 'Daily' },
            { value: 'weekly', text: 'Weekly' },
            { value: 'monthly', text: 'Monthly' },
            { value: 'yearly', text: 'Yearly' }
        ];

        options.forEach(option => {
            const optionEl = select.createEl('option', {
                value: option.value,
                text: option.text
            });

            if (option.value === this.recurrence) {
                optionEl.selected = true;
            }
        });

        select.addEventListener('change', (e) => {
            this.recurrence = (e.target as HTMLSelectElement).value as any;
            this.updateRecurrenceOptions(container.parentElement!);
        });
    }

    protected updateRecurrenceOptions(container: HTMLElement): void {
        const existingOptions = container.querySelector('.recurrence-options');
        if (existingOptions) {
            existingOptions.remove();
        }

        if (this.recurrence === 'none') return;

        const optionsContainer = container.createDiv({ cls: 'recurrence-options' });

        switch (this.recurrence) {
            case 'weekly':
                this.createDaysOfWeekSelector(optionsContainer);
                break;
            case 'monthly':
                this.createDayOfMonthSelector(optionsContainer);
                break;
            case 'yearly':
                this.createYearlySelector(optionsContainer);
                break;
        }
    }

    protected createDaysOfWeekSelector(container: HTMLElement): void {
        const label = container.createEl('label', { 
            text: 'Days of week:', 
            cls: 'form-label recurrence-label' 
        });

        const daysContainer = container.createDiv({ cls: 'days-of-week-container' });

        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        days.forEach(day => {
            const dayContainer = daysContainer.createDiv({ cls: 'day-checkbox-container' });
            
            const checkbox = dayContainer.createEl('input', {
                type: 'checkbox',
                cls: 'day-checkbox'
            });

            checkbox.checked = this.daysOfWeek.includes(day);

            dayContainer.createEl('label', { text: day, cls: 'day-label' });

            checkbox.addEventListener('change', (e) => {
                if ((e.target as HTMLInputElement).checked) {
                    if (!this.daysOfWeek.includes(day)) {
                        this.daysOfWeek.push(day);
                    }
                } else {
                    this.daysOfWeek = this.daysOfWeek.filter(d => d !== day);
                }
            });
        });
    }

    protected createDayOfMonthSelector(container: HTMLElement): void {
        const label = container.createEl('label', { 
            text: 'Day of month:', 
            cls: 'form-label recurrence-label' 
        });

        const input = container.createEl('input', {
            type: 'number',
            cls: 'form-input',
            attr: { min: '1', max: '31' }
        });

        input.value = this.dayOfMonth;

        input.addEventListener('change', (e) => {
            this.dayOfMonth = (e.target as HTMLInputElement).value;
        });
    }

    protected createYearlySelector(container: HTMLElement): void {
        const monthLabel = container.createEl('label', { 
            text: 'Month:', 
            cls: 'form-label recurrence-label' 
        });

        const monthSelect = container.createEl('select', { cls: 'form-select' });

        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        months.forEach((month, index) => {
            const option = monthSelect.createEl('option', {
                value: (index + 1).toString(),
                text: month
            });

            if ((index + 1).toString() === this.monthOfYear) {
                option.selected = true;
            }
        });

        monthSelect.addEventListener('change', (e) => {
            this.monthOfYear = (e.target as HTMLSelectElement).value;
        });

        const dayLabel = container.createEl('label', { 
            text: 'Day:', 
            cls: 'form-label recurrence-label' 
        });

        const dayInput = container.createEl('input', {
            type: 'number',
            cls: 'form-input',
            attr: { min: '1', max: '31' }
        });

        dayInput.value = this.dayOfMonth;

        dayInput.addEventListener('change', (e) => {
            this.dayOfMonth = (e.target as HTMLInputElement).value;
        });
    }
}