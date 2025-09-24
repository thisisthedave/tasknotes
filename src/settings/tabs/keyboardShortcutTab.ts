import { ButtonComponent, Platform, Scope, setIcon, Setting } from 'obsidian';
import TaskNotesPlugin from '../../main';
import { KeyboardShortcutAction, KeyboardShortcuts } from 'src/types/settings';
import { DEFAULT_KEYBOARD_SHORTCUTS } from '../defaults';
import { KeyboardShortcutsMap } from '../KeyboardShortcutsMap';
import { TranslationKey } from 'src/i18n';

// local helper
const t = (plugin: TaskNotesPlugin, key: TranslationKey, params?: Record<string, string | number>) =>
    plugin.i18n.translate(key, params);

const ACTION_LABEL_KEYS: Record<KeyboardShortcutAction, string> = {
    navigateDown: 'settings.keyboard.actions.navigateDown',
    navigateUp: 'settings.keyboard.actions.navigateUp',
    copyTaskTitles: 'settings.keyboard.actions.copyTaskTitles',
    newTask: 'settings.keyboard.actions.newTask',
    focusFilter: 'settings.keyboard.actions.focusFilter',
    toggleSelect: 'settings.keyboard.actions.toggleSelect',
    selectAll: 'settings.keyboard.actions.selectAll',
    clearFocusAndSelection: 'settings.keyboard.actions.clearFocusAndSelection',
    openInNewPane: 'settings.keyboard.actions.openInNewPane',
    openEdit: 'settings.keyboard.actions.openEdit',
    editDueDates: 'settings.keyboard.actions.editDueDates',
    editScheduleDates: 'settings.keyboard.actions.editScheduleDates',
    editPoints: 'settings.keyboard.actions.editPoints',
    editTags: 'settings.keyboard.actions.editTags',
    editProjects: 'settings.keyboard.actions.editProjects',
    editContexts: 'settings.keyboard.actions.editContexts',
    editPriorities: 'settings.keyboard.actions.editPriorities',
    editRecurrence: 'settings.keyboard.actions.editRecurrence',
    editStatuses: 'settings.keyboard.actions.editStatuses',
    deleteTasks: 'settings.keyboard.actions.deleteTasks',
    toggleArchive: 'settings.keyboard.actions.toggleArchive',
};

// ---- Normalization & display helpers ---------------------------------------

/** Render a normalized signature in human-friendly form (Ctrl + Shift + K). */
const formatSig = (sig: string): string => {
    const parts = KeyboardShortcutsMap.splitShortcut(sig);
    const mods: string[] = [];
    let key = '';

    const nice = (s: string) =>
        s.length <= 1 ? s.toUpperCase()
            : s.startsWith('arrow') ? 'Arrow ' + s.slice(5)
                : s === 'meta' ? (Platform.isMacOS ? 'Cmd' : 'Meta')
                    : s === 'ctrl' ? 'Ctrl'
                        : s === 'alt' ? 'Alt'
                            : s === 'shift' ? 'Shift'
                                : s.charAt(0).toUpperCase() + s.slice(1);

    for (const p of parts) {
        if (p === 'ctrl' || p === 'meta' || p === 'alt' || p === 'shift') mods.push(nice(p));
        else key = nice(p);
    }

    return (mods.length ? mods.join(' + ') + (key ? ' + ' : '') : '') + key;
};

// ---- Rendering --------------------------------------------------------------

