import { FilterQuery, TaskInfo, TaskSortKey, TaskGroupKey, SortDirection, FilterCondition, FilterGroup, FilterOptions, FilterProperty, FilterOperator } from '../types';
import { parseLinktext } from 'obsidian';
import { MinimalNativeCache } from '../utils/MinimalNativeCache';
import { StatusManager } from './StatusManager';
import { PriorityManager } from './PriorityManager';
import { EventEmitter } from '../utils/EventEmitter';
import { FilterUtils, FilterValidationError, FilterEvaluationError, TaskPropertyValue } from '../utils/FilterUtils';
import { isDueByRRule, filterEmptyProjects, getEffectiveTaskStatus } from '../utils/helpers';
import { format, isToday } from 'date-fns';
import { 
    getTodayString, 
    isBeforeDateSafe, 
    isSameDateSafe, 
    startOfDayForDateString, 
    isToday as isTodayUtil,
    isBeforeDateTimeAware,
    isOverdueTimeAware,
    getDatePart
} from '../utils/dateUtils';

/**
 * Unified filtering, sorting, and grouping service for all task views.
 * Provides performance-optimized data retrieval using CacheManager indexes.
 */
export class FilterService extends EventEmitter {
    private cacheManager: MinimalNativeCache;
    private statusManager: StatusManager;
    private priorityManager: PriorityManager;
    
    // Query result caching for repeated filter operations
    private indexQueryCache = new Map<string, Set<string>>();
    private cacheTimeout = 30000; // 30 seconds
    private cacheTimers = new Map<string, ReturnType<typeof setTimeout>>();
    
    // Filter options caching for better performance
    private filterOptionsCache: FilterOptions | null = null;
    private filterOptionsCacheTimestamp = 0;
    private filterOptionsCacheTTL = 300000; // 5 minutes fallback TTL (should rarely be needed)
    private filterOptionsComputeCount = 0;
    private filterOptionsCacheHits = 0;

