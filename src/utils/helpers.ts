import { normalizePath, TFile, Vault } from 'obsidian';
import { format } from 'date-fns';
import { TimeInfo, TaskInfo, TimeEntry } from '../types';
import * as YAML from 'yaml';
import { YAMLCache } from './YAMLCache';
import { FieldMapper } from '../services/FieldMapper';

/**
 * Creates a debounced version of a function
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    
    return function debounced(...args: Parameters<T>) {
        if (timeout) {
            clearTimeout(timeout);
        }
        
        timeout = setTimeout(() => {
            func(...args);
            timeout = null;
        }, wait);
    };
}

/**
 * Ensures a folder and its parent folders exist
 */
export async function ensureFolderExists(vault: Vault, folderPath: string): Promise<void> {
	try {
		const folders = folderPath.split('/').filter(folder => folder.length > 0);
		let currentPath = '';
		
		for (const folder of folders) {
			currentPath = currentPath ? `${currentPath}/${folder}` : folder;
			const exists = await vault.adapter.exists(currentPath);
			if (!exists) {
				await vault.createFolder(currentPath);
			}
		}
	} catch (error) {
		console.error('Error creating folder structure:', error);
		throw new Error(`Failed to create folder: ${folderPath}`);
	}
}

/**
 * Calculate duration in minutes between two ISO timestamp strings
 */
export function calculateDuration(startTime: string, endTime: string): number {
	try {
		const start = new Date(startTime);
		const end = new Date(endTime);
		
		// Validate dates
		if (isNaN(start.getTime()) || isNaN(end.getTime())) {
			console.error('Invalid timestamps for duration calculation:', { startTime, endTime });
			return 0;
		}
		
		// Ensure end is after start
		if (end <= start) {
			console.error('End time is not after start time:', { startTime, endTime });
			return 0;
		}
		
		// Calculate duration in minutes
		const durationMs = end.getTime() - start.getTime();
		const durationMinutes = Math.round(durationMs / (1000 * 60));
		
		return Math.max(0, durationMinutes); // Ensure non-negative
	} catch (error) {
		console.error('Error calculating duration:', error, { startTime, endTime });
		return 0;
	}
}

/**
 * Calculate total time spent for a task from its time entries
 */
export function calculateTotalTimeSpent(timeEntries: TimeEntry[]): number {
	if (!timeEntries || !Array.isArray(timeEntries)) {
		return 0;
	}
	
	return timeEntries.reduce((total, entry) => {
		// Skip entries without both start and end times
		if (!entry.startTime || !entry.endTime) {
			return total;
		}
		
		const duration = calculateDuration(entry.startTime, entry.endTime);
		return total + duration;
	}, 0);
}

/**
 * Get the active (running) time entry for a task
 */
export function getActiveTimeEntry(timeEntries: TimeEntry[]): TimeEntry | null {
	if (!timeEntries || !Array.isArray(timeEntries)) {
		return null;
	}
	
	return timeEntries.find(entry => entry.startTime && !entry.endTime) || null;
}

/**
 * Format time in minutes to a readable string (e.g., "1h 30m", "45m")
 */
export function formatTime(minutes: number): string {
	if (!minutes || minutes === 0 || isNaN(minutes)) {
		return '0m';
	}
	
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	
	if (hours === 0) return `${mins}m`;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

/**
 * Parses a time string in the format HH:MM and returns hours and minutes
 */
export function parseTime(timeStr: string): TimeInfo | null {
	try {
		if (!timeStr || typeof timeStr !== 'string') {
			return null;
		}
		
		const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
		if (!match) return null;
		
		const hours = parseInt(match[1]);
		const minutes = parseInt(match[2]);
		
		if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
			return null;
		}
		
		return { hours, minutes };
	} catch (error) {
		console.error('Error parsing time string:', error);
		return null;
	}
}

/**
 * Updates a YAML frontmatter value in a Markdown file
 */
