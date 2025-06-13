import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import interactionPlugin from '@fullcalendar/interaction';
import TaskNotesPlugin from '../main';
import {
    ADVANCED_CALENDAR_VIEW_TYPE,
    EVENT_DATA_CHANGED,
    EVENT_TASK_UPDATED,
    TaskInfo,
    TimeEntry,
    FilterQuery
} from '../types';
import { TaskCreationModal } from '../modals/TaskCreationModal';
import { TaskEditModal } from '../modals/TaskEditModal';
import { UnscheduledTasksSelectorModal, ScheduleTaskOptions } from '../modals/UnscheduledTasksSelectorModal';
import { FilterBar } from '../ui/FilterBar';
import { 
    hasTimeComponent, 
    getDatePart, 
    getTimePart,
    combineDateAndTime,
    getCurrentDateTimeString,
    parseDate 
} from '../utils/dateUtils';

interface CalendarEvent {
    id: string;
    title: string;
    start: string;
    end?: string;
    allDay: boolean;
    backgroundColor?: string;
    borderColor?: string;
    textColor?: string;
    extendedProps: {
        taskInfo: TaskInfo;
        eventType: 'scheduled' | 'due' | 'timeEntry';
    };
}

export class AdvancedCalendarView extends ItemView {
    plugin: TaskNotesPlugin;
    private calendar: Calendar | null = null;
    private listeners: (() => void)[] = [];
    
    // Filter system
    private filterBar: FilterBar | null = null;
    private currentQuery: FilterQuery;
    
