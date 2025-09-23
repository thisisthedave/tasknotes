import { App, FuzzySuggestModal, TAbstractFile, TFile, SearchResult, parseFrontMatterAliases, Notice, setTooltip } from 'obsidian';
import type TaskNotesPlugin from '../main';
import { TaskInfo } from 'src/types';
import { ProjectMetadataResolver } from '../utils/projectMetadataResolver';
import { parseDisplayFieldsRow } from '../utils/projectAutosuggestDisplayFieldsParser';
import { getProjectFiles } from 'src/utils/helpers';
import { getProjectPropertyFilter, matchesProjectProperty } from '../utils/projectFilterUtils';

/**
 * Modal for selecting project notes using fuzzy search
 * Based on the existing AttachmentSelectModal pattern
 */
export class ProjectSelectModal extends FuzzySuggestModal<TAbstractFile> {
    private onChoose: (file: TAbstractFile) => void;
    private onRemove: (file: TAbstractFile) => void;
    private plugin: TaskNotesPlugin;
    private removalEl: HTMLDivElement;
    selectedProjectFiles: TAbstractFile[];

    constructor(
        app: App, 
        plugin: TaskNotesPlugin, 
        onChoose: (file: TAbstractFile) => void, 
        onRemove: (file: TAbstractFile) => void = () => {}, 
        selectedProjectFiles: TAbstractFile[] = []) 
    {
        super(app);
        this.plugin = plugin;
        this.onChoose = onChoose;
        this.onRemove = onRemove;
        this.selectedProjectFiles = selectedProjectFiles;

        this.setTitle('Select Project Note');
        this.setPlaceholder('Type to search for project notes...');
        this.setInstructions([
            { command: '↑↓', purpose: 'to navigate' },
            { command: '↵', purpose: 'to select' },
            { command: 'esc', purpose: 'to cancel' }
        ]);
    }

    // --- inject custom content above the suggestion list ---
    onOpen() {
        super.onOpen();
        
        this.containerEl.addClass('tasknotes-plugin', 'minimalist-task-modal');

        const resultsContainer = this.modalEl.querySelector(".prompt-results");
        if (!resultsContainer) return;

        // Create (or reuse) a container for top content
        this.removalEl = createDiv({ cls: 'task-projects-list' });
        // Insert it just above the suggestions
        this.modalEl.insertBefore(this.removalEl, resultsContainer);

        this.renderRemovals();
    }    

    getItems(): TAbstractFile[] {
        const allFiles = this.app.vault.getAllLoadedFiles().filter(file => 
            file instanceof TFile && file.extension === 'md' && !file.path.includes('.trash')
        );

        // Get filtering settings
        const requiredTags = this.plugin.settings?.projectAutosuggest?.requiredTags ?? [];
        const includeFolders = this.plugin.settings?.projectAutosuggest?.includeFolders ?? [];
        const propertyFilter = getProjectPropertyFilter(this.plugin.settings?.projectAutosuggest);

        // Apply filtering if any filters are configured
        if (requiredTags.length === 0 && includeFolders.length === 0 && !propertyFilter.enabled) {
            return allFiles; // No filtering needed
        }

        return allFiles.filter(file => {
            if (!(file instanceof TFile)) return false;
            
            const cache = this.app.metadataCache.getFileCache(file);

            // Apply tag filtering - use native Obsidian API
            if (requiredTags.length > 0) {
                // Get tags from both native tag detection and frontmatter
                const nativeTags = cache?.tags?.map(t => t.tag.replace('#', '')) || [];
                const frontmatterTags = cache?.frontmatter?.tags || [];
                const allTags = [
                    ...nativeTags,
                    ...(Array.isArray(frontmatterTags) ? frontmatterTags : [frontmatterTags].filter(Boolean))
                ];
                
                // Check if file has ANY of the required tags
                const hasRequiredTag = requiredTags.some(reqTag => allTags.includes(reqTag));
                if (!hasRequiredTag) {
                    return false; // Skip this file
                }
            }

            // Apply folder filtering
            if (includeFolders.length > 0) {
                const isInIncludedFolder = includeFolders.some(folder => 
                    file.path.startsWith(folder) || file.path.startsWith(folder + '/')
                );
                if (!isInIncludedFolder) {
                    return false; // Skip this file
                }
            }

            if (propertyFilter.enabled) {
                const frontmatter = cache?.frontmatter;
                if (!matchesProjectProperty(frontmatter, propertyFilter)) {
                    return false;
                }
            }

            return true; // File passed all filters
        });
    }

