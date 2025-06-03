import { App, PluginSettingTab, Setting } from 'obsidian';
import TaskNotesPlugin from '../main';
import { FieldMapping, StatusConfig, PriorityConfig } from '../types';
import { StatusManager } from '../services/StatusManager';
import { PriorityManager } from '../services/PriorityManager';

export interface TaskNotesSettings {
	dailyNotesFolder: string;
	tasksFolder: string;  // Now just a default location for new tasks
	taskTag: string;      // The tag that identifies tasks
	excludedFolders: string;  // Comma-separated list of folders to exclude from Notes tab
	defaultTaskPriority: string;  // Changed to string to support custom priorities
	defaultTaskStatus: string;    // Changed to string to support custom statuses
	taskOrgFiltersCollapsed: boolean;  // Save collapse state of task organization filters
	// Daily note settings
	dailyNoteTemplate: string; // Path to template file for daily notes
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
	// Customization settings
	fieldMapping: FieldMapping;
	customStatuses: StatusConfig[];
	customPriorities: PriorityConfig[];
}

// Default field mapping maintains backward compatibility
export const DEFAULT_FIELD_MAPPING: FieldMapping = {
	title: 'title',
	status: 'status',
	priority: 'priority',
	due: 'due',
	contexts: 'contexts',
	timeEstimate: 'timeEstimate',
	timeSpent: 'timeSpent',
	completedDate: 'completedDate',
	dateCreated: 'dateCreated',
	dateModified: 'dateModified',
	recurrence: 'recurrence',
	archiveTag: 'archived'
};

// Default status configuration matches current hardcoded behavior
export const DEFAULT_STATUSES: StatusConfig[] = [
	{
		id: 'open',
		value: 'open',
		label: 'Open',
		color: '#808080',
		isCompleted: false,
		order: 1
	},
	{
		id: 'in-progress',
		value: 'in-progress',
		label: 'In progress',
		color: '#0066cc',
		isCompleted: false,
		order: 2
	},
	{
		id: 'done',
		value: 'done',
		label: 'Done',
		color: '#00aa00',
		isCompleted: true,
		order: 3
	}
];

// Default priority configuration matches current hardcoded behavior
export const DEFAULT_PRIORITIES: PriorityConfig[] = [
	{
		id: 'low',
		value: 'low',
		label: 'Low',
		color: '#00aa00',
		weight: 1
	},
	{
		id: 'normal',
		value: 'normal',
		label: 'Normal',
		color: '#ffaa00',
		weight: 2
	},
	{
		id: 'high',
		value: 'high',
		label: 'High',
		color: '#ff0000',
		weight: 3
	}
];

export const DEFAULT_SETTINGS: TaskNotesSettings = {
	dailyNotesFolder: 'TaskNotes/Daily',
	tasksFolder: 'TaskNotes/Tasks',
	taskTag: 'task',
	excludedFolders: '',  // Default to no excluded folders
	defaultTaskPriority: 'normal',
	defaultTaskStatus: 'open',
	taskOrgFiltersCollapsed: false,  // Default to expanded
	// Daily note defaults
	dailyNoteTemplate: '',  // Empty = use built-in template
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
	pomodoroSoundVolume: 50,
	// Customization defaults
	fieldMapping: DEFAULT_FIELD_MAPPING,
	customStatuses: DEFAULT_STATUSES,
	customPriorities: DEFAULT_PRIORITIES
};

export class TaskNotesSettingTab extends PluginSettingTab {
	plugin: TaskNotesPlugin;
	private activeTab: string = 'general';
	private tabContents: Record<string, HTMLElement> = {};
  
	constructor(app: App, plugin: TaskNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
  
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		
		// Create tab navigation
		const tabNav = containerEl.createDiv('settings-tab-nav');
		
		const tabs = [
			{ id: 'general', name: 'Basic setup' },
			{ id: 'field-mapping', name: 'Field mapping' },
			{ id: 'statuses', name: 'Statuses' },
			{ id: 'priorities', name: 'Priorities' },
			{ id: 'daily-notes', name: 'Daily notes' },
			{ id: 'pomodoro', name: 'Pomodoro' }
		];
		
		tabs.forEach(tab => {
			const tabButton = tabNav.createEl('button', {
				text: tab.name,
				cls: this.activeTab === tab.id ? 'settings-tab-button active' : 'settings-tab-button'
			});
			
			tabButton.addEventListener('click', () => {
				this.switchTab(tab.id);
			});
		});
		
		// Create tab content containers
		const tabContentsEl = containerEl.createDiv('settings-tab-contents');
		
		// Create all tab content containers
		tabs.forEach(tab => {
			const tabContent = tabContentsEl.createDiv('settings-tab-content');
			if (this.activeTab === tab.id) {
				tabContent.addClass('active');
			}
			this.tabContents[tab.id] = tabContent;
		});
		
		this.renderActiveTab();
	}
	
