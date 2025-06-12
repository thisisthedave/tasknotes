import { format, parse, parseISO, isSameDay, isBefore, isValid, startOfDay, addDays as addDaysFns, endOfDay, isBefore as isBeforeFns } from 'date-fns';

/**
 * Smart date parsing that detects timezone info and handles appropriately
 */
export function parseDate(dateString: string): Date {
    if (!dateString) {
        throw new Error('Date string cannot be empty');
    }
    
    // Check if the string contains timezone information
    if (dateString.includes('T') || dateString.includes('Z') || dateString.match(/[+-]\d{2}:\d{2}$/)) {
        // Has timezone info - parse as-is to preserve timezone
        const parsed = parseISO(dateString);
        if (!isValid(parsed)) {
            throw new Error(`Invalid timezone-aware date: ${dateString}`);
        }
        return parsed;
    } else {
        // Date-only string - parse in local timezone
        const parsed = parse(dateString, 'yyyy-MM-dd', new Date());
        if (!isValid(parsed)) {
            throw new Error(`Invalid date-only string: ${dateString}`);
        }
        return parsed;
    }
}

/**
 * Safe date comparison that handles mixed timezone contexts
 */
export function isSameDateSafe(date1: string, date2: string): boolean {
    try {
        const d1 = parseDate(date1);
        const d2 = parseDate(date2);
        return isSameDay(d1, d2);
    } catch (error) {
        console.error('Error comparing dates:', { date1, date2, error });
        return false;
    }
}

/**
 * Safe date comparison for before/after relationships
 */
export function isBeforeDateSafe(date1: string, date2: string): boolean {
    try {
        const d1 = startOfDay(parseDate(date1));
        const d2 = startOfDay(parseDate(date2));
        return isBefore(d1, d2);
    } catch (error) {
        console.error('Error comparing dates for before:', { date1, date2, error });
        return false;
    }
}

/**
 * Get today in appropriate format for comparison
 */