export function updateYamlFrontmatter<T = any>(content: string, key: string, updateFn: (val: T | undefined) => T): string {
	// Check if the content has YAML frontmatter
	if (!content.startsWith('---')) {
		// If not, add it with the updated key
		const yamlObj: Record<string, any> = {};
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
	let yamlObj: Record<string, any> = {};
	try {
		yamlObj = YAML.parse(frontmatter) || {};
	} catch (e) {
		console.error('Error parsing YAML frontmatter:', e);
		return content;
	}
	
	// Update the key
	yamlObj[key] = updateFn(yamlObj[key] as T | undefined);
	
	// Stringify the frontmatter
	const updatedFrontmatter = YAML.stringify(yamlObj);
	
	// Return the updated content
	return `---\n${updatedFrontmatter}---${restOfContent}`;
}

/**
 * Updates task properties in content using field mapping
 */
export function updateTaskProperty(
	content: string, 
	propertyUpdates: Partial<TaskInfo>, 
	fieldMapper?: FieldMapper
): string {
	// Check if the content has YAML frontmatter
	if (!content.startsWith('---')) {
		// If not, create new frontmatter
		const yamlObj: Record<string, any> = {};
		
		if (fieldMapper) {
			// Use field mapper to create frontmatter
			const mappedFrontmatter = fieldMapper.mapToFrontmatter(propertyUpdates);
			Object.assign(yamlObj, mappedFrontmatter);
		} else {
			// Use legacy field names
			Object.assign(yamlObj, propertyUpdates);
		}
		
		const yamlStr = YAML.stringify(yamlObj);
		return `---\n${yamlStr}---\n\n${content}`;
	}
	
	// Find the end of the frontmatter
	const endOfFrontmatter = content.indexOf('---', 3);
	if (endOfFrontmatter === -1) return content;
	
	// Extract the frontmatter
	const frontmatter = content.substring(3, endOfFrontmatter);
	const restOfContent = content.substring(endOfFrontmatter + 3); // Skip the closing ---
	
	// Parse the frontmatter
	let yamlObj: Record<string, any> = {};
	try {
		yamlObj = YAML.parse(frontmatter) || {};
	} catch (e) {
		console.error('Error parsing YAML frontmatter:', e);
		return content;
	}
	
	// Update properties
	if (fieldMapper) {
		// Use field mapper to update properties
		const mappedUpdates = fieldMapper.mapToFrontmatter(propertyUpdates);
		Object.assign(yamlObj, mappedUpdates);
	} else {
		// Use legacy field names
		Object.assign(yamlObj, propertyUpdates);
	}
	
	// Stringify the frontmatter
	const updatedFrontmatter = YAML.stringify(yamlObj);
	
	// Return the updated content
	return `---\n${updatedFrontmatter}---${restOfContent}`;
}

/**
 * Generates a daily note template
 */
export function generateDailyNoteTemplate(date: Date, templateContent?: string): string {
	// If a custom template is provided, process Obsidian template variables
	if (templateContent) {
		return processObsidianTemplateVariables(templateContent, date);
	}
	
	// Default built-in template
	const dateStr = format(date, 'yyyy-MM-dd');
	const dayName = format(date, 'eeee, MMMM do, yyyy');
	
	const yaml = {
		date: dateStr,
		tags: ['daily']
	};
	
	const content = `---\n${YAML.stringify(yaml)}---\n\n# ${dayName}\n\n## Notes\n\n`;
	
	return content;
}

/**
 * Process Obsidian template variables like {{title}}, {{date:format}}, etc.
 */
function processObsidianTemplateVariables(template: string, date: Date): string {
	let result = template;
	
	// {{title}} - Date in YYYY-MM-DD format (Obsidian's default for daily notes)
	const title = format(date, 'yyyy-MM-dd');
	result = result.replace(/\{\{title\}\}/g, title);
	
	// {{date}} and {{date:format}} - Custom date formatting
	result = result.replace(/\{\{date(?::([^}]+))?\}\}/g, (match, formatStr) => {
		if (formatStr) {
			// Convert Obsidian/moment format to date-fns format
			const dateFnsFormat = convertMomentToDateFnsFormat(formatStr);
			return format(date, dateFnsFormat);
		} else {
			// Default date format
			return format(date, 'yyyy-MM-dd');
		}
	});
	
	// {{time}} and {{time:format}} - Current time
	const now = new Date();
	result = result.replace(/\{\{time(?::([^}]+))?\}\}/g, (match, formatStr) => {
		if (formatStr) {
			const dateFnsFormat = convertMomentToDateFnsFormat(formatStr);
			return format(now, dateFnsFormat);
		} else {
			// Default time format
			return format(now, 'HH:mm');
		}
	});
	
	return result;
}

/**
 * Convert Moment.js/Obsidian format strings to date-fns format strings
 * This is a basic converter for common formats
 */
