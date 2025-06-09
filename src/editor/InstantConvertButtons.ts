import { Extension, RangeSetBuilder, StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { setIcon, MarkdownView } from 'obsidian';
import TaskNotesPlugin from '../main';
import { TasksPluginParser } from '../utils/TasksPluginParser';

class ConvertButtonWidget extends WidgetType {
    private plugin: TaskNotesPlugin;
    private lineNumber: number;

    constructor(plugin: TaskNotesPlugin, lineNumber: number) {
        super();
        this.plugin = plugin;
        this.lineNumber = lineNumber;
    }

    toDOM(view: EditorView): HTMLElement {
        // Create container with proper class structure
        const container = document.createElement('span');
        container.className = 'tasknotes-plugin';
        
        const button = container.createEl('button', { cls: 'instant-convert-button' });
        button.setAttribute('title', 'Convert to TaskNote');
        button.setAttribute('aria-label', 'Convert to TaskNote');
        
        // Add critical inline styles as fallback
        button.style.cssText = `
            background: transparent !important;
            color: var(--text-muted) !important;
            border: none !important;
            opacity: 0.6 !important;
            cursor: pointer !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 15px !important;
            height: 15px !important;
            margin-left: 8px !important;
            padding: 0 !important;
            border-radius: 3px !important;
            transition: all 0.15s ease !important;
        `;
        
        // Add the convert icon
        const iconSpan = button.createEl('span', { cls: 'instant-convert-button__icon' });
        setIcon(iconSpan, 'file-plus');
        
        // Handle click
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Get the editor from the active markdown view
            const activeMarkdownView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeMarkdownView) {
                return;
            }
            const editor = activeMarkdownView.editor;
                
                // Call the instant convert service
                if (this.plugin.instantTaskConvertService && editor) {
                    await this.plugin.instantTaskConvertService.instantConvertTask(editor, this.lineNumber);
                }
        });
        
        // Add hover effects with JavaScript since CSS might not apply
        button.addEventListener('mouseenter', () => {
            button.style.background = 'var(--interactive-accent) !important';
            button.style.color = 'var(--text-on-accent) !important';
            button.style.opacity = '1 !important';
            button.style.transform = 'scale(1.1) !important';
            button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2) !important';
        });
        
        button.addEventListener('mouseleave', () => {
            button.style.background = 'transparent !important';
            button.style.color = 'var(--text-muted) !important';
            button.style.opacity = '0.6 !important';
            button.style.transform = 'scale(1) !important';
            button.style.boxShadow = 'none !important';
        });
        
        button.addEventListener('mousedown', () => {
            button.style.transform = 'scale(0.95) !important';
        });
        
        button.addEventListener('mouseup', () => {
            button.style.transform = 'scale(1.1) !important';
        });
        
        return container;
    }

    eq(other: WidgetType): boolean {
        return other instanceof ConvertButtonWidget && 
               other.plugin === this.plugin && 
               other.lineNumber === this.lineNumber;
    }

    get estimatedHeight(): number {
        return -1; // Indicates inline widget
    }

    ignoreEvent(): boolean {
        return false;
    }
}

export function createInstantConvertField(plugin: TaskNotesPlugin) {
    return StateField.define<DecorationSet>({
        create(): DecorationSet {
            return Decoration.none;
        },
        
        update(oldState: DecorationSet, transaction: Transaction): DecorationSet {
            if (!plugin.settings.enableInstantTaskConvert) {
                return Decoration.none;
            }
            
            // Only rebuild on document changes or when needed
            if (!transaction.docChanged && oldState !== Decoration.none) {
                return oldState.map(transaction.changes);
            }
            
            return buildConvertButtonDecorations(transaction.state, plugin);
        },
        
        provide(field: StateField<DecorationSet>): Extension {
            return EditorView.decorations.from(field);
        },
    });
}

function buildConvertButtonDecorations(state: any, plugin: TaskNotesPlugin): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = state.doc;
    
    // Process each line looking for completed checkbox tasks
    for (let lineIndex = 0; lineIndex < doc.lines; lineIndex++) {
        const line = doc.line(lineIndex + 1);
        const lineText = line.text;
        
        // Parse the line to see if it's any checkbox task
        const taskLineInfo = TasksPluginParser.parseTaskLine(lineText);
        
        if (taskLineInfo.isTaskLine && taskLineInfo.parsedData) {
            
            // Create a button widget at the end of the line
            const widget = new ConvertButtonWidget(plugin, lineIndex);
            const decoration = Decoration.widget({
                widget: widget,
                side: 1 // Position after the line content
            });
            
            builder.add(line.to, line.to, decoration);
        }
    }
    
    return builder.finish();
}

export function createInstantConvertButtons(plugin: TaskNotesPlugin): Extension {
    return createInstantConvertField(plugin);
}