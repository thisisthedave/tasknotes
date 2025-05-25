import { Notice, TFile, ItemView, WorkspaceLeaf } from 'obsidian';
import { format } from 'date-fns';
import ChronoSyncPlugin from '../main';
import { 
    NOTES_VIEW_TYPE, 
    NoteInfo, 
    EVENT_DATE_SELECTED,
    EVENT_DATA_CHANGED
} from '../types';

export class NotesView extends ItemView {
    plugin: ChronoSyncPlugin;
    
    // UI elements
    private loadingIndicator: HTMLElement | null = null;
    
    // Cached data
    private cachedNotes: NoteInfo[] | null = null;
    private lastNotesRefresh: number = 0;
    private readonly NOTES_CACHE_TTL = 60000; // 1 minute TTL for notes cache
    
    // Loading states
    private isNotesLoading: boolean = false;
    
    // Event listeners
    private listeners: (() => void)[] = [];
    
    constructor(leaf: WorkspaceLeaf, plugin: ChronoSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Register event listeners
        this.registerEvents();
    }
    
    getViewType(): string {
        return NOTES_VIEW_TYPE;
    }
    
    getDisplayText(): string {
        return 'Notes';
    }
    
    getIcon(): string {
        return 'file-text';
    }
    
    registerEvents(): void {
        // Clean up any existing listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        this.listeners = [];
        
        // Listen for date selection changes - force a full refresh when date changes
        const dateListener = this.plugin.emitter.on(EVENT_DATE_SELECTED, () => {
            this.cachedNotes = null;
            this.lastNotesRefresh = 0;
            this.refresh(true); // Force refresh on date change
        });
        this.listeners.push(dateListener);
        
        // Listen for data changes
        const dataListener = this.plugin.emitter.on(EVENT_DATA_CHANGED, () => {
            this.refresh();
        });
        this.listeners.push(dataListener);
    }
    
