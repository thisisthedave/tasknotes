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

    constructor(vault: Vault, taskTag: string, excludedFolders: string = '') {
        this.vault = vault;
        this.taskTag = taskTag;
        this.excludedFolders = excludedFolders 
            ? excludedFolders.split(',').map(folder => folder.trim())
            : [];
        
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
        
        // Process files in batches
        const batchSize = 20;
        for (let i = 0; i < index.taskFiles.length; i += batchSize) {
            const batch = index.taskFiles.slice(i, i + batchSize);
            
            const batchResults = await Promise.all(
                batch.map(async (indexedFile) => {
                    // Use cached info if available and file hasn't changed
                    if (
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
        const result: NoteInfo[] = [];
        
        // Get selected date string for filtering
        const selectedDateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Process files in batches
        const batchSize = 20;
        for (let i = 0; i < index.noteFiles.length; i += batchSize) {
            const batch = index.noteFiles.slice(i, i + batchSize);
            
            const batchResults = await Promise.all(
                batch.map(async (indexedFile) => {
                    // Use cached info if available and file hasn't changed
                    if (
                        indexedFile.cachedInfo && 
                        !('status' in indexedFile.cachedInfo) && 
                        indexedFile.cachedInfo.createdDate?.startsWith(selectedDateStr)
                    ) {
                        return indexedFile.cachedInfo as NoteInfo;
                    }
                    
                    try {
                        const file = this.vault.getAbstractFileByPath(indexedFile.path);
                        if (!(file instanceof TFile)) return null;
                        
                        // Use cachedRead for better performance
                        const content = await this.vault.cachedRead(file);
                        const noteInfo = extractNoteInfo(content, indexedFile.path, file);
                        
                        if (
                            noteInfo && 
                            noteInfo.createdDate?.startsWith(selectedDateStr) && 
                            !(noteInfo.tags || []).includes(this.taskTag)
                        ) {
                            // Cache the result in the index
                            indexedFile.cachedInfo = noteInfo;
                            return noteInfo;
                        }
                    } catch (e) {
                        console.error(`Error processing note file ${indexedFile.path}:`, e);
                    }
                    
                    return null;
                })
            );
            
            // Add valid results to the final array
            batchResults.forEach(note => {
                if (note) result.push(note);
            });
        }
        
        return result;
    }
    
    // For clearing specific cached info when a file is updated
    public clearCachedInfo(path: string) {
        if (!this.fileIndex) return;
        
        const taskFile = this.fileIndex.taskFiles.find(f => f.path === path);
        if (taskFile) {
            taskFile.cachedInfo = undefined;
            return;
        }
        
        const noteFile = this.fileIndex.noteFiles.find(f => f.path === path);
        if (noteFile) {
            noteFile.cachedInfo = undefined;
        }
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