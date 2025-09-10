// src/settings/tabs/keyboardShortcutTab.ts
import { Setting, ButtonComponent } from 'obsidian';
import TaskNotesPlugin from '../../main';
import {
  createSectionHeader,
  createHelpText,
  createTextSetting
} from '../components/settingHelpers';
import { KeyboardShortcutAction } from 'src/types/settings';
import { DEFAULT_KEYBOARD_SHORTCUTS } from '../defaults';


const ACTION_LABELS: Record<KeyboardShortcutAction, string> = {
  navigateDown: 'Navigate down',
  navigateUp: 'Navigate up',
  copyTaskTitles: 'Copy selected task titles',
  newTask: 'Create new task',
  focusFilter: 'Focus filter box',
  toggleSelect: 'Toggle selection on focused task',
  selectAll: 'Select all',
  clearFocusAndSelection: 'Clear focus & selection (and close filter popups)',
  openInNewPane: 'Open selected/focused tasks (new pane)',
  openEdit: 'Open focused task editor',
  editDueDates: 'Edit Due date',
  editScheduleDates: 'Edit Scheduled date',
  editPoints: 'Edit Points',
  editTags: 'Edit Tags',
  editProjects: 'Edit Projects',
  editContexts: 'Edit Contexts',
  editPriorities: 'Edit Priority',
  editRecurrence: 'Edit Recurrence',
  editStatuses: 'Edit Status',
  deleteTasks: 'Delete selected/focused tasks',
  toggleArchive: 'Toggle Archive',
};

/**
 * Renders the Keyboard Shortcuts tab.
 * The UI accepts a comma-separated list for each action (e.g. `j, ArrowDown`).
 */
export function renderKeyboardShortcutTab(
  container: HTMLElement,
  plugin: TaskNotesPlugin,
  save: () => void
): void {
  container.empty();

  createSectionHeader(container, 'Keyboard Shortcuts');
  createHelpText(
    container,
    'Customize Task List hotkeys. Multiple shortcuts per action are allowed; separate with commas. Use keys like j, ArrowDown, Ctrl+/, Shift+Enter, Cmd+Delete.'
  );

  // Ensure settings object exists
  if (!plugin.settings.keyboardShortcuts) {
    plugin.settings.keyboardShortcuts = structuredClone(DEFAULT_KEYBOARD_SHORTCUTS);
  }

  // Controls
  new Setting(container)
    .setName('Reset all to defaults')
    .setDesc('Restore the default key bindings for the Task List view.')
    .addButton((b) =>
      (b as ButtonComponent)
        .setButtonText('Reset')
        .setCta()
        .onClick(() => {
          plugin.settings.keyboardShortcuts = structuredClone(DEFAULT_KEYBOARD_SHORTCUTS);
          save();
          renderKeyboardShortcutTab(container, plugin, save);
        })
    );

  // Render groups (Navigation, Selection, Open/Edit, Property editors, Other)
  const group = (title: string) => {
    const el = container.createDiv();
    el.createEl('h4', { text: title });
    return el;
  };

  const nav = group('Navigation');
  const sel = group('Selection');
  const open = group('Open & Focus');
  const edit = group('Quick-Edit Menus');
  const other = group('Other');

  const attachText = (parent: HTMLElement, action: KeyboardShortcutAction) => {
    createTextSetting(parent, {
      name: ACTION_LABELS[action],
      desc:
        'Comma-separated shortcuts. Examples: j, ArrowDown, Ctrl+/, Shift+Enter, Cmd+Delete',
      placeholder: DEFAULT_KEYBOARD_SHORTCUTS[action].join(', '),
      getValue: () => (plugin.settings.keyboardShortcuts?.[action] ?? []).join(', '),
      setValue: async (value: string) => {
        const parts = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        plugin.settings.keyboardShortcuts![action] = parts;
        save();
      },
      ariaLabel: `Shortcut for ${ACTION_LABELS[action]}`
    });
  };

  // Navigation
  attachText(nav, 'navigateDown');
  attachText(nav, 'navigateUp');

  // Selection & bulk
  attachText(sel, 'toggleSelect');
  attachText(sel, 'selectAll');
  attachText(sel, 'clearFocusAndSelection');

  // Open/focus
  attachText(open, 'newTask');
  attachText(open, 'openEdit');
  attachText(open, 'openInNewPane');
  attachText(open, 'focusFilter');
  attachText(open, 'copyTaskTitles');

  // Quick edit menus
  attachText(edit, 'editDueDates');
  attachText(edit, 'editScheduleDates');
  attachText(edit, 'editPoints');
  attachText(edit, 'editTags');
  attachText(edit, 'editProjects');
  attachText(edit, 'editContexts');
  attachText(edit, 'editPriorities');
  attachText(edit, 'editRecurrence');
  attachText(edit, 'editStatuses');

  // Other
  attachText(other, 'deleteTasks');
  attachText(other, 'toggleArchive');
}
