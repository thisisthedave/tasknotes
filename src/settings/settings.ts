import { App, PluginSettingTab, Setting } from 'obsidian';
import ChronoSyncPlugin from '../main';

export interface ChronoSyncSettings {
	dailyNotesFolder: string;
	tasksFolder: string;
	notesFolder: string;
	homeNotePath: string;
	defaultTaskPriority: 'low' | 'normal' | 'high';
	defaultTaskStatus: 'open' | 'in-progress' | 'done';
	timeblockStartTime: string;
	timeblockEndTime: string;
	timeblockInterval: '30' | '60';
	autoAddTimeblock: boolean;
}

export const DEFAULT_SETTINGS: ChronoSyncSettings = {
	dailyNotesFolder: 'ChronoSync/Daily',
	tasksFolder: 'ChronoSync/Tasks',
	notesFolder: 'ChronoSync/Notes',
	homeNotePath: 'ChronoSync/Home.md',
	defaultTaskPriority: 'normal',
	defaultTaskStatus: 'open',
	timeblockStartTime: '05:00',
	timeblockEndTime: '23:30',
	timeblockInterval: '30',
	autoAddTimeblock: true
};

export class ChronoSyncSettingTab extends PluginSettingTab {
	plugin: ChronoSyncPlugin;
  
	constructor(app: App, plugin: ChronoSyncPlugin) {
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
				.setPlaceholder('ChronoSync/Daily')
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Tasks folder')
			.setDesc('Folder where tasks will be stored')
			.addText(text => text
				.setPlaceholder('ChronoSync/Tasks')
				.setValue(this.plugin.settings.tasksFolder)
				.onChange(async (value) => {
					this.plugin.settings.tasksFolder = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Notes folder')
			.setDesc('Folder where general notes will be stored (use "/" for vault root)')
			.addText(text => text
				.setPlaceholder('ChronoSync/Notes')
				.setValue(this.plugin.settings.notesFolder)
				.onChange(async (value) => {
					this.plugin.settings.notesFolder = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Home note path')
			.setDesc('Path to the home note file')
			.addText(text => text
				.setPlaceholder('ChronoSync/Home.md')
				.setValue(this.plugin.settings.homeNotePath)
				.onChange(async (value) => {
					this.plugin.settings.homeNotePath = value;
					await this.plugin.saveSettings();
				}));
		
		// Task Settings
		new Setting(containerEl).setName('Tasks').setHeading();
		
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
		
		// Timeblock Settings
		new Setting(containerEl).setName('Timeblocks').setHeading();
		
		new Setting(containerEl)
			.setName('Default timeblock start time')
			.setDesc('Start time for timeblock table (HH:MM format)')
			.addText(text => text
				.setPlaceholder('05:00')
				.setValue(this.plugin.settings.timeblockStartTime)
				.onChange(async (value) => {
					this.plugin.settings.timeblockStartTime = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Default timeblock end time')
			.setDesc('End time for timeblock table (HH:MM format)')
			.addText(text => text
				.setPlaceholder('23:30')
				.setValue(this.plugin.settings.timeblockEndTime)
				.onChange(async (value) => {
					this.plugin.settings.timeblockEndTime = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Timeblock interval')
			.setDesc('Interval between timeblock entries')
			.addDropdown(dropdown => dropdown
				.addOption('30', '30 minutes')
				.addOption('60', '1 hour')
				.setValue(this.plugin.settings.timeblockInterval)
				.onChange(async (value: any) => {
					this.plugin.settings.timeblockInterval = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Auto-add timeblock')
			.setDesc('Automatically add timeblock table to new daily notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoAddTimeblock)
				.onChange(async (value) => {
					this.plugin.settings.autoAddTimeblock = value;
					await this.plugin.saveSettings();
				}));
	}
}