function convertMomentToDateFnsFormat(momentFormat: string): string {
	let result = momentFormat;
	
	// First, handle escaped literals [text] -> 'text'
	result = result.replace(/\[([^\]]+)\]/g, "'$1'");
	
	// Split by quotes to process unquoted sections only
	const parts = result.split(/'([^']*?)'/);
	
	for (let i = 0; i < parts.length; i += 2) { // Only process unquoted parts (even indices)
		let part = parts[i];
		
		// Apply conversions in order of length (longest first to avoid partial matches)
		const conversions = [
			['gggg', 'RRRR'], // ISO week year (4 digits)
			['dddd', 'EEEE'], // Full day name
			['YYYY', 'yyyy'], // 4-digit year
			['MMMM', 'MMMM'], // Full month name
			['MMM', 'MMM'],   // Short month name
			['ddd', 'EEE'],   // Short day name
			['gg', 'RR'],     // ISO week year (2 digits)
			['ww', 'II'],     // ISO week number (2 digits)
			['dd', 'EEEEEE'], // Minimal day name
			['DD', 'dd'],     // Day of month (2 digits)
			['MM', 'MM'],     // Month (2 digits)
			['HH', 'HH'],     // Hour (2 digits, 24h)
			['hh', 'hh'],     // Hour (2 digits, 12h)
			['mm', 'mm'],     // Minute (2 digits)
			['ss', 'ss'],     // Second (2 digits)
			['YY', 'yy'],     // 2-digit year
			['M', 'M'],       // Month (1 digit)
			['D', 'd'],       // Day of month (1 digit)
			['H', 'H'],       // Hour (1 digit, 24h)
			['h', 'h'],       // Hour (1 digit, 12h)
			['m', 'm'],       // Minute (1 digit)
			['s', 's'],       // Second (1 digit)
			['w', 'I'],       // ISO week number (1 digit)
			['A', 'a'],       // AM/PM (uppercase)
			['a', 'a']        // AM/PM (lowercase)
		];
		
		// Apply each conversion
		conversions.forEach(([momentPattern, dateFnsPattern]) => {
			const regex = new RegExp(momentPattern, 'g');
			part = part.replace(regex, dateFnsPattern);
		});
		
		parts[i] = part;
	}
	
	// Rejoin the parts
	result = parts.join("'");
	
	return result;
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
 * Extracts task information from a task file's content using field mapping
 */
export function extractTaskInfo(
	content: string, 
	path: string, 
	fieldMapper?: FieldMapper
): TaskInfo | null {
	// Try to extract task info from frontmatter
	if (content.startsWith('---')) {
		const endOfFrontmatter = content.indexOf('---', 3);
		if (endOfFrontmatter !== -1) {
			// Use our cached YAML parser
			const yaml = YAMLCache.extractFrontmatter(content, path);
			
			if (yaml) {
				if (fieldMapper) {
					// Use field mapper to extract task info
					const mappedTask = fieldMapper.mapFromFrontmatter(yaml, path);
					
					// Ensure required fields have defaults
					const taskInfo: TaskInfo = {
						title: mappedTask.title || 'Untitled task',
						status: mappedTask.status || 'open',
						priority: mappedTask.priority || 'normal',
						due: mappedTask.due,
						path,
						archived: mappedTask.archived || false,
						tags: mappedTask.tags || [],
						contexts: mappedTask.contexts || [],
						recurrence: mappedTask.recurrence,
						complete_instances: mappedTask.complete_instances,
						completedDate: mappedTask.completedDate,
						timeEstimate: mappedTask.timeEstimate,
												timeEntries: mappedTask.timeEntries
					};
					
					return taskInfo;
				} else {
					// Fallback to legacy field names for backward compatibility
					const tags = yaml.tags || [];
					const archived = Array.isArray(tags) && tags.includes('archived');
					
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
					
					// Extract contexts
					const contexts = yaml.contexts || [];
					
					return {
						title: yaml.title || 'Untitled task',
						status: yaml.status || 'open',
						priority: yaml.priority || 'normal',
						due: yaml.due,
						path,
						archived,
						tags: Array.isArray(tags) ? [...tags] : [],
						contexts: Array.isArray(contexts) ? [...contexts] : [],
						recurrence,
						complete_instances,
						completedDate: yaml.completedDate,
						timeEstimate: yaml.timeEstimate,
						timeEntries: yaml.timeEntries?.map((entry: any) => ({
							startTime: entry.start || entry.startTime,
							endTime: entry.end || entry.endTime,
														description: entry.description
						}))
					};
				}
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

