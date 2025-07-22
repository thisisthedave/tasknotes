import { App, FuzzySuggestModal, TAbstractFile, TFile, SearchResult, parseFrontMatterAliases } from 'obsidian';
import type TaskNotesPlugin from '../main';

/**
 * Modal for selecting project notes using fuzzy search
 * Based on the existing AttachmentSelectModal pattern
 */
export class ProjectSelectModal extends FuzzySuggestModal<TAbstractFile> {
    private onChoose: (file: TAbstractFile) => void;
    private plugin: TaskNotesPlugin;

    constructor(app: App, plugin: TaskNotesPlugin, onChoose: (file: TAbstractFile) => void) {
        super(app);
        this.plugin = plugin;
        this.onChoose = onChoose;
        this.setPlaceholder('Type to search for project notes...');
        this.setInstructions([
            { command: '↑↓', purpose: 'to navigate' },
            { command: '↵', purpose: 'to select' },
            { command: 'esc', purpose: 'to cancel' }
        ]);
    }

    getItems(): TAbstractFile[] {
        return this.app.vault.getAllLoadedFiles().filter(file => 
            file instanceof TFile && file.extension === 'md' && !file.path.includes('.trash')
        );
    }

    getItemText(file: TAbstractFile): string {
        let text = `${file.name} ${file.path}`;
        
        // Add aliases to searchable text
        if (file instanceof TFile) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter) {
                const aliases = parseFrontMatterAliases(cache.frontmatter);
                if (aliases && aliases.length > 0) {
                    text += ` ${aliases.join(' ')}`;
                }
            }
        }
        
        return text;
    }

    renderSuggestion(value: { item: TAbstractFile; match: SearchResult }, el: HTMLElement) {
        const file = value.item;
        el.empty();
        
        const container = el.createDiv({ cls: 'project-suggestion' });
        
        // File name (main line)
        const nameEl = container.createSpan({ cls: 'project-name' });
        nameEl.textContent = file.name;
        
        // Title or aliases (second line)
        if (file instanceof TFile) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter) {
                const titleField = this.plugin.fieldMapper.toUserField('title');
                const title = cache.frontmatter[titleField];
                
                if (title) {
                    const titleEl = container.createDiv({ cls: 'project-title' });
                    titleEl.textContent = title;
                } else {
                    const aliases = parseFrontMatterAliases(cache.frontmatter);
                    if (aliases && aliases.length > 0) {
                        const aliasEl = container.createDiv({ cls: 'project-aliases' });
                        aliasEl.textContent = aliases.join(', ');
                    }
                }
            }
        }
        
        // File path (if different from name)
        if (file.path !== file.name) {
            const pathEl = container.createDiv({ cls: 'project-path' });
            pathEl.textContent = file.path;
        }
    }

    onChooseItem(file: TAbstractFile, evt: MouseEvent | KeyboardEvent) {
        this.onChoose(file);
    }
}