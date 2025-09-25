import { Setting, TextComponent, AbstractInputSuggest, Notice, App, ExtraButtonComponent, DropdownComponent } from 'obsidian';
import TaskNotesPlugin from '../../main';
import { createSectionHeader, createHelpText } from '../components/settingHelpers';
import type { IJiraIssue } from 'src/types/obsidian-jira-issue';
import { getByPath, renderTemplate, resolveTokenToPath, sanitizeJiraFieldName } from 'src/utils/JiraMapping';
import { EnumRemapPair, JiraArraySource, JiraFieldMappingSettings, JiraValueSource } from 'src/types/settings';
import { DEFAULT_JIRA_FIELD_MAPPING } from '../defaults';
import { TranslationKey } from 'src/i18n';

type TokenItem = { token: string; preview?: string };
type PreviewResolver = (token: string) => string | undefined;

export class TokenSuggest extends AbstractInputSuggest<TokenItem> {
	private tokens: TokenItem[] = [];
	private inputEl: HTMLInputElement | HTMLDivElement;
	private previewOf?: PreviewResolver;

	constructor(app: App, textInputEl: HTMLInputElement | HTMLDivElement) {
		super(app, textInputEl);
		this.inputEl = textInputEl;
	}

	/** Provide tokens (you can omit preview; it will be computed if a resolver is set) */
	setTokens(tokens: TokenItem[]) { this.tokens = tokens; }

	/** Inject a resolver that returns the current sample-value for a token */
	setPreviewResolver(resolver: PreviewResolver | undefined) { this.previewOf = resolver; }

	override getSuggestions(q: string) {
		// Suggest based on the segment after the last '$'
		const afterDollar = q.split('$').pop() ?? '';
		const lc = afterDollar.toLowerCase();

		// Filter + compute previews lazily
		return this.tokens
			.filter(t => t.token.toLowerCase().includes(lc))
			.map(t => ({
				token: t.token,
				preview: this.previewOf?.(t.token) ?? t.preview,
			}));
	}

	override renderSuggestion(value: TokenItem, el: HTMLElement) {
		el.addClass('mod-complex');
		const left = el.createDiv({ text: '$' + value.token });
		const right = el.createDiv({ text: value.preview ?? '', cls: 'mod-muted' });
		right.style.marginLeft = '8px';
	}

	override selectSuggestion(value: TokenItem): void {
		const input = this.inputEl as HTMLInputElement;
		const before = input.value.slice(0, input.selectionStart ?? 0);
		const after = input.value.slice(input.selectionEnd ?? input.value.length);
		const prefix = before.lastIndexOf('$');
		const preText = prefix >= 0 ? before.slice(0, prefix) : before;
		input.value = preText + '$' + value.token + after;
		const caret = preText.length + value.token.length + 1;
		input.setSelectionRange(caret, caret);
		input.dispatchEvent(new Event('input'));
		this.close();
	}
}

function normalizeSource(src: JiraValueSource | undefined, fallback: JiraValueSource): JiraValueSource {
	return src ?? fallback;
}

