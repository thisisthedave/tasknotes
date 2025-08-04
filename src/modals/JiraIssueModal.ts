import { App, Modal, Setting } from "obsidian";

export class JiraIssueModal extends Modal {
    result: string | null = null;
    onSubmit: (result: string) => void;

    constructor(app: App, onSubmit: (result: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        this.titleEl.setText("Import JIRA Issue");

        new Setting(this.contentEl)
            .setName("JIRA Issue Key")
            .addText((text) =>
                text
                    .setPlaceholder("e.g. JIRA-1234")
                    .onChange((value) => (this.result = value))
                    .inputEl.focus()
            );

        new Setting(this.contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Import")
                    .setCta()
                    .onClick(() => {
                        if (this.result) this.onSubmit(this.result.trim());
                        this.close();
                    })
            );

        // Keyboard shortcuts
        document.addEventListener('keydown', this.onKeyDown.bind(this));
    }

    onClose() {
        this.contentEl.empty();
    }

    private onKeyDown = async (evt: KeyboardEvent) => {
        if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) {
            evt.preventDefault();
            if (this.result) this.onSubmit(this.result?.trim());
            this.close();
        }
    };

}
