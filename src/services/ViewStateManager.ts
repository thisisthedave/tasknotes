import { FilterQuery, ViewFilterState } from '../types';
import { EventEmitter } from '../utils/EventEmitter';

/**
 * Manages view-specific state like filter preferences across the application
 */
export class ViewStateManager extends EventEmitter {
    private filterState: ViewFilterState = {};
    private storageKey = 'tasknotes-view-filter-state';

    constructor() {
        super();
        this.loadFromStorage();
    }

    /**
     * Get filter state for a specific view
     */
    getFilterState(viewType: string): FilterQuery | undefined {
        return this.filterState[viewType];
    }

    /**
     * Set filter state for a specific view
     */
    setFilterState(viewType: string, query: FilterQuery): void {
        this.filterState[viewType] = { ...query };
        this.saveToStorage();
        this.emit('filter-state-changed', { viewType, query });
    }

    /**
     * Clear filter state for a specific view
     */
    clearFilterState(viewType: string): void {
        delete this.filterState[viewType];
        this.saveToStorage();
        this.emit('filter-state-cleared', { viewType });
    }

    /**
     * Clear all filter states
     */
    clearAllFilterStates(): void {
        this.filterState = {};
        this.saveToStorage();
        this.emit('all-filter-states-cleared');
    }

    /**
     * Load state from localStorage
     */
    private loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                this.filterState = JSON.parse(stored);
            }
        } catch (error) {
            console.warn('Failed to load view filter state from storage:', error);
            this.filterState = {};
        }
    }

    /**
     * Save state to localStorage
     */
    private saveToStorage(): void {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.filterState));
        } catch (error) {
            console.warn('Failed to save view filter state to storage:', error);
        }
    }

    /**
     * Get all filter states (for debugging or export)
     */
    getAllFilterStates(): ViewFilterState {
        return { ...this.filterState };
    }
}