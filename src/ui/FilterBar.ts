import { FilterQuery, FilterBarConfig, TaskSortKey, TaskGroupKey, SortDirection } from '../types';
import { EventEmitter } from '../utils/EventEmitter';

/**
 * Reusable filtering UI component that provides consistent filtering controls
 * across all task views. Emits FilterQuery updates when user interacts with controls.
 */
export class FilterBar extends EventEmitter {
    private container: HTMLElement;
    private config: FilterBarConfig;
    private currentQuery: FilterQuery;
    private filterOptions: {
        statuses: string[];
        priorities: string[];
        contexts: string[];
    };

    // UI Elements
    private searchInput?: HTMLInputElement;
    private sortSelect?: HTMLSelectElement;
    private groupSelect?: HTMLSelectElement;
    private advancedFiltersButton?: HTMLButtonElement;
    private advancedFiltersPanel?: HTMLElement;
    private archivedToggle?: HTMLInputElement;
    private activeFiltersIndicator?: HTMLElement;
    private dateRangeStartInput?: HTMLInputElement;
    private dateRangeEndInput?: HTMLInputElement;

    constructor(
        container: HTMLElement,
        initialQuery: FilterQuery,
        filterOptions: { statuses: string[]; priorities: string[]; contexts: string[] },
        config: FilterBarConfig = {}
    ) {
        super();
        this.container = container;
        this.currentQuery = { ...initialQuery };
        this.filterOptions = filterOptions;
        this.config = {
            showSearch: true,
            showGroupBy: true,
            showSortBy: true,
            showAdvancedFilters: true,
            showDateRangePicker: false, // Default to false to avoid breaking existing views
            allowedSortKeys: ['due', 'priority', 'title'],
            allowedGroupKeys: ['none', 'status', 'priority', 'context', 'due'],
            ...config
        };

        this.render();
        this.updateUI();
    }

    /**
     * Update the current query and refresh UI
     */
    updateQuery(query: FilterQuery): void {
        this.currentQuery = { ...query };
        this.updateUI();
    }

    /**
     * Update available filter options
     */
    updateFilterOptions(options: { statuses: string[]; priorities: string[]; contexts: string[] }): void {
        this.filterOptions = options;
        this.rebuildAdvancedFilters();
    }

    /**
     * Get the current query
     */
    getCurrentQuery(): FilterQuery {
        return { ...this.currentQuery };
    }

    /**
     * Render the complete FilterBar UI
     */
    private render(): void {
        this.container.empty();
        this.container.addClass('filter-bar');

        // Main controls row
        const mainRow = this.container.createDiv('filter-bar-main');

        // Search input
        if (this.config.showSearch) {
            this.renderSearchInput(mainRow);
        }

        // Sort and group controls
        const controlsGroup = mainRow.createDiv('filter-bar-controls');
        
        if (this.config.showSortBy) {
            this.renderSortControls(controlsGroup);
        }

        if (this.config.showGroupBy) {
            this.renderGroupControls(controlsGroup);
        }

        // Advanced filters button
        if (this.config.showAdvancedFilters) {
            this.renderAdvancedFiltersButton(controlsGroup);
        }

        // Advanced filters panel (initially hidden)
        if (this.config.showAdvancedFilters) {
            this.renderAdvancedFiltersPanel();
        }
    }

