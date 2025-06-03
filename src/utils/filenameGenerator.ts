import { format } from 'date-fns';
import { normalizePath } from 'obsidian';
import { TaskNotesSettings } from '../settings/settings';

export interface FilenameContext {
    title: string;
    priority: string;
    status: string;
    date?: Date;
}

/**
 * Generates a filename based on the configured format and context
 */
export function generateTaskFilename(
    context: FilenameContext, 
    settings: TaskNotesSettings
): string {
    const now = context.date || new Date();
    
    switch (settings.taskFilenameFormat) {
        case 'title':
            return sanitizeForFilename(context.title);
            
        case 'zettel':
            return generateZettelId(now);
            
        case 'timestamp':
            return generateTimestampFilename(now);
            
        case 'custom':
            return generateCustomFilename(context, settings.customFilenameTemplate, now);
            
        default:
            // Fallback to zettel format
            return generateZettelId(now);
    }
}

/**
 * Generates the traditional zettelkasten ID (YYMMDD + base36 seconds since midnight)
 */
function generateZettelId(date: Date): string {
    const datePart = format(date, 'yyMMdd');
    
    // Calculate seconds since midnight
    const midnight = new Date(date);
    midnight.setHours(0, 0, 0, 0);
    const secondsSinceMidnight = Math.floor((date.getTime() - midnight.getTime()) / 1000);
    
    // Convert to base36 for compactness
    const randomPart = secondsSinceMidnight.toString(36);
    
    return `${datePart}${randomPart}`;
}

/**
 * Generates a timestamp-based filename (YYYY-MM-DD-HHMMSS)
 */
function generateTimestampFilename(date: Date): string {
    return format(date, 'yyyy-MM-dd-HHmmss');
}

/**
 * Generates a filename based on a custom template
 */
function generateCustomFilename(
    context: FilenameContext, 
    template: string, 
    date: Date
): string {
    const variables: Record<string, string> = {
        title: sanitizeForFilename(context.title),
        date: format(date, 'yyyy-MM-dd'),
        time: format(date, 'HHmmss'),
        priority: context.priority,
        status: context.status,
        timestamp: format(date, 'yyyy-MM-dd-HHmmss'),
        dateTime: format(date, 'yyyy-MM-dd-HHmm'),
        year: format(date, 'yyyy'),
        month: format(date, 'MM'),
        day: format(date, 'dd'),
        hour: format(date, 'HH'),
        minute: format(date, 'mm'),
        second: format(date, 'ss')
    };
    
    let result = template;
    
    // Replace all variables in the template
    Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        result = result.replace(regex, value);
    });
    
    // Clean up any remaining unreplaced variables
    result = result.replace(/\{[^}]+\}/g, '');
    
    // Ensure we have a valid filename
    if (!result.trim()) {
        result = sanitizeForFilename(context.title) || generateZettelId(date);
    }
    
    return sanitizeForFilename(result);
}

/**
 * Sanitizes a string to be safe for use as a filename
 */
function sanitizeForFilename(input: string): string {
    if (!input) return '';
    
    // Remove or replace problematic characters
    let sanitized = input
        .trim()
        // Replace multiple spaces with single space
        .replace(/\s+/g, ' ')
        // Remove characters that are problematic in filenames (but keep spaces!)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        // Remove leading/trailing dots
        .replace(/^\.+|\.+$/g, '')
        // Limit length to reasonable size
        .substring(0, 100)
        // Final trim in case we removed characters at the edges
        .trim();
    
    // Ensure we don't have an empty result
    if (!sanitized) {
        sanitized = 'untitled';
    }
    
    return sanitized;
}

/**
 * Checks if a filename would be valid and unique
 */
export function validateFilename(filename: string): {
    isValid: boolean;
    error?: string;
    sanitized?: string;
} {
    if (!filename || !filename.trim()) {
        return {
            isValid: false,
            error: 'Filename cannot be empty'
        };
    }
    
    const sanitized = sanitizeForFilename(filename);
    
    if (!sanitized) {
        return {
            isValid: false,
            error: 'Filename contains only invalid characters'
        };
    }
    
    if (sanitized.length > 255) {
        return {
            isValid: false,
            error: 'Filename is too long (max 255 characters)'
        };
    }
    
    return {
        isValid: true,
        sanitized
    };
}

/**
 * Generates a unique filename by appending a number if needed
 */
export async function generateUniqueFilename(
    baseFilename: string,
    folderPath: string,
    vault: any // Obsidian Vault
): Promise<string> {
    const basePath = normalizePath(`${folderPath}/${baseFilename}.md`);
    
    // Check if the base filename is available
    if (!vault.getAbstractFileByPath(basePath)) {
        return baseFilename;
    }
    
    // If not, try appending numbers
    for (let i = 2; i <= 999; i++) {
        const candidateFilename = `${baseFilename}-${i}`;
        const candidatePath = normalizePath(`${folderPath}/${candidateFilename}.md`);
        
        if (!vault.getAbstractFileByPath(candidatePath)) {
            return candidateFilename;
        }
    }
    
    // If we get here, generate a unique ID fallback
    const timestamp = Date.now().toString(36);
    return `${baseFilename}-${timestamp}`;
}