    getItemText(file: TAbstractFile): string {
        if (!(file instanceof TFile)) {
            return file.name;
        }
        
        let text = `${file.name} ${file.path}`;
        
        // Use the same searchable fields as the inline autosuggest
        const rows = this.plugin.settings?.projectAutosuggest?.rows ?? [];
        const searchableFields = new Set<string>();
        
        // Parse searchable fields from configuration
        for (const row of rows) {
            try {
                const tokens = parseDisplayFieldsRow(row);
                for (const token of tokens) {
                    if ((token as any).searchable && !token.property.startsWith('literal:')) {
                        searchableFields.add(token.property);
                    }
                }
            } catch {
                // Ignore parse errors
            }
        }
        
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter) {
            const mapped = this.plugin.fieldMapper.mapFromFrontmatter(cache.frontmatter, file.path, this.plugin.settings.storeTitleInFilename);
            
            // Always include title and aliases (default searchable)
            const title = typeof mapped.title === 'string' ? mapped.title : '';
            if (title) {
                text += ` ${title}`;
            }
            
            const aliases = parseFrontMatterAliases(cache.frontmatter) || [];
            if (Array.isArray(aliases) && aliases.length > 0) {
                text += ` ${aliases.join(' ')}`;
            }
            
            // Add additional searchable fields based on configuration
            for (const fieldKey of searchableFields) {
                let value = '';
                
                switch (fieldKey) {
                    case 'file.path':
                        value = file.path;
                        break;
                    case 'file.parent':
                        value = file.parent?.name || '';
                        break;
                    case 'file.basename':
                        value = file.basename; // Already included as file.name
                        break;
                    case 'title':
                    case 'aliases':
                        // Already handled above
                        break;
                    default:
                        // Custom frontmatter field
                        const customValue = cache.frontmatter[fieldKey];
                        if (customValue != null) {
                            value = Array.isArray(customValue) ? customValue.join(' ') : String(customValue);
                        }
                        break;
                }
                
                if (value) {
                    text += ` ${value}`;
                }
            }
        }
        
        return text;
    }

    renderSuggestion(value: { item: TAbstractFile; match: SearchResult }, el: HTMLElement) {
        const file = value.item;
        el.empty();
        
        if (!(file instanceof TFile)) {
            // Fallback for non-TFile items
            el.textContent = file.name;
            return;
        }
        
        const container = el.createDiv({ cls: 'project-suggestion' });
        
        // Use the same configurable display as the inline autosuggest
        const rowConfigs = (this.plugin.settings?.projectAutosuggest?.rows ?? []).slice(0, 3);
        
        if (rowConfigs.length === 0) {
            // Fallback to simple display if no config
            container.createSpan({ cls: 'project-name', text: file.basename });
            return;
        }
        
        try {
            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter || {};
            const mapped = this.plugin.fieldMapper.mapFromFrontmatter(frontmatter, file.path, this.plugin.settings.storeTitleInFilename);
            
            // Derive title and aliases for display
            const title = typeof mapped.title === 'string' ? mapped.title : '';
            const aliasesFm = parseFrontMatterAliases(frontmatter) || [];
            const aliases = Array.isArray(aliasesFm) ? aliasesFm.filter(a => typeof a === 'string') as string[] : [];
            
            const fileData = {
                basename: file.basename,
                name: file.name,
                path: file.path,
                parent: file.parent?.path || '',
                title,
                aliases,
                frontmatter: frontmatter
            };
            
            const resolver = new ProjectMetadataResolver({
                getFrontmatter: () => frontmatter,
            });
            
            // Always show filename first
            const filenameEl = container.createDiv({ cls: 'project-name', text: file.basename });
            
            // Render configured rows
            for (let i = 0; i < Math.min(rowConfigs.length, 3); i++) {
                const row = rowConfigs[i];
                if (!row) continue;
                
                try {
                    const tokens = parseDisplayFieldsRow(row);
                    const parts: string[] = [];
                    
                    for (const token of tokens) {
                        if (token.property.startsWith('literal:')) {
                            parts.push(token.property.slice(8));
                            continue;
                        }
                        
                        const value = resolver.resolve(token.property, fileData) || '';
                        if (!value) continue;
                        
                        if (token.showName) {
                            const label = token.displayName ?? token.property;
                            parts.push(`${label}: ${value}`);
                        } else {
                            parts.push(value);
                        }
                    }
                    
                    const line = parts.join(' ');
                    if (line.trim()) {
                        const metaEl = container.createDiv({ cls: 'project-meta' });
                        metaEl.textContent = line;
                    }
                } catch {
                    // Skip invalid rows
                }
            }
        } catch (error) {
            console.error('Error rendering project suggestion:', error);
            // Fallback to simple display
            container.createSpan({ cls: 'project-name', text: file.basename });
        }
    }

    onChooseItem(file: TAbstractFile, evt: MouseEvent | KeyboardEvent) {
        this.onChoose(file);
    }

    onRemoveItem(file: TAbstractFile, evt: MouseEvent | KeyboardEvent) {
        this.onRemove(file);
    }

    private renderRemovals() {
        if (!this.removalEl) return;
        
        this.removalEl.empty();

        if (this.selectedProjectFiles.length === 0) {
            return;
        }

        this.selectedProjectFiles.forEach(file => {
            const projectEl = renderProjectItem(this.removalEl, file, this.plugin.i18n.translate('modals.task.projectsRemoveTooltip'), (file, evt) => {
                this.onRemoveItem(file, evt);
                projectEl.remove();
            });
        });
    }
}

