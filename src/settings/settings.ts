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
	// Task filename settings
	taskFilenameFormat: 'title' | 'zettel' | 'timestamp' | 'custom';
	customFilenameTemplate: string; // Template for custom format
	// Pomodoro settings
	pomodoroWorkDuration: number; // minutes
	pomodoroShortBreakDuration: number; // minutes
	pomodoroLongBreakDuration: number; // minutes
	pomodoroLongBreakInterval: number; // after X pomodoros
	pomodoroAutoStartBreaks: boolean;
	pomodoroAutoStartWork: boolean;
	pomodoroNotifications: boolean;
	pomodoroSoundEnabled: boolean;
	pomodoroSoundVolume: number; // 0-100
}

export const DEFAULT_SETTINGS: TaskNotesSettings = {
	dailyNotesFolder: 'TaskNotes/Daily',
	tasksFolder: 'TaskNotes/Tasks',
	taskTag: 'task',
	excludedFolders: '',  // Default to no excluded folders
	defaultTaskPriority: 'normal',
	defaultTaskStatus: 'open',
	taskOrgFiltersCollapsed: false,  // Default to expanded
	// Task filename defaults
	taskFilenameFormat: 'zettel',  // Keep existing behavior as default
	customFilenameTemplate: '{title}',  // Simple title template
	// Pomodoro defaults
	pomodoroWorkDuration: 25,
	pomodoroShortBreakDuration: 5,
	pomodoroLongBreakDuration: 15,
	pomodoroLongBreakInterval: 4,
	pomodoroAutoStartBreaks: true,
	pomodoroAutoStartWork: false,
	pomodoroNotifications: true,
	pomodoroSoundEnabled: true,
	pomodoroSoundVolume: 50
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
		new Setting(containerEl).setName('Task defaults').setHeading();
		
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
				.addOption('in-progress', 'In progress')
				.addOption('done', 'Done')
				.setValue(this.plugin.settings.defaultTaskStatus)
				.onChange(async (value: any) => {
					this.plugin.settings.defaultTaskStatus = value;
					await this.plugin.saveSettings();
				}));

		// Task Filename Settings
		new Setting(containerEl).setName('Task filenames').setHeading();

		new Setting(containerEl)
			.setName('Filename format')
			.setDesc('How task filenames should be generated')
			.addDropdown(dropdown => dropdown
				.addOption('title', 'Task title')
				.addOption('zettel', 'Zettelkasten format (YYMMDD + base36 seconds)')
				.addOption('timestamp', 'Full timestamp (YYYY-MM-DD-HHMMSS)')
				.addOption('custom', 'Custom template')
				.setValue(this.plugin.settings.taskFilenameFormat)
				.onChange(async (value: any) => {
					this.plugin.settings.taskFilenameFormat = value;
					await this.plugin.saveSettings();
					this.updateCustomTemplateVisibility();
				}));

		const customTemplateSetting = new Setting(containerEl)
			.setName('Custom filename template')
			.setDesc('Template for custom filenames. Available variables: {title}, {date}, {time}, {priority}, {status}, {timestamp}, {year}, {month}, {day}, {hour}, {minute}, {second}')
			.addText(text => text
				.setPlaceholder('{date}-{title}')
				.setValue(this.plugin.settings.customFilenameTemplate)
				.onChange(async (value) => {
					this.plugin.settings.customFilenameTemplate = value;
					await this.plugin.saveSettings();
				}));

		// Store reference for visibility toggle
		(this as any).customTemplateSetting = customTemplateSetting;
		this.updateCustomTemplateVisibility();

		// Pomodoro Settings
		new Setting(containerEl).setName('Pomodoro timer').setHeading();

		new Setting(containerEl)
			.setName('Work duration')
			.setDesc('Duration of work intervals in minutes')
			.addText(text => text
				.setPlaceholder('25')
				.setValue(this.plugin.settings.pomodoroWorkDuration.toString())
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.pomodoroWorkDuration = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Short break duration')
			.setDesc('Duration of short breaks in minutes')
			.addText(text => text
				.setPlaceholder('5')
				.setValue(this.plugin.settings.pomodoroShortBreakDuration.toString())
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.pomodoroShortBreakDuration = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Long break duration')
			.setDesc('Duration of long breaks in minutes')
			.addText(text => text
				.setPlaceholder('15')
				.setValue(this.plugin.settings.pomodoroLongBreakDuration.toString())
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.pomodoroLongBreakDuration = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Long break interval')
			.setDesc('Take a long break after this many pomodoros')
			.addText(text => text
				.setPlaceholder('4')
				.setValue(this.plugin.settings.pomodoroLongBreakInterval.toString())
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.pomodoroLongBreakInterval = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Auto-start breaks')
			.setDesc('Automatically start break timer after work session')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pomodoroAutoStartBreaks)
				.onChange(async (value) => {
					this.plugin.settings.pomodoroAutoStartBreaks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-start work')
			.setDesc('Automatically start work timer after break')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pomodoroAutoStartWork)
				.onChange(async (value) => {
					this.plugin.settings.pomodoroAutoStartWork = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable notifications')
			.setDesc('Show notifications when pomodoro sessions complete')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pomodoroNotifications)
				.onChange(async (value) => {
					this.plugin.settings.pomodoroNotifications = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable sound')
			.setDesc('Play sound when pomodoro sessions complete')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pomodoroSoundEnabled)
				.onChange(async (value) => {
					this.plugin.settings.pomodoroSoundEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sound volume')
			.setDesc('Volume for completion sounds (0-100)')
			.addSlider(slider => slider
				.setLimits(0, 100, 5)
				.setValue(this.plugin.settings.pomodoroSoundVolume)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.pomodoroSoundVolume = value;
					await this.plugin.saveSettings();
				}));
	}

	private updateCustomTemplateVisibility() {
		const customSetting = (this as any).customTemplateSetting as Setting;
		if (customSetting) {
			if (this.plugin.settings.taskFilenameFormat === 'custom') {
				customSetting.settingEl.style.display = '';
			} else {
				customSetting.settingEl.style.display = 'none';
			}
		}
	}
}