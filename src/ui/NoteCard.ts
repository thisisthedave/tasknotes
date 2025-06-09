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
    item.className = 'tasknotes-card tasknotes-card--compact tasknotes-card--shadow-light note-item';
    item.dataset.notePath = note.path;
    
    // Check if this is a daily note
    const isDailyNote = note.path.startsWith(plugin.settings.dailyNotesFolder);
    if (isDailyNote) {
        item.classList.add('daily-note-item');
    }
    
    // Daily note badge (if enabled and applicable)
    if (opts.showDailyNoteBadge && isDailyNote) {
        const dailyBadge = item.createSpan({ 
            cls: 'daily-note-badge',
            text: 'Daily',
            attr: { title: 'Daily Note' }
        });
    }
    
    // Main content container  
    const contentContainer = item.createDiv({ cls: 'note-content' });
    
    // Title
    const title = contentContainer.createDiv({ 
        cls: 'note-title',
        text: note.title
    });
    
    // Tags section (separate from other metadata)
    if (opts.showTags && note.tags && note.tags.length > 0) {
        // Divider line
        const divider = contentContainer.createEl('div', { cls: 'note-divider' });
        
        // Tags line
        const tagsToShow = note.tags.slice(0, opts.maxTags);
        let tagsText = tagsToShow.map(tag => `#${tag}`).join(' ');
        
        // Add "more tags" indicator if there are additional tags
        if (note.tags.length > opts.maxTags) {
            tagsText += ` +${note.tags.length - opts.maxTags}`;
        }
        
        const tagsLine = contentContainer.createEl('div', { 
            cls: 'note-tags-line',
            text: tagsText
        });
    }
    
    // Other metadata (date, path) if needed
    if (opts.showCreatedDate && note.createdDate) {
        const dateStr = note.createdDate.indexOf('T') > 0 
            ? format(new Date(note.createdDate), 'MMM d, yyyy h:mm a') 
            : note.createdDate;
        const dateEl = contentContainer.createDiv({ 
            cls: 'note-metadata-line',
            text: `Created: ${dateStr}`,
            attr: { title: `Created: ${dateStr}` }
        });
    }
    
    if (opts.showPath) {
        const pathEl = contentContainer.createDiv({ 
            cls: 'note-metadata-line',
            text: note.path,
            attr: { title: `Path: ${note.path}` }
        });
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