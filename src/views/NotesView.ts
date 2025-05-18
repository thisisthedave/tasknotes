import { View, WorkspaceLeaf } from 'obsidian';
import ChronoSyncPlugin from '../main';
import { NOTES_VIEW_TYPE } from '../types';

export class NotesView extends View {
	plugin: ChronoSyncPlugin;
  
	constructor(leaf: WorkspaceLeaf, plugin: ChronoSyncPlugin) {
		super(leaf);
		this.plugin = plugin;
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
  
	async onOpen() {
		// Clear and prepare the content element
		const contentEl = this.containerEl;
		contentEl.empty();
		
		// Add a container for our view content
		const container = contentEl.createDiv({ cls: 'chronosync-container' });
		
		// Create and add UI elements
		container.createEl('h2', { text: 'Notes' });
		
		// This will be implemented in more detail later
	}
  
	async onClose() {
		// Clean up when the view is closed
		this.containerEl.empty();
	}
}