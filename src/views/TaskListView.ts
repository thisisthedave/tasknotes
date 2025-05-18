import { View, WorkspaceLeaf } from 'obsidian';
import ChronoSyncPlugin from '../main';
import { TASK_LIST_VIEW_TYPE } from '../types';

export class TaskListView extends View {
	plugin: ChronoSyncPlugin;
  
	constructor(leaf: WorkspaceLeaf, plugin: ChronoSyncPlugin) {
		super(leaf);
		this.plugin = plugin;
	}
  
	getViewType(): string {
		return TASK_LIST_VIEW_TYPE;
	}
  
	getDisplayText(): string {
		return 'Tasks';
	}
  
	getIcon(): string {
		return 'check-square';
	}
  
	async onOpen() {
		// Clear and prepare the content element
		const contentEl = this.containerEl;
		contentEl.empty();
		
		// Add a container for our view content
		const container = contentEl.createDiv({ cls: 'chronosync-container' });
		
		// Create and add UI elements
		container.createEl('h2', { text: 'Tasks' });
		
		// This will be implemented in more detail later
	}
  
	async onClose() {
		// Clean up when the view is closed
		this.containerEl.empty();
	}
}