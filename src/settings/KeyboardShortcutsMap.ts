import { KeyboardShortcutAction, KeyboardShortcuts } from "src/types/settings";

export class KeyboardShortcutsMap implements KeyboardShortcuts {
    private map: Record<KeyboardShortcutAction, string[]>;

    constructor(shortcuts: Partial<Record<KeyboardShortcutAction, readonly string[]>>) {
        const pick = (action: KeyboardShortcutAction): readonly string[] => shortcuts[action] ?? [];

        const normList = (list: readonly string[]) =>
            (list ?? []).map(KeyboardShortcutsMap.normalize).filter(Boolean);

        this.map = {
            navigateDown: normList(pick('navigateDown')),
            navigateUp: normList(pick('navigateUp')),
            copyTaskTitles: normList(pick('copyTaskTitles')),
            newTask: normList(pick('newTask')),
            focusFilter: normList(pick('focusFilter')),
            toggleSelect: normList(pick('toggleSelect')),
            selectAll: normList(pick('selectAll')),
            clearFocusAndSelection: normList(pick('clearFocusAndSelection')),
            openInNewPane: normList(pick('openInNewPane')),
            openEdit: normList(pick('openEdit')),
            editDueDates: normList(pick('editDueDates')),
            editScheduleDates: normList(pick('editScheduleDates')),
            editPoints: normList(pick('editPoints')),
            editTags: normList(pick('editTags')),
            editProjects: normList(pick('editProjects')),
            editContexts: normList(pick('editContexts')),
            editPriorities: normList(pick('editPriorities')),
            editRecurrence: normList(pick('editRecurrence')),
            editStatuses: normList(pick('editStatuses')),
            deleteTasks: normList(pick('deleteTasks')),
            toggleArchive: normList(pick('toggleArchive')),
        };
    }

    getAction(e: KeyboardEvent): KeyboardShortcutAction | null {
        const sig = KeyboardShortcutsMap.keyboardEventToShortcutSig(e);
        return this.sigToAction(sig);
    }

    getShortcuts(action: KeyboardShortcutAction): string[] {
        return this.map[action] ?? [];
    }

    getAllShortcuts(): Record<KeyboardShortcutAction, readonly string[]> {
        return this.map;
    }

    addShortcut(action: KeyboardShortcutAction, e: KeyboardEvent): boolean {
        if (KeyboardShortcutsMap.isPureModifier(e)) return false; // ignore pure modifiers

        const sig = KeyboardShortcutsMap.keyboardEventToShortcutSig(e);
        const normalized = KeyboardShortcutsMap.normalize(sig);
        const hotkeys = this.map[action];

        // ignore duplicate in the same action
        if (!hotkeys.includes(normalized)) {
            hotkeys.push(normalized);
            return true;
        } else {
            return false;
        }
    }

    removeShortcut(action: KeyboardShortcutAction, shortcut: string): boolean {
        const shortcuts = this.map[action]
        if (shortcuts && shortcuts.includes(shortcut)) {
            this.map[action] = shortcuts.filter((s) => s !== shortcut);
            return true;
        } else {
            return false;
        }
    }

    static isPureModifier(e: KeyboardEvent): boolean {
        // ignore pure-modifier presses (wait for a real key)
        const k = e.key.toLowerCase();
        return k === 'shift' || k === 'control' || k === 'alt' || k === 'meta';
    }

    /** split keyboard shortcut signature into parts, e.g. "ctrl+k" -> ["ctrl", "k"] */
    static splitShortcut(raw: string): string[] {
        return raw.split(/(?<!\+)\+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    }


    private sigToAction(eventSig: string): KeyboardShortcutAction | null {
        for (const action in this.map) {
            if (this.map[action as KeyboardShortcutAction].includes(eventSig)) {
                return action as KeyboardShortcutAction;
            }
        }
        return null;
    }

    /** Convert KeyboardEvent -> normalized signature (ctrl+meta+alt+shift+key). */
    private static keyboardEventToShortcutSig(e: KeyboardEvent): string {
        // ignore pure-modifier presses (wait for a real key)
        if (this.isPureModifier(e)) return '';
        const k = e.key.toLowerCase();

        const mods: string[] = [];
        if (e.ctrlKey) mods.push('ctrl');
        if (e.metaKey) mods.push('meta');
        if (e.altKey) mods.push('alt');
        if (e.shiftKey) mods.push('shift');

        return (mods.length ? mods.join('+') + '+' : '') + k;
    }

    /** Normalize a string like "Ctrl+Shift+K" or "J" into "ctrl+shift+k" or "j". */
    private static normalize(s: string): string {
        const raw = s.trim();
        if (!raw) return '';
        const parts = KeyboardShortcutsMap.splitShortcut(raw);

        // Separate modifiers from key
        const mods = new Set<string>();
        let key = '';
        for (const p of parts) {
            if (p === 'ctrl' || p === 'control') mods.add('ctrl');
            else if (p === 'cmd' || p === 'meta' || p === 'command') mods.add('meta');
            else if (p === 'alt' || p === 'option') mods.add('alt');
            else if (p === 'shift') mods.add('shift');
            else key = p; // last non-modifier wins
        }
        // Keep order stable for comparison
        const ordered = ['ctrl', 'meta', 'alt', 'shift'].filter(m => mods.has(m));
        return (ordered.length ? ordered.join('+') + '+' : '') + key;
    };
}