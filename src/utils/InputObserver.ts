import { App, WorkspaceLeaf } from "obsidian";

export class InputObserver {
    private app: App;
    private isMenuOpen = false;
    private observer: MutationObserver;

    constructor(app: App) {
        this.app = app;

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

    /** Disconnects the MutationObserver to prevent leaks */
    disconnect() {
        this.observer.disconnect();
    }

    /** Returns true if any text or textarea input (or contenteditable) is focused */
    private isTextInputFocused(): boolean {
        const active = document.activeElement;
        const isActive = (
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement ||
            (active && active.getAttribute?.("contenteditable") === "true")
        );
        return isActive === true;
    }

    /**
     * Returns whether keyboard input should be processed.
     * Pass the view type you want to gate against (e.g., TaskListView).
     */
    shouldHandleKeyboardInput<T>(viewType: new (...args: any[]) => T): boolean {
        // Ensure the specified view is currently active
        const active = this.app.workspace.getActiveViewOfType(viewType as any);
        if (!active) return false;

        // Block if a menu is open or was just closed this frame
        if (this.isMenuOpen) return false;

        // Block if text input is focused
        if (this.isTextInputFocused()) return false;

        return true;
    }
}
