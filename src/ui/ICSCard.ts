import { setIcon } from 'obsidian';
import TaskNotesPlugin from '../main';
import { ICSEvent } from '../types';
import { format } from 'date-fns';
import { ICSEventContextMenu } from '../components/ICSEventContextMenu';

export interface ICSCardOptions {
    showDate: boolean;
}

export const DEFAULT_ICS_CARD_OPTIONS: ICSCardOptions = {
    showDate: true
};

function formatTimeRange(icsEvent: ICSEvent): string {
    try {
        if (!icsEvent.start) return '';
        const start = new Date(icsEvent.start);
        if (icsEvent.allDay) {
            return 'All day';
        }
        const startText = format(start, 'h:mm a');
        if (icsEvent.end) {
            const end = new Date(icsEvent.end);
            const endText = format(end, 'h:mm a');
            return `${startText} – ${endText}`;
        }
        return startText;
    } catch {
        return '';
    }
}

/**
 * Create a compact ICS event card styled similar to TaskCard
 */
export function createICSEventCard(icsEvent: ICSEvent, plugin: TaskNotesPlugin, options: Partial<ICSCardOptions> = {}): HTMLElement {
    const opts = { ...DEFAULT_ICS_CARD_OPTIONS, ...options };

    const card = document.createElement('div');
    // Reuse task-card base styling for visual consistency
    card.className = 'task-card task-card--ics';
    (card as any).dataset.key = icsEvent.id;

    // Determine subscription color and name
    const subscription = plugin.icsSubscriptionService?.getSubscriptions().find(s => s.id === icsEvent.subscriptionId);
    const color = subscription?.color || 'var(--color-accent)';
    const sourceName = subscription?.name || 'Calendar';

    // Main row
    const mainRow = card.createEl('div', { cls: 'task-card__main-row' });

    // Left indicator area: calendar icon (no ring/checkbox)
    const leftIconWrap = mainRow.createEl('span', { cls: 'ics-card__icon' });
    const leftIcon = leftIconWrap.createDiv({ attr: { 'aria-label': 'Calendar event' } });
    setIcon(leftIcon, 'calendar');
    // Inline layout styling to mimic status area spacing without the ring
    const wrapEl = leftIconWrap as HTMLElement;
    wrapEl.style.display = 'inline-flex';
    wrapEl.style.width = '16px';
    wrapEl.style.height = '16px';
    wrapEl.style.marginRight = '8px';
    wrapEl.style.alignItems = 'center';
    wrapEl.style.justifyContent = 'center';
    wrapEl.style.flexShrink = '0';
    // Color the icon using subscription color
    (leftIcon as HTMLElement).style.width = '100%';
    (leftIcon as HTMLElement).style.height = '100%';
    (leftIcon as HTMLElement).style.color = color;

    // Content
    const content = mainRow.createEl('div', { cls: 'task-card__content' });
    const titleEl = content.createEl('div', { cls: 'task-card__title', text: icsEvent.title || 'Untitled event' });

    // Metadata line: time range • location • source
    const metadata = content.createEl('div', { cls: 'task-card__metadata' });
    const parts: string[] = [];
    const timeText = formatTimeRange(icsEvent);
    if (timeText) parts.push(timeText);
    if (icsEvent.location) parts.push(icsEvent.location);
    parts.push(sourceName);
    metadata.textContent = parts.join(' • ');

    // Left-click to open detailed info modal
    card.addEventListener('click', () => {
        const { ICSEventInfoModal } = require('../modals/ICSEventInfoModal');
        const modal = new ICSEventInfoModal(plugin.app, plugin, icsEvent, sourceName);
        modal.open();
    });

    // Right-click for context menu
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const contextMenu = new ICSEventContextMenu({
            icsEvent: icsEvent,
            plugin: plugin,
            subscriptionName: sourceName,
            onUpdate: () => {
                // Trigger any necessary updates
                plugin.app.workspace.trigger('tasknotes:refresh-views');
            }
        });
        
        contextMenu.show(e);
    });

    // Apply accent color as CSS var for nicer theming
    card.style.setProperty('--current-status-color', color);

    return card;
}

/**
 * Update an existing ICS event card
 */
export function updateICSEventCard(element: HTMLElement, icsEvent: ICSEvent, plugin: TaskNotesPlugin, options: Partial<ICSCardOptions> = {}): void {
    const opts = { ...DEFAULT_ICS_CARD_OPTIONS, ...options };

    const subscription = plugin.icsSubscriptionService?.getSubscriptions().find(s => s.id === icsEvent.subscriptionId);
    const color = subscription?.color || 'var(--color-accent)';
    const sourceName = subscription?.name || 'Calendar';

    // Update icon color on wrapper to propagate to svg (icons use currentColor)
    element.style.setProperty('--current-status-color', color);
    const iconWrap = element.querySelector('.ics-card__icon') as HTMLElement | null;
    if (iconWrap) iconWrap.style.color = color;

    const titleEl = element.querySelector('.task-card__title') as HTMLElement | null;
    if (titleEl) titleEl.textContent = icsEvent.title || 'Untitled event';

    const metadata = element.querySelector('.task-card__metadata') as HTMLElement | null;
    if (metadata) {
        const parts: string[] = [];
        const timeText = formatTimeRange(icsEvent);
        if (timeText) parts.push(timeText);
        if (icsEvent.location) parts.push(icsEvent.location);
        parts.push(sourceName);
        metadata.textContent = parts.join(' • ');
    }
}
