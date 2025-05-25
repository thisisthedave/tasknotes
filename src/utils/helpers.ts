import { normalizePath, TFile, Vault } from 'obsidian';
import { format } from 'date-fns';
import { TimeInfo } from '../types';
import * as YAML from 'yaml';
import { YAMLCache } from './YAMLCache';

/**
 * Ensures a folder and its parent folders exist
 */
export async function ensureFolderExists(vault: Vault, folderPath: string): Promise<void> {
	const folders = folderPath.split('/').filter(folder => folder.length > 0);
	let currentPath = '';
	
	for (const folder of folders) {
		currentPath = currentPath ? `${currentPath}/${folder}` : folder;
		const exists = await vault.adapter.exists(currentPath);
		if (!exists) {
			await vault.createFolder(currentPath);
		}
	}
}

/**
 * Parses a time string in the format HH:MM and returns hours and minutes
 */
export function parseTime(timeStr: string): TimeInfo | null {
	const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
	if (!match) return null;
	
	const hours = parseInt(match[1]);
	const minutes = parseInt(match[2]);
	
	if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
		return null;
	}
	
	return { hours, minutes };
}

/**
 * Updates a YAML frontmatter value in a Markdown file
 */
export function updateYamlFrontmatter(content: string, key: string, updateFn: (val: any) => any): string {
	// Check if the content has YAML frontmatter
	if (!content.startsWith('---')) {
		// If not, add it with the updated key
		const yamlObj: any = {};
		yamlObj[key] = updateFn(undefined);
		const yamlStr = YAML.stringify(yamlObj);
		return `---\n${yamlStr}---\n\n${content}`;
	}
	
	// Find the end of the frontmatter
	const endOfFrontmatter = content.indexOf('---', 3);
	if (endOfFrontmatter === -1) return content;
	
	// Extract the frontmatter
	const frontmatter = content.substring(3, endOfFrontmatter);
	const restOfContent = content.substring(endOfFrontmatter);
	
	// Parse the frontmatter
	let yamlObj: any = {};
	try {
		yamlObj = YAML.parse(frontmatter) || {};
	} catch (e) {
		console.error('Error parsing YAML frontmatter:', e);
		return content;
	}
	
	// Update the key
	yamlObj[key] = updateFn(yamlObj[key]);
	
	// Stringify the frontmatter
	const updatedFrontmatter = YAML.stringify(yamlObj);
	
	// Return the updated content
	return `---\n${updatedFrontmatter}---${restOfContent}`;
}

/**
 * Generates a timeblock table based on start/end times and interval
 */
export function generateTimeblockTable(startTime: TimeInfo, endTime: TimeInfo, intervalMinutes: number): string {
	if (!startTime || !endTime) return '';

	let table = '| Time | Activity |\n| ---- | -------- |\n';
	
	const startMinutes = startTime.hours * 60 + startTime.minutes;
	const endMinutes = endTime.hours * 60 + endTime.minutes;
	
	for (let minutes = startMinutes; minutes <= endMinutes; minutes += intervalMinutes) {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
		table += `| ${timeStr} | |\n`;
	}
	
	return table;
}

/**
 * Generates a daily note template
 */
export function generateDailyNoteTemplate(date: Date, timeblockStartTime: TimeInfo, timeblockEndTime: TimeInfo, intervalMinutes: number, addTimeblock: boolean): string {
	const dateStr = format(date, 'yyyy-MM-dd');
	
	// Create the YAML frontmatter
	const yaml = {
		date: dateStr,
		pomodoros: 0,
		workout: false,
		meditate: false,
		tags: ['daily']
	};
	
	let content = `---\n${YAML.stringify(yaml)}---\n\n# ${format(date, 'eeee, MMMM do, yyyy')}\n\n## Notes\n\n`;
	
	// Add timeblock table if configured
	if (addTimeblock) {
		content += `\n## Timeblock\n\n${generateTimeblockTable(timeblockStartTime, timeblockEndTime, parseInt(intervalMinutes.toString()))}`;
	}
	
	return content;
}

/**
 * Checks if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
	return date1.getFullYear() === date2.getFullYear() &&
		date1.getMonth() === date2.getMonth() &&
		date1.getDate() === date2.getDate();
}

/**
 * Extracts task information from a task file's content
 */
export function extractTaskInfo(content: string, path: string): { 
	title: string, 
	status: string, 
	priority: string, 
	due?: string, 
	path: string, 
	archived: boolean, 
	tags?: string[],
	recurrence?: {
		frequency: 'daily' | 'weekly' | 'monthly' | 'yearly',
		days_of_week?: string[],
		day_of_month?: number,
		month_of_year?: number
	},
	complete_instances?: string[]
} | null {
	// Try to extract task info from frontmatter
	if (content.startsWith('---')) {
		const endOfFrontmatter = content.indexOf('---', 3);
		if (endOfFrontmatter !== -1) {
			// Use our cached YAML parser
			const yaml = YAMLCache.extractFrontmatter(content, path);
			
			if (yaml) {
				// Check if task has archive tag
				const tags = yaml.tags || [];
				const archived = Array.isArray(tags) && tags.includes('archive');
				
				// Extract recurrence info if present
				let recurrence = undefined;
				if (yaml.recurrence && typeof yaml.recurrence === 'object') {
					recurrence = {
						frequency: yaml.recurrence.frequency,
						days_of_week: yaml.recurrence.days_of_week,
						day_of_month: yaml.recurrence.day_of_month,
						month_of_year: yaml.recurrence.month_of_year
					};
				}
				
				// Extract complete_instances array if present
				let complete_instances = undefined;
				if (yaml.complete_instances && Array.isArray(yaml.complete_instances)) {
					complete_instances = yaml.complete_instances;
				}
				
				return {
					title: yaml.title || 'Untitled Task',
					status: yaml.status || 'open',
					priority: yaml.priority || 'normal',
					due: yaml.due,
					path,
					archived,
					tags: Array.isArray(tags) ? [...tags] : [],
					recurrence,
					complete_instances
				};
			}
		}
	}
	
	// Fallback to basic info from filename
	const filename = path.split('/').pop()?.replace('.md', '') || 'Untitled';
	return {
		title: filename,
		status: 'open',
		priority: 'normal',
		path,
		archived: false
	};
}

