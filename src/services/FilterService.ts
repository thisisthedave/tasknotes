import { FilterQuery, TaskInfo, TaskSortKey, TaskGroupKey, SortDirection } from '../types';
import { CacheManager } from '../utils/CacheManager';
import { StatusManager } from './StatusManager';
import { PriorityManager } from './PriorityManager';
import { EventEmitter } from '../utils/EventEmitter';
import { isRecurringTaskDueOn } from '../utils/helpers';

/**
 * Unified filtering, sorting, and grouping service for all task views.
 * Provides performance-optimized data retrieval using CacheManager indexes.
 */
export class FilterService extends EventEmitter {
    private cacheManager: CacheManager;
    private statusManager: StatusManager;
    private priorityManager: PriorityManager;

    constructor(
        cacheManager: CacheManager,
        statusManager: StatusManager,
        priorityManager: PriorityManager
    ) {
        super();
        this.cacheManager = cacheManager;
        this.statusManager = statusManager;
        this.priorityManager = priorityManager;
    }

    /**
     * Main method to get filtered, sorted, and grouped tasks
     * Uses performance-optimized strategy starting with smallest dataset
     */
    async getGroupedTasks(query: FilterQuery, targetDate?: Date): Promise<Map<string, TaskInfo[]>> {
        // Step 1: Get initial task set using best available index
        let initialTaskPaths = await this.getInitialTaskSet(query);
        
        // Step 2: Convert paths to TaskInfo objects with filtering
        const filteredTasks = await this.filterTasksByQuery(initialTaskPaths, query);
        
        // Step 3: Sort the filtered results
        const sortedTasks = this.sortTasks(filteredTasks, query.sortKey, query.sortDirection);
        
        // Step 4: Group the sorted results
        return this.groupTasks(sortedTasks, query.groupKey, targetDate);
    }

    /**
     * Get the smallest possible initial dataset using CacheManager indexes
     * Priority order: status > priority > date > all tasks
     */
    private async getInitialTaskSet(query: FilterQuery): Promise<Set<string>> {
        // Strategy 1: Use specific status index
        if (query.status && query.status !== 'all' && query.status !== 'open') {
            const statusPaths = this.cacheManager.getTaskPathsByStatus(query.status);
            if (statusPaths.size > 0) {
                return statusPaths;
            }
        }

        // Strategy 2: Use priority index if specific priorities requested
        if (query.priorities && query.priorities.length === 1) {
            const priorityPaths = this.cacheManager.getTaskPathsByPriority(query.priorities[0]);
            if (priorityPaths.size > 0) {
                return priorityPaths;
            }
        }

        // Strategy 3: Use date range if specified (with optional overdue tasks)
        if (query.dateRange) {
            const dateRangePaths = await this.getTaskPathsInDateRange(query.dateRange.start, query.dateRange.end);
            
            // If includeOverdue is true, combine with overdue tasks
            if (query.includeOverdue) {
                const overduePaths = this.getOverdueTaskPaths();
                return this.combineTaskPathSets([dateRangePaths, overduePaths]);
            }
            
            return dateRangePaths;
        }

        // Strategy 4: Fallback to all tasks
        return this.cacheManager.getAllTaskPaths();
    }

    /**
     * Get task paths within a date range
     */
    private async getTaskPathsInDateRange(startDate: string, endDate: string): Promise<Set<string>> {
        const pathsInRange = new Set<string>();
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Get tasks with due dates in the range (existing logic)
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const dateStr = date.toISOString().split('T')[0];
            const pathsForDate = this.cacheManager.getTaskPathsByDate(dateStr);
            pathsForDate.forEach(path => pathsInRange.add(path));
        }

        // Also check recurring tasks without due dates to see if they should appear in this range
        const allTaskPaths = this.cacheManager.getAllTaskPaths();
        
        // Process paths in batches for better performance
        const batchSize = 50;
        const pathArray = Array.from(allTaskPaths);
        