export function renderKeyboardShortcutTab(
    container: HTMLElement,
    plugin: TaskNotesPlugin,
    save: () => void
): void {
    container.empty();

    const translate = (key: TranslationKey, params?: Record<string, string | number>) => plugin.i18n.translate(key, params);

    // Ensure settings exist & are mutable copies (we mutate arrays when adding/removing)
    if (!plugin.settings.keyboardShortcuts) {
        plugin.settings.keyboardShortcuts = DEFAULT_KEYBOARD_SHORTCUTS;
        save();
    }

    // Header & reset
    const header = container.createEl('h3', { text: translate('settings.keyboard.header') });
    header.style.marginBottom = '0';

    const help = container.createEl('div', {
        text: translate('settings.keyboard.help.line1') + '\n' + translate('settings.keyboard.help.line2'),
    });
    help.style.opacity = '0.8';
    help.style.margin = '6px 0 12px';

    new Setting(container)
    .setName(translate('settings.keyboard.resetAll.name'))
    .setDesc(translate('settings.keyboard.resetAll.description'))
        .addButton((b) =>
            (b as ButtonComponent)
                .setButtonText(translate('settings.keyboard.resetAll.buttonText'))
                .setCta()
                .onClick(() => {
                    plugin.settings.keyboardShortcuts = DEFAULT_KEYBOARD_SHORTCUTS;
                    save();
                    renderKeyboardShortcutTab(container, plugin, save);
                })
        );

    // Build rows
    const ACTIONS: KeyboardShortcutAction[] = Object.keys(ACTION_LABEL_KEYS) as KeyboardShortcutAction[];

    // single source of truth in this tab
    const getMap = (): KeyboardShortcutsMap => new KeyboardShortcutsMap(plugin.settings.keyboardShortcuts!);

    const saveMap = (shortcuts: KeyboardShortcutsMap): void => {
        plugin.settings.keyboardShortcuts = shortcuts.getAllShortcuts();
        save();
    }

    const refreshConflicts = () => {
        const reverse = new Map<string, KeyboardShortcutAction[]>();
        const map = getMap();

        for (const action of ACTIONS) {
            for (const sig of map.getShortcuts(action) ?? []) {
                const list = reverse.get(sig) ?? [];
                list.push(action);
                reverse.set(sig, list);
            }
        }
        return reverse; // sig -> actions[]
    };

    const reverseIndex = () => refreshConflicts();

    // render an action row (chips + add button)
    const renderRow = (parent: HTMLElement, action: KeyboardShortcutAction) => {
        const setting = new Setting(parent).setName(translate(ACTION_LABEL_KEYS[action]));
        // right-side container we fully control
        const row = setting.controlEl.createDiv({ cls: 'tasknotes-settings__ts-hotkey-row setting-command-hotkeys' });

        const paint = () => {
            row.empty();
            const map = getMap();
            const conflicts = reverseIndex();

            // render each chip
            for (const sig of map.getShortcuts(action)) {
                const chip = row.createDiv({ cls: 'tasknotes-settings__chip tasknotes-settings__ts-hotkey-pill setting-hotkey' });
                const offenders = conflicts.get(sig) ?? [];
                if (offenders.length > 1) chip.addClass('tasknotes-settings__ts-conflict');

                chip.createSpan({ text: formatSig(sig) });

                const remove = chip.createEl('button', { text: '', attr: { 'aria-label': translate('settings.keyboard.removeShortcut.ariaLabel') } });
                setIcon(remove, 'x');
                remove.addClass('setting-delete-hotkey', 'setting-hotkey-icon');
                remove.addEventListener('click', () => {
                    if (map.removeShortcut(action, sig)) {
                        saveMap(map);
                        paint();
                    }
                });

                if (offenders.length > 1) {
                    const others = offenders.filter((a) => a !== action).map((a) => ACTION_LABEL_KEYS[a]);
                    if (others.length) {
                        row.createSpan({ cls: 'tasknotes-settings__ts-conflict-note', text: translate('settings.keyboard.conflictNote', { actions: others.join(', ') }) });
                    }
                }
            }

            // add button (capture)
            const addBtn = new ButtonComponent(row);
            addBtn.setIcon('circle-plus').setTooltip(translate('settings.keyboard.addHotkey.tooltip')).setClass('tasknotes-settings__ts-capture-btn');
            addBtn.buttonEl.classList.add('clickable-icon');

            // swallow Esc (and optionally Enter) while capturing
            const bindHotkeyScope: Scope | null = new Scope(plugin.app.scope);
            bindHotkeyScope.register([], 'Escape', (ev) => {
                stopCapture();
                ev.preventDefault();
                ev.stopPropagation();
            });

            const onKey = (ev: KeyboardEvent) => {
                ev.preventDefault();
                ev.stopPropagation();

                if (ev.key.toLowerCase() === 'escape') {
                    stopCapture();
                    return;
                }

                if (KeyboardShortcutsMap.isPureModifier(ev)) return; // ignore pure modifiers

                // ignore duplicate in the same action
                if (map.addShortcut(action, ev)) {
                    saveMap(map);
                }
                stopCapture();
            };

            const startCapture = () => {
                addBtn.setButtonText(translate('settings.keyboard.capture.prompt')).setCta().setClass('mod-capturing');
                plugin.app.keymap.pushScope(bindHotkeyScope);
                document.addEventListener('keydown', onKey, { capture: true });
            };

            const stopCapture = () => {
                plugin.app.keymap.popScope(bindHotkeyScope);
                document.removeEventListener('keydown', onKey, { capture: true });

                addBtn.removeCta();
                addBtn.setClass('tasknotes-settings__ts-capture-btn');
                addBtn.setButtonText('');
                paint();
            };

            addBtn.onClick(startCapture);
        };

        paint();
    };

    // Render groups
    const group = (title: string) => {
        const el = container.createDiv();
        el.createEl('h4', { text: title });
        return el;
    };

    const nav = group(translate('settings.keyboard.groups.navigationSelection'));
    const open = group(translate('settings.keyboard.groups.openFocus'));
    const edit = group(translate('settings.keyboard.groups.quickEditMenus'));
    const other = group(translate('settings.keyboard.groups.other'));

    const attach = (parent: HTMLElement, action: KeyboardShortcutAction) => renderRow(parent, action);

    // Navigation
    attach(nav, 'navigateDown');
    attach(nav, 'navigateUp');
    // Selection & bulk
    attach(nav, 'toggleSelect');
    attach(nav, 'selectAll');
    attach(nav, 'clearFocusAndSelection');

    // Open/focus
    attach(open, 'newTask');
    attach(open, 'openEdit');
    attach(open, 'openInNewPane');
    attach(open, 'focusFilter');

    // Quick edit menus
    attach(edit, 'editDueDates');
    attach(edit, 'editScheduleDates');
    attach(edit, 'editPoints');
    attach(edit, 'editTags');
    attach(edit, 'editProjects');
    attach(edit, 'editContexts');
    attach(edit, 'editPriorities');
    attach(edit, 'editRecurrence');
    attach(edit, 'editStatuses');

    // Other
    attach(other, 'deleteTasks');
    attach(other, 'toggleArchive');
    attach(other, 'copyTaskTitles');

}
