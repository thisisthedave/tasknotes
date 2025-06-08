import { format, parse } from 'date-fns';

export interface ParsedTaskData {
	title: string;
	status: string;
	priority: string;
	dueDate?: string;
	scheduledDate?: string;
	startDate?: string;
	createdDate?: string;
	doneDate?: string;
	recurrence?: string;
	recurrenceData?: {
		frequency: string;
		days_of_week?: string[];
		day_of_month?: number;
		month_of_year?: number;
	};
	isCompleted: boolean;
}

export interface TaskLineInfo {
	isTaskLine: boolean;
	originalText: string;
	parsedData?: ParsedTaskData;
	error?: string;
}

export class TasksPluginParser {
	// Emoji patterns for Tasks plugin
	private static readonly EMOJI_PATTERNS = {
		DUE_DATE: /📅\s*(\d{4}-\d{2}-\d{2})/g,
		SCHEDULED_DATE: /⏳\s*(\d{4}-\d{2}-\d{2})/g,
		START_DATE: /🛫\s*(\d{4}-\d{2}-\d{2})/g,
		CREATED_DATE: /➕\s*(\d{4}-\d{2}-\d{2})/g,
		DONE_DATE: /✅\s*(\d{4}-\d{2}-\d{2})/g,
		HIGH_PRIORITY: /⏫/g,
		MEDIUM_PRIORITY: /🔼/g,
		LOW_PRIORITY: /⏬/g,
		RECURRENCE: /🔁\s*([^📅⏳🛫➕✅⏫🔼⏬🔁]+?)(?=\s*[📅⏳🛫➕✅⏫🔼⏬🔁]|$)/g
	};

