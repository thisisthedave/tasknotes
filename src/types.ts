// View types
export const CALENDAR_VIEW_TYPE = 'chronosync-calendar-view';
export const TASK_LIST_VIEW_TYPE = 'chronosync-task-list-view';
export const NOTES_VIEW_TYPE = 'chronosync-notes-view';

// Event types
export const EVENT_DATE_SELECTED = 'date-selected';
export const EVENT_TAB_CHANGED = 'tab-changed';
export const EVENT_DATA_CHANGED = 'data-changed';
export const EVENT_TASK_UPDATED = 'task-updated';

// Calendar colorization modes
export type ColorizeMode = 'tasks' | 'notes' | 'daily';

// Calendar display modes
export type CalendarDisplayMode = 'month' | 'agenda';

// Task sorting and grouping types
export type TaskSortKey = 'due' | 'priority' | 'title';
export type TaskGroupKey = 'none' | 'priority' | 'context' | 'due';

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
	month_of_year?: number;   // For yearly recurrence: 1-12
}

export interface TaskInfo {
	title: string;
	status: string;
	priority: string;
	due?: string;
	path: string;
	archived: boolean;
	tags?: string[];
	contexts?: string[];
	recurrence?: RecurrenceInfo;
	complete_instances?: string[]; // Array of dates (YYYY-MM-DD) when recurring task was completed
	completedDate?: string; // Date (YYYY-MM-DD) when task was marked as done
}

// Note types
export interface NoteInfo {
	title: string;
	tags: string[];
	path: string;
	createdDate?: string;
	lastModified?: number; // Timestamp of last modification
}

// File index types
export interface FileIndex {
	taskFiles: IndexedFile[];
	noteFiles: IndexedFile[];
	lastIndexed: number;
}

export interface IndexedFile {
	path: string;
	mtime: number;
	ctime: number;
	tags?: string[];
	isTask?: boolean;
	cachedInfo?: TaskInfo | NoteInfo;
}

// YAML Frontmatter types
export interface DailyNoteFrontmatter {
	date?: string;
	pomodoros?: number;
	workout?: boolean;
	meditate?: boolean;
	tags?: string[];
	important?: boolean;
}

export interface TaskFrontmatter {
	title: string;
	zettelid: string;
	dateCreated: string;
	dateModified: string;
	status: 'open' | 'in-progress' | 'done';
	due?: string;
	tags: string[];
	priority: 'low' | 'normal' | 'high';
	contexts?: string[];
	recurrence?: RecurrenceInfo;
	complete_instances?: string[];
	completedDate?: string;
}

export interface NoteFrontmatter {
	title: string;
	dateCreated: string;
	dateModified?: string;
	tags?: string[];
}

// Event handler types
export interface FileEventHandlers {
	modify?: (file: any) => void;
	delete?: (file: any) => void;
	rename?: (file: any, oldPath: string) => void;
	create?: (file: any) => void;
}