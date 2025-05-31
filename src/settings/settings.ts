import { App, PluginSettingTab, Setting } from 'obsidian';
import TaskNotesPlugin from '../main';

export interface TaskNotesSettings {
	dailyNotesFolder: string;
	tasksFolder: string;  // Now just a default location for new tasks
	taskTag: string;      // The tag that identifies tasks
	excludedFolders: string;  // Comma-separated list of folders to exclude from Notes tab
	defaultTaskPriority: 'low' | 'normal' | 'high';
	defaultTaskStatus: 'open' | 'in-progress' | 'done';
	taskOrgFiltersCollapsed: boolean;  // Save collapse state of task organization filters
}

export const DEFAULT_SETTINGS: TaskNotesSettings = {
	dailyNotesFolder: 'TaskNotes/Daily',
	tasksFolder: 'TaskNotes/Tasks',
	taskTag: 'task',
	excludedFolders: '',  // Default to no excluded folders
	defaultTaskPriority: 'normal',
	defaultTaskStatus: 'open',
	taskOrgFiltersCollapsed: false  // Default to expanded
};

export class TaskNotesSettingTab extends PluginSettingTab {
	plugin: TaskNotesPlugin;
  
	constructor(app: App, plugin: TaskNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
  
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		
		// General Settings
		new Setting(containerEl)
			.setName('Daily notes folder')
			.setDesc('Folder where daily notes will be stored')
			.addText(text => text
				.setPlaceholder('TaskNotes/Daily')
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Default tasks folder')
			.setDesc('Default folder for new tasks (tasks are identified by tag, not folder)')
			.addText(text => text
				.setPlaceholder('TaskNotes/Tasks')
				.setValue(this.plugin.settings.tasksFolder)
				.onChange(async (value) => {
					this.plugin.settings.tasksFolder = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Comma-separated list of folder paths to exclude from Notes tab (e.g., "Templates,Archive,Attachments")')
			.addText(text => text
				.setPlaceholder('Templates,Archive')
				.setValue(this.plugin.settings.excludedFolders)
				.onChange(async (value) => {
					this.plugin.settings.excludedFolders = value;
					await this.plugin.saveSettings();
				}));
		
		// Task Settings
		new Setting(containerEl).setName('Tasks').setHeading();
		
		new Setting(containerEl)
			.setName('Task tag')
			.setDesc('Tag that identifies notes as tasks (without #)')
			.addText(text => text
				.setPlaceholder('task')
				.setValue(this.plugin.settings.taskTag)
				.onChange(async (value) => {
					this.plugin.settings.taskTag = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Default task priority')
			.setDesc('Default priority for new tasks')
			.addDropdown(dropdown => dropdown
				.addOption('low', 'Low')
				.addOption('normal', 'Normal')
				.addOption('high', 'High')
				.setValue(this.plugin.settings.defaultTaskPriority)
				.onChange(async (value: any) => {
					this.plugin.settings.defaultTaskPriority = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Default task status')
			.setDesc('Default status for new tasks')
			.addDropdown(dropdown => dropdown
				.addOption('open', 'Open')
				.addOption('in-progress', 'In Progress')
				.addOption('done', 'Done')
				.setValue(this.plugin.settings.defaultTaskStatus)
				.onChange(async (value: any) => {
					this.plugin.settings.defaultTaskStatus = value;
					await this.plugin.saveSettings();
				}));
	}
}