export async function renderJiraFieldMappingTab(container: HTMLElement, plugin: TaskNotesPlugin, save: () => void) {
	container.empty();

	const translate = (key: TranslationKey, params?: Record<string, string | number>) => plugin.i18n.translate(key, params);

	const settings: JiraFieldMappingSettings = plugin.settings.jiraMapping ?? (plugin.settings.jiraMapping = structuredClone(DEFAULT_JIRA_FIELD_MAPPING));

	// --- Sample issue fetcher
	createSectionHeader(container, translate('settings.jiraMapping.sample.header'));
	createHelpText(container,
		translate('settings.jiraMapping.sample.help'));

	let sampleIssue: IJiraIssue | null = null;

	let issueKeyInput: TextComponent;
	let issueFetchButton: ExtraButtonComponent;
	let tokens: { token: string, preview?: string }[] = [];

	// Sample issue row
	const fetchRow = new Setting(container)
		.setName(translate('settings.jiraMapping.sample.name'))
		.setDesc(translate('settings.jiraMapping.sample.desc'))
		.addText((t) => {
			issueKeyInput = t;
			t.setPlaceholder(translate('settings.jiraMapping.sample.placeholder'));
			t.inputEl.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') fetchIssue();
			});
		})
		.addExtraButton((btn) => {
			issueFetchButton = btn;
			btn.setIcon('search').setTooltip(translate('settings.jiraMapping.sample.fetch.tooltip'));
			btn.onClick(fetchIssue);
		});

	/* =========================
	 * Raw Data (collapsible + searchable)
	 * ========================= */
	let rawExpanded = false;
	let rawToggleBtn: ExtraButtonComponent;
	let rawHost: HTMLDivElement;
	let rawTextArea: HTMLTextAreaElement;
	let rawSearch: TextComponent;

	const rawRow = new Setting(container)
		.setName(translate('settings.jiraMapping.raw.header'))
		.setDesc(translate('settings.jiraMapping.raw.desc'))
		.addExtraButton((b) => {
			rawToggleBtn = b;
			b.setIcon('chevron-right').setTooltip(translate('common.expand'));
			b.onClick(() => {
				rawExpanded = !rawExpanded;
				updateRawPanel();
			});
		});

	rawRow.settingEl.addClass('tasknotes-settings__raw-row');       // scope for CSS
	rawHost = rawRow.settingEl.createDiv({ cls: 'tasknotes-settings__raw is-collapsed' });

	const rawToolbar = rawHost.createDiv({ cls: 'tasknotes-settings__raw-toolbar' });
	// toolbar
	rawToolbar.createSpan({ text: translate('common.search') + ':' });
	rawSearch = new TextComponent(rawToolbar);
	rawSearch.inputEl.placeholder = translate('common.find.placeholder');
	rawSearch.inputEl.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter') {
			performRawSearch(ev.shiftKey ? -1 : +1);
			ev.preventDefault();
			ev.stopPropagation();
		}
	});
	const rawFindPrev = rawToolbar.createEl('button', { text: translate('common.prev'), cls: 'clickable-icon' });
	rawFindPrev.onclick = (e) => { e.preventDefault(); performRawSearch(-1); };
	const rawFindNext = rawToolbar.createEl('button', { text: translate('common.next'), cls: 'clickable-icon' });
	rawFindNext.onclick = (e) => { e.preventDefault(); performRawSearch(+1); };

	rawTextArea = rawHost.createEl('textarea', { cls: 'tasknotes-settings__raw-text' });
	rawTextArea.readOnly = true;

	function updateRawPanel() {
		// toggle visibility + icon
		rawHost.classList.toggle('is-collapsed', !rawExpanded);
		rawToggleBtn.setIcon(rawExpanded ? 'chevron-down' : 'chevron-right');
		rawToggleBtn.setTooltip(rawExpanded ? translate('common.collapse') : translate('common.expand'));

		// refresh content from current sample
		if (sampleIssue && rawExpanded) {
			rawTextArea.value = JSON.stringify(sampleIssue, null, 2);
		} else if (!sampleIssue) {
			rawTextArea.value = '';
		}
	}

	function performRawSearch(direction: 1 | -1) {
		function setSelectionRange(textarea: HTMLTextAreaElement, selectionStart: number, selectionEnd: number) {
			// First scroll selection region to view
			const fullText = textarea.value;
			textarea.value = fullText.substring(0, selectionEnd);
			// For some unknown reason, you must store the scollHeight to a variable
			// before setting the textarea value. Otherwise it won't work for long strings
			const scrollHeight = textarea.scrollHeight
			textarea.value = fullText;
			let scrollTop = scrollHeight;
			const textareaHeight = textarea.clientHeight;
			if (scrollTop > textareaHeight) {
				// scroll selection to center of textarea
				scrollTop -= textareaHeight / 2;
			} else {
				scrollTop = 0;
			}
			textarea.scrollTop = scrollTop;

			// Continue to set selection range
			textarea.setSelectionRange(selectionStart, selectionEnd);
		}

		const needle = rawSearch.getValue().toLowerCase();
		if (!needle) return;

		const hay = rawTextArea.value.toLowerCase();

		// Use current caret depending on direction
		const startPos =
			direction > 0
				? Math.min(rawTextArea.selectionEnd ?? 0, hay.length)
				: Math.max((rawTextArea.selectionStart ?? hay.length) - 1, 0);

		let idx = -1;
		if (direction > 0) {
			idx = hay.indexOf(needle, startPos);
			if (idx === -1) idx = hay.indexOf(needle); // wrap to start
		} else {
			idx = hay.lastIndexOf(needle, startPos);
			if (idx === -1) idx = hay.lastIndexOf(needle); // wrap to end
		}
		if (idx === -1) return;

		// Focus and select; let the browser scroll it into view.
		rawTextArea.focus();
		setSelectionRange(rawTextArea, idx, idx + needle.length);
	}

	// call after attempting to fetch an issue
	async function fetchIssue() {
		const key = issueKeyInput.getValue().trim();
		if (!key) { sampleIssue = null; new Notice(translate('settings.jiraMapping.sample.notice.enterKey')); updateRawPanel(); return; }

		const jira = plugin.app.plugins.getPlugin('obsidian-jira-issue');
		if (!jira?.api?.base?.getIssue) {
			new Notice(translate('settings.jiraMapping.sample.notice.missingPlugin'));
			return;
		}

		issueFetchButton.setDisabled(true);
		try {
			sampleIssue = await jira.api.base.getIssue(key);
			new Notice(translate('settings.jiraMapping.sample.notice.loaded', { key: sampleIssue.key }));
		} catch (e) {
			new Notice(translate('settings.jiraMapping.sample.notice.loadFailed', { key }));
			sampleIssue = null;
		} finally {
			issueFetchButton.setDisabled(false);
			tokens = collectTokens();
			updateRawPanel();
			rerenderFields();
		}
	}

	// initialize panel collapsed
	updateRawPanel();



	// helper: build tokens from sampleIssue
	const collectTokens = (): { token: string; preview?: string }[] => {
		const base = [
			{ token: 'key', preview: sampleIssue?.key },
			{ token: 'id', preview: sampleIssue?.id },
			{
				token: 'summary',
				preview: sampleIssue ? String(getByPath(sampleIssue, 'fields.summary') ?? '') : undefined,
			},
			{
				token: 'description',
				preview: sampleIssue ? String(getByPath(sampleIssue, 'fields.description') ?? '') : undefined,
			},
		];

		const extra: { token: string; preview?: string }[] = [];

		// Include custom-field shortcuts derived from metadata
		const customFieldIndex =
			(sampleIssue as any)?.account?.cache?.customFieldsNameToId ||
			(sampleIssue as any)?.customFieldsNameToId ||
			(sampleIssue as any)?.fields?.customFieldsNameToId;

		if (customFieldIndex && typeof customFieldIndex === 'object') {
			for (const [name, id] of Object.entries<string>(customFieldIndex as Record<string, string>)) {
				const token = sanitizeJiraFieldName(String(name)); // e.g., "Story Points" -> "Story_Points"
				const path = `fields.customfield_${id}`;
				const preview = sampleIssue ? String(getByPath(sampleIssue, path) ?? '') : '';
				extra.push({ token, preview });
			}
		}

		// flatten fields.* shallow + a few popular arrays (as before)
		if (sampleIssue?.fields) {
			for (const k of Object.keys(sampleIssue.fields)) {
				if (typeof (sampleIssue.fields as any)[k] !== 'object') {
					extra.push({ token: `fields.${k}`, preview: String((sampleIssue.fields as any)[k]) });
				}
			}
			const arrays = ['labels', 'components[]', 'fixVersions[]', 'issueLinks[]', 'worklog.worklogs[]'];
			arrays.forEach((a) => extra.push({ token: `fields.${a}`, preview: '' }));

			// nested helpful hints
			extra.push({
				token: 'fields.project.key',
				preview: String(getByPath(sampleIssue, 'fields.project.key') ?? ''),
			});
			extra.push({
				token: 'fields.priority.name',
				preview: String(getByPath(sampleIssue, 'fields.priority.name') ?? ''),
			});
			extra.push({
				token: 'fields.status.name',
				preview: String(getByPath(sampleIssue, 'fields.status.name') ?? ''),
			});
			extra.push({
				token: 'fields.parent.key',
				preview: String(getByPath(sampleIssue, 'fields.parent.key') ?? ''),
			});

			// also advertise raw customfield_* tokens for power users
			// (no preview unless you want to iterate all fields.* and pick those that match)
			// If you want: scan keys that look like customfield_\d+ and add them here.
		}

		return [...base, ...extra];
	};

	tokens = collectTokens();

	const previewResolver: (token: string) => string | undefined = (token) => {
		if (!sampleIssue) return undefined;
		const path = resolveTokenToPath(token, sampleIssue);
		const val = getByPath(sampleIssue, path);
		if (Array.isArray(val)) return val.map(v => String(v)).join(', ');
		return val == null ? '' : String(val);
	}

	// --- Two-column grid
	// const container = container.createDiv({ cls: 'tasknotes-settings__jira-grid' });

	const fieldRows: Array<() => void> = [];

	x: Setting;
	const updateSettingValue = (): { value: string, preview: string } => {
		return { value: '', preview: '' };
	};
	const refreshSetting = (
		src: JiraValueSource | undefined,
		setting: Setting,
		preview: boolean,
		suggest: TokenSuggest | null
	) => {
		const jiraSrc = normalizeSource(src, { mode: 'off', value: '' });
		const valueInput = setting.components.find(c => c instanceof TextComponent) as TextComponent;
		if (valueInput) {
			// set input state
			valueInput.setValue(jiraSrc.value ?? '');
			valueInput.inputEl.toggleAttribute('disabled', jiraSrc.mode === 'off' || jiraSrc.mode === 'fixed');
			valueInput.inputEl.placeholder = 
				jiraSrc.mode === 'fixed' ? translate('settings.jiraMapping.placeholder.constant')
				: jiraSrc.mode === 'path' ? translate('settings.jiraMapping.placeholder.fieldPath')
				: translate('settings.jiraMapping.placeholder.tokensAllowed');
		}
		if (suggest) suggest.setTokens(tokens);

		const typeDropdown = setting.components.find(c => c instanceof DropdownComponent) as DropdownComponent;
		if (typeDropdown) {
			// set input mapping type
			typeDropdown.setValue(jiraSrc.mode);
		}

		if (sampleIssue && preview) {
			let val: any = undefined;
			if (jiraSrc.mode === 'template') val = renderTemplate(jiraSrc.value, sampleIssue);
			else if (jiraSrc.mode === 'path') val = getByPath(sampleIssue, jiraSrc.value);
			else if (jiraSrc.mode === 'fixed') val = jiraSrc.value;

			const prefix = translate('settings.jiraMapping.preview.prefix');
			setting.setDesc(val == null ? translate('settings.jiraMapping.preview.none') : `${prefix} ${Array.isArray(val) ? val.join(', ') : String(val)}`);
		} else {
			setting.setDesc('');
		}
	};

	const addScalarRow = (
		labelKey: TranslationKey,
		property: keyof JiraFieldMappingSettings,
		getSrc: () => JiraValueSource | undefined,
		setSrc: (scalarSource: JiraValueSource) => void,
		opts?: { template?: boolean, preview?: boolean }
	) => {
		const setAndSave = (scalarSource: JiraValueSource) => {
			setSrc(scalarSource);
			save();
			rerenderFields();
		};

		var suggest: TokenSuggest;
		const scalarSetting = new Setting(container)
			.setName(translate(labelKey))
			.addDropdown(typeDropdown => {
				typeDropdown.addOption('template', translate('settings.jiraMapping.mapping.mode.template'));
				typeDropdown.addOption('path', translate('settings.jiraMapping.mapping.mode.path'));
				typeDropdown.addOption('fixed', translate('settings.jiraMapping.mapping.mode.fixed'));
				typeDropdown.addOption('off', translate('settings.jiraMapping.mapping.mode.off'));
				const current = normalizeSource(getSrc(), { mode: 'off', value: '' });
				typeDropdown.setValue(current.mode);
				typeDropdown.onChange(v => {
					const cur = normalizeSource(getSrc(), { mode: 'off', value: '' });
					setAndSave({ ...cur, mode: v as any });
				});
			}).addText(input => {
				// Value input with $-autocomplete (when template/path)
				input.setPlaceholder(translate('settings.jiraMapping.value.placeholder'));
				suggest = new TokenSuggest(plugin.app, input.inputEl);
				suggest.setPreviewResolver(previewResolver)
				suggest.setTokens(collectTokens());

				input.onChange(v => {
					const cur = normalizeSource(getSrc(), { mode: 'off', value: '' });
					if (cur.value !== v) setAndSave({ ...cur, value: v });
				});
			}).addExtraButton(resetBtn => {
				resetBtn
					.setIcon('rotate-ccw')
					.setTooltip(translate('common.resetToDefault'))
					.onClick(() => {
					// reset from defaults by label
					const def = (DEFAULT_JIRA_FIELD_MAPPING as any)[property] as JiraValueSource | undefined;
					if (def) setAndSave({ ...def });
				});
				resetBtn.extraSettingsEl.addClass('tasknotes-settings__inline');						
			}).setDesc(translate('settings.jiraMapping.preview.hint'));


		const renderScalarSetting = () => { refreshSetting(getSrc(), scalarSetting, opts?.preview !== false, suggest); };

		fieldRows.push(renderScalarSetting);
	};

	const addArrayRow = (
		labelKey: TranslationKey,
		property: keyof JiraFieldMappingSettings,
		getList: () => JiraArraySource[] | undefined,
		setList: (arraySources: JiraArraySource[]) => void
	) => {
		const setAndSave = (arraySources: JiraArraySource[], render: () => void) => {
			setList(arraySources);
			save();
			render();
		};

		const arraySetting = new Setting(container).setName(translate(labelKey));
		const mappingArrayEl = arraySetting.controlEl.createDiv({ cls: 'tasknotes-settings__jira-arr' });

		const renderArraySetting = () => {
			mappingArrayEl.empty();
			const arraySources = getList() ?? [];
			arraySources.forEach((src, idx) => {
				const line = mappingArrayEl.createDiv({ cls: 'tasknotes-settings__jira-arr-line' });

				var suggest: TokenSuggest | null = null;
				const arrayRowSetting = new Setting(line).addDropdown(typeDropdown => {
					typeDropdown
						.addOption('template', translate('settings.jiraMapping.mapping.mode.template'))
						.addOption('path', translate('settings.jiraMapping.mapping.mode.path'))
						.addOption('fixed', translate('settings.jiraMapping.mapping.mode.fixed'))
						.setValue(src.mode)
						.onChange(value => {
							const cp = [...arraySources];
							cp[idx] = { ...src, mode: value as any };
							setAndSave(cp, () => refreshSetting(cp[idx], arrayRowSetting, true, suggest));
						});
				}).addText(input => {
					input
						.setValue(src.value)
						.onChange(v => {
							const cp = [...arraySources];
							cp[idx] = { ...src, value: v };
							setAndSave(cp, () => refreshSetting(cp[idx], arrayRowSetting, true, suggest));
						});
					suggest = new TokenSuggest(plugin.app, input.inputEl);
					suggest.setTokens(tokens);
				}).addExtraButton(deleteBtn => {
					deleteBtn
						.setIcon('x')
						.setTooltip(translate('common.remove'))
						.onClick(() => {
							const cp = [...arraySources];
							cp.splice(idx, 1);
							setAndSave(cp, () => rerenderFields());
						});
				}).setDesc(translate('settings.jiraMapping.preview.hint')); // may be updated below

				refreshSetting(src, arrayRowSetting, true, suggest);
			});

			const add = new Setting(mappingArrayEl).addExtraButton(b => {
				b.setIcon('circle-plus').setTooltip('Add source').onClick(() => {
					const cp = [...(getList() ?? [])];
					cp.push({ mode: 'path', value: '' });
					setAndSave(cp, () => rerenderFields());
				});
			});

		};

		fieldRows.push(renderArraySetting);
	};

	// rows
	createSectionHeader(container, translate('settings.jiraMapping.header'));
	createHelpText(container, translate('settings.jiraMapping.description'));
	addScalarRow('settings.jiraMapping.fields.title', 'title', () => settings.title, v => settings.title = v, { template: true, preview: true });
	addScalarRow('settings.jiraMapping.fields.id', 'id', () => settings.id, v => settings.id = v, { template: true, preview: true });
	addScalarRow('settings.jiraMapping.fields.details', 'details', () => settings.details, v => settings.details = v, { template: true, preview: true });

	addScalarRow('settings.jiraMapping.fields.status', 'status', () => settings.status, v => settings.status = v, { preview: true });
	addScalarRow('settings.jiraMapping.fields.priority', 'priority', () => settings.priority, v => settings.priority = v, { preview: true });

	addScalarRow('settings.jiraMapping.fields.due', 'due', () => settings.due, v => settings.due = v, { preview: true });
	addScalarRow('settings.jiraMapping.fields.scheduled', 'scheduled', () => settings.scheduled, v => settings.scheduled = v, { preview: true });
	addScalarRow('settings.jiraMapping.fields.timeEstimate', 'timeEstimate', () => settings.timeEstimate, v => settings.timeEstimate = v, { preview: true });
	addScalarRow('settings.jiraMapping.fields.points', 'points', () => settings.points, v => settings.points = v, { preview: true });
	addScalarRow('settings.jiraMapping.fields.dateCreated', 'dateCreated', () => settings.dateCreated, v => settings.dateCreated = v, { preview: true });
	addScalarRow('settings.jiraMapping.fields.dateModified', 'dateModified', () => settings.dateModified, v => settings.dateModified = v, { preview: true });
	addScalarRow('settings.jiraMapping.fields.completedDate', 'completedDate', () => settings.completedDate, v => settings.completedDate = v, { preview: true });
	addScalarRow('settings.jiraMapping.fields.recurrence', 'recurrence', () => settings.recurrence, v => settings.recurrence = v, { preview: true });

	addArrayRow('settings.jiraMapping.fields.tags', 'tags', () => settings.tags, xs => settings.tags = xs);
	addArrayRow('settings.jiraMapping.fields.projects', 'projects', () => settings.projects, xs => settings.projects = xs); // no default
	addArrayRow('settings.jiraMapping.fields.contexts', 'contexts', () => settings.contexts, xs => settings.contexts = xs); // no default

	// --- Enum remaps (status/priority/contexts)
	const addEnumEditor = (
		titleKey: string,
		property: keyof JiraFieldMappingSettings,
		getPairs: () => EnumRemapPair[] | undefined,
		setPairs: (enumPairs: EnumRemapPair[]) => void,
		leftValues: string[]
	) => {
		const setAndSave = (idx: number, taskValue: string, jiraValues: string[]) => {
			const updatedPairs = [...getPairs() ?? []];
			updatedPairs[idx] = { taskValue: taskValue, jiraValues: jiraValues };
			setPairs(updatedPairs);
			save();
		};

		const box = new Setting(container)
			.setName(translate(titleKey))
			.setDesc(translate('settings.jiraMapping.mapping.enumRemap.description'));
		const host = box.controlEl.createDiv();

		const renderEnumSetting = () => {
			host.empty();
			const pairs = getPairs() ?? [];
			pairs.forEach((enumPair, idx) => {
				const row = host.createDiv({ cls: 'tasknotes-settings__jira-enum' });
				// left: TaskNotes value (dropdown from your configured values)
				new Setting(row)
					.addText(t => {
						// right: CSV of JIRA values mapping to that TaskNotes value
						t.setPlaceholder(translate('settings.jiraMapping.mapping.enumRemap.jiraValues.placeholder'));
						t.setValue((enumPair.jiraValues ?? []).join(', '));
						t.onChange(v => {
							setAndSave(idx, enumPair.taskValue, v.split(',').map(s => s.trim()).filter(Boolean));
						});
					}).addDropdown(statusDropdown => {
						leftValues.forEach(v => statusDropdown.addOption(v, v));
						statusDropdown.setValue(enumPair.taskValue ?? '');
						statusDropdown.onChange(value => {
							setAndSave(idx, value, enumPair.jiraValues);
							const cp = [...getPairs() ?? []];
							cp[idx] = { ...enumPair, taskValue: value };
							setPairs(cp);
							save();
						});
					}).addExtraButton(b =>
						b.setIcon('x')
							.setTooltip(translate('common.remove'))
							.onClick(() => {
								const cp = [...getPairs() ?? []];
								cp.splice(idx, 1);
								setPairs(cp);
								save();
								renderEnumSetting();
							}));
			});

			new Setting(host).addExtraButton(addMappingBtn => {
				addMappingBtn
					.setIcon('circle-plus')
					.setTooltip(translate('settings.jiraMapping.mapping.enumRemap.addMapping'))
					.onClick(() => {
						const cp = [...(getPairs() ?? [])];
						cp.push({ taskValue: leftValues[0] ?? '', jiraValues: [] });
						setPairs(cp);
						save();
						renderEnumSetting();
					});
			});
		};

		fieldRows.push(renderEnumSetting);
	};

	// pull configured TaskNotes values for status/priority/contexts
	const statuses = (plugin.settings.customStatuses ?? []).map((s: any) => s.value) as string[];	   // from your Task Properties tab UI :contentReference[oaicite:6]{index=6}
	const priorities = (plugin.settings.customPriorities ?? []).map((p: any) => p.value) as string[];   // analogous list
	// await plugin.waitForCacheReady();
	// const contexts = plugin.cacheManager.getAllContexts();
	// const contextVals = (contexts ?? []).map((c: any) => c.value) as string[];	// if you expose contexts similarly

	addEnumEditor('settings.jiraMapping.fields.status', 'status', () => settings.statusMap, xs => settings.statusMap = xs, statuses);
	addEnumEditor('settings.jiraMapping.fields.priority', 'priority', () => settings.priorityMap, xs => settings.priorityMap = xs, priorities);
	// addEnumEditor('settings.jiraMapping.fields.contexts', 'contexts', () => settings.contextsMap, xs => settings.contextsMap = xs, contextVals);

	// --- Re-render helpers
	function rerenderFields() { fieldRows.forEach(fn => fn()); }

	rerenderFields();
}