	private switchTab(tabId: string): void {
		this.activeTab = tabId;
		this.display(); // Re-render the entire settings tab
	}
	
	private renderActiveTab(): void {
		// Clear current tab content
		Object.values(this.tabContents).forEach(content => content.empty());
		
		switch (this.activeTab) {
			case 'general':
				this.renderGeneralTab();
				break;
			case 'field-mapping':
				this.renderFieldMappingTab();
				break;
			case 'statuses':
				this.renderStatusesTab();
				break;
			case 'priorities':
				this.renderPrioritiesTab();
				break;
			case 'daily-notes':
				this.renderDailyNotesTab();
				break;
			case 'pomodoro':
				this.renderPomodoroTab();
				break;
		}
	}
	
	private renderGeneralTab(): void {
		const container = this.tabContents['general'];
		
		new Setting(container)
			.setName('Default tasks folder')
			.setDesc('Default folder for new tasks (tasks are identified by tag, not folder)')
			.addText(text => text
				.setPlaceholder('TaskNotes/Tasks')
				.setValue(this.plugin.settings.tasksFolder)
				.onChange(async (value) => {
					this.plugin.settings.tasksFolder = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(container)
			.setName('Task tag')
			.setDesc('Tag that identifies notes as tasks (without #)')
			.addText(text => text
				.setPlaceholder('task')
				.setValue(this.plugin.settings.taskTag)
				.onChange(async (value) => {
					this.plugin.settings.taskTag = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(container)
			.setName('Excluded folders')
			.setDesc('Comma-separated list of folder paths to exclude from Notes tab')
			.addText(text => text
				.setPlaceholder('Templates,Archive')
				.setValue(this.plugin.settings.excludedFolders)
				.onChange(async (value) => {
					this.plugin.settings.excludedFolders = value;
					await this.plugin.saveSettings();
				}));
		
		// Task defaults section
		new Setting(container).setName('Task defaults').setHeading();
		
		new Setting(container)
			.setName('Default task status')
			.setDesc('Default status for new tasks')
			.addDropdown(dropdown => {
				// Populate with custom statuses
				this.plugin.settings.customStatuses.forEach(status => {
					dropdown.addOption(status.value, status.label);
				});
				return dropdown
					.setValue(this.plugin.settings.defaultTaskStatus)
					.onChange(async (value: any) => {
						this.plugin.settings.defaultTaskStatus = value;
						await this.plugin.saveSettings();
					});
			});
		
		new Setting(container)
			.setName('Default task priority')
			.setDesc('Default priority for new tasks')
			.addDropdown(dropdown => {
				// Populate with custom priorities
				this.plugin.settings.customPriorities.forEach(priority => {
					dropdown.addOption(priority.value, priority.label);
				});
				return dropdown
					.setValue(this.plugin.settings.defaultTaskPriority)
					.onChange(async (value: any) => {
						this.plugin.settings.defaultTaskPriority = value;
						await this.plugin.saveSettings();
					});
			});
		
		// Task filename settings
		new Setting(container).setName('Task filenames').setHeading();

		new Setting(container)
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
					this.renderActiveTab(); // Re-render to update visibility
				}));

		if (this.plugin.settings.taskFilenameFormat === 'custom') {
			new Setting(container)
				.setName('Custom filename template')
				.setDesc('Template for custom filenames. Available variables: {title}, {date}, {time}, {priority}, {status}, {timestamp}, etc.')
				.addText(text => text
					.setPlaceholder('{date}-{title}')
					.setValue(this.plugin.settings.customFilenameTemplate)
					.onChange(async (value) => {
						this.plugin.settings.customFilenameTemplate = value;
						await this.plugin.saveSettings();
					}));
		}
	}
	
	private renderFieldMappingTab(): void {
		const container = this.tabContents['field-mapping'];
		
		// Warning message
		const warning = container.createDiv('settings-warning');
		const warningIcon = warning.createEl('strong', { text: '⚠️ Warning:' });
		warning.createSpan({ text: ' TaskNotes will read AND write using these property names. Changing these after creating tasks may cause inconsistencies.' });
		
		container.createEl('h3', { text: 'Field mapping' });
		container.createEl('p', { 
			text: 'Configure which frontmatter properties TaskNotes should use for each field.'
		});
		
		// Create mapping table
		const table = container.createEl('table', { cls: 'settings-table' });
		
		const header = table.createEl('tr');
		header.createEl('th', { text: 'TaskNotes field' });
		header.createEl('th', { text: 'Your property name' });
		
		const fieldMappings: Array<[keyof FieldMapping, string]> = [
			['title', 'Title'],
			['status', 'Status'],
			['priority', 'Priority'],
			['due', 'Due date'],
			['contexts', 'Contexts'],
			['timeEstimate', 'Time estimate'],
			['timeSpent', 'Time spent'],
			['completedDate', 'Completed date'],
			['dateCreated', 'Created date'],
			['dateModified', 'Modified date'],
			['recurrence', 'Recurrence'],
			['archiveTag', 'Archive tag']
		];
		
		fieldMappings.forEach(([field, label]) => {
			const row = table.createEl('tr');
			const labelCell = row.createEl('td');
			labelCell.textContent = label;
			
			const inputCell = row.createEl('td');
			
			const input = inputCell.createEl('input', {
				type: 'text',
				value: this.plugin.settings.fieldMapping[field]
			});
			
			input.addEventListener('change', async () => {
				this.plugin.settings.fieldMapping[field] = input.value;
				await this.plugin.saveSettings();
			});
		});
		
		// Reset button
		new Setting(container)
			.setName('Reset to defaults')
			.setDesc('Reset all field mappings to default values')
			.addButton(button => button
				.setButtonText('Reset')
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.fieldMapping = { ...DEFAULT_FIELD_MAPPING };
					await this.plugin.saveSettings();
					this.renderActiveTab();
				}));
	}
	
	private renderStatusesTab(): void {
		const container = this.tabContents['statuses'];
		
		container.createEl('h3', { text: 'Task statuses' });
		container.createEl('p', { 
			text: 'Define the statuses available for your tasks. The order determines the cycling sequence.'
		});
		
		// Status list
		const statusList = container.createDiv('settings-list');
		
		this.renderStatusList(statusList);
		
		// Add status button
		new Setting(container)
			.setName('Add new status')
			.addButton(button => button
				.setButtonText('Add status')
				.onClick(async () => {
					const newStatus = StatusManager.createDefaultStatus(this.plugin.settings.customStatuses);
					this.plugin.settings.customStatuses.push(newStatus);
					await this.plugin.saveSettings();
					this.renderActiveTab();
				}));
	}
	
	private renderStatusList(container: HTMLElement): void {
		container.empty();
		
		const sortedStatuses = [...this.plugin.settings.customStatuses].sort((a, b) => a.order - b.order);
		
		sortedStatuses.forEach((status, index) => {
			const statusRow = container.createDiv('settings-item-row');
			
			// Color indicator
			const colorIndicator = statusRow.createDiv('settings-color-indicator');
			colorIndicator.style.backgroundColor = status.color; // Keep this - user color
			
			// Status value input
			const valueInput = statusRow.createEl('input', {
				type: 'text',
				value: status.value,
				cls: 'settings-input value-input'
			});
			
			// Status label input
			const labelInput = statusRow.createEl('input', {
				type: 'text',
				value: status.label,
				cls: 'settings-input label-input'
			});
			
			// Color input
			const colorInput = statusRow.createEl('input', {
				type: 'color',
				value: status.color,
				cls: 'settings-input color-input'
			});
			
			// Completed checkbox
			const completedLabel = statusRow.createEl('label', { cls: 'settings-checkbox-label' });
			
			const completedCheckbox = completedLabel.createEl('input', {
				type: 'checkbox'
			});
			completedCheckbox.checked = status.isCompleted;
			
			completedLabel.createSpan({ text: 'Completed' });
			
			// Delete button
			const deleteButton = statusRow.createEl('button', {
				text: 'Delete',
				cls: 'settings-delete-button'
			});
			
			// Event listeners
			const updateStatus = async () => {
				status.value = valueInput.value;
				status.label = labelInput.value;
				status.color = colorInput.value;
				status.isCompleted = completedCheckbox.checked;
				await this.plugin.saveSettings();
				colorIndicator.style.backgroundColor = status.color;
			};
			
			valueInput.addEventListener('change', updateStatus);
			labelInput.addEventListener('change', updateStatus);
			colorInput.addEventListener('change', updateStatus);
			completedCheckbox.addEventListener('change', updateStatus);
			
			deleteButton.addEventListener('click', async () => {
				if (this.plugin.settings.customStatuses.length <= 2) {
					alert('You must have at least 2 statuses');
					return;
				}
				
				const statusIndex = this.plugin.settings.customStatuses.findIndex(s => s.id === status.id);
				if (statusIndex !== -1) {
					this.plugin.settings.customStatuses.splice(statusIndex, 1);
					await this.plugin.saveSettings();
					this.renderActiveTab();
				}
			});
		});
	}
	
	private renderPrioritiesTab(): void {
		const container = this.tabContents['priorities'];
		
		container.createEl('h3', { text: 'Task priorities' });
		container.createEl('p', { 
			text: 'Define the priority levels for your tasks. Higher weight = higher priority.'
		});
		
		// Priority list
		const priorityList = container.createDiv('settings-list');
		
		this.renderPriorityList(priorityList);
		
		// Add priority button
		new Setting(container)
			.setName('Add new priority')
			.addButton(button => button
				.setButtonText('Add priority')
				.onClick(async () => {
					const newPriority = PriorityManager.createDefaultPriority(this.plugin.settings.customPriorities);
					this.plugin.settings.customPriorities.push(newPriority);
					await this.plugin.saveSettings();
					this.renderActiveTab();
				}));
	}
	
	private renderPriorityList(container: HTMLElement): void {
		container.empty();
		
		const sortedPriorities = [...this.plugin.settings.customPriorities].sort((a, b) => b.weight - a.weight);
		
		sortedPriorities.forEach((priority, index) => {
			const priorityRow = container.createDiv('settings-item-row');
			
			// Color indicator
			const colorIndicator = priorityRow.createDiv('settings-color-indicator');
			colorIndicator.style.backgroundColor = priority.color; // Keep this - user color
			
			// Priority value input
			const valueInput = priorityRow.createEl('input', {
				type: 'text',
				value: priority.value,
				cls: 'settings-input value-input'
			});
			
			// Priority label input
			const labelInput = priorityRow.createEl('input', {
				type: 'text',
				value: priority.label,
				cls: 'settings-input label-input'
			});
			
			// Color input
			const colorInput = priorityRow.createEl('input', {
				type: 'color',
				value: priority.color,
				cls: 'settings-input color-input'
			});
			
			// Weight input
			const weightInput = priorityRow.createEl('input', {
				type: 'number',
				value: priority.weight.toString(),
				cls: 'settings-input weight-input'
			});
			
			// Delete button
			const deleteButton = priorityRow.createEl('button', {
				text: 'Delete',
				cls: 'settings-delete-button'
			});
			
			// Event listeners
			const updatePriority = async () => {
				priority.value = valueInput.value;
				priority.label = labelInput.value;
				priority.color = colorInput.value;
				priority.weight = parseInt(weightInput.value) || 0;
				await this.plugin.saveSettings();
				colorIndicator.style.backgroundColor = priority.color;
			};
			
			valueInput.addEventListener('change', updatePriority);
			labelInput.addEventListener('change', updatePriority);
			colorInput.addEventListener('change', updatePriority);
			weightInput.addEventListener('change', updatePriority);
			
			deleteButton.addEventListener('click', async () => {
				if (this.plugin.settings.customPriorities.length <= 1) {
					alert('You must have at least 1 priority');
					return;
				}
				
				const priorityIndex = this.plugin.settings.customPriorities.findIndex(p => p.id === priority.id);
				if (priorityIndex !== -1) {
					this.plugin.settings.customPriorities.splice(priorityIndex, 1);
					await this.plugin.saveSettings();
					this.renderActiveTab();
				}
			});
		});
	}
	
	private renderDailyNotesTab(): void {
		const container = this.tabContents['daily-notes'];
		
		new Setting(container)
			.setName('Daily notes folder')
			.setDesc('Folder where daily notes will be stored')
			.addText(text => text
				.setPlaceholder('TaskNotes/Daily')
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('Daily note template')
			.setDesc('Path to template file for daily notes (leave empty to use built-in template). Supports Obsidian template variables like {{title}}, {{date}}, {{date:format}}, {{time}}, etc.')
			.addText(text => text
				.setPlaceholder('Templates/Daily Note Template.md')
				.setValue(this.plugin.settings.dailyNoteTemplate)
				.onChange(async (value) => {
					this.plugin.settings.dailyNoteTemplate = value;
					await this.plugin.saveSettings();
				}));
	}
	
	private renderPomodoroTab(): void {
		const container = this.tabContents['pomodoro'];
		
		new Setting(container)
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

		new Setting(container)
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

		new Setting(container)
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

		new Setting(container)
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

		new Setting(container)
			.setName('Auto-start breaks')
			.setDesc('Automatically start break timer after work session')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pomodoroAutoStartBreaks)
				.onChange(async (value) => {
					this.plugin.settings.pomodoroAutoStartBreaks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('Auto-start work')
			.setDesc('Automatically start work timer after break')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pomodoroAutoStartWork)
				.onChange(async (value) => {
					this.plugin.settings.pomodoroAutoStartWork = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('Enable notifications')
			.setDesc('Show notifications when pomodoro sessions complete')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pomodoroNotifications)
				.onChange(async (value) => {
					this.plugin.settings.pomodoroNotifications = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('Enable sound')
			.setDesc('Play sound when pomodoro sessions complete')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.pomodoroSoundEnabled)
				.onChange(async (value) => {
					this.plugin.settings.pomodoroSoundEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
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
}