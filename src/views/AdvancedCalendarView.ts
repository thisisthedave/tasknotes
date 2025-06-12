import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import TaskNotesPlugin from '../main';
import {
    ADVANCED_CALENDAR_VIEW_TYPE,
    EVENT_DATA_CHANGED,
    EVENT_TASK_UPDATED,
    TaskInfo,
    TimeEntry
} from '../types';
import { TaskCreationModal } from '../modals/TaskCreationModal';
import { TaskEditModal } from '../modals/TaskEditModal';
import { UnscheduledTasksSelectorModal, ScheduleTaskOptions } from '../modals/UnscheduledTasksSelectorModal';
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
    
    // View toggles
    private showScheduled: boolean = true;
    private showDue: boolean = true;
    private showTimeEntries: boolean = false;

    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
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
        
        const contentEl = this.contentEl;
        contentEl.empty();
        contentEl.addClass('tasknotes-plugin');
        contentEl.addClass('advanced-calendar-view');

        // Create the calendar container
        this.renderView();
        
        // Register event listeners
        this.registerEvents();
        
        // Initialize the calendar
        await this.initializeCalendar();
    }

    renderView() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Create main layout container
        const mainContainer = contentEl.createDiv({ cls: 'advanced-calendar-view__container' });
        
        // Create header with controls
        this.createHeader(mainContainer);
        
        // Create calendar container (now full width)
        const calendarContainer = mainContainer.createDiv({ 
            cls: 'advanced-calendar-view__calendar-container',
            attr: { id: 'advanced-calendar' }
        });
    }

    createHeader(container: HTMLElement) {
        const header = container.createDiv({ cls: 'advanced-calendar-view__header' });
        
        // View toggles
        const toggles = header.createDiv({ cls: 'advanced-calendar-view__toggles' });
        
        // Show Scheduled Tasks toggle
        const scheduledToggle = this.createToggle(
            toggles,
            'Show scheduled tasks',
            this.showScheduled,
            (enabled) => {
                this.showScheduled = enabled;
                this.refreshEvents();
            }
        );
        
        // Show Due Dates toggle
        const dueToggle = this.createToggle(
            toggles,
            'Show Due Dates',
            this.showDue,
            (enabled) => {
                this.showDue = enabled;
                this.refreshEvents();
            }
        );
        
        // Show Time Entries toggle
        const timeEntriesToggle = this.createToggle(
            toggles,
            'Show Time Entries',
            this.showTimeEntries,
            (enabled) => {
                this.showTimeEntries = enabled;
                this.refreshEvents();
            }
        );
        
        // Schedule Tasks button
        const scheduleTasksBtn = header.createEl('button', {
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
            plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
            initialView: 'dayGridMonth',
            headerToolbar: {
                left: 'prev,next today',
                center: '',
                right: 'dayGridMonth,timeGridWeek,timeGridDay'
            },
            height: '100%',
            editable: true,
            droppable: true,
            selectable: true,
            selectMirror: true,
            
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
            
            // Event sources will be added dynamically
            events: this.getCalendarEvents.bind(this)
        });

        this.calendar.render();
    }

    async getCalendarEvents(): Promise<CalendarEvent[]> {
        const events: CalendarEvent[] = [];
        
        try {
            // Get all task paths and then get their task info
            const allTaskPaths = this.plugin.cacheManager.getAllTaskPaths();
            const allTasksPromises = Array.from(allTaskPaths).map(path => 
                this.plugin.cacheManager.getTaskInfo(path)
            );
            const allTasks = (await Promise.all(allTasksPromises)).filter((task): task is TaskInfo => task !== null);
            
            for (const task of allTasks) {
                if (task.archived) continue;
                
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
        // External drop is no longer used since we removed the sidebar
        // Tasks are now scheduled through the modal
        return;
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
    }

    async refreshEvents() {
        if (this.calendar) {
            this.calendar.refetchEvents();
        }
    }

    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        
        // Destroy calendar
        if (this.calendar) {
            this.calendar.destroy();
            this.calendar = null;
        }
        
        // Clean up
        this.contentEl.empty();
    }
}
