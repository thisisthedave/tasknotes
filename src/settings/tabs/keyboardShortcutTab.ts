import { ButtonComponent, Platform, Scope, setIcon, Setting } from 'obsidian';
import TaskNotesPlugin from '../../main';
import { KeyboardShortcutAction, KeyboardShortcutsMap } from 'src/types/settings';
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

// ---- Normalization & display helpers ---------------------------------------

/** Normalize a string like "Ctrl+Shift+K" or "J" into "ctrl+shift+k" or "j". */
const normalizeShortcutString = (raw: string): string => {
    const parts = raw.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
    const mods = new Set<string>();
    let key = '';

    for (const p of parts) {
        if (p === 'ctrl' || p === 'control') mods.add('ctrl');
        else if (p === 'cmd' || p === 'meta' || p === 'command') mods.add('meta');
        else if (p === 'alt' || p === 'option') mods.add('alt');
        else if (p === 'shift') mods.add('shift');
        else key = p;
    }

    const ordered = ['ctrl', 'meta', 'alt', 'shift'].filter((m) => mods.has(m));
    return (ordered.length ? ordered.join('+') + '+' : '') + key;
};

/** Convert KeyboardEvent -> normalized signature (ctrl+meta+alt+shift+key). */
const eventToSig = (e: KeyboardEvent): string => {
    // ignore pure-modifier presses (wait for a real key)
    const k = String(e.key).toLowerCase();
    if (k === 'shift' || k === 'control' || k === 'alt' || k === 'meta') return '';

    const mods: string[] = [];
    if (e.ctrlKey) mods.push('ctrl');
    if (e.metaKey) mods.push('meta');
    if (e.altKey) mods.push('alt');
    if (e.shiftKey) mods.push('shift');

    return (mods.length ? mods.join('+') + '+' : '') + k;
};

/** Render a normalized signature in human-friendly form (Ctrl + Shift + K). */
const formatSig = (sig: string): string => {
    const parts = sig.split('+').filter(Boolean);
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

    // Ensure settings exist & are mutable copies (we mutate arrays when adding/removing)
    const ks = plugin.settings.keyboardShortcuts
        ? cloneMutable(plugin.settings.keyboardShortcuts)
        : cloneMutable(DEFAULT_KEYBOARD_SHORTCUTS);

    plugin.settings.keyboardShortcuts = ks;
    save();

    // Header & reset
    const header = container.createEl('h3', { text: 'Keyboard Shortcuts' });
    header.style.marginBottom = '0';

    const help = container.createEl('div', {
        text:
            'Click ＋ and press a key (or combo) to add a binding. Press Esc to cancel. ' +
            'Bindings shown in red conflict with other actions.',
    });
    help.style.opacity = '0.8';
    help.style.margin = '6px 0 12px';

    new Setting(container)
        .setName('Reset all to defaults')
        .setDesc('Restore default key bindings for the Task List view.')
        .addButton((b) =>
            (b as ButtonComponent)
                .setButtonText('Reset')
                .setCta()
                .onClick(() => {
                    plugin.settings.keyboardShortcuts = cloneMutable(DEFAULT_KEYBOARD_SHORTCUTS);
                    save();
                    renderKeyboardShortcutTab(container, plugin, save);
                })
        );

    // Build rows
    const ACTIONS: KeyboardShortcutAction[] = Object.keys(ACTION_LABELS) as KeyboardShortcutAction[];

    // single source of truth in this tab
    const getMap = (): KeyboardShortcutsMap => plugin.settings.keyboardShortcuts ?? DEFAULT_KEYBOARD_SHORTCUTS;

    const refreshConflicts = () => {
        const reverse = new Map<string, KeyboardShortcutAction[]>();
        const map = getMap();

        for (const action of ACTIONS) {
            for (const sig of map[action]) {
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
        const setting = new Setting(parent).setName(ACTION_LABELS[action]);
        // right-side container we fully control
        const row = setting.controlEl.createDiv({ cls: 'tasknotes-settings__ts-hotkey-row setting-command-hotkeys' });

        const paint = () => {
            row.empty();
            const map = getMap();
            const conflicts = reverseIndex();

            // render each chip
            for (const sig of map[action]) {
                const chip = row.createDiv({ cls: 'tasknotes-settings__chip tasknotes-settings__ts-hotkey-pill setting-hotkey' });
                const offenders = conflicts.get(sig) ?? [];
                if (offenders.length > 1) chip.addClass('tasknotes-settings__ts-conflict');

                chip.createSpan({ text: formatSig(sig) });

                const remove = chip.createEl('button', { text: '', attr: { 'aria-label': 'Remove shortcut' } });
                setIcon(remove, 'x');
                remove.addClass('setting-delete-hotkey', 'setting-hotkey-icon');
                remove.addEventListener('click', () => {
                    map[action] = map[action].filter((s) => s !== sig);
                    save();
                    paint();
                });

                if (offenders.length > 1) {
                    const others = offenders.filter((a) => a !== action).map((a) => ACTION_LABELS[a]);
                    if (others.length) {
                        row.createSpan({ cls: 'tasknotes-settings__ts-conflict-note', text: `Conflicts with ${others.join(', ')}` });
                    }
                }
            }

            // add button (capture)
            const addBtn = new ButtonComponent(row);
            addBtn.setIcon('circle-plus').setTooltip('Add hotkey').setClass('tasknotes-settings__ts-capture-btn');
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

                const sig = eventToSig(ev);
                if (!sig) return; // ignore pure modifiers

                const normalized = normalizeShortcutString(sig);
                const hotkeys = map[action];

                // ignore duplicate in the same action
                if (!hotkeys.includes(normalized)) {
                    hotkeys.push(normalized);
                    save();
                }
                stopCapture();
            };

            const startCapture = () => {
                addBtn.setButtonText('Press hotkey...').setCta().setClass('mod-capturing');
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

    const nav = group('Navigation & Selection');
    const open = group('Open & Focus');
    const edit = group('Quick-Edit Menus');
    const other = group('Other');

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

// ---- utils ------------------------------------------------------------------

function cloneMutable(map: KeyboardShortcutsMap): Record<KeyboardShortcutAction, string[]> {
    const out: any = {};
    for (const k of Object.keys(map) as KeyboardShortcutAction[]) {
        out[k] = [...map[k]];
    }
    return out;
}
