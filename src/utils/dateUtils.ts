import { format, parse, parseISO, isSameDay, isBefore, isValid, startOfDay, addDays as addDaysFns } from 'date-fns';

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