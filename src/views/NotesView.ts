import { Notice, TFile, ItemView, WorkspaceLeaf } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    NOTES_VIEW_TYPE, 
    NoteInfo, 
    EVENT_DATE_SELECTED,
    EVENT_DATA_CHANGED
} from '../types';
import { createNoteCard } from '../ui/NoteCard';

export class NotesView extends ItemView {
    plugin: TaskNotesPlugin;
    
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
    
    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
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
        
        // Try to preserve scroll position if not forcing full refresh
        const existingContainer = this.contentEl.querySelector('.tasknotes-container');
        let scrollTop = 0;
        if (existingContainer && !forceFullRefresh) {
            const notesList = existingContainer.querySelector('.notes-list') as HTMLElement;
            if (notesList) {
                scrollTop = notesList.scrollTop;
            }
        }
        
        // Clear and prepare the content element
        this.contentEl.empty();
        await this.render();
        
        // Restore scroll position
        if (scrollTop > 0) {
            const newNotesList = this.contentEl.querySelector('.notes-list') as HTMLElement;
            if (newNotesList) {
                newNotesList.scrollTop = scrollTop;
            }
        }
    }
    
    async render() {
        const container = this.contentEl.createDiv({ cls: 'tasknotes-container notes-view-container' });
        
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
        
        // Add refresh button
        const refreshButton = actionsContainer.createEl('button', { 
            text: 'Refresh', 
            cls: 'refresh-notes-button tasknotes-button tasknotes-button-secondary',
            attr: {
                'aria-label': 'Refresh notes list',
                'title': 'Refresh notes list'
            }
        });
        
        refreshButton.addEventListener('click', async () => {
            // Prevent double-clicks during refresh
            if (refreshButton.classList.contains('is-loading')) return;
            
            refreshButton.classList.add('is-loading');
            refreshButton.disabled = true;
            const originalText = refreshButton.textContent;
            refreshButton.textContent = 'Refreshing...';
            
            try {
                // Force refresh the notes cache
                this.cachedNotes = null;
                this.lastNotesRefresh = 0;
                await this.refresh(true);
            } finally {
                refreshButton.classList.remove('is-loading');
                refreshButton.disabled = false;
                refreshButton.textContent = originalText;
            }
        });
    }
    
    async createNotesContent(container: HTMLElement) {
        // Notes list
        const notesList = container.createDiv({ cls: 'notes-list' });
        
        // Add loading indicator
        this.loadingIndicator = notesList.createDiv({ cls: 'loading-indicator' });
        this.loadingIndicator.createDiv({ cls: 'loading-spinner' });
        this.loadingIndicator.createDiv({ cls: 'loading-text', text: 'Loading notes...' });
        this.loadingIndicator.addClass('is-hidden');
        
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
            
            // Create note items using the NoteCard component
            notes.forEach(note => {
                const noteCard = createNoteCard(note, this.plugin, {
                    showCreatedDate: true,
                    showTags: true,
                    showPath: false,
                    maxTags: 5,
                    showDailyNoteBadge: true
                });
                
                fragment.appendChild(noteCard);
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
            this.loadingIndicator.removeClass('is-hidden');
        } else {
            this.loadingIndicator.addClass('is-hidden');
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
            
            // Use the CacheManager to get notes information for the specific date
            const notes = await this.plugin.cacheManager.getNotesForDate(this.plugin.selectedDate, forceRefresh);
            
            // Include all notes (both regular notes and daily notes)
            const filteredNotes = notes;
            
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