export function showProjectModal(
    plugin: TaskNotesPlugin,
    tasks: TaskInfo[]
): void {
    if (tasks && tasks.length > 0) {
        const projectStrings = [...new Set(tasks.flatMap(t => t.projects).filter(p => p !== undefined))] as string[];
        const currentProjects = getProjectFiles(projectStrings, this.app)
        const modal = new ProjectSelectModal(plugin.app, plugin, async (file) => {
            try {
                // fileToLinktext expects TFile, so cast safely since we know these are markdown files
                const updates = tasks.map(task => {
                    const linkText = plugin.app.metadataCache.fileToLinktext(file as TFile, task.path || '', true);
                    const projectLink = `[[${linkText}]]`;
                    
                    if (task.projects && task.projects.includes(projectLink)) {
                        return Promise.resolve(); // Already includes this project, skip
                    }

                    // add the project link to the task's projects
                    return plugin.updateTaskProperty(task, 'projects', [...(task.projects || []), projectLink]);
                });

                // Wait for all updates to complete
                await Promise.all(updates);
            } catch (error) {
                console.error('Error updating projects:', error);
                new Notice('Failed to update projects');
            }
        },
        async (file) => {
            try {
                // fileToLinktext expects TFile, so cast safely since we know these are markdown files
                const removals = tasks.map(task => {
                    const linkText = plugin.app.metadataCache.fileToLinktext(file as TFile, task.path || '', true);
                    const projectLink = `[[${linkText}]]`;
                    
                    if (task.projects) {
                        const updatedProjects = (task.projects).filter(p => p !== projectLink);
                        // remove the project link from the task's projects
                        if (updatedProjects.length !== task.projects.length) {
                            return plugin.updateTaskProperty(task, 'projects', updatedProjects);
                        }
                    }

                    return Promise.resolve(); // Task doesn't have this project, skip
                });

                // Wait for all updates to complete
                await Promise.all(removals);
            } catch (error) {
                console.error('Error removing project:', error);
                new Notice('Failed to remove project');
            }
        }, currentProjects as TAbstractFile[]);
        modal.open();
    }
}

export function renderProjectItem(
    projectsList: HTMLElement, 
    file: TAbstractFile,
    removeTooltip: string,
    onRemove: (file: TAbstractFile, evt: MouseEvent | KeyboardEvent) => void
): HTMLElement {
    const projectItem = projectsList.createDiv({ cls: 'task-project-item' });
    
    // Info container
    const infoEl = projectItem.createDiv({ cls: 'task-project-info' });
    
    // File name
    const nameEl = infoEl.createSpan({ cls: 'task-project-name' });
    nameEl.textContent = file.name;
    
    // File path (if different from name)
    if (file.path !== file.name) {
        const pathEl = infoEl.createDiv({ cls: 'task-project-path' });
        pathEl.textContent = file.path;
    }
    
    // Remove button
    const removeBtn = projectItem.createEl('button', { 
        cls: 'task-project-remove',
        text: '×'
    });
    setTooltip(removeBtn, removeTooltip, { placement: 'top' });
    removeBtn.addEventListener('click', (evt) => {
        onRemove(file, evt);
    });

    return projectItem;
}