    // View toggles (keeping for calendar-specific display options)
    private showScheduled: boolean = true;
    private showDue: boolean = true;
    private showTimeEntries: boolean = false;

    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Initialize with default filter query
        this.currentQuery = {
            searchQuery: undefined,
            statuses: undefined,
            contexts: undefined,
            priorities: undefined,
            dateRange: undefined,
            showArchived: false,
            sortKey: 'due',
            sortDirection: 'asc',
            groupKey: 'none'
        };
    }

    getViewType(): string {
        return ADVANCED_CALENDAR_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Advanced Calendar';
    }

    getIcon(): string {
        return 'calendar-range';
    }

    async onOpen() {
        await this.plugin.onReady();
        
        // Load saved filter state
        const savedQuery = this.plugin.viewStateManager.getFilterState(ADVANCED_CALENDAR_VIEW_TYPE);
        if (savedQuery) {
            this.currentQuery = savedQuery;
        } else if (this.plugin.filterService) {
            this.currentQuery = this.plugin.filterService.createDefaultQuery();
        }
        
        const contentEl = this.contentEl;
        contentEl.empty();
        contentEl.addClass('tasknotes-plugin');
        contentEl.addClass('advanced-calendar-view');

        // Create the calendar container
        await this.renderView();
        
        // Register event listeners
        this.registerEvents();
        
        // Initialize the calendar
        await this.initializeCalendar();
    }

    async renderView() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Create main layout container
        const mainContainer = contentEl.createDiv({ cls: 'advanced-calendar-view__container' });
        
        // Create header with controls
        await this.createHeader(mainContainer);
        
        // Create calendar container (now full width)
        const calendarContainer = mainContainer.createDiv({ 
            cls: 'advanced-calendar-view__calendar-container',
            attr: { id: 'advanced-calendar' }
        });
    }

    async createHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: 'advanced-calendar-view__header' });
        
        // Create main header row that can contain both FilterBar and controls
        const mainRow = header.createDiv({ cls: 'advanced-calendar-view__main-row' });
        
        // Create FilterBar container
        const filterBarContainer = mainRow.createDiv({ cls: 'filter-bar-container' });
        
        // Get filter options from FilterService
        const filterOptions = await this.plugin.filterService.getFilterOptions();
        
        // Create FilterBar with AdvancedCalendarView configuration
        this.filterBar = new FilterBar(
            filterBarContainer,
            this.currentQuery,
            filterOptions,
            {
                showSearch: true,
                showGroupBy: false, // Calendar doesn't need grouping
                showSortBy: false,  // Calendar sorts by date
                showAdvancedFilters: true,
                showDateRangePicker: false, // Calendar provides date navigation
                allowedSortKeys: [],
                allowedGroupKeys: []
            }
        );
        
        // Initialize FilterBar
        await this.filterBar.initialize();
        
        // Set up cache refresh mechanism for FilterBar
        this.filterBar.setupCacheRefresh(this.plugin.cacheManager, this.plugin.filterService);
        
        // Listen for filter changes
        this.filterBar.on('queryChange', async (newQuery: FilterQuery) => {
            this.currentQuery = newQuery;
            // Save the filter state
            await this.plugin.viewStateManager.setFilterState(ADVANCED_CALENDAR_VIEW_TYPE, newQuery);
            this.refreshEvents();
        });
        
        // Controls section - view toggles and button
        const controlsSection = mainRow.createDiv({ cls: 'advanced-calendar-view__controls' });
        
        // View toggles
        const toggles = controlsSection.createDiv({ cls: 'advanced-calendar-view__toggles' });
        
        // Scheduled Tasks toggle
        const scheduledToggle = this.createToggle(
            toggles,
            'Scheduled tasks',
            this.showScheduled,
            (enabled) => {
                this.showScheduled = enabled;
                this.refreshEvents();
            }
        );
        
        // Due Dates toggle
        const dueToggle = this.createToggle(
            toggles,
            'Due dates',
            this.showDue,
            (enabled) => {
                this.showDue = enabled;
                this.refreshEvents();
            }
        );
        
        // Time Entries toggle
        const timeEntriesToggle = this.createToggle(
            toggles,
            'Time entries',
            this.showTimeEntries,
            (enabled) => {
                this.showTimeEntries = enabled;
                this.refreshEvents();
            }
        );
        
        // Schedule Tasks button
        const scheduleTasksBtn = controlsSection.createEl('button', {
            text: 'Schedule tasks',
            cls: 'advanced-calendar-view__schedule-tasks-btn'
        });
        scheduleTasksBtn.addEventListener('click', () => {
            this.openScheduleTasksModal();
        });
    }

    createToggle(
        container: HTMLElement, 
        label: string, 
        initialValue: boolean, 
        onChange: (enabled: boolean) => void
    ): HTMLElement {
        const toggleContainer = container.createDiv({ cls: 'advanced-calendar-view__toggle' });
        
        const checkbox = toggleContainer.createEl('input', {
            type: 'checkbox',
            cls: 'advanced-calendar-view__toggle-input'
        });
        checkbox.checked = initialValue;
        
        const labelEl = toggleContainer.createEl('label', {
            text: label,
            cls: 'advanced-calendar-view__toggle-label'
        });
        
        checkbox.addEventListener('change', () => {
            onChange(checkbox.checked);
        });
        
        return toggleContainer;
    }

    openScheduleTasksModal() {
        const modal = new UnscheduledTasksSelectorModal(
            this.app,
            this.plugin,
            (task: TaskInfo | null, options?: ScheduleTaskOptions) => {
                if (task) {
                    this.scheduleTask(task, options);
                }
            }
        );
        modal.open();
    }

    async scheduleTask(task: TaskInfo, options?: ScheduleTaskOptions) {
        try {
            let scheduledDate: string;
            
            if (options?.date) {
                if (options.allDay) {
                    scheduledDate = format(options.date, 'yyyy-MM-dd');
                } else if (options.time) {
                    scheduledDate = format(options.date, 'yyyy-MM-dd') + 'T' + options.time;
                } else {
                    // Default to 9 AM if no time specified
                    scheduledDate = format(options.date, 'yyyy-MM-dd') + 'T09:00';
                }
            } else {
                // Default to today at 9 AM
                scheduledDate = format(new Date(), 'yyyy-MM-dd') + 'T09:00';
            }
            
            await this.plugin.taskService.updateProperty(task, 'scheduled', scheduledDate);
        } catch (error) {
            console.error('Error scheduling task:', error);
        }
    }

    async initializeCalendar() {
        const calendarEl = document.getElementById('advanced-calendar');
        if (!calendarEl) {
            console.error('Calendar element not found');
            return;
        }

        this.calendar = new Calendar(calendarEl, {
            plugins: [dayGridPlugin, timeGridPlugin, multiMonthPlugin, interactionPlugin],
            initialView: 'dayGridMonth',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'multiMonthYear,dayGridMonth,timeGridWeek,timeGridDay'
            },
            height: '100%',
            editable: true,
            droppable: true,
            selectable: true,
            selectMirror: true,
            
            // Current time indicator
            nowIndicator: true,
            
            // 24-hour view configuration
            slotMinTime: '00:00:00',
            slotMaxTime: '24:00:00',
            scrollTime: '08:00:00', // Start scrolled to 8 AM
            
            // Time grid configurations
            slotDuration: '01:00:00', // 1 hour slots
            slotLabelInterval: '02:00:00', // Show labels every 2 hours
            
            // Event handlers
            select: this.handleDateSelect.bind(this),
            eventClick: this.handleEventClick.bind(this),
            eventDrop: this.handleEventDrop.bind(this),
            eventResize: this.handleEventResize.bind(this),
            drop: this.handleExternalDrop.bind(this),
            eventReceive: this.handleEventReceive.bind(this),
            
            // Event sources will be added dynamically
            events: this.getCalendarEvents.bind(this)
        });

        this.calendar.render();
    }

    async getCalendarEvents(): Promise<CalendarEvent[]> {
        const events: CalendarEvent[] = [];
        
        try {
            // Get filtered tasks from FilterService
            const groupedTasks = await this.plugin.filterService.getGroupedTasks(this.currentQuery);
            
            // Flatten grouped tasks since calendar doesn't use grouping
            const allTasks: TaskInfo[] = [];
            for (const tasks of groupedTasks.values()) {
                allTasks.push(...tasks);
            }
            
            for (const task of allTasks) {
                // Add scheduled events
                if (this.showScheduled && task.scheduled) {
                    const scheduledEvent = this.createScheduledEvent(task);
                    if (scheduledEvent) events.push(scheduledEvent);
                }
                
                // Add due events (only if no scheduled event exists to avoid duplicates)
                if (this.showDue && task.due && !task.scheduled) {
                    const dueEvent = this.createDueEvent(task);
                    if (dueEvent) events.push(dueEvent);
                }
                
                // Add time entry events
                if (this.showTimeEntries && task.timeEntries) {
                    const timeEvents = this.createTimeEntryEvents(task);
                    events.push(...timeEvents);
                }
            }
        } catch (error) {
            console.error('Error getting calendar events:', error);
        }
        
        return events;
    }

    createScheduledEvent(task: TaskInfo): CalendarEvent | null {
        if (!task.scheduled) return null;
        
        const hasTime = hasTimeComponent(task.scheduled);
        const startDate = task.scheduled;
        
        let endDate: string | undefined;
        if (hasTime && task.timeEstimate) {
            // Calculate end time based on time estimate
            const start = parseDate(startDate);
            const end = new Date(start.getTime() + (task.timeEstimate * 60 * 1000));
            endDate = format(end, "yyyy-MM-dd'T'HH:mm");
        }
        
        // Get priority-based color for border
        const priorityConfig = this.plugin.priorityManager.getPriorityConfig(task.priority);
        const borderColor = priorityConfig?.color || '#6B73FF';
        
        return {
            id: `scheduled-${task.path}`,
            title: task.title,
            start: startDate,
            end: endDate,
            allDay: !hasTime,
            backgroundColor: 'transparent',
            borderColor: borderColor,
            textColor: borderColor,
            extendedProps: {
                taskInfo: task,
                eventType: 'scheduled'
            }
        };
    }

    createDueEvent(task: TaskInfo): CalendarEvent | null {
        if (!task.due) return null;
        
        const hasTime = hasTimeComponent(task.due);
        const startDate = task.due;
        
        let endDate: string | undefined;
        if (hasTime) {
            // Fixed duration for due events (30 minutes)
            const start = parseDate(startDate);
            const end = new Date(start.getTime() + (30 * 60 * 1000));
            endDate = format(end, "yyyy-MM-dd'T'HH:mm");
        }
        
        // Get priority-based color with faded background
        const priorityConfig = this.plugin.priorityManager.getPriorityConfig(task.priority);
        const borderColor = priorityConfig?.color || '#FF5722';
        
        // Create faded background color from priority color
        const fadedBackground = this.hexToRgba(borderColor, 0.15);
        
        return {
            id: `due-${task.path}`,
            title: `DUE: ${task.title}`,
            start: startDate,
            end: endDate,
            allDay: !hasTime,
            backgroundColor: fadedBackground,
            borderColor: borderColor,
            textColor: borderColor,
            extendedProps: {
                taskInfo: task,
                eventType: 'due'
            }
        };
    }

    hexToRgba(hex: string, alpha: number): string {
        // Remove # if present
        hex = hex.replace('#', '');
        
        // Parse hex color
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    createTimeEntryEvents(task: TaskInfo): CalendarEvent[] {
        if (!task.timeEntries) return [];
        
        return task.timeEntries
            .filter(entry => entry.endTime) // Only completed time entries
            .map((entry, index) => ({
                id: `timeentry-${task.path}-${index}`,
                title: `⏱️ ${task.title}`,
                start: entry.startTime,
                end: entry.endTime!,
                allDay: false,
                backgroundColor: '#9E9E9E',
                borderColor: '#757575',
                textColor: '#FFFFFF',
                extendedProps: {
                    taskInfo: task,
                    eventType: 'timeEntry' as const
                }
            }));
    }

    // Event handlers
    handleDateSelect(selectInfo: any) {
        const { start, end, allDay } = selectInfo;
        
        // Pre-populate with selected date/time
        const scheduledDate = allDay 
            ? format(start, 'yyyy-MM-dd')
            : format(start, "yyyy-MM-dd'T'HH:mm");
            
        const timeEstimate = allDay 
            ? 60 // Default 1 hour for all-day events
            : Math.round((end.getTime() - start.getTime()) / (1000 * 60)); // Duration in minutes
        
        const modal = new TaskCreationModal(this.app, this.plugin, {
            scheduled: scheduledDate,
            timeEstimate: timeEstimate > 0 ? timeEstimate : 60
        });
        
        modal.open();
        
        // Clear selection
        this.calendar?.unselect();
    }

    handleEventClick(clickInfo: any) {
        const { taskInfo, eventType } = clickInfo.event.extendedProps;
        const jsEvent = clickInfo.jsEvent;
        
        if (eventType === 'timeEntry') {
            // Time entries are read-only, just show info
            return;
        }
        
        // Handle different click types
        if (jsEvent.ctrlKey || jsEvent.metaKey) {
            // Ctrl/Cmd + Click: Open task in new tab
            const file = this.app.vault.getAbstractFileByPath(taskInfo.path);
            if (file instanceof TFile) {
                this.app.workspace.openLinkText(taskInfo.path, '', true);
            }
        } else {
            // Left click: Open edit modal
            const editModal = new TaskEditModal(this.app, this.plugin, taskInfo);
            editModal.open();
        }
    }

    async handleEventDrop(dropInfo: any) {
        const { taskInfo, eventType } = dropInfo.event.extendedProps;
        
        if (eventType === 'timeEntry') {
            // Time entries cannot be moved
            dropInfo.revert();
            return;
        }
        
        try {
            const newStart = dropInfo.event.start;
            const allDay = dropInfo.event.allDay;
            
            let newDateString: string;
            if (allDay) {
                newDateString = format(newStart, 'yyyy-MM-dd');
            } else {
                newDateString = format(newStart, "yyyy-MM-dd'T'HH:mm");
            }
            
            // Update the appropriate property
            const propertyToUpdate = eventType === 'scheduled' ? 'scheduled' : 'due';
            await this.plugin.taskService.updateProperty(taskInfo, propertyToUpdate, newDateString);
            
        } catch (error) {
            console.error('Error updating task date:', error);
            dropInfo.revert();
        }
    }

    async handleEventResize(resizeInfo: any) {
        const { taskInfo, eventType } = resizeInfo.event.extendedProps;
        
        if (eventType !== 'scheduled') {
            // Only scheduled events can be resized
            resizeInfo.revert();
            return;
        }
        
        try {
            const start = resizeInfo.event.start;
            const end = resizeInfo.event.end;
            
            if (start && end) {
                const durationMinutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
                await this.plugin.taskService.updateProperty(taskInfo, 'timeEstimate', durationMinutes);
            }
            
        } catch (error) {
            console.error('Error updating task duration:', error);
            resizeInfo.revert();
        }
    }

    async handleExternalDrop(dropInfo: any) {
        try {
            console.log('FullCalendar external drop triggered', dropInfo);
            
            // Get task path from drag data transfer
            let taskPath: string | undefined;
            
            // Try to get from dataTransfer first (most reliable)
            if (dropInfo.dataTransfer) {
                taskPath = dropInfo.dataTransfer.getData('text/plain') || 
                          dropInfo.dataTransfer.getData('application/x-task-path');
                console.log('Task path from dataTransfer:', taskPath);
            }
            
            // Fallback to element data attribute
            if (!taskPath && dropInfo.draggedEl) {
                taskPath = dropInfo.draggedEl.dataset.taskPath;
                console.log('Task path from element dataset:', taskPath);
            }
            
            if (!taskPath) {
                console.warn('No task path found in drop data', dropInfo);
                return;
            }
            
            // Get the task info
            const task = await this.plugin.cacheManager.getTaskInfo(taskPath);
            if (!task) {
                console.warn('Task not found:', taskPath);
                return;
            }
            
            // Get the drop date/time
            const dropDate = dropInfo.date;
            if (!dropDate) {
                console.warn('No drop date provided');
                return;
            }
            
            // Format the date for task scheduling
            let scheduledDate: string;
            if (dropInfo.allDay) {
                // All-day event - just the date
                scheduledDate = format(dropDate, 'yyyy-MM-dd');
            } else {
                // Specific time - include time
                scheduledDate = format(dropDate, "yyyy-MM-dd'T'HH:mm");
            }
            
            // Update the task's scheduled date
            await this.plugin.taskService.updateProperty(task, 'scheduled', scheduledDate);
            
            console.log(`Task "${task.title}" scheduled for ${scheduledDate}`);
            
            // Show success feedback
            new Notice(`Task "${task.title}" scheduled for ${format(dropDate, dropInfo.allDay ? 'MMM d, yyyy' : 'MMM d, yyyy h:mm a')}`);
            
            // Remove any event that FullCalendar might have created from the drop
            if (dropInfo.draggedEl) {
                // Remove the dragged element to prevent it from being rendered as an event
                dropInfo.draggedEl.remove();
            }
            
            // Refresh calendar to show the new event with proper task data
            this.refreshEvents();
            
        } catch (error) {
            console.error('Error handling external drop:', error);
            new Notice('Failed to schedule task');
            
            // Remove any event that might have been created on error
            if (dropInfo.draggedEl) {
                dropInfo.draggedEl.remove();
            }
        }
    }

    /**
     * Handle when FullCalendar tries to create an event from external drop
     * We prevent this since we handle the task scheduling ourselves
     */
    handleEventReceive(info: any) {
        console.log('FullCalendar eventReceive triggered, removing placeholder event:', info);
        // Remove the automatically created event since we handle scheduling ourselves
        info.event.remove();
    }

    registerEvents(): void {
        // Clean up any existing listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        this.listeners = [];
        
        // Listen for data changes
        const dataListener = this.plugin.emitter.on(EVENT_DATA_CHANGED, () => {
            this.refreshEvents();
        });
        this.listeners.push(dataListener);
        
        // Listen for task updates
        const taskUpdateListener = this.plugin.emitter.on(EVENT_TASK_UPDATED, () => {
            this.refreshEvents();
        });
        this.listeners.push(taskUpdateListener);
        
        // Listen for filter service data changes
        const filterDataListener = this.plugin.filterService.on('data-changed', () => {
            this.refreshEvents();
        });
        this.listeners.push(filterDataListener);
    }

    async refreshEvents() {
        if (this.calendar) {
            this.calendar.refetchEvents();
        }
    }

    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        
        // Clean up FilterBar
        if (this.filterBar) {
            this.filterBar.destroy();
            this.filterBar = null;
        }
        
        // Destroy calendar
        if (this.calendar) {
            this.calendar.destroy();
            this.calendar = null;
        }
        
        // Clean up
        this.contentEl.empty();
    }
}
