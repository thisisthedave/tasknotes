import { format } from 'date-fns';
import { TFile } from 'obsidian';
import { NoteInfo } from '../types';
import TaskNotesPlugin from '../main';

export interface NoteCardOptions {
    showCreatedDate: boolean;
    showTags: boolean;
    showPath: boolean;
    maxTags: number;
    showDailyNoteBadge: boolean;
}

export const DEFAULT_NOTE_CARD_OPTIONS: NoteCardOptions = {
    showCreatedDate: true,
    showTags: true,
    showPath: false,
    maxTags: 3,
    showDailyNoteBadge: true
};

/**
 * Create a reusable note card element
 */
export function createNoteCard(note: NoteInfo, plugin: TaskNotesPlugin, options: Partial<NoteCardOptions> = {}): HTMLElement {
    const opts = { ...DEFAULT_NOTE_CARD_OPTIONS, ...options };
    
    const item = document.createElement('div');
    item.className = 'note-item tasknotes-card';
    item.dataset.notePath = note.path;
    
    // Check if this is a daily note
    const isDailyNote = note.path.startsWith(plugin.settings.dailyNotesFolder);
    if (isDailyNote) {
        item.classList.add('daily-note-item');
    }
    
    // Header with title and badges
    const header = item.createDiv({ cls: 'note-item-header tasknotes-card-header' });
    
    // Daily note badge (if enabled and applicable)
    if (opts.showDailyNoteBadge && isDailyNote) {
        const dailyBadge = header.createSpan({ 
            cls: 'daily-note-badge',
            text: 'Daily',
            attr: { title: 'Daily Note' }
        });
    }
    
    // Title
    const title = header.createDiv({ 
        cls: 'note-item-title',
        text: note.title
    });
    
    // Content container
    const content = item.createDiv({ cls: 'note-item-content tasknotes-card-content' });
    
    // Created date (if enabled and available)
    if (opts.showCreatedDate && note.createdDate) {
        const dateStr = note.createdDate.indexOf('T') > 0 
            ? format(new Date(note.createdDate), 'MMM d, yyyy h:mm a') 
            : note.createdDate;
        const dateEl = content.createDiv({ 
            cls: 'note-item-date',
            text: `Created: ${dateStr}`,
            attr: { title: `Created: ${dateStr}` }
        });
    }
    
    // Path (if enabled)
    if (opts.showPath) {
        const pathEl = content.createDiv({ 
            cls: 'note-item-path',
            text: note.path,
            attr: { title: `Path: ${note.path}` }
        });
    }
    
    // Tags footer (if enabled and tags exist)
    if (opts.showTags && note.tags && note.tags.length > 0) {
        const footer = item.createDiv({ cls: 'note-item-footer tasknotes-card-footer' });
        const tagContainer = footer.createDiv({ cls: 'note-item-tags' });
        
        const tagsToShow = note.tags.slice(0, opts.maxTags);
        tagsToShow.forEach(tag => {
            const tagEl = tagContainer.createSpan({ 
                cls: 'note-tag',
                text: tag,
                attr: { title: `Tag: ${tag}` }
            });
        });
        
        // Show "more tags" indicator if there are additional tags
        if (note.tags.length > opts.maxTags) {
            const moreTagsEl = tagContainer.createSpan({ 
                cls: 'more-tags',
                text: `+${note.tags.length - opts.maxTags}`,
                attr: { title: `${note.tags.length - opts.maxTags} more tags` }
            });
        }
    }
    
    // Add click handler to open note
    item.addEventListener('click', () => {
        const file = plugin.app.vault.getAbstractFileByPath(note.path);
        if (file instanceof TFile) {
            plugin.app.workspace.getLeaf(false).openFile(file);
        }
    });
    
    // Add hover preview
    item.addEventListener('mouseover', (event) => {
        const file = plugin.app.vault.getAbstractFileByPath(note.path);
        if (file) {
            plugin.app.workspace.trigger('hover-link', {
                event,
                source: 'tasknotes-note-card',
                hoverParent: item,
                targetEl: item,
                linktext: note.path,
                sourcePath: note.path
            });
        }
    });
    
    return item;
}

/**
 * Update an existing note card with new data
 */
export function updateNoteCard(element: HTMLElement, note: NoteInfo, plugin: TaskNotesPlugin, options: Partial<NoteCardOptions> = {}): void {
    const opts = { ...DEFAULT_NOTE_CARD_OPTIONS, ...options };
    
    // Update main element classes
    const isDailyNote = note.path.startsWith(plugin.settings.dailyNotesFolder);
    element.className = `note-item tasknotes-card ${isDailyNote ? 'daily-note-item' : ''}`;
    
    // Update title
    const titleEl = element.querySelector('.note-item-title') as HTMLElement;
    if (titleEl) {
        titleEl.textContent = note.title;
    }
    
    // Update created date
    const dateEl = element.querySelector('.note-item-date') as HTMLElement;
    if (dateEl && opts.showCreatedDate && note.createdDate) {
        const dateStr = note.createdDate.indexOf('T') > 0 
            ? format(new Date(note.createdDate), 'MMM d, yyyy h:mm a') 
            : note.createdDate;
        dateEl.textContent = `Created: ${dateStr}`;
    }
    
    // Update path
    const pathEl = element.querySelector('.note-item-path') as HTMLElement;
    if (pathEl && opts.showPath) {
        pathEl.textContent = note.path;
    }
    
    // Update tags
    const tagContainer = element.querySelector('.note-item-tags') as HTMLElement;
    if (tagContainer && opts.showTags && note.tags && note.tags.length > 0) {
        tagContainer.empty();
        
        const tagsToShow = note.tags.slice(0, opts.maxTags);
        tagsToShow.forEach(tag => {
            const tagEl = tagContainer.createSpan({ 
                cls: 'note-tag',
                text: tag,
                attr: { title: `Tag: ${tag}` }
            });
        });
        
        if (note.tags.length > opts.maxTags) {
            const moreTagsEl = tagContainer.createSpan({ 
                cls: 'more-tags',
                text: `+${note.tags.length - opts.maxTags}`,
                attr: { title: `${note.tags.length - opts.maxTags} more tags` }
            });
        }
    }
    
    // Add update animation
    element.classList.add('note-updated');
    setTimeout(() => {
        element.classList.remove('note-updated');
    }, 1000);
}