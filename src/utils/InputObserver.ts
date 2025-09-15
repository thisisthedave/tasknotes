import { EventRef, View } from "obsidian";
import TaskNotesPlugin from "src/main";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "src/settings/defaults";
import { KeyboardShortcutsMap } from "src/settings/KeyboardShortcutsMap";
import { KeyboardShortcutAction, KeyboardShortcuts } from "src/types/settings";

export class InputObserver {
    private plugin: TaskNotesPlugin;
    private isMenuOpen = false;
    private observer: MutationObserver;
    private keyboardShortcuts: KeyboardShortcuts;
    // Event listeners
    private eventListeners: EventRef[] = [];
    private inputListeners: Map<View, (action: KeyboardShortcutAction) => Promise<void>> = new Map();

    constructor(plugin: TaskNotesPlugin) {
        this.plugin = plugin;
        this.initializeKeyboardShortcuts();
        this.registerEvents();

        // Watch DOM events to track when menus/modals open or close
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (node as Element).matches(".menu, .modal-container:not(.modals-hidden)")) {
                        this.isMenuOpen = true;
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === 1 && (node as Element).matches(".menu, .modal-container:not(.modals-hidden)")) {
                        // Defer clearing until the end of the current event loop
                        setTimeout(() => {
                            if (!document.querySelector(".menu, .modal-container:not(.modals-hidden)")) {
                                this.isMenuOpen = false;
                            }
                        }, 0);
                    }
                }
            }
        });

        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    addInputListener(view: View, handler: (action: KeyboardShortcutAction) => Promise<void>) {
        this.inputListeners.set(view, handler);
        view.registerDomEvent(document, 'keydown', this.handleKeyDown.bind(this));
    }

    /** Disconnects the MutationObserver to prevent leaks */
    disconnect() {
        this.observer.disconnect();
    }

    private registerEvents(): void {
        // Clean up any existing listeners
        this.eventListeners.forEach(listener => this.plugin.emitter.offref(listener));
        this.eventListeners = [];

        // Listen for settings changes to keyboard shortcuts
        const settingsListener = this.plugin.emitter.on('settings-changed', () => {
            this.initializeKeyboardShortcuts();
        });
        this.eventListeners.push(settingsListener);
    }

    private initializeKeyboardShortcuts(): void {        
        this.keyboardShortcuts = new KeyboardShortcutsMap(DEFAULT_KEYBOARD_SHORTCUTS);
    }

    isActiveView(view: View): boolean {
        return this.plugin.app.workspace.getActiveViewOfType(view.constructor as any) === view;
    }

    /**
     * Returns whether keyboard input should be processed.
     * Pass the view type you want to gate against (e.g., TaskListView).
     */
    private shouldHandleKeyboardInput(): boolean {
        // Block if a menu is open or was just closed this frame
        if (this.isMenuOpen) return false;

        // Block if text input is focused
        if (InputObserver.isTextInputFocused()) return false;

        return true;
    }

    private handleKeyDown(event: KeyboardEvent): void {
        if (!this.shouldHandleKeyboardInput()) return;

        const keyboardAction = this.keyboardShortcuts.getAction(event);

        if (keyboardAction) {
            for (const [view, handler] of this.inputListeners) {
                if (this.isActiveView(view)) {
                    handler(keyboardAction);
                }
            }
            event.preventDefault();
            event.stopPropagation();
        }
    }

    /** Returns true if any text or textarea input (or contenteditable) is focused */
    static isTextInputFocused(): boolean {
        const active = document.activeElement;
        const isActive = (
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement ||
            (active && active.getAttribute?.("contenteditable") === "true")
        );
        return isActive === true;
    }
}
