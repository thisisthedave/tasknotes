import { Setting, TextComponent, AbstractInputSuggest, setIcon, Notice, App, ExtraButtonComponent } from 'obsidian';
import TaskNotesPlugin from '../../main';
import { createSectionHeader, createHelpText } from '../components/settingHelpers';
import type { IJiraIssue } from 'src/types/obsidian-jira-issue';
import { getByPath, renderTemplate, resolveTokenToPath, sanitizeJiraFieldName } from 'src/utils/JiraMapping';
import { EnumRemapPair, JiraArraySource, JiraFieldMappingSettings, JiraValueSource } from 'src/types/settings';
import { DEFAULT_JIRA_FIELD_MAPPING } from '../defaults';
import { TaskInfo } from 'src/types';

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

	const settings: JiraFieldMappingSettings = plugin.settings.jiraMapping ?? (plugin.settings.jiraMapping = structuredClone(DEFAULT_JIRA_FIELD_MAPPING));

	// --- Sample issue fetcher
	createSectionHeader(container, 'Jira Sample Data');
	createHelpText(container,
		'Load a JIRA issue to preview field mappings. Requires the "Jira Issue" plugin to be installed and configured.');

	let sampleIssue: IJiraIssue | null = null;

	let issueKeyInput: TextComponent;
	let issueFetchButton: ExtraButtonComponent;
	let tokens: { token: string, preview?: string }[] = [];

	async function fetchIssue() {
		const key = issueKeyInput.getValue().trim();
		if (!key) { sampleIssue = null; new Notice('Enter an issue key'); return; }

		const jira = plugin.app.plugins.getPlugin('obsidian-jira-issue');
		if (!jira?.api?.base?.getIssue) {
			new Notice('"Jira Issue" plugin not installed or not enabled');
			return;
		}

		// simple loading state
		issueFetchButton.setDisabled(true);
		try {
			sampleIssue = await jira.api.base.getIssue(key);
			new Notice(`Loaded ${sampleIssue.key}`);
		} catch (e) {
			new Notice(`Could not load ${key}`);
			sampleIssue = null;
		} finally {
			issueFetchButton.setDisabled(false);
			tokens = collectTokens();
			rerenderFields();
		}
	}
	const fetchRow = new Setting(container)
		.setName('Sample issue (for autocomplete & preview)')
		.setDesc('Enter a JIRA issue key like JIRA-123.')
		.addText((t) => {
			issueKeyInput = t;
			t.setPlaceholder('JIRA-123');

			// Press Enter to fetch (optional but nice)
			t.inputEl.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') fetchIssue();
			});
		})
		.addExtraButton((btn) => {
			issueFetchButton = btn;
			btn.setIcon('search').setTooltip('Fetch issue');
			btn.onClick(fetchIssue);
		});


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
			valueInput.inputEl.placeholder = jiraSrc.mode === 'fixed' ? 'Constant value' : jiraSrc.mode === 'path' ? 'fields.xyz' : '$tokens allowed';
		}
		if (suggest) suggest.setTokens(tokens);

		if (sampleIssue && preview) {
			let val: any = undefined;
			if (jiraSrc.mode === 'template') val = renderTemplate(jiraSrc.value, sampleIssue);
			else if (jiraSrc.mode === 'path') val = getByPath(sampleIssue, jiraSrc.value);
			else if (jiraSrc.mode === 'fixed') val = jiraSrc.value;
			setting.setDesc(val == null ? 'Preview: <no value>' : `Preview: ${Array.isArray(val) ? val.join(', ') : String(val)}`);
		} else {
			setting.setDesc('');
		}
	};

	const addScalarRow = (
		label: string,
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
			.setName(label)
			.addDropdown(typeDropdown => {
				typeDropdown.addOption('template', 'Template');
				typeDropdown.addOption('path', 'Field path');
				typeDropdown.addOption('fixed', 'Fixed');
				typeDropdown.addOption('off', 'Off');
				const current = normalizeSource(getSrc(), { mode: 'off', value: '' });
				typeDropdown.setValue(current.mode);
				typeDropdown.onChange(v => {
					const cur = normalizeSource(getSrc(), { mode: 'off', value: '' });
					setAndSave({ ...cur, mode: v as any });
				});
			}).addText(input => {
				// Value input with $-autocomplete (when template/path)
				input.setPlaceholder('e.g., $key or fields.summary');
				suggest = new TokenSuggest(plugin.app, input.inputEl);
				suggest.setPreviewResolver(previewResolver)
				suggest.setTokens(collectTokens());

				input.onChange(v => {
					const cur = normalizeSource(getSrc(), { mode: 'off', value: '' });
					if (cur.value !== v) setAndSave({ ...cur, value: v });
				});
			}).addExtraButton(resetBtn => {
				resetBtn.setIcon('rotate-ccw').setTooltip('Reset to default').onClick(() => {
					// reset from defaults by label
					const def = (DEFAULT_JIRA_FIELD_MAPPING as any)[property] as JiraValueSource | undefined;
					if (def) setAndSave({ ...def });
				});
				resetBtn.extraSettingsEl.addClass('tasknotes-settings__inline');
			}).setDesc('Load a sample issue to preview'); // may be updated below


		const renderScalarSetting = () => { refreshSetting(getSrc(), scalarSetting, opts?.preview !== false, suggest); };

		fieldRows.push(renderScalarSetting);
	};

	const addArrayRow = (
		label: string,
		property: keyof JiraFieldMappingSettings,
		getList: () => JiraArraySource[] | undefined,
		setList: (arraySources: JiraArraySource[]) => void
	) => {
		const setAndSave = (arraySources: JiraArraySource[], render: () => void) => {
			setList(arraySources);
			save();
			render();
		};

		const arraySetting = new Setting(container).setName(label);
		const mappingArrayEl = arraySetting.controlEl.createDiv({ cls: 'tasknotes-settings__jira-arr' });

		const renderArraySetting = () => {
			mappingArrayEl.empty();
			const arraySources = getList() ?? [];
			arraySources.forEach((src, idx) => {
				const line = mappingArrayEl.createDiv({ cls: 'tasknotes-settings__jira-arr-line' });

				var suggest: TokenSuggest | null = null;
				const arrayRowSetting = new Setting(line).addDropdown(typeDropdown => {
					typeDropdown
						.addOption('template', 'Template')
						.addOption('path', 'Field path')
						.addOption('fixed', 'Fixed')
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
						.setTooltip('Remove source')
						.onClick(() => {
							const cp = [...arraySources];
							cp.splice(idx, 1);
							setAndSave(cp, () => rerenderFields());
						});
				}).setDesc('Load a sample issue to preview'); // may be updated below

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

	// ---- rows

	createSectionHeader(container, 'Jira Field Mapping');
	createHelpText(container,
		'Map JIRA issue data into TaskNotes fields. Use $tokens in templates (e.g., $key, $fields.summary, $fields.parent.key). Enter an issue key to preview values.');
	addScalarRow('Title', 'title', () => settings.title, v => settings.title = v, { template: true, preview: true });
	addScalarRow('ID', 'id', () => settings.id, v => settings.id = v, { template: true, preview: true });
	addScalarRow('Details', 'details', () => settings.details, v => settings.details = v, { template: true, preview: true });

	addScalarRow('Status', 'status', () => settings.status, v => settings.status = v, { preview: true });
	addScalarRow('Priority', 'priority', () => settings.priority, v => settings.priority = v, { preview: true });

	addScalarRow('Due', 'due', () => settings.due, v => settings.due = v, { preview: true });
	addScalarRow('Scheduled', 'scheduled', () => settings.scheduled, v => settings.scheduled = v, { preview: true });
	addScalarRow('Time Estimate', 'timeEstimate', () => settings.timeEstimate, v => settings.timeEstimate = v, { preview: true });
	addScalarRow('Points', 'points', () => settings.points, v => settings.points = v, { preview: true });
	addScalarRow('Date Created', 'dateCreated', () => settings.dateCreated, v => settings.dateCreated = v, { preview: true });
	addScalarRow('Date Modified', 'dateModified', () => settings.dateModified, v => settings.dateModified = v, { preview: true });
	addScalarRow('Completed Date', 'completedDate', () => settings.completedDate, v => settings.completedDate = v, { preview: true });
	addScalarRow('Recurrence', 'recurrence', () => settings.recurrence, v => settings.recurrence = v, { preview: true });

	addArrayRow('Tags', 'tags', () => settings.tags, xs => settings.tags = xs);
	addArrayRow('Projects', 'projects', () => settings.projects, xs => settings.projects = xs); // no default
	addArrayRow('Contexts', 'contexts', () => settings.contexts, xs => settings.contexts = xs); // no default

	// --- Enum remaps (status/priority/contexts)
	const addEnumEditor = (
		title: string,
		property: keyof JiraFieldMappingSettings,
		getPairs: () => EnumRemapPair[] | undefined,
		setPairs: (xs: EnumRemapPair[]) => void,
		leftValues: string[]
	) => {
		const box = new Setting(container).setName(`${title} remapping`).setDesc('Convert incoming JIRA values to your TaskNotes values.');
		const host = box.controlEl.createDiv();

		const renderEnumSetting = () => {
			host.empty();
			const pairs = getPairs() ?? [];
			pairs.forEach((p, i) => {
				const row = host.createDiv({ cls: 'tasknotes-settings__jira-enum' });
				// left: TaskNotes value (dropdown from your configured values)
				new Setting(row)
					.addText(t => {
						// right: CSV of JIRA values mapping to that TaskNotes value
						t.setPlaceholder('JIRA values (comma separated)');
						t.setValue((p.jiraValues ?? []).join(', '));
						t.onChange(v => {
							const cp = [...pairs];
							cp[i] = { ...p, jiraValues: v.split(',').map(s => s.trim()).filter(Boolean) };
							setPairs(cp);
							save();
						});
					}).addDropdown(d => {
						leftValues.forEach(v => d.addOption(v, v));
						d.setValue(p.taskValue ?? '');
						d.onChange(v => {
							const cp = [...pairs];
							cp[i] = { ...p, taskValue: v };
							setPairs(cp);
							save();
						});
					}).addExtraButton(b =>
						b.setIcon('x')
							.setTooltip('Remove')
							.onClick(() => {
								const cp = [...pairs];
								cp.splice(i, 1);
								setPairs(cp);
								save();
								renderEnumSetting();
							}));
			});

			new Setting(host).addExtraButton(b => {
				b.setIcon('circle-plus').setTooltip('Add mapping').onClick(() => { const cp = [...(getPairs() ?? [])]; cp.push({ taskValue: leftValues[0] ?? '', jiraValues: [] }); setPairs(cp); save(); renderEnumSetting(); });
			});
		};

		fieldRows.push(renderEnumSetting);
	};

	// pull configured TaskNotes values for status/priority/contexts
	const statuses = (plugin.settings.customStatuses ?? []).map((s: any) => s.value) as string[];	   // from your Task Properties tab UI :contentReference[oaicite:6]{index=6}
	const priorities = (plugin.settings.customPriorities ?? []).map((p: any) => p.value) as string[];   // analogous list
	await plugin.waitForCacheReady();
	const contexts = plugin.cacheManager.getAllContexts();
	const contextVals = (contexts ?? []).map((c: any) => c.value) as string[];	// if you expose contexts similarly

	addEnumEditor('Status', 'status', () => settings.statusMap, xs => settings.statusMap = xs, statuses);
	addEnumEditor('Priority', 'priority', () => settings.priorityMap, xs => settings.priorityMap = xs, priorities);
	// addEnumEditor('Contexts', 'contexts', () => settings.contextsMap, xs => settings.contextsMap = xs, contextVals);

	// --- Re-render helpers
	function rerenderFields() { fieldRows.forEach(fn => fn()); }

	rerenderFields();
}
