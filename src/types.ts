// View types
export const CALENDAR_VIEW_TYPE = 'chronosync-calendar-view';
export const TASK_LIST_VIEW_TYPE = 'chronosync-task-list-view';
export const NOTES_VIEW_TYPE = 'chronosync-notes-view';
export const DETAIL_VIEW_TYPE = 'chronosync-detail-view';

// Event types
export const EVENT_DATE_SELECTED = 'date-selected';
export const EVENT_TAB_CHANGED = 'tab-changed';
export const EVENT_DATA_CHANGED = 'data-changed';

// Tab types
export type DetailTab = 'tasks' | 'notes' | 'timeblock';

// Time and date related types
export interface TimeInfo {
	hours: number;
	minutes: number;
}

// Task types
export interface RecurrenceInfo {
	frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
	days_of_week?: string[];  // For weekly recurrence: ['mon', 'tue', etc.]
	day_of_month?: number;    // For monthly/yearly recurrence: 1-31
}

export interface TaskInfo {
	title: string;
	status: string;
	priority: string;
	due?: string;
	path: string;
	archived: boolean;
	tags?: string[];
	recurrence?: RecurrenceInfo;
	complete_instances?: string[]; // Array of dates (YYYY-MM-DD) when recurring task was completed
}

// Note types
export interface NoteInfo {
	title: string;
	tags: string[];
	path: string;
	createdDate?: string;
}