	// Checkbox pattern for markdown tasks
	private static readonly CHECKBOX_PATTERN = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)/;

	/**
	 * Parse a line of text to extract Tasks plugin format data
	 */
	static parseTaskLine(line: string): TaskLineInfo {
		const trimmedLine = line.trim();
		
		// Check if this is a checkbox task line
		const checkboxMatch = trimmedLine.match(this.CHECKBOX_PATTERN);
		if (!checkboxMatch) {
			return {
				isTaskLine: false,
				originalText: line
			};
		}

		try {
			const [, prefix, checkState, middle, taskContent] = checkboxMatch;
			const isCompleted = checkState.toLowerCase() === 'x';

			// Parse the task content for emojis and metadata
			const parsedData = this.parseTaskContent(taskContent, isCompleted);
			
			return {
				isTaskLine: true,
				originalText: line,
				parsedData
			};
		} catch (error) {
			return {
				isTaskLine: true,
				originalText: line,
				error: `Failed to parse task: ${error.message}`
			};
		}
	}

	/**
	 * Parse task content to extract emoji-based metadata
	 */
	private static parseTaskContent(content: string, isCompleted: boolean): ParsedTaskData {
		let workingContent = content;
		
		// Extract dates
		const dueDate = this.extractDate(workingContent, this.EMOJI_PATTERNS.DUE_DATE);
		const scheduledDate = this.extractDate(workingContent, this.EMOJI_PATTERNS.SCHEDULED_DATE);
		const startDate = this.extractDate(workingContent, this.EMOJI_PATTERNS.START_DATE);
		const createdDate = this.extractDate(workingContent, this.EMOJI_PATTERNS.CREATED_DATE);
		const doneDate = this.extractDate(workingContent, this.EMOJI_PATTERNS.DONE_DATE);

		// Extract priority
		const priority = this.extractPriority(workingContent);

		// Extract recurrence
		const { recurrence, recurrenceData } = this.extractRecurrence(workingContent);

		// Remove all emoji patterns to get clean title
		const title = this.extractCleanTitle(workingContent);

		// Determine status based on completion and done date
		let status = 'open';
		if (isCompleted || doneDate) {
			status = 'done';
		} else if (startDate && new Date(startDate) > new Date()) {
			status = 'scheduled';
		}

		return {
			title: title.trim(),
			status,
			priority,
			dueDate,
			scheduledDate,
			startDate,
			createdDate,
			doneDate,
			recurrence,
			recurrenceData,
			isCompleted
		};
	}

	/**
	 * Extract date from content using pattern
	 */
	private static extractDate(content: string, pattern: RegExp): string | undefined {
		// Create a fresh regex to avoid global state issues
		const freshPattern = new RegExp(pattern.source, 'g');
		const match = freshPattern.exec(content);
		
		if (match && match[1]) {
			// Validate date format
			try {
				const date = parse(match[1], 'yyyy-MM-dd', new Date());
				return format(date, 'yyyy-MM-dd');
			} catch {
				return undefined;
			}
		}
		return undefined;
	}

	/**
	 * Extract priority from content
	 */
	private static extractPriority(content: string): string {
		// Create fresh regex patterns to avoid global state issues
		if (new RegExp(this.EMOJI_PATTERNS.HIGH_PRIORITY.source).test(content)) {
			return 'high';
		}
		if (new RegExp(this.EMOJI_PATTERNS.MEDIUM_PRIORITY.source).test(content)) {
			return 'medium';
		}
		if (new RegExp(this.EMOJI_PATTERNS.LOW_PRIORITY.source).test(content)) {
			return 'low';
		}
		return 'normal';
	}

	/**
	 * Extract recurrence information from content
	 */
	private static extractRecurrence(content: string): { recurrence?: string; recurrenceData?: any } {
		// Create a fresh regex to avoid global state issues
		const freshPattern = new RegExp(this.EMOJI_PATTERNS.RECURRENCE.source, 'g');
		const match = freshPattern.exec(content);
		
		if (!match || !match[1]) {
			return {};
		}

		const recurrenceText = match[1].trim();
		
		// Parse common recurrence patterns
		if (recurrenceText.includes('every day')) {
			return {
				recurrence: 'daily',
				recurrenceData: { frequency: 'daily' }
			};
		}
		
		if (recurrenceText.includes('every week')) {
			return {
				recurrence: 'weekly',
				recurrenceData: { frequency: 'weekly' }
			};
		}
		
		if (recurrenceText.includes('every month')) {
			return {
				recurrence: 'monthly',
				recurrenceData: { frequency: 'monthly' }
			};
		}
		
		if (recurrenceText.includes('every year')) {
			return {
				recurrence: 'yearly',
				recurrenceData: { frequency: 'yearly' }
			};
		}

		// Handle weekly with specific days
		const weeklyDaysMatch = recurrenceText.match(/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
		if (weeklyDaysMatch) {
			return {
				recurrence: 'weekly',
				recurrenceData: {
					frequency: 'weekly',
					days_of_week: [weeklyDaysMatch[1].toLowerCase().substring(0, 3)]
				}
			};
		}

		// Default to storing the raw recurrence text
		return {
			recurrence: 'custom',
			recurrenceData: {
				frequency: 'custom',
				raw: recurrenceText
			}
		};
	}

	/**
	 * Extract clean title by removing all emoji patterns
	 */
	private static extractCleanTitle(content: string): string {
		let cleanContent = content;

		// Remove all emoji patterns using fresh regex instances
		Object.values(this.EMOJI_PATTERNS).forEach(pattern => {
			const freshPattern = new RegExp(pattern.source, 'g');
			cleanContent = cleanContent.replace(freshPattern, '');
		});

		// Clean up extra whitespace
		return cleanContent.replace(/\s+/g, ' ').trim();
	}

	/**
	 * Validate if a line contains Tasks plugin format
	 */
	static isTasksPluginFormat(line: string): boolean {
		const trimmedLine = line.trim();
		const hasCheckbox = this.CHECKBOX_PATTERN.test(trimmedLine);
		
		if (!hasCheckbox) return false;

		// Check for at least one Tasks plugin emoji using fresh regex instances
		const emojiPatterns = Object.values(this.EMOJI_PATTERNS);
		return emojiPatterns.some(pattern => {
			const freshPattern = new RegExp(pattern.source);
			return freshPattern.test(trimmedLine);
		});
	}

	/**
	 * Get a human-readable summary of parsed data for debugging
	 */
	static getSummary(parsedData: ParsedTaskData): string {
		const parts: string[] = [];
		
		parts.push(`Title: "${parsedData.title}"`);
		parts.push(`Status: ${parsedData.status}`);
		parts.push(`Priority: ${parsedData.priority}`);
		
		if (parsedData.dueDate) parts.push(`Due: ${parsedData.dueDate}`);
		if (parsedData.startDate) parts.push(`Start: ${parsedData.startDate}`);
		if (parsedData.scheduledDate) parts.push(`Scheduled: ${parsedData.scheduledDate}`);
		if (parsedData.createdDate) parts.push(`Created: ${parsedData.createdDate}`);
		if (parsedData.doneDate) parts.push(`Done: ${parsedData.doneDate}`);
		if (parsedData.recurrence) parts.push(`Recurrence: ${parsedData.recurrence}`);
		
		return parts.join(' | ');
	}
}