    /**
     * Render search input
     */
    private renderSearchInput(parent: HTMLElement): void {
        const searchContainer = parent.createDiv('filter-bar-search');
        
        this.searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'Search tasks...',
            cls: 'filter-bar-search-input'
        });

        this.searchInput.addEventListener('input', () => {
            this.updateQueryField('searchQuery', this.searchInput!.value || undefined);
        });
    }

    /**
     * Render sort controls
     */
    private renderSortControls(parent: HTMLElement): void {
        const sortContainer = parent.createDiv('filter-bar-sort');
        
        // Add label first
        sortContainer.createSpan({ text: 'Sort:', cls: 'filter-bar-label' });
        
        // Sort key dropdown
        this.sortSelect = sortContainer.createEl('select', {
            cls: 'filter-bar-select'
        });

        const sortKeys = this.config.allowedSortKeys || ['due', 'priority', 'title'];
        sortKeys.forEach(key => {
            const option = this.sortSelect!.createEl('option', {
                value: key,
                text: this.getSortKeyLabel(key)
            });
        });

        this.sortSelect.addEventListener('change', () => {
            this.updateQueryField('sortKey', this.sortSelect!.value as TaskSortKey);
        });

        // Sort direction button
        const sortDirectionBtn = sortContainer.createEl('button', {
            cls: 'filter-bar-sort-direction',
            attr: { 'aria-label': 'Toggle sort direction' }
        });

        sortDirectionBtn.addEventListener('click', () => {
            const newDirection: SortDirection = this.currentQuery.sortDirection === 'asc' ? 'desc' : 'asc';
            this.updateQueryField('sortDirection', newDirection);
        });
    }

    /**
     * Render group controls
     */
    private renderGroupControls(parent: HTMLElement): void {
        const groupContainer = parent.createDiv('filter-bar-group');
        
        groupContainer.createSpan({ text: 'Group:', cls: 'filter-bar-label' });

        this.groupSelect = groupContainer.createEl('select', {
            cls: 'filter-bar-select'
        });

        const groupKeys = this.config.allowedGroupKeys || ['none', 'status', 'priority', 'context', 'due'];
        groupKeys.forEach(key => {
            this.groupSelect!.createEl('option', {
                value: key,
                text: this.getGroupKeyLabel(key)
            });
        });

        this.groupSelect.addEventListener('change', () => {
            this.updateQueryField('groupKey', this.groupSelect!.value as TaskGroupKey);
        });
    }

    /**
     * Render date range filter in advanced filters panel
     */
    private renderDateRangeFilter(): void {
        const dateRangeContainer = this.advancedFiltersPanel!.createDiv('filter-bar-advanced-item');
        dateRangeContainer.createSpan({ text: 'Date Range:', cls: 'filter-bar-label' });

        const dateInputsContainer = dateRangeContainer.createDiv('filter-bar-date-inputs');

        // Start date input
        const startContainer = dateInputsContainer.createDiv('filter-bar-date-input-container');
        startContainer.createSpan({ text: 'From:', cls: 'filter-bar-date-label' });
        this.dateRangeStartInput = startContainer.createEl('input', {
            type: 'date',
            cls: 'filter-bar-date-input'
        });

        // End date input
        const endContainer = dateInputsContainer.createDiv('filter-bar-date-input-container');
        endContainer.createSpan({ text: 'To:', cls: 'filter-bar-date-label' });
        this.dateRangeEndInput = endContainer.createEl('input', {
            type: 'date',
            cls: 'filter-bar-date-input'
        });

        // Clear button
        const clearButton = dateInputsContainer.createEl('button', {
            cls: 'filter-bar-date-clear',
            text: 'Clear',
            attr: { 'aria-label': 'Clear date range' }
        });

        // Event listeners
        this.dateRangeStartInput.addEventListener('change', () => {
            this.updateDateRange();
        });

        this.dateRangeEndInput.addEventListener('change', () => {
            this.updateDateRange();
        });

        clearButton.addEventListener('click', () => {
            this.clearDateRange();
        });
    }

    /**
     * Update date range in query
     */
    private updateDateRange(): void {
        const startDate = this.dateRangeStartInput?.value;
        const endDate = this.dateRangeEndInput?.value;

        if (startDate && endDate) {
            this.updateQueryField('dateRange', {
                start: startDate,
                end: endDate
            });
        } else if (!startDate && !endDate) {
            this.updateQueryField('dateRange', undefined);
        }
        // If only one date is set, don't update the range yet
    }

    /**
     * Clear date range inputs and query
     */
    private clearDateRange(): void {
        if (this.dateRangeStartInput) {
            this.dateRangeStartInput.value = '';
        }
        if (this.dateRangeEndInput) {
            this.dateRangeEndInput.value = '';
        }
        this.updateQueryField('dateRange', undefined);
    }

    /**
     * Render advanced filters button
     */
    private renderAdvancedFiltersButton(parent: HTMLElement): void {
        this.advancedFiltersButton = parent.createEl('button', {
            cls: 'filter-bar-advanced-toggle',
            text: 'Filters'
        });

        this.activeFiltersIndicator = this.advancedFiltersButton.createSpan({
            cls: 'filter-bar-active-indicator'
        });

        this.advancedFiltersButton.addEventListener('click', () => {
            this.toggleAdvancedFilters();
        });
    }

    /**
     * Render advanced filters panel
     */
    private renderAdvancedFiltersPanel(): void {
        this.advancedFiltersPanel = this.container.createDiv('filter-bar-advanced');
        this.advancedFiltersPanel.addClass('is-hidden');

        // Status filter
        this.renderStatusFilter();

        // Priority filter
        this.renderPriorityFilter();

        // Context filter
        this.renderContextFilter();

        // Date range filter
        if (this.config.showDateRangePicker) {
            this.renderDateRangeFilter();
        }

        // Archived toggle (after date range)
        this.renderArchivedToggle();
    }

    /**
     * Render status filter
     */
    private renderStatusFilter(): void {
        const statusContainer = this.advancedFiltersPanel!.createDiv('filter-bar-advanced-item');
        statusContainer.createSpan({ text: 'Status:', cls: 'filter-bar-label' });

        const statusCheckboxContainer = statusContainer.createDiv('filter-bar-checkbox-group');

        // Add "All" and "Open" options first
        const specialOptions = [
            { value: 'all', text: 'All' },
            { value: 'open', text: 'Open Tasks' }
        ];

        specialOptions.forEach(option => {
            const checkboxWrapper = statusCheckboxContainer.createDiv('filter-bar-checkbox-wrapper');
            
            const label = checkboxWrapper.createEl('label', {
                cls: 'filter-bar-checkbox-label'
            });

            const checkbox = label.createEl('input', {
                type: 'radio',
                value: option.value,
                cls: 'filter-bar-checkbox',
                attr: { name: 'status-filter' }
            });

            label.createSpan({ text: option.text });

            checkbox.addEventListener('change', () => {
                this.updateStatusFilter();
            });
        });

        // Add specific status options
        this.filterOptions.statuses.forEach(status => {
            const checkboxWrapper = statusCheckboxContainer.createDiv('filter-bar-checkbox-wrapper');
            
            const label = checkboxWrapper.createEl('label', {
                cls: 'filter-bar-checkbox-label'
            });

            const checkbox = label.createEl('input', {
                type: 'radio',
                value: status,
                cls: 'filter-bar-checkbox',
                attr: { name: 'status-filter' }
            });

            label.createSpan({ text: status });

            checkbox.addEventListener('change', () => {
                this.updateStatusFilter();
            });
        });
    }

    /**
     * Update status filter based on radio button selection
     */
    private updateStatusFilter(): void {
        const statusContainer = this.advancedFiltersPanel?.querySelector('.filter-bar-advanced-item:nth-child(1)');
        const checkedRadio = statusContainer?.querySelector('input[type="radio"]:checked') as HTMLInputElement;
        const selectedStatus = checkedRadio?.value || 'all';
        this.updateQueryField('status', selectedStatus);
    }

    /**
     * Render priority filter
     */
    private renderPriorityFilter(): void {
        const priorityContainer = this.advancedFiltersPanel!.createDiv('filter-bar-advanced-item');
        priorityContainer.createSpan({ text: 'Priority:', cls: 'filter-bar-label' });

        const priorityCheckboxContainer = priorityContainer.createDiv('filter-bar-checkbox-group');

        this.filterOptions.priorities.forEach(priority => {
            const checkboxWrapper = priorityCheckboxContainer.createDiv('filter-bar-checkbox-wrapper');
            
            const label = checkboxWrapper.createEl('label', {
                cls: 'filter-bar-checkbox-label'
            });

            const checkbox = label.createEl('input', {
                type: 'checkbox',
                value: priority,
                cls: 'filter-bar-checkbox'
            });

            label.createSpan({ text: priority });

            checkbox.addEventListener('change', () => {
                this.updatePriorityFilter();
            });
        });
    }

    /**
     * Update priority filter based on checkbox selections
     */
    private updatePriorityFilter(): void {
        const priorityContainer = this.advancedFiltersPanel?.querySelector('.filter-bar-advanced-item:nth-child(2)');
        const checkboxes = priorityContainer?.querySelectorAll('input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
        const selectedPriorities = Array.from(checkboxes || []).map(cb => cb.value);
        this.updateQueryField('priorities', selectedPriorities.length > 0 ? selectedPriorities : undefined);
    }

    /**
     * Render context filter
     */
    private renderContextFilter(): void {
        const contextContainer = this.advancedFiltersPanel!.createDiv('filter-bar-advanced-item');
        contextContainer.createSpan({ text: 'Context:', cls: 'filter-bar-label' });

        const contextCheckboxContainer = contextContainer.createDiv('filter-bar-checkbox-group');

        this.filterOptions.contexts.forEach(context => {
            const checkboxWrapper = contextCheckboxContainer.createDiv('filter-bar-checkbox-wrapper');
            
            const label = checkboxWrapper.createEl('label', {
                cls: 'filter-bar-checkbox-label'
            });

            const checkbox = label.createEl('input', {
                type: 'checkbox',
                value: context,
                cls: 'filter-bar-checkbox'
            });

            label.createSpan({ text: context });

            checkbox.addEventListener('change', () => {
                this.updateContextFilter();
            });
        });
    }

    /**
     * Update context filter based on checkbox selections
     */
    private updateContextFilter(): void {
        const contextContainer = this.advancedFiltersPanel?.querySelector('.filter-bar-advanced-item:nth-child(3)');
        const checkboxes = contextContainer?.querySelectorAll('input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
        const selectedContexts = Array.from(checkboxes || []).map(cb => cb.value);
        this.updateQueryField('contexts', selectedContexts.length > 0 ? selectedContexts : undefined);
    }

    /**
     * Render archived toggle
     */
    private renderArchivedToggle(): void {
        const archivedContainer = this.advancedFiltersPanel!.createDiv('filter-bar-advanced-item');
        
        const label = archivedContainer.createEl('label', {
            cls: 'filter-bar-checkbox-label'
        });

        this.archivedToggle = label.createEl('input', {
            type: 'checkbox',
            cls: 'filter-bar-checkbox'
        });

        label.createSpan({ text: 'Show archived' });

        this.archivedToggle.addEventListener('change', () => {
            this.updateQueryField('showArchived', this.archivedToggle!.checked);
        });
    }

    /**
     * Update a specific field in the query and emit change event
     */
    private updateQueryField<K extends keyof FilterQuery>(field: K, value: FilterQuery[K]): void {
        this.currentQuery[field] = value;
        
        // Update specific UI elements based on the field that changed
        if (field === 'sortDirection') {
            this.updateSortDirectionButton();
        }
        
        this.updateActiveFiltersIndicator();
        this.emit('queryChange', { ...this.currentQuery });
    }

    /**
     * Update UI elements to reflect current query
     */
    private updateUI(): void {
        if (this.searchInput) {
            this.searchInput.value = this.currentQuery.searchQuery || '';
        }

        if (this.sortSelect) {
            this.sortSelect.value = this.currentQuery.sortKey;
        }

        if (this.groupSelect) {
            this.groupSelect.value = this.currentQuery.groupKey;
        }

        // Update date range inputs
        if (this.dateRangeStartInput && this.dateRangeEndInput) {
            if (this.currentQuery.dateRange) {
                this.dateRangeStartInput.value = this.currentQuery.dateRange.start;
                this.dateRangeEndInput.value = this.currentQuery.dateRange.end;
            } else {
                this.dateRangeStartInput.value = '';
                this.dateRangeEndInput.value = '';
            }
        }

        // Update status radio buttons
        const statusContainer = this.advancedFiltersPanel?.querySelector('.filter-bar-advanced-item:nth-child(1)');
        const statusRadios = statusContainer?.querySelectorAll('input[type="radio"]') as NodeListOf<HTMLInputElement>;
        statusRadios?.forEach(radio => {
            radio.checked = radio.value === (this.currentQuery.status || 'all');
        });

        // Update priority checkboxes
        const priorityContainer = this.advancedFiltersPanel?.querySelector('.filter-bar-advanced-item:nth-child(2)');
        const priorityCheckboxes = priorityContainer?.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
        priorityCheckboxes?.forEach(checkbox => {
            checkbox.checked = (this.currentQuery.priorities || []).includes(checkbox.value);
        });

        // Update context checkboxes
        const contextContainer = this.advancedFiltersPanel?.querySelector('.filter-bar-advanced-item:nth-child(3)');
        const contextCheckboxes = contextContainer?.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
        contextCheckboxes?.forEach(checkbox => {
            checkbox.checked = (this.currentQuery.contexts || []).includes(checkbox.value);
        });

        if (this.archivedToggle) {
            this.archivedToggle.checked = this.currentQuery.showArchived;
        }

        this.updateSortDirectionButton();
        this.updateActiveFiltersIndicator();
    }

    /**
     * Update sort direction button appearance
     */
    private updateSortDirectionButton(): void {
        const button = this.container.querySelector('.filter-bar-sort-direction') as HTMLElement;
        if (button) {
            button.textContent = this.currentQuery.sortDirection === 'asc' ? '↑' : '↓';
            button.title = `Sort ${this.currentQuery.sortDirection === 'asc' ? 'Ascending' : 'Descending'}`;
        }
    }

    /**
     * Update active filters indicator
     */
    private updateActiveFiltersIndicator(): void {
        if (!this.activeFiltersIndicator) return;

        let activeCount = 0;
        
        if (this.currentQuery.searchQuery) activeCount++;
        if (this.currentQuery.status && this.currentQuery.status !== 'all') activeCount++;
        if (this.currentQuery.priorities && this.currentQuery.priorities.length > 0) activeCount++;
        if (this.currentQuery.contexts && this.currentQuery.contexts.length > 0) activeCount++;
        if (this.currentQuery.showArchived) activeCount++;
        if (this.currentQuery.dateRange) activeCount++;

        if (activeCount > 0) {
            this.activeFiltersIndicator.textContent = `(${activeCount})`;
            this.activeFiltersIndicator.classList.remove('is-hidden');
        } else {
            this.activeFiltersIndicator.classList.add('is-hidden');
        }
    }

    /**
     * Toggle advanced filters panel visibility
     */
    private toggleAdvancedFilters(): void {
        if (!this.advancedFiltersPanel) return;

        const isVisible = !this.advancedFiltersPanel.classList.contains('is-hidden');
        this.advancedFiltersPanel.classList.toggle('is-hidden', isVisible);
        
        if (this.advancedFiltersButton) {
            this.advancedFiltersButton.classList.toggle('active', !isVisible);
        }
    }

    /**
     * Rebuild advanced filters when options change
     */
    private rebuildAdvancedFilters(): void {
        if (!this.advancedFiltersPanel) return;

        // Rebuild status radio buttons
        this.rebuildStatusRadioButtons();

        // Rebuild priority checkboxes
        this.rebuildPriorityCheckboxes();
        
        // Rebuild context checkboxes
        this.rebuildContextCheckboxes();
    }

    /**
     * Helper to rebuild select options while preserving selection
     */
    private rebuildSelectOptions(select: HTMLSelectElement | undefined, options: string[], currentSelection?: string[]): void {
        if (!select) return;

        const selectedValues = currentSelection || [];
        select.empty();

        options.forEach(option => {
            const optionEl = select.createEl('option', {
                value: option,
                text: option
            });
            optionEl.selected = selectedValues.includes(option);
        });
    }

    /**
     * Rebuild status radio buttons while preserving selection
     */
    private rebuildStatusRadioButtons(): void {
        const statusContainer = this.advancedFiltersPanel?.querySelector('.filter-bar-advanced-item:nth-child(1) .filter-bar-checkbox-group');
        if (!statusContainer) return;

        const selectedStatus = this.currentQuery.status || 'all';
        statusContainer.empty();

        // Add "All" and "Open" options first
        const specialOptions = [
            { value: 'all', text: 'All' },
            { value: 'open', text: 'Open Tasks' }
        ];

        specialOptions.forEach(option => {
            const checkboxWrapper = statusContainer.createDiv('filter-bar-checkbox-wrapper');
            
            const label = checkboxWrapper.createEl('label', {
                cls: 'filter-bar-checkbox-label'
            });

            const checkbox = label.createEl('input', {
                type: 'radio',
                value: option.value,
                cls: 'filter-bar-checkbox',
                attr: { name: 'status-filter' }
            });

            checkbox.checked = option.value === selectedStatus;

            label.createSpan({ text: option.text });

            checkbox.addEventListener('change', () => {
                this.updateStatusFilter();
            });
        });

        // Add specific status options
        this.filterOptions.statuses.forEach(status => {
            const checkboxWrapper = statusContainer.createDiv('filter-bar-checkbox-wrapper');
            
            const label = checkboxWrapper.createEl('label', {
                cls: 'filter-bar-checkbox-label'
            });

            const checkbox = label.createEl('input', {
                type: 'radio',
                value: status,
                cls: 'filter-bar-checkbox',
                attr: { name: 'status-filter' }
            });

            checkbox.checked = status === selectedStatus;

            label.createSpan({ text: status });

            checkbox.addEventListener('change', () => {
                this.updateStatusFilter();
            });
        });
    }

    /**
     * Rebuild priority checkboxes while preserving selection
     */
    private rebuildPriorityCheckboxes(): void {
        const priorityContainer = this.advancedFiltersPanel?.querySelector('.filter-bar-advanced-item:nth-child(2) .filter-bar-checkbox-group');
        if (!priorityContainer) return;

        const selectedPriorities = this.currentQuery.priorities || [];
        priorityContainer.empty();

        this.filterOptions.priorities.forEach(priority => {
            const checkboxWrapper = priorityContainer.createDiv('filter-bar-checkbox-wrapper');
            
            const label = checkboxWrapper.createEl('label', {
                cls: 'filter-bar-checkbox-label'
            });

            const checkbox = label.createEl('input', {
                type: 'checkbox',
                value: priority,
                cls: 'filter-bar-checkbox'
            });

            checkbox.checked = selectedPriorities.includes(priority);

            label.createSpan({ text: priority });

            checkbox.addEventListener('change', () => {
                this.updatePriorityFilter();
            });
        });
    }

    /**
     * Rebuild context checkboxes while preserving selection
     */
    private rebuildContextCheckboxes(): void {
        const contextContainer = this.advancedFiltersPanel?.querySelector('.filter-bar-advanced-item:nth-child(3) .filter-bar-checkbox-group');
        if (!contextContainer) return;

        const selectedContexts = this.currentQuery.contexts || [];
        contextContainer.empty();

        this.filterOptions.contexts.forEach(context => {
            const checkboxWrapper = contextContainer.createDiv('filter-bar-checkbox-wrapper');
            
            const label = checkboxWrapper.createEl('label', {
                cls: 'filter-bar-checkbox-label'
            });

            const checkbox = label.createEl('input', {
                type: 'checkbox',
                value: context,
                cls: 'filter-bar-checkbox'
            });

            checkbox.checked = selectedContexts.includes(context);

            label.createSpan({ text: context });

            checkbox.addEventListener('change', () => {
                this.updateContextFilter();
            });
        });
    }

    /**
     * Get human-readable label for sort key
     */
    private getSortKeyLabel(key: TaskSortKey): string {
        const labels: Record<TaskSortKey, string> = {
            'due': 'Due Date',
            'priority': 'Priority',
            'title': 'Title'
        };
        return labels[key] || key;
    }

    /**
     * Get human-readable label for group key
     */
    private getGroupKeyLabel(key: TaskGroupKey): string {
        const labels: Record<TaskGroupKey, string> = {
            'none': 'None',
            'status': 'Status',
            'priority': 'Priority',
            'context': 'Context',
            'due': 'Due Date'
        };
        return labels[key] || key;
    }

    /**
     * Destroy and clean up the FilterBar
     */
    destroy(): void {
        this.container.empty();
        this.removeAllListeners();
    }
}