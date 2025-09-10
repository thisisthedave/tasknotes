import { Setting, ButtonComponent, Platform, setIcon } from 'obsidian';
import TaskNotesPlugin from '../../main';
import { createSectionHeader, createHelpText } from '../components/settingHelpers';
import { DEFAULT_KEYBOARD_SHORTCUTS } from '../defaults';
import { KeyboardShortcutAction, KeyboardShortcutsMap } from 'src/types/settings';

const ACTION_LABELS: Record<KeyboardShortcutAction, string> = {
  navigateDown: 'Navigate down',
  navigateUp: 'Navigate up',
  copyTaskTitles: 'Copy selected task titles',
  newTask: 'Create new task',
  focusFilter: 'Focus filter box',
  toggleSelect: 'Toggle selection on focused task',
  selectAll: 'Select all',
  clearFocusAndSelection: 'Clear focus & selection',
  openInNewPane: 'Open selected/focused (new pane)',
  openEdit: 'Open focused editor',
  editDueDates: 'Edit Due date',
  editScheduleDates: 'Edit Scheduled date',
  editPoints: 'Edit Points',
  editTags: 'Edit Tags',
  editProjects: 'Edit Projects',
  editContexts: 'Edit Contexts',
  editPriorities: 'Edit Priority',
  editRecurrence: 'Edit Recurrence',
  editStatuses: 'Edit Status',
  deleteTasks: 'Delete selected/focused',
  toggleArchive: 'Toggle Archive',
};

type Sig = string;

function normalizeSig(s: string): Sig {
  const raw = (s ?? '').trim();
  if (!raw) return '';
  const parts = raw.split('+').map(p => p.trim().toLowerCase());

  const mods = new Set<string>();
  let key = '';
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control') mods.add('ctrl');
    else if (p === 'cmd' || p === 'meta' || p === 'command') mods.add('meta');
    else if (p === 'alt' || p === 'option') mods.add('alt');
    else if (p === 'shift') mods.add('shift');
    else key = p;
  }
  const ordered = ['ctrl','meta','alt','shift'].filter(m => mods.has(m));
  const alias: Record<string,string> = { esc: 'escape' };
  const kk = alias[key] ?? key;
  return (ordered.length ? ordered.join('+') + '+' : '') + kk;
}

function sigFromEvent(e: KeyboardEvent): Sig {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.metaKey) mods.push('meta');
  if (e.altKey)  mods.push('alt');
  if (e.shiftKey)mods.push('shift');
  const k = String(e.key).toLowerCase();
  return (mods.length ? mods.join('+') + '+' : '') + k;
}

function prettyLabel(sig: Sig): string {
  const parts = sig.split('+').filter(Boolean);
  const label = parts.map(p => {
    if (p === 'ctrl') return 'Ctrl';
    if (p === 'meta') return Platform.isMacOS ? 'Cmd' : 'Meta';
    if (p === 'alt')  return Platform.isMacOS ? 'Option' : 'Alt';
    if (p === 'shift')return 'Shift';
    if (p.startsWith('arrow')) return 'Arrow ' + p.slice(5);
    if (p === 'escape') return 'Esc';
    if (p.length === 1) return p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  });
  return label.join(' + ');
}

function ensureNormalizedSettings(settings: TaskNotesPlugin['settings']) {
  const src = settings.keyboardShortcuts ?? DEFAULT_KEYBOARD_SHORTCUTS;
  const out: KeyboardShortcutsMap = {} as any;
  (Object.keys(DEFAULT_KEYBOARD_SHORTCUTS) as KeyboardShortcutAction[]).forEach(k => {
    const list = (src as any)[k] ?? DEFAULT_KEYBOARD_SHORTCUTS[k];
    (out as any)[k] = Array.from(new Set(list.map(normalizeSig).filter(Boolean)));
  });
  settings.keyboardShortcuts = out;
}

function computeConflicts(map: KeyboardShortcutsMap): Map<Sig, KeyboardShortcutAction[]> {
  const m = new Map<Sig, KeyboardShortcutAction[]>();
  (Object.keys(map) as KeyboardShortcutAction[]).forEach(action => {
    for (const sig of map[action]) {
      const arr = m.get(sig) ?? [];
      arr.push(action);
      m.set(sig, arr);
    }
  });
  return m;
}

// ---------- UI ----------