        for (let i = 0; i < pathArray.length; i += batchSize) {
            const batch = pathArray.slice(i, i + batchSize);
            const batchTasks = await Promise.all(
                batch.map(path => this.cacheManager.getCachedTaskInfo(path))
            );
            
            for (const task of batchTasks) {
                if (task && task.recurrence && !task.due) {
                    // Check if this recurring task should appear on any date in the range
                    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
                        if (isRecurringTaskDueOn(task, date)) {
                            pathsInRange.add(task.path);
                            break; // No need to check more dates once we find a match
                        }
                    }
                }
            }
        }

        return pathsInRange;
    }

    /**
     * Get overdue task paths efficiently using the dedicated index
     */
    getOverdueTaskPaths(): Set<string> {
        return this.cacheManager.getOverdueTaskPaths();
    }

    /**
     * Combine multiple task path sets (e.g., date range + overdue)
     */
    private combineTaskPathSets(sets: Set<string>[]): Set<string> {
        const combined = new Set<string>();
        sets.forEach(set => {
            set.forEach(path => combined.add(path));
        });
        return combined;
    }

    /**
     * Filter task paths to TaskInfo objects based on query criteria
     */
    private async filterTasksByQuery(taskPaths: Set<string>, query: FilterQuery): Promise<TaskInfo[]> {
        const filteredTasks: TaskInfo[] = [];
        
        // Process paths in batches for better performance
        const batchSize = 50;
        const pathArray = Array.from(taskPaths);

        for (let i = 0; i < pathArray.length; i += batchSize) {
            const batch = pathArray.slice(i, i + batchSize);
            const batchTasks = await Promise.all(
                batch.map(path => this.cacheManager.getCachedTaskInfo(path))
            );

            for (const task of batchTasks) {
                if (task && this.matchesQuery(task, query)) {
                    filteredTasks.push(task);
                }
            }
        }

        return filteredTasks;
    }

    /**
     * Check if a task matches the filter query
     */
    private matchesQuery(task: TaskInfo, query: FilterQuery): boolean {
        // Search query filter
        if (query.searchQuery) {
            const searchTerm = query.searchQuery.toLowerCase();
            const titleMatch = task.title.toLowerCase().includes(searchTerm);
            const contextMatch = task.contexts?.some(context => 
                context.toLowerCase().includes(searchTerm)
            ) || false;
            
            if (!titleMatch && !contextMatch) {
                return false;
            }
        }

        // Status filter (if not already used for initial set)
        if (query.status && query.status !== 'all') {
            if (query.status === 'open') {
                // 'open' means all non-completed tasks
                const isCompleted = this.statusManager.isCompletedStatus(task.status);
                if (isCompleted) {
                    return false;
                }
            } else if (task.status !== query.status) {
                return false;
            }
        }

        // Priority filter (if not already used for initial set)
        if (query.priorities && query.priorities.length > 0) {
            if (!query.priorities.includes(task.priority)) {
                return false;
            }
        }

        // Context filter
        if (query.contexts && query.contexts.length > 0) {
            if (!task.contexts || !query.contexts.some(context => 
                task.contexts!.includes(context)
            )) {
                return false;
            }
        }

        // Archived filter
        if (!query.showArchived && task.archived) {
            return false;
        }

        // Date range filter (if not already used for initial set)
        if (query.dateRange) {
            // For recurring tasks without due dates, check if they appear on any date in range
            if (task.recurrence && !task.due) {
                const startDate = new Date(query.dateRange.start);
                const endDate = new Date(query.dateRange.end);
                
                // Check each date in range to see if recurring task should appear
                let appearsInRange = false;
                for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
                    if (isRecurringTaskDueOn(task, date)) {
                        appearsInRange = true;
                        break;
                    }
                }
                
                if (!appearsInRange) {
                    return false;
                }
            }
            // For tasks with due dates, use existing logic
            else if (task.due) {
                const taskDate = new Date(task.due);
                const startDate = new Date(query.dateRange.start);
                const endDate = new Date(query.dateRange.end);
                
                // If includeOverdue is true and this task is overdue, don't filter it out by date
                if (query.includeOverdue && taskDate < new Date()) {
                    // This is an overdue task and we want to include overdue tasks, so don't filter by date range
                } else if (taskDate < startDate || taskDate > endDate) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Sort tasks by specified criteria
     */
    private sortTasks(tasks: TaskInfo[], sortKey: TaskSortKey, direction: SortDirection): TaskInfo[] {
        return tasks.sort((a, b) => {
            let comparison = 0;

            switch (sortKey) {
                case 'due':
                    comparison = this.compareDates(a.due, b.due);
                    break;
                case 'priority':
                    comparison = this.comparePriorities(a.priority, b.priority);
                    break;
                case 'title':
                    comparison = a.title.localeCompare(b.title);
                    break;
            }

            return direction === 'desc' ? -comparison : comparison;
        });
    }

    /**
     * Compare due dates with proper null handling
     */
    private compareDates(dateA?: string, dateB?: string): number {
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1; // No due date sorts last
        if (!dateB) return -1;
        
        return new Date(dateA).getTime() - new Date(dateB).getTime();
    }

    /**
     * Compare priorities using PriorityManager weights
     */
    private comparePriorities(priorityA: string, priorityB: string): number {
        const weightA = this.priorityManager.getPriorityWeight(priorityA);
        const weightB = this.priorityManager.getPriorityWeight(priorityB);
        
        // Higher weight = higher priority, so reverse for ascending order
        return weightB - weightA;
    }

    /**
     * Group sorted tasks by specified criteria
     */
    private groupTasks(tasks: TaskInfo[], groupKey: TaskGroupKey, targetDate?: Date): Map<string, TaskInfo[]> {
        if (groupKey === 'none') {
            return new Map([['all', tasks]]);
        }

        const groups = new Map<string, TaskInfo[]>();

        for (const task of tasks) {
            let groupValue: string;

            switch (groupKey) {
                case 'status':
                    groupValue = task.status || 'unknown';
                    break;
                case 'priority':
                    groupValue = task.priority || 'unknown';
                    break;
                case 'context':
                    // For multiple contexts, put task in first context or 'none'
                    groupValue = (task.contexts && task.contexts.length > 0) 
                        ? task.contexts[0] 
                        : 'none';
                    break;
                case 'due':
                    groupValue = this.getDueDateGroup(task, targetDate);
                    break;
                default:
                    groupValue = 'unknown';
            }

            if (!groups.has(groupValue)) {
                groups.set(groupValue, []);
            }
            groups.get(groupValue)!.push(task);
        }

        return this.sortGroups(groups, groupKey);
    }

    /**
     * Get due date group for task (Today, Tomorrow, This Week, etc.)
     * For recurring tasks, checks if the task is due on the target date
     */
    private getDueDateGroup(task: TaskInfo, targetDate?: Date): string {
        // Use target date if provided, otherwise use today
        const referenceDate = targetDate || new Date();
        referenceDate.setHours(0, 0, 0, 0);

        // For recurring tasks, check if due on the target date
        if (task.recurrence) {
            if (isRecurringTaskDueOn(task, referenceDate)) {
                // If due on target date, determine which group based on target date vs today
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                
                const thisWeek = new Date(today);
                thisWeek.setDate(thisWeek.getDate() + 7);
                
                if (referenceDate.getTime() < today.getTime()) return 'Overdue';
                if (referenceDate.getTime() === today.getTime()) return 'Today';
                if (referenceDate.getTime() === tomorrow.getTime()) return 'Tomorrow';
                if (referenceDate <= thisWeek) return 'This week';
                
                return 'Later';
            } else {
                // Recurring task not due on target date
                // If it has an original due date, use that, otherwise no due date
                if (task.due) {
                    return this.getDueDateGroupFromDate(task.due);
                }
                return 'No due date';
            }
        }
        
        // Non-recurring task - use original logic
        if (!task.due) return 'No due date';
        return this.getDueDateGroupFromDate(task.due);
    }
    
    /**
     * Helper method to get due date group from a specific date string
     */
    private getDueDateGroupFromDate(dueDate: string): string {
        const due = new Date(dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const thisWeek = new Date(today);
        thisWeek.setDate(thisWeek.getDate() + 7);

        const dueDateOnly = new Date(due);
        dueDateOnly.setHours(0, 0, 0, 0);

        if (dueDateOnly < today) return 'Overdue';
        if (dueDateOnly.getTime() === today.getTime()) return 'Today';
        if (dueDateOnly.getTime() === tomorrow.getTime()) return 'Tomorrow';
        if (dueDateOnly <= thisWeek) return 'This week';
        
        return 'Later';
    }

    /**
     * Sort groups according to logical order
     */
    private sortGroups(groups: Map<string, TaskInfo[]>, groupKey: TaskGroupKey): Map<string, TaskInfo[]> {
        const sortedGroups = new Map<string, TaskInfo[]>();
        
        let sortedKeys: string[];
        
        switch (groupKey) {
            case 'priority':
                // Sort by priority weight (high to low)
                sortedKeys = Array.from(groups.keys()).sort((a, b) => {
                    const weightA = this.priorityManager.getPriorityWeight(a);
                    const weightB = this.priorityManager.getPriorityWeight(b);
                    return weightB - weightA;
                });
                break;
                
            case 'status':
                // Sort by status order
                sortedKeys = Array.from(groups.keys()).sort((a, b) => {
                    const orderA = this.statusManager.getStatusOrder(a);
                    const orderB = this.statusManager.getStatusOrder(b);
                    return orderA - orderB;
                });
                break;
                
            case 'due':
                // Sort by logical due date order
                const dueDateOrder = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'No due date'];
                sortedKeys = Array.from(groups.keys()).sort((a, b) => {
                    const indexA = dueDateOrder.indexOf(a);
                    const indexB = dueDateOrder.indexOf(b);
                    return indexA - indexB;
                });
                break;
                
            default:
                // Alphabetical sort for contexts and others
                sortedKeys = Array.from(groups.keys()).sort();
        }

        // Rebuild map in sorted order
        for (const key of sortedKeys) {
            sortedGroups.set(key, groups.get(key)!);
        }

        return sortedGroups;
    }

    /**
     * Get available filter options for building FilterBar UI
     */
    async getFilterOptions(): Promise<{
        statuses: string[];
        priorities: string[];
        contexts: string[];
    }> {
        return {
            statuses: this.cacheManager.getAllStatuses(),
            priorities: this.cacheManager.getAllPriorities(),
            contexts: await this.cacheManager.getAllContexts()
        };
    }

    /**
     * Create a default filter query
     */
    createDefaultQuery(): FilterQuery {
        return {
            searchQuery: undefined,
            status: 'all',
            contexts: undefined,
            priorities: undefined,
            dateRange: undefined,
            showArchived: false,
            sortKey: 'due',
            sortDirection: 'asc',
            groupKey: 'none'
        };
    }

    /**
     * Validate and normalize a filter query
     */
    normalizeQuery(query: Partial<FilterQuery>): FilterQuery {
        const defaultQuery = this.createDefaultQuery();
        
        return {
            searchQuery: query.searchQuery || defaultQuery.searchQuery,
            status: query.status || defaultQuery.status,
            contexts: query.contexts || defaultQuery.contexts,
            priorities: query.priorities || defaultQuery.priorities,
            dateRange: query.dateRange || defaultQuery.dateRange,
            showArchived: query.showArchived ?? defaultQuery.showArchived,
            sortKey: query.sortKey || defaultQuery.sortKey,
            sortDirection: query.sortDirection || defaultQuery.sortDirection,
            groupKey: query.groupKey || defaultQuery.groupKey
        };
    }

    /**
     * Subscribe to cache changes and emit refresh events
     */
    initialize(): void {
        this.cacheManager.subscribe('file-updated', () => {
            this.emit('data-changed');
        });
        
        this.cacheManager.subscribe('file-added', () => {
            this.emit('data-changed');
        });
        
        this.cacheManager.subscribe('file-deleted', () => {
            this.emit('data-changed');
        });
    }
}
