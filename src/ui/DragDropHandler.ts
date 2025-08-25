/**
 * Drag and drop handler for saved view items
 */
export interface DragState {
    draggedElement: HTMLElement | null;
    placeholder: HTMLElement | null;
    draggedIndex: number;
    dropHandled: boolean;
}

export class DragDropHandler {
    private dragState: DragState | null = null;
    private onResolveChildren: () => HTMLElement[] = () => {
        if (!this.dragState?.placeholder?.parentNode) {
            return [];
        }
        
        const children = Array.from(this.dragState.placeholder.parentNode.children) as HTMLElement[];
        return children;
    }
    private onReorder: (fromIndex: number, toIndex: number, draggedElement: HTMLElement, placeholder: HTMLElement) => void;

    constructor(onReorder: (fromIndex: number, toIndex: number, draggedElement: HTMLElement, placeholder: HTMLElement) => void) {
        this.onReorder = onReorder;
    }

    /**
     * Initialize drag and drop for a container element
     */
    setupDragAndDrop(container: HTMLElement, index: number): void {
        this.initializeDragState();
        
        container.addEventListener('dragstart', (e) => this.handleDragStart(e, container, index));
        container.addEventListener('dragend', () => this.handleDragEnd(container));
        container.addEventListener('dragover', (e) => this.handleDragOver(e, container));
        container.addEventListener('drop', (e) => this.handleDrop(e, index));
    }

    /**
     * Setup global drop handlers for reliability
     */
    setupGlobalHandlers(
        section: HTMLElement,
        getElements: null | (() => HTMLElement[]) = null
    ): void {
        if (getElements) {
            this.onResolveChildren = getElements;
        }

        section.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        
        section.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (!this.dragState?.draggedElement || this.dragState.dropHandled) {
                return;
            }
            
            this.dragState.dropHandled = true;
            const fromIndex = this.dragState.draggedIndex;
            const toIndex = this.calculateDropPosition();
            
            this.onReorder(fromIndex, toIndex, this.dragState.draggedElement, this.dragState.placeholder!);
        });
    }

    private initializeDragState(): void {
        if (!this.dragState) {
            this.dragState = {
                draggedElement: null,
                placeholder: null,
                draggedIndex: -1,
                dropHandled: false
            };
        }
    }

    private handleDragStart(e: DragEvent, container: HTMLElement, index: number): void {
        if (!this.dragState) return;
        
        this.dragState.draggedElement = container;
        this.dragState.draggedIndex = index;
        this.dragState.dropHandled = false;
        container.classList.add('filter-bar__view-item-container--dragging');
        
        // Create placeholder
        this.dragState.placeholder = container.cloneNode(true) as HTMLElement;
        this.dragState.placeholder.classList.add('filter-bar__view-item-container--placeholder');
        this.dragState.placeholder.classList.remove('filter-bar__view-item-container--dragging');
        
        if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', index.toString());
            e.dataTransfer.effectAllowed = 'move';
        }
    }

    private handleDragEnd(container: HTMLElement): void {
        if (!this.dragState) return;
        
        container.classList.remove('filter-bar__view-item-container--dragging');
        
        if (this.dragState.placeholder?.parentNode) {
            this.dragState.placeholder.parentNode.removeChild(this.dragState.placeholder);
        }
        
        this.resetDragState();
    }

    private handleDragOver(e: DragEvent, container: HTMLElement): void {
        e.preventDefault();

        if (!this.dragState?.draggedElement || this.dragState.draggedElement === container) {
            return;
        }

        const rect = container.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const insertBefore = y < rect.height / 2;

        const parent = container.parentNode;
        const placeholder = this.dragState.placeholder;

        if (!parent || !placeholder) return;

        // Target node to place the placeholder before (null means "append at end")
        const target: Node | null = insertBefore ? container : container.nextSibling;

        // If the placeholder is already right before the target, skip the DOM write.
        // This works even when target is null.
        if (placeholder.parentNode === parent && placeholder.nextSibling === target) {
            return;
        }

        parent.insertBefore(placeholder, target);
    }


    private handleDrop(e: DragEvent, index: number): void {
        e.preventDefault();
        
        if (!this.dragState?.draggedElement || this.dragState.dropHandled) {
            return;
        }
        
        this.dragState.dropHandled = true;
        const fromIndex = this.dragState.draggedIndex;
        const toIndex = this.calculateDropPosition() ?? index;
        
        this.onReorder(fromIndex, toIndex, this.dragState.draggedElement, this.dragState.placeholder!);
    }

    private calculateDropPosition(): number {
        if (!this.dragState?.placeholder) {
            return -1;
        }

        let position = 0;
        const children = this.onResolveChildren();
        for (const child of children) {
            if (child === this.dragState.placeholder) {
                break;
            }
            if (child.classList.contains('filter-bar__view-item-container') && 
                !child.classList.contains('filter-bar__view-item-container--placeholder')) {
                position++;
            }
        }
        
        // Adjust position if we're dropping after the original position
        // When dragging down, the original item is missing from the DOM, so we need to account for it
        if (position > this.dragState.draggedIndex) {
            position--;
        }
        
        return position;
    }

    private resetDragState(): void {
        if (this.dragState) {
            this.dragState.draggedElement = null;
            this.dragState.placeholder = null;
            this.dragState.draggedIndex = -1;
            this.dragState.dropHandled = false;
        }
    }
}