export function renderKeyboardShortcutTab(
  container: HTMLElement,
  plugin: TaskNotesPlugin,
  save: () => void
): void {
  container.empty();

  createSectionHeader(container, 'Keyboard Shortcuts');
  createHelpText(
    container,
    'Click + to add a binding, then press a key or combo. Bindings render as chips. Click × to remove. Conflicts are highlighted.'
  );

  ensureNormalizedSettings(plugin.settings);

  new Setting(container)
    .setName('Reset all to defaults')
    .setDesc('Restore default bindings for the Task List view.')
    .addButton((b) =>
      (b as ButtonComponent).setButtonText('Reset').setCta().onClick(() => {
        plugin.settings.keyboardShortcuts = JSON.parse(JSON.stringify(DEFAULT_KEYBOARD_SHORTCUTS));
        ensureNormalizedSettings(plugin.settings);
        save();
        renderKeyboardShortcutTab(container, plugin, save);
      })
    );

  const rows = container.createDiv({ cls: 'tasknotes-kb__rows' });
  let conflictMap = computeConflicts(plugin.settings.keyboardShortcuts!);

  const rerenderConflicts = () => {
    conflictMap = computeConflicts(plugin.settings.keyboardShortcuts!);
    const chips = rows.querySelectorAll<HTMLElement>('.tasknotes-kb__chip');
    chips.forEach(chip => {
      const sig = chip.dataset.sig!;
      const conflict = (conflictMap.get(sig)?.length ?? 0) > 1;
      chip.toggleClass('is-conflict', conflict);
      if (conflict) {
        const others = conflictMap.get(sig)!.join(', ');
        chip.setAttr('title', `Conflicts with: ${others}`);
        chip.setAttr('aria-label', `Conflicts with: ${others}`);
      } else {
        chip.removeAttribute('title');
        chip.removeAttribute('aria-label');
      }
    });
  };

  const removeSig = (action: KeyboardShortcutAction, sig: Sig) => {
    const list = plugin.settings.keyboardShortcuts![action];
    const idx = list.indexOf(sig);
    if (idx >= 0) list.splice(idx, 1);
    save();
    rerender();
  };

  let capturingFor: KeyboardShortcutAction | null = null;
  let cancelCapture: (() => void) | null = null;

  const beginCapture = (forAction: KeyboardShortcutAction, btn: ButtonComponent) => {
    if (capturingFor) endCapture();
    capturingFor = forAction;

    const original = btn.buttonEl.textContent;
    btn.setButtonText('Press hotkey...');
    btn.buttonEl.addClass('is-capturing');

    const handler = (ev: KeyboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') { endCapture(); return; }

      const sig = normalizeSig(sigFromEvent(ev));
      if (!sig) return;

      const list = plugin.settings.keyboardShortcuts![forAction];
      if (!list.includes(sig)) {
        list.push(sig);
        ensureNormalizedSettings(plugin.settings);
        save();
        rerender();
      }
      endCapture();
    };

    document.addEventListener('keydown', handler, { capture: true });
    cancelCapture = () => {
      btn.setButtonText(original ?? '+');
      btn.buttonEl.removeClass('is-capturing');
      document.removeEventListener('keydown', handler, { capture: true } as any);
      capturingFor = null;
      cancelCapture = null;
    };
  };

  const endCapture = () => { if (cancelCapture) cancelCapture(); };

  const makeChip = (label: string, action: KeyboardShortcutAction, sig: Sig) => {
    const chip = document.createElement('span');
    chip.addClass('tasknotes-kb__chip');
    chip.dataset.sig = sig;
    chip.textContent = label;

    const del = document.createElement('button');
    del.addClass('tasknotes-kb__chip-x');
    del.setAttr('aria-label', 'Remove binding');
    setIcon(del, 'x');
    del.onclick = (e) => { e.preventDefault(); e.stopPropagation(); removeSig(action, sig); };
    chip.appendChild(del);

    return chip;
  };

  const renderRow = (parent: HTMLElement, action: KeyboardShortcutAction) => {
    const setting = new Setting(parent).setName(ACTION_LABELS[action]);

    const chipWrap = setting.controlEl.createDiv({ cls: 'tasknotes-kb__chipwrap' });
    for (const sig of plugin.settings.keyboardShortcuts![action]) {
      chipWrap.appendChild(makeChip(prettyLabel(sig), action, sig));
    }

    setting.addButton((b) => {
      b.setButtonText('+').setTooltip('Add binding').onClick(() => beginCapture(action, b));
    });

    setting.addExtraButton((btn) => {
      btn.setIcon('rotate-ccw').setTooltip('Reset to default').onClick(() => {
        plugin.settings.keyboardShortcuts![action] =
          [...DEFAULT_KEYBOARD_SHORTCUTS[action]].map(normalizeSig);
        ensureNormalizedSettings(plugin.settings);
        save();
        rerender();
      });
    });
  };

  const rerender = () => {
    rows.empty();
    ensureNormalizedSettings(plugin.settings);
    (Object.keys(ACTION_LABELS) as KeyboardShortcutAction[]).forEach((a) => renderRow(rows, a));
    rerenderConflicts();
  };

  rerender();
  container.onNodeRemoved(() => endCapture());
}