/**
 * Checks if a task is overdue
 */
export function isTaskOverdue(task: {due?: string}): boolean {
	if (!task.due) return false;
	
	const dueDate = new Date(task.due);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	
	return dueDate < today;
}

/**
 * Checks if a recurring task is due on a specific date
 */
export function isRecurringTaskDueOn(task: any, date: Date): boolean {
	if (!task.recurrence) return true; // Non-recurring tasks are always shown
	
	const frequency = task.recurrence.frequency;
	const targetDate = new Date(date);
	targetDate.setHours(0, 0, 0, 0);
	const dayOfWeek = targetDate.getDay();
	const dayOfMonth = targetDate.getDate();
	const monthOfYear = targetDate.getMonth() + 1; // JavaScript months are 0-indexed
	// Map JavaScript's day of week (0-6, where 0 is Sunday) to our day abbreviations
	const weekdayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
	
	switch (frequency) {
		case 'daily':
			return true;
		case 'weekly':
			// Check if the day of week is in the specified days
			const daysOfWeek = task.recurrence.days_of_week || [];
			return daysOfWeek.includes(weekdayMap[dayOfWeek]);
		case 'monthly':
			// Check if the day of month matches
			return dayOfMonth === task.recurrence.day_of_month;
		case 'yearly':
			// Check if it's the specific day of month in the correct month
			// First check if we have explicit month_of_year in recurrence
			if (task.recurrence.month_of_year && task.recurrence.day_of_month) {
				return dayOfMonth === task.recurrence.day_of_month && 
					monthOfYear === task.recurrence.month_of_year;
			}
			// Fall back to using the original due date
			else if (task.due) {
				const originalDueDate = new Date(task.due);
				return originalDueDate.getDate() === dayOfMonth && 
					originalDueDate.getMonth() === targetDate.getMonth();
			}
			return false;
		default:
			return false;
	}
}

/**
 * Gets the effective status of a task, considering recurrence
 */
export function getEffectiveTaskStatus(task: any, date: Date): string {
	if (!task.recurrence) {
		return task.status || 'open';
	}
	
	// If it has recurrence, check if it's completed for the specified date
	const dateStr = format(date, 'yyyy-MM-dd');
	const completedDates = task.complete_instances || [];
	
	return completedDates.includes(dateStr) ? 'done' : 'open';
}

/**
 * Extracts note information from a note file's content
 */
export function extractNoteInfo(content: string, path: string, file?: TFile): {title: string, tags: string[], path: string, createdDate?: string, lastModified?: number} | null {
	let title = path.split('/').pop()?.replace('.md', '') || 'Untitled';
	let tags: string[] = [];
	let createdDate: string | undefined = undefined;
	let lastModified: number | undefined = file?.stat.mtime;
	
	// Try to extract note info from frontmatter
	if (content.startsWith('---')) {
		// Use our cached YAML parser
		const yaml = YAMLCache.extractFrontmatter(content, path);
		
		if (yaml) {
			if (yaml.title) {
				title = yaml.title;
			}
			
			if (yaml.tags && Array.isArray(yaml.tags)) {
				tags = yaml.tags;
			}
			
			// Extract creation date from dateCreated or date field
			if (yaml.dateCreated) {
				createdDate = yaml.dateCreated;
			} else if (yaml.date) {
				createdDate = yaml.date;
			}
		}
	}
	
	// Look for first heading in the content as a fallback title
	if (title === 'Untitled') {
		const headingMatch = content.match(/^#\s+(.+)$/m);
		if (headingMatch && headingMatch[1]) {
			title = headingMatch[1].trim();
		}
	}
	
	// If no creation date in frontmatter, use file creation time
	if (!createdDate && file) {
		createdDate = format(new Date(file.stat.ctime), "yyyy-MM-dd'T'HH:mm:ss");
	}
	
	// Normalize date format for consistent comparison
	if (createdDate) {
		// If it's just a date without time (YYYY-MM-DD), keep it as is
		if (createdDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
			// Already in the right format
		} 
		// If it's a full ISO timestamp or similar, extract just the date part
		else {
			try {
				const date = new Date(createdDate);
				if (!isNaN(date.getTime())) {
					// Format to YYYY-MM-DD to ensure consistency
					createdDate = format(date, "yyyy-MM-dd");
				}
			} catch (e) {
				console.error(`Error parsing date ${createdDate}:`, e);
			}
		}
	}
	
	return { title, tags, path, createdDate, lastModified };
}

/**
 * Extracts timeblock content from a daily note
 */
export function extractTimeblockContent(content: string): string | null {
	// Check if the content has a timeblock section
	const timeblockMatch = content.match(/## Timeblock\s*\n([^#]*)/);
	
	if (timeblockMatch && timeblockMatch[1]) {
		return timeblockMatch[1].trim();
	}
	
	return null;
}