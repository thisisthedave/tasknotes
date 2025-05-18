import { TFile, Vault } from 'obsidian';
import { FileIndex, IndexedFile, TaskInfo, NoteInfo } from '../types';
import { extractNoteInfo, extractTaskInfo } from './helpers';
import * as YAML from 'yaml';
import { YAMLCache } from './YAMLCache';

const INDEX_TTL = 5 * 60 * 1000; // 5 minutes TTL for index

export class FileIndexer {
    private vault: Vault;
    private fileIndex: FileIndex | null = null;
    private taskTag: string;
    private excludedFolders: string[];
    private dailyNotesPath: string;

    constructor(vault: Vault, taskTag: string, excludedFolders: string = '', dailyNotesPath: string = '') {
        this.vault = vault;
        this.taskTag = taskTag;
        this.excludedFolders = excludedFolders 
            ? excludedFolders.split(',').map(folder => folder.trim())
            : [];
        this.dailyNotesPath = dailyNotesPath;
        
        // Register event listeners for file changes
        this.registerFileEvents();
    }

    private registerFileEvents() {
        // These events will mark specific files as dirty in the index
        this.vault.on('modify', (file) => {
            if (file instanceof TFile) {
                this.updateIndexedFile(file);
            }
        });
        
        this.vault.on('delete', (file) => {
            if (file instanceof TFile) {
                this.removeFromIndex(file);
            }
        });
        
        this.vault.on('rename', (file, oldPath) => {
            if (file instanceof TFile) {
                this.updateFileOnRename(file, oldPath);
            }
        });
        
        this.vault.on('create', (file) => {
            if (file instanceof TFile) {
                this.addToIndex(file);
            }
        });
    }

    private updateFileOnRename(file: TFile, oldPath: string) {
        // Remove old path
        this.removeFromIndexByPath(oldPath);
        
        // Clear YAML cache for both old and new paths
        YAMLCache.clearCacheEntry(oldPath);
        YAMLCache.clearCacheEntry(file.path);
        
        // Add with new path
        this.addToIndex(file);
    }

    private removeFromIndexByPath(path: string) {
        if (!this.fileIndex) return;

        this.fileIndex.taskFiles = this.fileIndex.taskFiles.filter(f => f.path !== path);
        this.fileIndex.noteFiles = this.fileIndex.noteFiles.filter(f => f.path !== path);
    }

    private removeFromIndex(file: TFile) {
        this.removeFromIndexByPath(file.path);
        
        // Also clear YAML cache for this file
        YAMLCache.clearCacheEntry(file.path);
    }

    private async updateIndexedFile(file: TFile) {
        if (!this.fileIndex || file.extension !== 'md') return;

        // Clear YAML cache for this file
        YAMLCache.clearCacheEntry(file.path);
        
        // Remove first
        this.removeFromIndex(file);
        // Then add fresh
        await this.addToIndex(file);
    }

    private isExcluded(path: string): boolean {
        return this.excludedFolders.some(folder => 
            folder && path.startsWith(folder)
        );
    }

    private async addToIndex(file: TFile) {
        if (!this.fileIndex || file.extension !== 'md') return;
        
        // Check if file is in excluded folder
        if (this.isExcluded(file.path)) return;

        try {
            // Use cachedRead for better performance
            const content = await this.vault.cachedRead(file);
            
            // Check if this is a task file
            const hasFrontmatter = content.startsWith('---');
            let isTask = false;
            let tags: string[] = [];
            
            if (hasFrontmatter) {
                const endOfFrontmatter = content.indexOf('---', 3);
                if (endOfFrontmatter !== -1) {
                    const frontmatter = content.substring(3, endOfFrontmatter);
                    try {
                        const yaml = YAML.parse(frontmatter);
                        if (yaml && yaml.tags) {
                            tags = Array.isArray(yaml.tags) ? yaml.tags : [yaml.tags];
                            isTask = tags.includes(this.taskTag);
                        }
                    } catch (e) {
                        console.error('Error parsing YAML frontmatter:', e);
                    }
                }
            }
            
            const indexedFile: IndexedFile = {
                path: file.path,
                mtime: file.stat.mtime,
                ctime: file.stat.ctime,
                tags,
                isTask
            };
            
            // Add to the appropriate list
            if (isTask) {
                this.fileIndex.taskFiles.push(indexedFile);
            } else {
                this.fileIndex.noteFiles.push(indexedFile);
            }
        } catch (e) {
            console.error(`Error indexing file ${file.path}:`, e);
        }
    }

