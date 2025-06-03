import { FieldMapping, TaskInfo } from '../types';

/**
 * Service for mapping between internal field names and user-configured property names
 */
export class FieldMapper {
    constructor(private mapping: FieldMapping) {}

    /**
     * Convert internal field name to user's property name
     */
    toUserField(internalName: keyof FieldMapping): string {
        return this.mapping[internalName];
    }

    /**
     * Convert frontmatter object using mapping to internal task data
     */
    mapFromFrontmatter(frontmatter: any, filePath: string): Partial<TaskInfo> {
        if (!frontmatter) return {};

        const mapped: Partial<TaskInfo> = {
            path: filePath
        };

        // Map each field if it exists in frontmatter
        if (frontmatter[this.mapping.title] !== undefined) {
            mapped.title = frontmatter[this.mapping.title];
        }
        
        if (frontmatter[this.mapping.status] !== undefined) {
            mapped.status = frontmatter[this.mapping.status];
        }
        
        if (frontmatter[this.mapping.priority] !== undefined) {
            mapped.priority = frontmatter[this.mapping.priority];
        }
        
        if (frontmatter[this.mapping.due] !== undefined) {
            mapped.due = frontmatter[this.mapping.due];
        }
        
        if (frontmatter[this.mapping.contexts] !== undefined) {
            const contexts = frontmatter[this.mapping.contexts];
            // Ensure contexts is always an array
            mapped.contexts = Array.isArray(contexts) ? contexts : [contexts];
        }
        
        if (frontmatter[this.mapping.timeEstimate] !== undefined) {
            mapped.timeEstimate = frontmatter[this.mapping.timeEstimate];
        }
        
        
        if (frontmatter[this.mapping.completedDate] !== undefined) {
            mapped.completedDate = frontmatter[this.mapping.completedDate];
        }
        
        if (frontmatter[this.mapping.recurrence] !== undefined) {
            mapped.recurrence = frontmatter[this.mapping.recurrence];
        }

        // Handle tags array (includes archive tag)
        if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
            mapped.tags = frontmatter.tags;
            mapped.archived = frontmatter.tags.includes(this.mapping.archiveTag);
        }

        // Handle time entries
        if (frontmatter.timeEntries !== undefined) {
            mapped.timeEntries = frontmatter.timeEntries;
        }

        return mapped;
    }

    /**
     * Convert internal task data to frontmatter using mapping
     */
    mapToFrontmatter(taskData: Partial<TaskInfo>): any {
        const frontmatter: any = {};

        // Map each field if it exists in task data
        if (taskData.title !== undefined) {
            frontmatter[this.mapping.title] = taskData.title;
        }
        
        if (taskData.status !== undefined) {
            frontmatter[this.mapping.status] = taskData.status;
        }
        
        if (taskData.priority !== undefined) {
            frontmatter[this.mapping.priority] = taskData.priority;
        }
        
        if (taskData.due !== undefined) {
            frontmatter[this.mapping.due] = taskData.due;
        }
        
        if (taskData.contexts !== undefined) {
            frontmatter[this.mapping.contexts] = taskData.contexts;
        }
        
        if (taskData.timeEstimate !== undefined) {
            frontmatter[this.mapping.timeEstimate] = taskData.timeEstimate;
        }
        
        
        if (taskData.completedDate !== undefined) {
            frontmatter[this.mapping.completedDate] = taskData.completedDate;
        }
        
        if (taskData.recurrence !== undefined) {
            frontmatter[this.mapping.recurrence] = taskData.recurrence;
        }

        // Handle tags (merge archive status into tags array)
        let tags = taskData.tags ? [...taskData.tags] : [];
        
        if (taskData.archived === true && !tags.includes(this.mapping.archiveTag)) {
            tags.push(this.mapping.archiveTag);
        } else if (taskData.archived === false) {
            tags = tags.filter(tag => tag !== this.mapping.archiveTag);
        }
        
        if (tags.length > 0) {
            frontmatter.tags = tags;
        }

        // Handle time entries
        if (taskData.timeEntries !== undefined) {
            frontmatter.timeEntries = taskData.timeEntries;
        }

        return frontmatter;
    }

    /**
     * Update mapping configuration
     */
    updateMapping(newMapping: FieldMapping): void {
        this.mapping = newMapping;
    }

    /**
     * Get current mapping
     */
    getMapping(): FieldMapping {
        return { ...this.mapping };
    }

    /**
     * Validate that a mapping has no empty field names
     */
    static validateMapping(mapping: FieldMapping): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        const fields = Object.keys(mapping) as (keyof FieldMapping)[];
        for (const field of fields) {
            if (!mapping[field] || mapping[field].trim() === '') {
                errors.push(`Field "${field}" cannot be empty`);
            }
        }

        // Check for duplicate values
        const values = Object.values(mapping);
        const uniqueValues = new Set(values);
        if (values.length !== uniqueValues.size) {
            errors.push('Field mappings must have unique property names');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}