export function getTodayString(): string {
    return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Normalize a date string to YYYY-MM-DD format for storage/comparison
 */
export function normalizeDateString(dateString: string): string {
    try {
        const parsed = parseDate(dateString);
        return format(parsed, 'yyyy-MM-dd');
    } catch (error) {
        console.error('Error normalizing date string:', { dateString, error });
        return dateString; // Return original if parsing fails
    }
}

/**
 * Create a safe Date object for a specific year/month/day in local timezone
 */
export function createSafeDate(year: number, month: number, day: number): Date {
    // Note: month is 0-based in Date constructor
    return new Date(year, month, day);
}

/**
 * Enhanced date validation that accepts both date-only and timezone-aware formats
 */
export function validateDateInput(dateValue: string): boolean {
    if (!dateValue || dateValue.trim() === '') {
        return true; // Empty is valid (optional field)
    }
    
    try {
        parseDate(dateValue);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Add days to a date string, returning a date string
 */
export function addDaysToDateString(dateString: string, days: number): string {
    try {
        const parsed = parseDate(dateString);
        const result = addDaysFns(parsed, days);
        return format(result, 'yyyy-MM-dd');
    } catch (error) {
        console.error('Error adding days to date string:', { dateString, days, error });
        throw error;
    }
}

/**
 * Get start of day for a date string, preserving the date format
 */
export function startOfDayForDateString(dateString: string): Date {
    try {
        const parsed = parseDate(dateString);
        return startOfDay(parsed);
    } catch (error) {
        console.error('Error getting start of day for date string:', { dateString, error });
        throw error;
    }
}

/**
 * Check if a date string represents today
 */
export function isToday(dateString: string): boolean {
    return isSameDateSafe(dateString, getTodayString());
}

/**
 * Check if a date string represents a past date (before today)
 */
export function isPastDate(dateString: string): boolean {
    return isBeforeDateSafe(dateString, getTodayString());
}

/**
 * Format a date string for user display
 */
export function formatDateForDisplay(dateString: string, formatString: string = 'MMM d, yyyy'): string {
    try {
        const parsed = parseDate(dateString);
        return format(parsed, formatString);
    } catch (error) {
        console.error('Error formatting date for display:', { dateString, error });
        return dateString; // Return original if formatting fails
    }
}

/**
 * Get current timestamp in local timezone ISO format for consistent timestamp generation
 */
export function getCurrentTimestamp(): string {
    const now = new Date();
    const tzOffset = -now.getTimezoneOffset();
    const diff = tzOffset >= 0 ? '+' : '-';
    const pad = (num: number) => String(Math.abs(num)).padStart(2, '0');
    
    const tzOffsetHours = pad(Math.floor(Math.abs(tzOffset) / 60));
    const tzOffsetMinutes = pad(Math.abs(tzOffset) % 60);
    
    // Get local date/time components
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${diff}${tzOffsetHours}:${tzOffsetMinutes}`;
}

/**
 * Get current date in YYYY-MM-DD format for completion dates
 */
export function getCurrentDateString(): string {
    return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Safe timestamp parsing for display and comparison
 */
export function parseTimestamp(timestampString: string): Date {
    try {
        if (!timestampString) {
            throw new Error('Timestamp string cannot be empty');
        }
        
        // Always use parseISO for timestamps as they should be in ISO format
        const parsed = parseISO(timestampString);
        if (!isValid(parsed)) {
            throw new Error(`Invalid timestamp: ${timestampString}`);
        }
        return parsed;
    } catch (error) {
        console.error('Error parsing timestamp:', { timestampString, error });
        throw error;
    }
}

/**
 * Format timestamp for display in user's timezone
 */
export function formatTimestampForDisplay(timestampString: string, formatString: string = 'MMM d, yyyy h:mm a'): string {
    try {
        const parsed = parseTimestamp(timestampString);
        return format(parsed, formatString);
    } catch (error) {
        console.error('Error formatting timestamp for display:', { timestampString, error });
        return timestampString; // Return original if formatting fails
    }
}

// ==========================================
// TIME-AWARE DATE UTILITIES
// ==========================================

/**
 * Check if a date string contains time information
 */
export function hasTimeComponent(dateString: string): boolean {
    if (!dateString) return false;
    // Check for 'T' followed by time pattern (HH:mm or HH:mm:ss)
    return /T\d{2}:\d{2}/.test(dateString);
}

/**
 * Extract just the date part from a date or datetime string
 */
export function getDatePart(dateString: string): string {
    if (!dateString) return '';
    
    try {
        const parsed = parseDate(dateString);
        return format(parsed, 'yyyy-MM-dd');
    } catch (error) {
        console.error('Error extracting date part:', { dateString, error });
        return dateString;
    }
}

/**
 * Extract just the time part from a datetime string, returns null if no time
 */
export function getTimePart(dateString: string): string | null {
    if (!dateString || !hasTimeComponent(dateString)) {
        return null;
    }
    
    try {
        const parsed = parseDate(dateString);
        return format(parsed, 'HH:mm');
    } catch (error) {
        console.error('Error extracting time part:', { dateString, error });
        return null;
    }
}

/**
 * Combine a date and time into a datetime string
 */
export function combineDateAndTime(dateString: string, timeString: string): string {
    if (!dateString) return '';
    if (!timeString) return dateString;
    
    try {
        // Parse the date part
        const datePart = getDatePart(dateString);
        
        // Validate time format (HH:mm)
        if (!/^\d{2}:\d{2}$/.test(timeString)) {
            console.warn('Invalid time format, expected HH:mm:', timeString);
            return dateString;
        }
        
        return `${datePart}T${timeString}`;
    } catch (error) {
        console.error('Error combining date and time:', { dateString, timeString, error });
        return dateString;
    }
}

/**
 * Format a date/datetime string for display, showing time if available
 */
export function formatDateTimeForDisplay(dateString: string, options: {
    dateFormat?: string;
    timeFormat?: string;
    showTime?: boolean;
} = {}): string {
    if (!dateString) return '';
    
    const {
        dateFormat = 'MMM d, yyyy',
        timeFormat = 'h:mm a',
        showTime = true
    } = options;
    
    try {
        const parsed = parseDate(dateString);
        const hasTime = hasTimeComponent(dateString);
        
        if (hasTime && showTime) {
            // Handle empty dateFormat case (e.g., for "Today at" scenarios)
            if (!dateFormat || dateFormat.trim() === '') {
                return format(parsed, timeFormat);
            } else {
                return format(parsed, `${dateFormat} ${timeFormat}`);
            }
        } else {
            // For date-only, return the dateFormat or fallback
            if (!dateFormat || dateFormat.trim() === '') {
                return ''; // Return empty for time-only requests when no time available
            } else {
                return format(parsed, dateFormat);
            }
        }
    } catch (error) {
        console.error('Error formatting datetime for display:', { dateString, error });
        return dateString;
    }
}

/**
 * Time-aware comparison for before/after relationships
 * For date-only strings, treats them as end-of-day for sorting purposes
 */
export function isBeforeDateTimeAware(date1: string, date2: string): boolean {
    try {
        const d1 = parseDate(date1);
        const d2 = parseDate(date2);
        
        // If both have time, direct comparison
        if (hasTimeComponent(date1) && hasTimeComponent(date2)) {
            return isBeforeFns(d1, d2);
        }
        
        // If neither has time, compare dates only
        if (!hasTimeComponent(date1) && !hasTimeComponent(date2)) {
            return isBefore(startOfDay(d1), startOfDay(d2));
        }
        
        // Mixed case: treat date-only as end-of-day for sorting
        const d1Normalized = hasTimeComponent(date1) ? d1 : endOfDay(d1);
        const d2Normalized = hasTimeComponent(date2) ? d2 : endOfDay(d2);
        
        return isBeforeFns(d1Normalized, d2Normalized);
    } catch (error) {
        console.error('Error comparing dates time-aware:', { date1, date2, error });
        return false;
    }
}

/**
 * Check if a date/datetime is overdue (past current date/time)
 */
export function isOverdueTimeAware(dateString: string): boolean {
    if (!dateString) return false;
    
    try {
        const taskDate = parseDate(dateString);
        const now = new Date();
        
        // If task has time, compare with current date/time
        if (hasTimeComponent(dateString)) {
            return isBeforeFns(taskDate, now);
        }
        
        // If task is date-only, it's overdue if the date is before today
        const today = startOfDay(now);
        const taskDateStart = startOfDay(taskDate);
        return isBefore(taskDateStart, today);
    } catch (error) {
        console.error('Error checking overdue status:', { dateString, error });
        return false;
    }
}

/**
 * Check if a date/datetime represents today (time-aware)
 */
export function isTodayTimeAware(dateString: string): boolean {
    if (!dateString) return false;
    
    try {
        const taskDate = parseDate(dateString);
        const now = new Date();
        
        return isSameDay(taskDate, now);
    } catch (error) {
        console.error('Error checking if today:', { dateString, error });
        return false;
    }
}

/**
 * Validate datetime input (supports both date-only and date+time)
 */
export function validateDateTimeInput(dateValue: string, timeValue?: string): boolean {
    if (!dateValue || dateValue.trim() === '') {
        return true; // Empty is valid (optional field)
    }
    
    try {
        // Validate date part
        if (!validateDateInput(dateValue)) {
            return false;
        }
        
        // If time is provided, validate it
        if (timeValue && timeValue.trim() !== '') {
            // Check for HH:mm format
            if (!/^\d{2}:\d{2}$/.test(timeValue)) {
                return false;
            }
            
            // Validate the combined datetime
            const combined = combineDateAndTime(dateValue, timeValue);
            return validateDateInput(combined);
        }
        
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Get current date+time in local timezone as YYYY-MM-DDTHH:mm format
 */
export function getCurrentDateTimeString(): string {
    const now = new Date();
    return format(now, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Add days to a date/datetime string, preserving time if present
 */
export function addDaysToDateTime(dateString: string, days: number): string {
    try {
        const parsed = parseDate(dateString);
        const result = addDaysFns(parsed, days);
        
        // Preserve time format if original had time
        if (hasTimeComponent(dateString)) {
            return format(result, "yyyy-MM-dd'T'HH:mm");
        } else {
            return format(result, 'yyyy-MM-dd');
        }
    } catch (error) {
        console.error('Error adding days to datetime:', { dateString, days, error });
        throw error;
    }
}