    async onOpen() {
        await this.refresh();
    }
    
    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        this.contentEl.empty();
    }
    
    async refresh(forceFullRefresh: boolean = false) {
        // If forcing a full refresh, clear the caches
        if (forceFullRefresh) {
            this.cachedNotes = null;
            this.lastNotesRefresh = 0;
        }
        
        // Clear and prepare the content element
        this.contentEl.empty();
        await this.render();
    }
    
    async render() {
        const container = this.contentEl.createDiv({ cls: 'chronosync-container notes-view-container' });
        
        // Create header with current date information
        this.createHeader(container);
        
        // Create notes content
        await this.createNotesContent(container);
    }
    
    createHeader(container: HTMLElement) {
        const headerContainer = container.createDiv({ cls: 'detail-view-header' });
        
        // Display selected date
        const formattedDate = format(this.plugin.selectedDate, 'EEEE, MMMM d, yyyy');
        headerContainer.createEl('h2', { text: formattedDate });
        
        // Add actions
        const actionsContainer = headerContainer.createDiv({ cls: 'detail-view-actions' });
        
        const createNoteButton = actionsContainer.createEl('button', { 
            text: 'New Note', 
            cls: 'new-note-button chronosync-button chronosync-button-primary',
            attr: {
                'aria-label': 'Create new note',
                'title': 'Create new note'
            }
        });
        
        createNoteButton.addEventListener('click', () => {
            // TODO: Implement note creation
            new Notice('Note creation not yet implemented');
        });
    }
    
    async createNotesContent(container: HTMLElement) {
        // Get the selected date as a string for display
        const dateText = `Notes for ${format(this.plugin.selectedDate, 'MMM d, yyyy')}`;
        
        // Create header with refresh option
        const headerContainer = container.createDiv({ cls: 'notes-header' });
        headerContainer.createEl('h3', { text: dateText, cls: 'notes-title' });
        
        // Add refresh button to header
        const refreshButton = headerContainer.createEl('button', { 
            text: 'Refresh', 
            cls: 'refresh-notes-button chronosync-button chronosync-button-secondary',
            attr: {
                'aria-label': 'Refresh notes list',
                'title': 'Refresh notes list'
            }
        });
        
        refreshButton.addEventListener('click', async () => {
            // Force refresh the notes cache
            this.cachedNotes = null;
            this.lastNotesRefresh = 0;
            await this.refresh(true);
        });
        
        // Notes list
        const notesList = container.createDiv({ cls: 'notes-list' });
        
        // Add loading indicator
        this.loadingIndicator = notesList.createDiv({ cls: 'loading-indicator' });
        this.loadingIndicator.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-text">Loading notes...</div>
        `;
        this.loadingIndicator.style.display = 'none';
        
        // Show loading state
        this.isNotesLoading = true;
        this.updateLoadingState();
        
        // Get notes for the current view
        const notes = await this.getNotesForView();
        
        // Hide loading state
        this.isNotesLoading = false;
        this.updateLoadingState();
        
        if (notes.length === 0) {
            // Placeholder for empty notes list
            notesList.createEl('p', { text: 'No notes found for the selected date.' });
        } else {
            // Create a div to hold all note items for quicker rendering
            const notesContainer = notesList.createDiv({ cls: 'notes-container' });
            
            // Use document fragment for faster DOM operations
            const fragment = document.createDocumentFragment();
            
            // Create note items
            notes.forEach(note => {
                const noteItem = document.createElement('div');
                noteItem.className = 'note-item chronosync-card';
                
                const titleEl = document.createElement('div');
                titleEl.className = 'note-item-title chronosync-card-header';
                titleEl.textContent = note.title;
                noteItem.appendChild(titleEl);
                
                const contentContainer = document.createElement('div');
                contentContainer.className = 'chronosync-card-content';
                
                // Add created date if available
                if (note.createdDate) {
                    const dateStr = note.createdDate.indexOf('T') > 0 
                        ? format(new Date(note.createdDate), 'MMM d, yyyy h:mm a') 
                        : note.createdDate;
                    const dateEl = document.createElement('div');
                    dateEl.className = 'note-item-date';
                    dateEl.textContent = `Created: ${dateStr}`;
                    contentContainer.appendChild(dateEl);
                }
                
                noteItem.appendChild(contentContainer);
                
                // Add tags as footer
                if (note.tags && note.tags.length > 0) {
                    const tagContainer = document.createElement('div');
                    tagContainer.className = 'note-item-tags chronosync-card-footer';
                    
                    note.tags.forEach(tag => {
                        const tagEl = document.createElement('span');
                        tagEl.className = 'note-tag';
                        tagEl.textContent = tag;
                        tagContainer.appendChild(tagEl);
                    });
                    
                    noteItem.appendChild(tagContainer);
                }
                
                // Add click handler to open note
                noteItem.addEventListener('click', () => {
                    this.openNote(note.path);
                });
                
                fragment.appendChild(noteItem);
            });
            
            // Append all notes at once
            notesContainer.appendChild(fragment);
        }
    }
    
    /**
     * Helper method to update the loading indicator visibility
     */
    private updateLoadingState(): void {
        if (!this.loadingIndicator) return;
        
        if (this.isNotesLoading) {
            this.loadingIndicator.style.display = 'flex';
        } else {
            this.loadingIndicator.style.display = 'none';
        }
    }
    
    async getNotesForView(forceRefresh: boolean = false): Promise<NoteInfo[]> {
        try {
            // Set loading state
            this.isNotesLoading = true;
            this.updateLoadingState();
            
            // Use cached notes if available and not forcing refresh
            const now = Date.now();
            if (!forceRefresh && 
                this.cachedNotes && 
                now - this.lastNotesRefresh < this.NOTES_CACHE_TTL) {
                // Wait a little bit before returning to allow temp UI changes to be visible
                await new Promise(resolve => setTimeout(resolve, 100));
                return [...this.cachedNotes]; // Return a copy to prevent modification of cache
            }
            
            // Use the FileIndexer to get notes information for the specific date
            const notes = await this.plugin.fileIndexer.getNotesForDate(this.plugin.selectedDate, forceRefresh);
            
            // Filter out daily notes
            const filteredNotes = notes.filter(note => 
                !note.path.startsWith(this.plugin.settings.dailyNotesFolder)
            );
            
            // Sort notes by title
            const sortedResult = filteredNotes.sort((a, b) => a.title.localeCompare(b.title));
            
            // Update cache and timestamp
            this.cachedNotes = [...sortedResult];
            this.lastNotesRefresh = now;
            
            return sortedResult;
        } finally {
            // Clear loading state
            this.isNotesLoading = false;
            this.updateLoadingState();
        }
    }
    
    openNote(path: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file);
        }
    }
}