    public async getIndex(forceRefresh = false): Promise<FileIndex> {
        const now = Date.now();
        
        // Return cached index if it's still valid
        if (
            !forceRefresh && 
            this.fileIndex && 
            now - this.fileIndex.lastIndexed < INDEX_TTL
        ) {
            return this.fileIndex;
        }
        
        // Create a new index
        this.fileIndex = {
            taskFiles: [],
            noteFiles: [],
            lastIndexed: now
        };
        
        // Get all markdown files
        const files = this.vault.getMarkdownFiles();
        
        // Process files in batches of 50 for better responsiveness
        const batchSize = 50;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            await Promise.all(batch.map(file => this.addToIndex(file)));
        }
        
        return this.fileIndex;
    }
    
    public async getTaskInfoForDate(date: Date, forceRefresh = false): Promise<TaskInfo[]> {
        const index = await this.getIndex(forceRefresh);
        const result: TaskInfo[] = [];
        const processedPaths = new Set<string>(); // Track which paths we've processed to prevent duplicates
        
        // Process files in batches
        const batchSize = 20;
        for (let i = 0; i < index.taskFiles.length; i += batchSize) {
            const batch = index.taskFiles.slice(i, i + batchSize);
            
            const batchResults = await Promise.all(
                batch.map(async (indexedFile) => {
                    // Skip if we've already processed this path
                    if (processedPaths.has(indexedFile.path)) {
                        return null;
                    }
                    processedPaths.add(indexedFile.path);
                    
                    // Use cached info if available and not forcing refresh
                    if (
                        !forceRefresh &&
                        indexedFile.cachedInfo && 
                        'status' in indexedFile.cachedInfo
                    ) {
                        return indexedFile.cachedInfo as TaskInfo;
                    }
                    
                    try {
                        const file = this.vault.getAbstractFileByPath(indexedFile.path);
                        if (!(file instanceof TFile)) return null;
                        
                        // Use cachedRead for better performance
                        const content = await this.vault.cachedRead(file);
                        const taskInfo = extractTaskInfo(content, indexedFile.path);
                        
                        if (taskInfo) {
                            // Cache the result in the index
                            indexedFile.cachedInfo = taskInfo;
                            return taskInfo;
                        }
                    } catch (e) {
                        console.error(`Error processing task file ${indexedFile.path}:`, e);
                    }
                    
                    return null;
                })
            );
            
            // Add valid results to the final array
            batchResults.forEach(task => {
                if (task) result.push(task);
            });
        }
        
        return result;
    }
    
    public async getNotesForDate(date: Date, forceRefresh = false): Promise<NoteInfo[]> {
        const index = await this.getIndex(forceRefresh);
        
        // Get selected date string for filtering - use '10' for hours to ensure timezone issues don't affect dates
        const targetDate = new Date(date);
        targetDate.setHours(10, 0, 0, 0); // Normalize to mid-day to avoid timezone issues
        const selectedDateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Check if we have a cached result for this date that's still valid
        if (!forceRefresh && this.lastNotesQueryDate === selectedDateStr && this.lastNotesQueryResult) {
            return this.lastNotesQueryResult;
        }
        
        // Create a map to track processed files (faster lookup than Set for large collections)
        const processedPaths = new Map<string, NoteInfo>();
        const result: NoteInfo[] = [];
        
        // First, collect all valid note information from the index
        const validNoteFiles = index.noteFiles.filter(file => 
            !processedPaths.has(file.path) && 
            !file.tags?.includes(this.taskTag)
        );
        
        // Use a larger batch size for better throughput
        const batchSize = 50;
        
        // Process files in batches, prioritizing files with cached info
        // This should significantly speed up repeated queries
        
        // Step 1: Quickly process all files that have cached info first
        const filesWithCache = validNoteFiles.filter(file => 
            file.cachedInfo && !('status' in file.cachedInfo)
        );
        
        for (const file of filesWithCache) {
            if (processedPaths.has(file.path)) continue;
            
            const noteInfo = file.cachedInfo as NoteInfo;
            processedPaths.set(file.path, noteInfo);
            
            // Check if this note matches our date filter
            if (noteInfo.createdDate) {
                const noteDate = noteInfo.createdDate.split('T')[0];
                if (noteDate === selectedDateStr) {
                    result.push(noteInfo);
                }
            }
        }
        
        // Step 2: Process all remaining files that don't have cached info
        const filesWithoutCache = validNoteFiles.filter(file => 
            !file.cachedInfo || ('status' in file.cachedInfo)
        );
        
        for (let i = 0; i < filesWithoutCache.length; i += batchSize) {
            const batch = filesWithoutCache.slice(i, i + batchSize);
            
            await Promise.all(
                batch.map(async (indexedFile) => {
                    if (processedPaths.has(indexedFile.path)) return;
                    
                    try {
                        const file = this.vault.getAbstractFileByPath(indexedFile.path);
                        if (!(file instanceof TFile)) return;
                        
                        // Use cachedRead for better performance
                        const content = await this.vault.cachedRead(file);
                        const noteInfo = extractNoteInfo(content, indexedFile.path, file);
                        
                        if (noteInfo && !(noteInfo.tags || []).includes(this.taskTag)) {
                            // Store the note info in our processed map
                            processedPaths.set(indexedFile.path, noteInfo);
                            
                            // Cache the result in the index for future use
                            indexedFile.cachedInfo = noteInfo;
                            
                            // Check if this note matches our date filter
                            if (noteInfo.createdDate) {
                                const noteDate = noteInfo.createdDate.split('T')[0];
                                if (noteDate === selectedDateStr) {
                                    result.push(noteInfo);
                                }
                            }
                        }
                    } catch (e) {
                        console.error(`Error processing note file ${indexedFile.path}:`, e);
                    }
                })
            );
        }
        
        // Cache the result for this date query
        this.lastNotesQueryDate = selectedDateStr;
        this.lastNotesQueryResult = result;
        
        return result;
    }
    
    // Store the last notes query result to avoid unnecessary reprocessing
    private lastNotesQueryDate: string | null = null;
    private lastNotesQueryResult: NoteInfo[] | null = null;
    
    // Calendar data caching
    private calendarCache: Map<string, {
        notes: Map<string, number>,  // Date -> count
        tasks: Map<string, {
            count: number,
            hasDue: boolean,
            hasCompleted: boolean,
            hasArchived: boolean
        }>,
        dailyNotes: Set<string>,     // YYYY-MM-DD strings
        lastUpdated: number
    }> = new Map();
    
    /**
     * Get calendar data for a specific month
     * This provides the data needed for calendar highlighting
     * 
     * @param year The year
     * @param month The month (0-11)
     * @param forceRefresh Whether to force a refresh of the cache
     * @returns Calendar data needed for highlighting
     */
    public async getCalendarData(year: number, month: number, forceRefresh = false): Promise<{
        notes: Map<string, number>,
        tasks: Map<string, {
            count: number,
            hasDue: boolean,
            hasCompleted: boolean,
            hasArchived: boolean
        }>,
        dailyNotes: Set<string>
    }> {
        const monthKey = `${year}-${month}`;
        const cacheAge = 5 * 60 * 1000; // 5 minutes
        
        // Check if we have fresh cached data
        if (!forceRefresh && 
            this.calendarCache.has(monthKey) && 
            (Date.now() - this.calendarCache.get(monthKey)!.lastUpdated < cacheAge)) {
            const cachedData = this.calendarCache.get(monthKey)!;
            return {
                notes: cachedData.notes,
                tasks: cachedData.tasks,
                dailyNotes: cachedData.dailyNotes
            };
        }
        
        // Calculate month boundaries
        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 0);
        
        // Initialize data structures for the month
        const notesMap = new Map<string, number>();
        const tasksMap = new Map<string, {
            count: number,
            hasDue: boolean,
            hasCompleted: boolean,
            hasArchived: boolean
        }>();
        const dailyNotesSet = new Set<string>();
        
        // Get data for the month
        await this.getIndex(forceRefresh);
        
        // Process notes
        const noteFiles = await Promise.all(
            this.fileIndex!.noteFiles
                .filter(file => !file.tags?.includes(this.taskTag))
                .map(async file => {
                    try {
                        if (!file.cachedInfo || ('status' in file.cachedInfo)) {
                            const fileObj = this.vault.getAbstractFileByPath(file.path);
                            if (!(fileObj instanceof TFile)) return null;
                            
                            const content = await this.vault.cachedRead(fileObj);
                            return extractNoteInfo(content, file.path, fileObj);
                        } else {
                            return file.cachedInfo as NoteInfo;
                        }
                    } catch (e) {
                        console.error(`Error processing note for calendar: ${file.path}`, e);
                        return null;
                    }
                })
        );
        
        // Process valid notes
        noteFiles.forEach(note => {
            if (note?.createdDate) {
                try {
                    const noteDate = new Date(note.createdDate);
                    if (noteDate >= startOfMonth && noteDate <= endOfMonth) {
                        const dateKey = noteDate.toISOString().split('T')[0]; // YYYY-MM-DD
                        notesMap.set(dateKey, (notesMap.get(dateKey) || 0) + 1);
                    }
                } catch (e) {
                    console.error(`Error processing note date: ${note.createdDate}`, e);
                }
            }
        });
        
        // Process tasks
        const taskFiles = await Promise.all(
            this.fileIndex!.taskFiles.map(async file => {
                try {
                    if (!file.cachedInfo || !('status' in file.cachedInfo)) {
                        const fileObj = this.vault.getAbstractFileByPath(file.path);
                        if (!(fileObj instanceof TFile)) return null;
                        
                        const content = await this.vault.cachedRead(fileObj);
                        return extractTaskInfo(content, file.path);
                    } else {
                        return file.cachedInfo as TaskInfo;
                    }
                } catch (e) {
                    console.error(`Error processing task for calendar: ${file.path}`, e);
                    return null;
                }
            })
        );
        
        // Process valid tasks
        taskFiles.forEach(task => {
            if (task?.due) {
                try {
                    const dueDate = new Date(task.due);
                    if (dueDate >= startOfMonth && dueDate <= endOfMonth) {
                        const dateKey = dueDate.toISOString().split('T')[0]; // YYYY-MM-DD
                        const taskInfo = tasksMap.get(dateKey) || { 
                            count: 0, 
                            hasDue: false, 
                            hasCompleted: false,
                            hasArchived: false 
                        };
                        
                        // Update task info
                        taskInfo.count++;
                        taskInfo.hasDue = true;
                        taskInfo.hasCompleted = taskInfo.hasCompleted || task.status.toLowerCase() === 'done';
                        taskInfo.hasArchived = taskInfo.hasArchived || task.archived;
                        
                        // Update the map
                        tasksMap.set(dateKey, taskInfo);
                    }
                } catch (e) {
                    console.error(`Error processing task date: ${task.due}`, e);
                }
            }
        });
        
        // Process daily notes
        const dailyNotesFolder = this.vault.getAbstractFileByPath("/" + dailyNotesPath);
        if (dailyNotesFolder) {
            const dailyNoteFiles = this.vault.getMarkdownFiles().filter(file => 
                file.path.startsWith(dailyNotesPath) && /^\d{4}-\d{2}-\d{2}\.md$/.test(file.basename + '.md')
            );
            
            dailyNoteFiles.forEach(file => {
                const dateStr = file.basename;
                try {
                    const fileDate = new Date(dateStr);
                    if (fileDate.getFullYear() === year && fileDate.getMonth() === month) {
                        dailyNotesSet.add(dateStr);
                    }
                } catch (e) {
                    console.error(`Error processing daily note date: ${dateStr}`, e);
                }
            });
        }
        
        // Update the cache
        this.calendarCache.set(monthKey, {
            notes: notesMap,
            tasks: tasksMap,
            dailyNotes: dailyNotesSet,
            lastUpdated: Date.now()
        });
        
        // Return the data
        return {
            notes: notesMap,
            tasks: tasksMap,
            dailyNotes: dailyNotesSet
        };
    }
    
    // For clearing specific cached info when a file is updated
    public clearCachedInfo(path: string) {
        if (!this.fileIndex) return;
        
        // First, clear any duplicates of this path in both arrays
        this.fileIndex.taskFiles = this.fileIndex.taskFiles.filter(f => f.path !== path);
        this.fileIndex.noteFiles = this.fileIndex.noteFiles.filter(f => f.path !== path);
        
        // Now, re-add the file to the appropriate list based on its current state
        const file = this.vault.getAbstractFileByPath(path);
        if (file instanceof TFile && file.extension === 'md') {
            // Add it back asynchronously
            this.addToIndex(file).catch(e => {
                console.error(`Error re-indexing file ${path}:`, e);
            });
        }
    }
    
    // Force a complete rebuild of the index
    public async rebuildIndex() {
        // Set lastIndexed to 0 to force a rebuild
        if (this.fileIndex) {
            this.fileIndex.lastIndexed = 0;
        }
        
        // Clear all cached info
        if (this.fileIndex) {
            this.fileIndex.taskFiles.forEach(f => f.cachedInfo = undefined);
            this.fileIndex.noteFiles.forEach(f => f.cachedInfo = undefined);
        }
        
        // Clear calendar cache
        this.calendarCache.clear();
        
        // Clear query result cache
        this.lastNotesQueryDate = null;
        this.lastNotesQueryResult = null;
        
        // Get a fresh index
        await this.getIndex(true);
    }
    
    // Update a task's info in the cache without reloading all tasks
    public async updateTaskInfoInCache(path: string, taskInfo: TaskInfo | null) {
        if (!this.fileIndex) return;
        
        // Look for the task in the task files list
        const taskFile = this.fileIndex.taskFiles.find(f => f.path === path);
        if (taskFile) {
            // Update the cached info - cast to avoid type error
            taskFile.cachedInfo = taskInfo as TaskInfo | undefined;
            return;
        }
        
        // If the task wasn't found in the task files list, it might be a new task
        // or one that hasn't been indexed yet - check if it's in the notes list
        const noteFile = this.fileIndex.noteFiles.find(f => f.path === path);
        if (noteFile && taskInfo) {
            // This was a note that's now a task - move it to the task files list
            this.fileIndex.noteFiles = this.fileIndex.noteFiles.filter(f => f.path !== path);
            this.fileIndex.taskFiles.push({
                path,
                mtime: noteFile.mtime,
                ctime: noteFile.ctime,
                tags: taskInfo.tags || [],
                isTask: true,
                cachedInfo: taskInfo
            });
        }
    }
}