    constructor(
        cacheManager: MinimalNativeCache,
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
     * Handles the new advanced FilterQuery structure with nested conditions and groups
     * Uses query-first approach with index optimization for better performance
     */
    async getGroupedTasks(query: FilterQuery, targetDate?: Date): Promise<Map<string, TaskInfo[]>> {
        try {
            // Use non-strict validation to allow incomplete filters during building
            FilterUtils.validateFilterNode(query, false);
            
            // PHASE 1 OPTIMIZATION: Use query-first approach with index-backed filtering
            let candidateTaskPaths = this.getIndexOptimizedTaskPaths(query);
            
            // Convert paths to TaskInfo objects (only for candidates)
            const candidateTasks = await this.pathsToTaskInfos(Array.from(candidateTaskPaths));
            
            // Apply full filter query to the reduced candidate set
            const filteredTasks = candidateTasks.filter(task => this.evaluateFilterNode(query, task, targetDate));
            
            // Sort the filtered results
            const sortedTasks = this.sortTasks(filteredTasks, query.sortKey || 'due', query.sortDirection || 'asc');
            
            // Group the sorted results
            return this.groupTasks(sortedTasks, query.groupKey || 'none', targetDate);
        } catch (error) {
            if (error instanceof FilterValidationError || error instanceof FilterEvaluationError) {
                console.error('Filter error:', error.message, { nodeId: error.nodeId, field: (error as FilterValidationError).field });
                // Return empty results rather than throwing - let UI handle gracefully
                return new Map<string, TaskInfo[]>();
            }
            throw error;
        }
    }

    /**
     * Get optimized task paths using index-backed filtering
     * Analyzes the filter query to find safe optimization opportunities
     * Returns a reduced set of candidate task paths for further processing
     * CRITICAL: Only optimizes when it's guaranteed to not exclude valid results
     */
    private getIndexOptimizedTaskPaths(query: FilterQuery): Set<string> {
        // Analyze if optimization is safe for this query structure
        const optimizationAnalysis = this.analyzeQueryOptimizationSafety(query);
        
        if (!optimizationAnalysis.canOptimize) {
            // Optimization not safe - return all task paths to ensure correctness
            console.debug('FilterService: Optimization not safe for this query, using all tasks');
            return this.cacheManager.getAllTaskPaths();
        }
        
        // Safe to optimize - apply the optimization strategy
        if (optimizationAnalysis.strategy === 'intersect') {
            // All indexable conditions are in AND relationship - intersect them
            let candidatePaths = this.getPathsForIndexableCondition(optimizationAnalysis.conditions[0]);
            
            for (let i = 1; i < optimizationAnalysis.conditions.length; i++) {
                const conditionPaths = this.getPathsForIndexableCondition(optimizationAnalysis.conditions[i]);
                candidatePaths = this.intersectPathSets(candidatePaths, conditionPaths);
            }
            
            console.debug(`FilterService: Optimized using intersection of ${optimizationAnalysis.conditions.length} conditions (${candidatePaths.size} candidates)`);
            return candidatePaths;
        } else if (optimizationAnalysis.strategy === 'single') {
            // Single indexable condition that's safe to use
            const candidatePaths = this.getPathsForIndexableCondition(optimizationAnalysis.conditions[0]);
            console.debug(`FilterService: Optimized using single condition (${candidatePaths.size} candidates)`);
            return candidatePaths;
        }
        
        // Fallback to all tasks
        console.debug('FilterService: No valid optimization strategy, using all tasks');
        return this.cacheManager.getAllTaskPaths();
    }

    /**
     * Analyze query structure to determine if optimization is safe and what strategy to use
     */
    private analyzeQueryOptimizationSafety(query: FilterQuery): {
        canOptimize: boolean;
        strategy?: 'intersect' | 'single';
        conditions: FilterCondition[];
        reason?: string;
    } {
        // Find all indexable conditions in the query
        const indexableConditions = this.findIndexableConditions(query);
        
        if (indexableConditions.length === 0) {
            return { 
                canOptimize: false, 
                conditions: [], 
                reason: 'No indexable conditions found' 
            };
        }
        
        // For simple queries (single condition or only AND at root level), optimization is safe
        if (this.isSimpleQuery(query, indexableConditions)) {
            return {
                canOptimize: true,
                strategy: indexableConditions.length === 1 ? 'single' : 'intersect',
                conditions: indexableConditions
            };
        }
        
        // For complex queries with OR conditions involving indexable conditions,
        // we need to be very careful. Conservative approach: don't optimize.
        return { 
            canOptimize: false, 
            conditions: indexableConditions,
            reason: 'Complex query structure with OR conditions - optimization not safe'
        };
    }

    /**
     * Check if query is simple enough for safe optimization
     * A simple query is one where all indexable conditions are in AND relationship
     */
    private isSimpleQuery(query: FilterQuery, indexableConditions: FilterCondition[]): boolean {
        // If no indexable conditions, nothing to optimize
        if (indexableConditions.length === 0) {
            return false;
        }
        
        // CRITICAL: Check if any indexable condition is part of an OR group
        // This would make pre-filtering unsafe as it could exclude valid results
        if (this.hasIndexableConditionInOrGroup(query, indexableConditions)) {
            return false;
        }
        
        // If only one indexable condition AND it's not in an OR group, safe to optimize
        if (indexableConditions.length === 1) {
            return true;
        }
        
        // Check if all indexable conditions are at the root level and root is AND
        if (query.type === 'group' && query.conjunction === 'and') {
            const rootIndexableConditions = query.children.filter(child => 
                child.type === 'condition' && this.isIndexableCondition(child)
            );
            
            // If all indexable conditions are at root level in an AND group, safe to intersect
            if (rootIndexableConditions.length === indexableConditions.length) {
                return true;
            }
        }
        
        // Any other structure is potentially unsafe
        return false;
    }

    /**
     * Check if any indexable condition is part of an OR group
     * This makes optimization unsafe as it would exclude valid results
     */
    private hasIndexableConditionInOrGroup(query: FilterQuery, indexableConditions: FilterCondition[]): boolean {
        return this.checkNodeForOrWithIndexable(query, indexableConditions);
    }

    /**
     * Recursively check if any indexable condition is in an OR group
     */
    private checkNodeForOrWithIndexable(node: FilterQuery | FilterCondition, indexableConditions: FilterCondition[]): boolean {
        if (node.type === 'condition') {
            return false; // Conditions themselves can't contain OR
        }
        
        if (node.type === 'group') {
            // If this group is OR and contains any indexable conditions, optimization is unsafe
            if (node.conjunction === 'or') {
                const hasIndexableChild = node.children.some(child => 
                    child.type === 'condition' && indexableConditions.includes(child)
                );
                if (hasIndexableChild) {
                    console.debug('FilterService: Found indexable condition in OR group - optimization unsafe');
                    return true;
                }
            }
            
            // Recursively check child groups
            for (const child of node.children) {
                if (this.checkNodeForOrWithIndexable(child, indexableConditions)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Recursively find all indexable conditions in a filter query
     */
    private findIndexableConditions(node: FilterQuery | FilterCondition): FilterCondition[] {
        const conditions: FilterCondition[] = [];
        
        if (node.type === 'condition') {
            if (this.isIndexableCondition(node)) {
                conditions.push(node);
            }
        } else if (node.type === 'group') {
            for (const child of node.children) {
                conditions.push(...this.findIndexableConditions(child));
            }
        }
        
        return conditions;
    }

    /**
     * Check if a condition can be optimized using existing indexes
     */
    private isIndexableCondition(condition: FilterCondition): boolean {
        const { property, operator, value } = condition;
        
        // Status-based conditions (uses tasksByStatus index)
        if (property === 'status' && operator === 'is' && value) {
            return true;
        }
        
        // Due date conditions (uses tasksByDate index)
        if (property === 'due' && (operator === 'is' || operator === 'is-before' || operator === 'is-after') && value) {
            return true;
        }
        
        // Scheduled date conditions (uses tasksByDate index)
        if (property === 'scheduled' && (operator === 'is' || operator === 'is-before' || operator === 'is-after') && value) {
            return true;
        }
        
        return false;
    }


    /**
     * Get cached index query result with automatic expiration
     * Returns a copy of the cached result to avoid mutation issues
     */
    private getCachedIndexResult(cacheKey: string, computer: () => Set<string>): Set<string> {
        const cached = this.indexQueryCache.get(cacheKey);
        if (cached) {
            // Cache hit - return copy to avoid mutation of cached data
            console.debug(`FilterService: Cache HIT for key "${cacheKey}" (${cached.size} results)`);
            return new Set(cached);
        }

        // Cache miss - compute the result
        console.debug(`FilterService: Cache MISS for key "${cacheKey}", computing...`);
        const startTime = performance.now();
        const result = computer();
        const computeTime = performance.now() - startTime;
        console.debug(`FilterService: Computed "${cacheKey}" in ${computeTime.toFixed(2)}ms (${result.size} results)`);
        
        // Cache the result
        this.indexQueryCache.set(cacheKey, new Set(result));

        // Clear any existing timer for this key
        const existingTimer = this.cacheTimers.get(cacheKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Auto-expire cache entry after timeout
        const timer = setTimeout(() => {
            console.debug(`FilterService: Cache entry "${cacheKey}" expired`);
            this.indexQueryCache.delete(cacheKey);
            this.cacheTimers.delete(cacheKey);
        }, this.cacheTimeout);
        
        this.cacheTimers.set(cacheKey, timer);

        return result;
    }

    /**
     * Clear all cached index query results
     * Called when underlying data changes to ensure cache consistency
     */
    private clearIndexQueryCache(): void {
        const cacheSize = this.indexQueryCache.size;
        if (cacheSize > 0) {
            console.debug(`FilterService: Clearing query cache (${cacheSize} entries)`);
        }
        
        // Clear all timers
        for (const timer of this.cacheTimers.values()) {
            clearTimeout(timer);
        }
        
        // Clear caches
        this.indexQueryCache.clear();
        this.cacheTimers.clear();
    }

    /**
     * Get query cache statistics for monitoring performance
     */
    getCacheStats(): {
        entryCount: number;
        cacheKeys: string[];
        timeoutMs: number;
    } {
        return {
            entryCount: this.indexQueryCache.size,
            cacheKeys: Array.from(this.indexQueryCache.keys()),
            timeoutMs: this.cacheTimeout
        };
    }

    /**
     * Get task paths for a specific indexable condition with caching
     */
    private getPathsForIndexableCondition(condition: FilterCondition): Set<string> {
        const { property, operator, value } = condition;
        
        // Create cache key from condition properties
        const cacheKey = `${property}:${operator}:${value}`;
        
        return this.getCachedIndexResult(cacheKey, () => {
            // Original logic for computing paths
            if (property === 'status' && operator === 'is' && value && typeof value === 'string') {
                return new Set(this.cacheManager.getTaskPathsByStatus(value));
            }
            
            if ((property === 'due' || property === 'scheduled') && operator === 'is' && value && typeof value === 'string') {
                return new Set(this.cacheManager.getTasksForDate(value));
            }
            
            // For date range conditions, we'll need to implement range queries
            if ((property === 'due' || property === 'scheduled') && (operator === 'is-before' || operator === 'is-after') && value && typeof value === 'string') {
                return this.getTaskPathsForDateRange(property, operator, value);
            }
            
            // Fallback - return all paths if we can't optimize
            return this.cacheManager.getAllTaskPaths();
        });
    }

    /**
     * Get task paths for date range queries (before/after operators)
     */
    private getTaskPathsForDateRange(property: string, operator: string, value: string): Set<string> {
        // For now, return all paths and let the full filter handle the range logic
        // This could be optimized further by implementing date range indexes
        return this.cacheManager.getAllTaskPaths();
    }


    /**
     * Intersect two sets of task paths
     */
    private intersectPathSets(set1: Set<string>, set2: Set<string>): Set<string> {
        const intersection = new Set<string>();
        for (const path of set1) {
            if (set2.has(path)) {
                intersection.add(path);
            }
        }
        return intersection;
    }

    /**
     * Convert task paths to TaskInfo objects
     */
    private async pathsToTaskInfos(paths: string[]): Promise<TaskInfo[]> {
        const tasks: TaskInfo[] = [];
        const batchSize = 50;
        
        for (let i = 0; i < paths.length; i += batchSize) {
            const batch = paths.slice(i, i + batchSize);
            const batchTasks = await Promise.all(
                batch.map(path => this.cacheManager.getCachedTaskInfo(path))
            );
            
            for (const task of batchTasks) {
                if (task) {
                    tasks.push(task);
                }
            }
        }
        
        return tasks;
    }

    /**
     * Recursively evaluate a filter node (group or condition) against a task
     * Returns true if the task matches the filter criteria
     */
    private evaluateFilterNode(node: FilterGroup | FilterCondition, task: TaskInfo, targetDate?: Date): boolean {
        if (node.type === 'condition') {
            return this.evaluateCondition(node, task, targetDate);
        } else if (node.type === 'group') {
            return this.evaluateGroup(node, task, targetDate);
        }
        return true; // Default to true if unknown node type
    }

    /**
     * Evaluate a filter group against a task
     */
    private evaluateGroup(group: FilterGroup, task: TaskInfo, targetDate?: Date): boolean {
        if (group.children.length === 0) {
            return true; // Empty group matches everything
        }

        // Filter out incomplete conditions - they should be completely ignored
        const completeChildren = group.children.filter(child => {
            if (child.type === 'condition') {
                return FilterUtils.isFilterNodeComplete(child);
            }
            return true; // Groups are always evaluated (they may contain complete conditions)
        });

        // If no complete children, return true (no active filters)
        if (completeChildren.length === 0) {
            return true;
        }

        if (group.conjunction === 'and') {
            // All complete children must match
            return completeChildren.every(child => this.evaluateFilterNode(child, task, targetDate));
        } else if (group.conjunction === 'or') {
            // At least one complete child must match
            return completeChildren.some(child => this.evaluateFilterNode(child, task, targetDate));
        }

        return true; // Default to true if unknown conjunction
    }

    /**
     * Evaluate a single filter condition against a task
     */
    private evaluateCondition(condition: FilterCondition, task: TaskInfo, targetDate?: Date): boolean {
        const { property, operator, value } = condition;
        
        // Get the actual value from the task
        let taskValue: TaskPropertyValue = FilterUtils.getTaskPropertyValue(task, property as FilterProperty);
        
        // Handle special case for status.isCompleted
        if (property === 'status.isCompleted') {
            const effectiveStatus = getEffectiveTaskStatus(task, targetDate || new Date());
            taskValue = this.statusManager.isCompletedStatus(effectiveStatus);
        }
        
        // Apply the operator
        return FilterUtils.applyOperator(taskValue, operator as FilterOperator, value, condition.id, property as FilterProperty);
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
            const dateStr = format(date, 'yyyy-MM-dd'); // CORRECT: Uses local timezone
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
                        if (isDueByRRule(task, date)) {
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
     * Check if a date string falls within a date range (inclusive)
     * Works with both date-only and datetime strings
     */
    private isDateInRange(dateString: string, startDateString: string, endDateString: string): boolean {
        try {
            // Extract date parts for range comparison
            const datePart = getDatePart(dateString);
            const startDatePart = getDatePart(startDateString);
            const endDatePart = getDatePart(endDateString);
            
            const date = startOfDayForDateString(datePart);
            const startDate = startOfDayForDateString(startDatePart);
            const endDate = startOfDayForDateString(endDatePart);
            
            return date >= startDate && date <= endDate;
        } catch (error) {
            console.error('Error checking date range:', { dateString, startDateString, endDateString, error });
            return false;
        }
    }

    /**
     * Check if a Date object represents the same day as a date string
     */
    private isSameDayAs(dateObj: Date, dateString: string): boolean {
        try {
            const dateObjNormalized = new Date(dateObj);
            dateObjNormalized.setHours(0, 0, 0, 0);
            const targetDate = startOfDayForDateString(dateString);
            return dateObjNormalized.getTime() === targetDate.getTime();
        } catch (error) {
            console.error('Error comparing date object with date string:', { dateObj, dateString, error });
            return false;
        }
    }


    /**
     * Sort tasks by specified criteria
     */
    private sortTasks(tasks: TaskInfo[], sortKey: TaskSortKey, direction: SortDirection): TaskInfo[] {
        return tasks.sort((a, b) => {
            let comparison = 0;

            // Primary sort criteria
            switch (sortKey) {
                case 'sortOrder':
                    comparison = this.compareSortOrder(a.sortOrder, b.sortOrder);
                    break;
                case 'due':
                    comparison = this.compareDates(a.due, b.due);
                    break;
                case 'scheduled':
                    comparison = this.compareDates(a.scheduled, b.scheduled);
                    break;
                case 'priority':
                    comparison = this.comparePriorities(a.priority, b.priority);
                    break;
                case 'title':
                    comparison = a.title.localeCompare(b.title);
                    break;
                case 'dateCreated':
                    comparison = this.compareDates(a.dateCreated, b.dateCreated);
                    break;
            }

            // If primary criteria are equal, apply fallback sorting
            if (comparison === 0) {
                comparison = this.applyFallbackSorting(a, b, sortKey);
            }

            return direction === 'desc' ? -comparison : comparison;
        });
    }
    
    /**
     * Compare sortOrder field for manual ordering
     */
    private compareSortOrder(a?: number, b?: number): number {
        // Treat undefined as last
        if (a === undefined && b === undefined) return 0;
        if (a === undefined) return 1;
        if (b === undefined) return -1;
        return a - b;
    }

    /**
     * Compare due dates with proper null handling using time-aware utilities
     * Supports both date-only (YYYY-MM-DD) and datetime (YYYY-MM-DDTHH:mm) formats
     */
    private compareDates(dateA?: string, dateB?: string): number {
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1; // No due date sorts last
        if (!dateB) return -1;
        
        try {
            // Use time-aware comparison for precise sorting
            if (isBeforeDateTimeAware(dateA, dateB)) {
                return -1;
            } else if (isBeforeDateTimeAware(dateB, dateA)) {
                return 1;
            } else {
                return 0;
            }
        } catch (error) {
            console.error('Error comparing dates time-aware:', { dateA, dateB, error });
            // Fallback to string comparison
            return dateA.localeCompare(dateB);
        }
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
     * Apply fallback sorting criteria when primary sort yields equal values
     * Order: scheduled date → due date → priority → title
     */
    private applyFallbackSorting(a: TaskInfo, b: TaskInfo, primarySortKey: TaskSortKey): number {
        // Define fallback order: scheduled → due → priority → title
        const fallbackOrder: TaskSortKey[] = ['scheduled', 'due', 'priority', 'title'];
        
        // Remove the primary sort key from fallbacks to avoid redundant comparison
        const fallbacks = fallbackOrder.filter(key => key !== primarySortKey);
        
        for (const fallbackKey of fallbacks) {
            let comparison = 0;
            
            switch (fallbackKey) {
                case 'scheduled':
                    comparison = this.compareDates(a.scheduled, b.scheduled);
                    break;
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
            
            // Return first non-zero comparison
            if (comparison !== 0) {
                return comparison;
            }
        }
        
        // All criteria equal
        return 0;
    }

    /**
     * Get the names of all groups returned by groupTasks() that correspond to an empty or null group value
     */
    isNullGroupKey(groupKey: string | null | undefined): boolean {
        return groupKey ? ['No Project', 'No due date', 'No scheduled date', 'no-status', 'unknown', 'none'].includes(groupKey) : false;
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
            // For projects, handle multiple groups per task
            if (groupKey === 'project') {
                const filteredProjects = filterEmptyProjects(task.projects || []);
                if (filteredProjects.length > 0) {
                    // Add task to each project group
                    for (const project of filteredProjects) {
                        if (!groups.has(project)) {
                            groups.set(project, []);
                        }
                        groups.get(project)!.push(task);
                    }
                } else {
                    // Task has no projects - add to "No Project" group
                    const noProjectGroup = 'No Project';
                    if (!groups.has(noProjectGroup)) {
                        groups.set(noProjectGroup, []);
                    }
                    groups.get(noProjectGroup)!.push(task);
                }
            } else {
                // For all other grouping types, use single group assignment
                let groupValue: string;

                switch (groupKey) {
                    case 'status':
                        groupValue = task.status || 'no-status';
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
                    case 'scheduled':
                        groupValue = this.getScheduledDateGroup(task, targetDate);
                        break;
                    default:
                        groupValue = 'unknown';
                }

                if (!groups.has(groupValue)) {
                    groups.set(groupValue, []);
                }
                groups.get(groupValue)!.push(task);
            }
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
            if (isDueByRRule(task, referenceDate)) {
                // If due on target date, determine which group based on target date vs today
                const referenceDateStr = format(referenceDate, 'yyyy-MM-dd');
                return this.getDateGroupFromDateString(referenceDateStr);
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
     * Helper method to get date group from a date string (shared logic)
     * Uses time-aware overdue detection for precise categorization
     */
    private getDateGroupFromDateString(dateString: string): string {
        const todayStr = getTodayString();
        
        // Use time-aware overdue detection
        if (isOverdueTimeAware(dateString)) return 'Overdue';
        
        // Extract date part for day-level comparisons
        const datePart = getDatePart(dateString);
        if (isSameDateSafe(datePart, todayStr)) return 'Today';
        
        try {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');
            if (isSameDateSafe(datePart, tomorrowStr)) return 'Tomorrow';
            
            const thisWeek = new Date();
            thisWeek.setDate(thisWeek.getDate() + 7);
            const thisWeekStr = format(thisWeek, 'yyyy-MM-dd');
            if (isBeforeDateSafe(datePart, thisWeekStr) || isSameDateSafe(datePart, thisWeekStr)) return 'This week';
            
            return 'Later';
        } catch (error) {
            console.error(`Error categorizing date ${dateString}:`, error);
            return 'Invalid Date';
        }
    }

    /**
     * Helper method to get due date group from a specific date string
     */
    private getDueDateGroupFromDate(dueDate: string): string {
        return this.getDateGroupFromDateString(dueDate);
    }

    private getScheduledDateGroup(task: TaskInfo, targetDate?: Date): string {
        if (!task.scheduled) return 'No scheduled date';
        return this.getScheduledDateGroupFromDate(task.scheduled);
    }
    
    /**
     * Helper method to get scheduled date group from a specific date string
     * Uses time-aware overdue detection for precise categorization
     */
    private getScheduledDateGroupFromDate(scheduledDate: string): string {
        const todayStr = getTodayString();
        
        // Use time-aware overdue detection for past scheduled
        if (isOverdueTimeAware(scheduledDate)) return 'Past scheduled';
        
        // Extract date part for day-level comparisons
        const datePart = getDatePart(scheduledDate);
        if (isSameDateSafe(datePart, todayStr)) return 'Today';
        
        try {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');
            if (isSameDateSafe(datePart, tomorrowStr)) return 'Tomorrow';
            
            const thisWeek = new Date();
            thisWeek.setDate(thisWeek.getDate() + 7);
            const thisWeekStr = format(thisWeek, 'yyyy-MM-dd');
            if (isBeforeDateSafe(datePart, thisWeekStr) || isSameDateSafe(datePart, thisWeekStr)) return 'This week';
            
            return 'Later';
        } catch (error) {
            console.error(`Error categorizing scheduled date ${scheduledDate}:`, error);
            return 'Invalid Date';
        }
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
                
            case 'due': {
                // Sort by logical due date order
                const dueDateOrder = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'No due date'];
                sortedKeys = Array.from(groups.keys()).sort((a, b) => {
                    const indexA = dueDateOrder.indexOf(a);
                    const indexB = dueDateOrder.indexOf(b);
                    return indexA - indexB;
                });
                break;
            }
                
            case 'scheduled': {
                // Sort by logical scheduled date order
                const scheduledDateOrder = ['Past scheduled', 'Today', 'Tomorrow', 'This week', 'Later', 'No scheduled date'];
                sortedKeys = Array.from(groups.keys()).sort((a, b) => {
                    const indexA = scheduledDateOrder.indexOf(a);
                    const indexB = scheduledDateOrder.indexOf(b);
                    return indexA - indexB;
                });
                break;
            }
                
            case 'project':
                // Sort projects alphabetically with "No Project" at the end
                sortedKeys = Array.from(groups.keys()).sort((a, b) => {
                    if (a === 'No Project') return 1;
                    if (b === 'No Project') return -1;
                    return a.localeCompare(b);
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
     * Uses event-driven caching - cache is invalidated only when new options are detected
     */
    async getFilterOptions(): Promise<FilterOptions> {
        const now = Date.now();
        
        // Return cached options if valid and not expired by fallback TTL
        if (this.filterOptionsCache && (now - this.filterOptionsCacheTimestamp) < this.filterOptionsCacheTTL) {
            this.filterOptionsCacheHits++;
            console.debug(`FilterService: getFilterOptions() cache HIT (${this.filterOptionsCacheHits} hits, ${this.filterOptionsComputeCount} computes)`);
            return this.filterOptionsCache;
        }
        
        // Cache miss - compute fresh options
        const reason = this.filterOptionsCache ? 'fallback TTL expired' : 'no cache';
        console.debug(`FilterService: getFilterOptions() cache MISS (${reason}) - computing fresh options...`);
        const startTime = performance.now();
        
        const freshOptions = {
            statuses: this.statusManager.getAllStatuses(),
            priorities: this.priorityManager.getAllPriorities(),
            contexts: this.cacheManager.getAllContexts(),
            projects: this.cacheManager.getAllProjects(),
            tags: this.cacheManager.getAllTags()
        };
        
        const computeTime = performance.now() - startTime;
        this.filterOptionsComputeCount++;
        
        // Update cache and timestamp
        this.filterOptionsCache = freshOptions;
        this.filterOptionsCacheTimestamp = now;
        
        console.debug(`FilterService: Computed filter options in ${computeTime.toFixed(2)}ms (${this.filterOptionsComputeCount} total computes)`);
        
        return freshOptions;
    }
    
    /**
     * Check if new filter options have been detected and invalidate cache if needed
     * Uses a time-based throttling approach to balance freshness with performance
     */
    private checkAndInvalidateFilterOptionsCache(): void {
        if (!this.filterOptionsCache) {
            return; // No cache to invalidate
        }
        
        const now = Date.now();
        const cacheAge = now - this.filterOptionsCacheTimestamp;
        
        // Use a smart invalidation strategy:
        // 1. If cache is very fresh (< 30 seconds), keep it (most changes don't affect options)
        // 2. If cache is older, invalidate it to ensure new options are picked up
        // This gives us good performance for rapid file changes while ensuring freshness
        
        const minCacheAge = 30000; // 30 seconds
        
        if (cacheAge > minCacheAge) {
            console.debug(`FilterService: File change detected, cache age ${(cacheAge/1000).toFixed(1)}s > ${minCacheAge/1000}s, invalidating`);
            this.invalidateFilterOptionsCache();
        } else {
            console.debug(`FilterService: File change detected, but cache is fresh (${(cacheAge/1000).toFixed(1)}s), keeping cache`);
        }
    }
    
    /**
     * Manually invalidate the filter options cache
     */
    private invalidateFilterOptionsCache(): void {
        if (this.filterOptionsCache) {
            console.debug('FilterService: Invalidating filter options cache');
            this.filterOptionsCache = null;
        }
    }
    
    /**
     * Get performance statistics for filter options caching
     */
    getFilterOptionsCacheStats(): {
        cacheHits: number;
        computeCount: number;
        hitRate: string;
        isCurrentlyCached: boolean;
        cacheAge: number;
        ttlRemaining: number;
    } {
        const now = Date.now();
        const cacheAge = this.filterOptionsCache ? now - this.filterOptionsCacheTimestamp : 0;
        const ttlRemaining = this.filterOptionsCache ? Math.max(0, this.filterOptionsCacheTTL - cacheAge) : 0;
        const totalRequests = this.filterOptionsCacheHits + this.filterOptionsComputeCount;
        const hitRate = totalRequests > 0 ? ((this.filterOptionsCacheHits / totalRequests) * 100).toFixed(1) + '%' : '0%';
        
        return {
            cacheHits: this.filterOptionsCacheHits,
            computeCount: this.filterOptionsComputeCount,
            hitRate,
            isCurrentlyCached: !!this.filterOptionsCache,
            cacheAge,
            ttlRemaining
        };
    }

    /**
     * Create a default filter query with the new structure
     */
    createDefaultQuery(): FilterQuery {
        return {
            type: 'group',
            id: FilterUtils.generateId(),
            conjunction: 'and',
            children: [],
            sortKey: 'due',
            sortDirection: 'asc',
            groupKey: 'none'
        };
    }



    /**
     * Add quick toggle conditions (Show Completed, Show Archived, Hide Recurring)
     * These are syntactic sugar that programmatically modify the root query
     */
    addQuickToggleCondition(query: FilterQuery, toggle: 'showCompleted' | 'showArchived' | 'showRecurrent', enabled: boolean): FilterQuery {
        const newQuery = JSON.parse(JSON.stringify(query)); // Deep clone

        // Remove existing condition for this toggle if it exists
        this.removeQuickToggleCondition(newQuery, toggle);

        // Add new condition if toggle is disabled (meaning we want to filter out)
        if (!enabled) {
            let condition: FilterCondition;
            
            switch (toggle) {
                case 'showCompleted':
                    condition = {
                        type: 'condition',
                        id: FilterUtils.generateId(),
                        property: 'status.isCompleted',
                        operator: 'is-not-checked',
                        value: null
                    };
                    break;
                case 'showArchived':
                    condition = {
                        type: 'condition',
                        id: FilterUtils.generateId(),
                        property: 'archived',
                        operator: 'is-not-checked',
                        value: null
                    };
                    break;
                case 'showRecurrent':
                    condition = {
                        type: 'condition',
                        id: FilterUtils.generateId(),
                        property: 'recurrence',
                        operator: 'is-empty',
                        value: null
                    };
                    break;
            }
            
            newQuery.children.push(condition);
        }

        return newQuery;
    }

    /**
     * Remove quick toggle condition from query
     */
    private removeQuickToggleCondition(query: FilterQuery, toggle: 'showCompleted' | 'showArchived' | 'showRecurrent'): void {
        let propertyToRemove: string;
        
        switch (toggle) {
            case 'showCompleted':
                propertyToRemove = 'status.isCompleted';
                break;
            case 'showArchived':
                propertyToRemove = 'archived';
                break;
            case 'showRecurrent':
                propertyToRemove = 'recurrence';
                break;
        }

        query.children = query.children.filter(child => {
            if (child.type === 'condition') {
                return child.property !== propertyToRemove;
            }
            return true;
        });
    }

    /**
     * Validate and normalize a filter query
     */
    normalizeQuery(query: Partial<FilterQuery>): FilterQuery {
        const defaultQuery = this.createDefaultQuery();
        
        return {
            ...defaultQuery,
            ...query,
            type: 'group',
            id: query.id || defaultQuery.id,
            conjunction: query.conjunction || defaultQuery.conjunction,
            children: query.children || defaultQuery.children,
            sortKey: query.sortKey || defaultQuery.sortKey,
            sortDirection: query.sortDirection || defaultQuery.sortDirection,
            groupKey: query.groupKey || defaultQuery.groupKey
        };
    }

    /**
     * Subscribe to cache changes and emit refresh events
     */
    initialize(): void {
        this.cacheManager.on('file-updated', () => {
            this.clearIndexQueryCache();
            this.checkAndInvalidateFilterOptionsCache();
            this.emit('data-changed');
        });
        
        this.cacheManager.on('file-added', () => {
            this.clearIndexQueryCache();
            this.checkAndInvalidateFilterOptionsCache();
            this.emit('data-changed');
        });
        
        this.cacheManager.on('file-deleted', () => {
            this.clearIndexQueryCache();
            this.checkAndInvalidateFilterOptionsCache();
            this.emit('data-changed');
        });
        
        this.cacheManager.on('file-renamed', () => {
            this.clearIndexQueryCache();
            this.checkAndInvalidateFilterOptionsCache();
            this.emit('data-changed');
        });
        
        this.cacheManager.on('indexes-built', () => {
            this.clearIndexQueryCache();
            this.checkAndInvalidateFilterOptionsCache();
            this.emit('data-changed');
        });
    }

    /**
     * Clean up event subscriptions and clear any caches
     */
    cleanup(): void {
        // Clear query result cache and timers
        this.clearIndexQueryCache();
        
        // Clear filter options cache
        this.invalidateFilterOptionsCache();
        
        // Remove all event listeners
        this.removeAllListeners();
    }

    // ============================================================================
    // AGENDA-SPECIFIC METHODS
    // ============================================================================

    /**
     * Generate date range for agenda views from array of dates
     */
    static createDateRangeFromDates(dates: Date[]): { start: string; end: string } {
        if (dates.length === 0) throw new Error('No dates provided');
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];
        
        return {
            start: format(startDate, 'yyyy-MM-dd'),
            end: format(endDate, 'yyyy-MM-dd')
        };
    }

    /**
     * Check if overdue tasks should be included for a date range
     */
    static shouldIncludeOverdueForRange(dates: Date[], showOverdue: boolean): boolean {
        if (!showOverdue) return false;
        
        const today = new Date();
        const todayStr = format(today, 'yyyy-MM-dd');
        return dates.some(date => format(date, 'yyyy-MM-dd') === todayStr);
    }

    /**
     * Get tasks for a specific date within an agenda view
     * Handles recurring tasks, due dates, scheduled dates, and overdue logic
     */
    async getTasksForDate(
        date: Date, 
        baseQuery: FilterQuery,
        includeOverdue = false
    ): Promise<TaskInfo[]> {
        // Normalize to the date string first to avoid timezone boundary issues
        const dateStr = format(date, 'yyyy-MM-dd');
        const normalizedDate = startOfDayForDateString(dateStr);
        const isViewingToday = isTodayUtil(dateStr);
        
        
        // Get all tasks and filter using new system
        const allTaskPaths = this.cacheManager.getAllTaskPaths();
        const allTasks = await this.pathsToTaskInfos(Array.from(allTaskPaths));
        const filteredTasks = allTasks.filter(task => this.evaluateFilterNode(baseQuery, task));

        const tasksForDate = filteredTasks.filter(task => {
            // Handle recurring tasks
            if (task.recurrence) {
                return isDueByRRule(task, normalizedDate);
            }
            
            // Handle regular tasks with due dates for this specific date
            // Use robust date comparison to handle timezone edge cases
            if (task.due) {
                const taskDueDatePart = getDatePart(task.due);
                if (taskDueDatePart === dateStr) {
                    return true;
                }
            }
            
            // Handle regular tasks with scheduled dates for this specific date  
            // Use robust date comparison to handle timezone edge cases
            if (task.scheduled) {
                const taskScheduledDatePart = getDatePart(task.scheduled);
                if (taskScheduledDatePart === dateStr) {
                    return true;
                }
            }
            
            // If showing overdue tasks and this is today, include overdue tasks on today
            if (includeOverdue && isViewingToday) {
                // Check if due date is overdue (show on today)
                if (task.due && getDatePart(task.due) !== dateStr) {
                    if (isOverdueTimeAware(task.due)) {
                        return true;
                    }
                }
                
                // Check if scheduled date is overdue (show on today)
                if (task.scheduled && getDatePart(task.scheduled) !== dateStr) {
                    if (isOverdueTimeAware(task.scheduled)) {
                        return true;
                    }
                }
            }
            
            return false;
        });

        // Apply sorting to the filtered tasks for this date
        return this.sortTasks(tasksForDate, baseQuery.sortKey || 'due', baseQuery.sortDirection || 'asc');
    }

    /**
     * Get agenda data grouped by dates for agenda views
     * Simplified for new filter system
     */
    async getAgendaData(
        dates: Date[], 
        baseQuery: FilterQuery,
        showOverdueOnToday = false
    ): Promise<Array<{date: Date; tasks: TaskInfo[]}>> {
        const agendaData: Array<{date: Date; tasks: TaskInfo[]}> = [];

        // Get tasks for each date
        for (const date of dates) {
            const tasksForDate = await this.getTasksForDate(
                date, 
                baseQuery, 
                showOverdueOnToday && isToday(date)
            );
            
            agendaData.push({
                date: new Date(date),
                tasks: tasksForDate
            });
        }

        return agendaData;
    }

    /**
     * Get flat agenda data (all tasks in one array) with date information attached
     * Useful for flat agenda view rendering
     */
    async getFlatAgendaData(
        dates: Date[], 
        baseQuery: FilterQuery,
        showOverdueOnToday = false
    ): Promise<Array<TaskInfo & {agendaDate: Date}>> {
        const groupedData = await this.getAgendaData(dates, baseQuery, showOverdueOnToday);
        
        const flatData: Array<TaskInfo & {agendaDate: Date}> = [];
        
        for (const dayData of groupedData) {
            for (const task of dayData.tasks) {
                flatData.push({
                    ...task,
                    agendaDate: dayData.date
                });
            }
        }

        return flatData;
    }

    /**
     * Extract project names from a task project value, handling [[link]] format
     * This mirrors the logic from MinimalNativeCache.extractProjectNamesFromValue
     */
    private extractProjectNamesFromTaskValue(projectValue: string, sourcePath: string): string[] {
        if (!projectValue || projectValue.trim() === '' || projectValue === '""') {
            return [];
        }

        // Remove quotes if the value is wrapped in them
        const cleanValue = projectValue.replace(/^"(.*)"$/, '$1');
        
        // Check if it's a wikilink format
        if (cleanValue.startsWith('[[') && cleanValue.endsWith(']]')) {
            const linkContent = cleanValue.slice(2, -2);
            const parsed = parseLinktext(linkContent);
            
            // Try to resolve the link using Obsidian's API through cache manager
            const resolvedFile = this.cacheManager.getApp().metadataCache.getFirstLinkpathDest(parsed.path, sourcePath);
            if (resolvedFile) {
                // Return the basename of the resolved file
                return [resolvedFile.basename];
            } else {
                // If file doesn't exist, use the display text or path
                const displayName = parsed.subpath || (parsed.path.includes('/') ? parsed.path.split('/').pop() : parsed.path);
                return displayName ? [displayName] : [];
            }
        } else {
            // Plain text project (backward compatibility)
            return [cleanValue];
        }
    }
}
