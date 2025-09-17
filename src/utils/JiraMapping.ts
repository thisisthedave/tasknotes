import { TaskCreationData, TaskInfo } from 'src/types';
import type { IJiraIssue } from 'src/types/obsidian-jira-issue';
import { EnumRemapPair, JiraFieldMappingSettings } from 'src/types/settings';
import { sanitizeNoteTitle } from './helpers';

type Json = any;

export function getByPath(root: Json, path: string): unknown {
	if (!path) return undefined;
	// supports: a.b.c, a[].name (project across arrays), and indexes a[0].b
	const parts = path.split('.');

	function step(cur: any, seg: string): any {
		if (cur == null) return undefined;

		// a[].x → map each item then flatten
		const m = seg.match(/^([^\[\]]+)(\[(.*?)\])?$/); // name + optional [..]
		if (!m) return undefined;
		const name = m[1];
		const bracket = m[2];

		let next = cur[name];
		if (!bracket) return next;

		// []
		if (bracket === '[]') {
			if (!Array.isArray(next)) return undefined;
			return next.flat();
		}

		// [n]
		const idx = Number(bracket.slice(1, -1));
		if (Number.isFinite(idx)) {
			return Array.isArray(next) ? next[idx] : undefined;
		}
		return next;
	}

	// First pass to resolve names/indices
	let cur: any = root;
	for (const seg of parts) {
		// project operator: foo[].bar
		if (seg.endsWith('[]')) {
			const base = seg.slice(0, -2);
			const arr = step(cur, base);
			if (!Array.isArray(arr)) return undefined;
			// peek next for projection
			const rest = parts.slice(parts.indexOf(seg) + 1);
			return arr.map(v => getByPath(v, rest.join('.'))).flat().filter(x => x != null);
		}
		cur = step(cur, seg);
	}
	return cur;
}

// sanitize display names into token-safe identifiers: "Story Points" -> "Story_Points"
export function sanitizeJiraFieldName(s: string): string { return s.replace(/[^a-zA-Z0-9._\[\]]+/g, '_'); }

export function resolveTokenToPath(token: string, issue: IJiraIssue): string {
  const aliases = buildAliasMap(issue);
  // exact or lowercase match; also allow raw customfield_* and fields.*
  return (
    aliases[token] ??
    aliases[token.toLowerCase()] ??
    (token.startsWith('fields.') ? token : token.startsWith('customfield_') ? `fields.${token}` : token)
  );
}

// Build an alias map once per render from issue metadata
function buildAliasMap(ctx: IJiraIssue): Record<string, string> {
  const map: Record<string, string> = {
    key: 'key',
    id: 'id',
    summary: 'fields.summary',
    description: 'fields.description',
  };

  // prefer metadata on the issue; fall back to plugin API cache if you want (optional)
  const cfMap =
    (ctx as any)?.customFieldsNameToId ||
    (ctx as any)?.fields?.customFieldsNameToId; // tolerate either location if present

  if (cfMap && typeof cfMap === 'object') {
    for (const [name, id] of Object.entries<string>(cfMap as Record<string, string>)) {
      const token = sanitizeJiraFieldName(String(name));
      const path = `fields.customfield_${id}`;
      // support case-insensitive tokens by adding lowercased alias too
      map[token] = path;
      map[token.toLowerCase()] = path;
    }
  }

  return map;
}

export function renderTemplate(tpl: string, ctx: IJiraIssue): string {
  const aliases = buildAliasMap(ctx);

  // $token = $[a-zA-Z0-9._[]]+  (underscores are already allowed)
  return tpl
    .replace(/\$[a-zA-Z0-9._\[\]]+/g, (m) => {
      const raw = m.slice(1);

      // 1) alias by exact or lowercased token (handles $Design and $Story_Points)
      const aliased =
        aliases[raw] ??
        aliases[raw.toLowerCase()] ??
        // 2) allow $customfield_12345 as shorthand for fields.customfield_12345
        (/^customfield_\d+(\..*)?$/i.test(raw) ? `fields.${raw}` : undefined);

      // 3) built-ins and passthroughs
      const keyPath =
        aliased ??
        (raw === 'summary' ? 'fields.summary'
          : raw === 'description' ? 'fields.description'
          : raw === 'key' ? 'key'
          : raw.startsWith('fields.') ? raw
          : raw);

      const value = getByPath(ctx, keyPath);
      if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
      if (value == null) return '';
      return String(value);
    })
    .replace(/\\n/g, '\n')
    .trim();
}


const toArray = (v: unknown): string[] =>
	v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)];

const dedupe = (xs: string[]) => Array.from(new Set(xs.map(x => x.trim()).filter(Boolean)));

const remapEnum = (incoming: string | undefined, table?: EnumRemapPair[]) => {
	if (!incoming || !table || table.length === 0) return incoming;
	const hit = table.find(p => p.jiraValues.some(j => j.toLowerCase() === incoming.toLowerCase()));
	return hit?.taskValue ?? incoming;
};

function readSource(src: { mode: string, value: string } | undefined, issue: IJiraIssue): unknown {
	if (!src || src.mode === 'off') return undefined;
	if (src.mode === 'fixed') return src.value;
	if (src.mode === 'template') return renderTemplate(src.value, issue);
	if (src.mode === 'path') return getByPath(issue, src.value);
	return undefined;
}

export function mapFromJiraIssueWithConfig(
	issue: IJiraIssue,
	cfg: JiraFieldMappingSettings
): Partial<TaskInfo> {
	const out: Partial<TaskInfo> = {};

	// 1) scalar/template fields
	const id = readSource(cfg.id, issue);
	const titleRaw = readSource(cfg.title, issue);
	const detailsRaw = readSource(cfg.details, issue);

	if (id != null) out.id = String(id);

	// Always sanitize note title (required field)
	const title = sanitizeNoteTitle(String(titleRaw ?? `${issue.key} ${issue.fields.summary}`));
	const bodyTop = `JIRA:${issue.key}`; // always include JIRA key at top
	const details = String(detailsRaw ?? '');
	out.title = `${title}\n${bodyTop}${details ? `\n${details}` : ''}`; // Task modal NLP parsing will extract description from title

	// Enumerations
	const statusRaw = readSource(cfg.status, issue);
	const priorityRaw = readSource(cfg.priority, issue);
	out.status = remapEnum(statusRaw ? String(statusRaw) : undefined, cfg.statusMap) ?? '';
	out.priority = remapEnum(priorityRaw ? String(priorityRaw) : undefined, cfg.priorityMap) ?? '';

	// Dates/Nums
	const due = readSource(cfg.due, issue); if (due) out.due = String(due);
	const scheduled = readSource(cfg.scheduled, issue); if (scheduled) out.scheduled = String(scheduled);
	const points = readSource(cfg.points, issue); if (points != null && points !== '') out.points = Number(points);
	const dateCreated = readSource(cfg.dateCreated, issue); if (dateCreated) out.dateCreated = String(dateCreated);
	const dateModified = readSource(cfg.dateModified, issue); if (dateModified) out.dateModified = String(dateModified);
	const completedDate = readSource(cfg.completedDate, issue); if (completedDate) out.completedDate = String(completedDate);
	const recurrence = readSource(cfg.recurrence, issue); if (recurrence) out.recurrence = String(recurrence);

	// timeEstimate (JIRA seconds -> minutes)
	const te = readSource(cfg.timeEstimate, issue);
	if (te != null && te !== '') {
		const secs = Number(te);
		if (!Number.isNaN(secs)) out.timeEstimate = Math.floor(secs / 60);
	}

	// Worklogs → totalTrackedTime (minutes)
	const wls = readSource(cfg.timeEntries, issue);
	if (Array.isArray(wls)) {
		const mins = wls.reduce((acc: number, wl: any) => acc + (Number(wl?.timeSpentSeconds) || 0), 0);
		out.totalTrackedTime = Math.floor(mins / 60);
		out.timeEntries = wls.map(wl => ({
			startTime: String(wl.started),
			endTime: undefined,
			description: wl.comment,
			duration: Math.floor((Number(wl.timeSpentSeconds) || 0) / 60),
		}));
	} else {
		const agg = readSource(cfg.totalTrackedTime, issue);
		if (agg != null && agg !== '') {
			const secs = Number(agg);
			if (!Number.isNaN(secs)) out.totalTrackedTime = Math.floor(secs / 60);
		}
	}

	// Arrays: merge all configured sources, flatten & dedupe
	const tags = (cfg.tags ?? []).flatMap(s => toArray(readSource(s, issue)));
	if (tags.length) out.tags = dedupe(tags);

	const projects = (cfg.projects ?? []).flatMap(s => toArray(readSource(s, issue)));
	if (projects.length) out.projects = dedupe(projects);

	const contextsRaw = (cfg.contexts ?? []).flatMap(s => toArray(readSource(s, issue)));
	const contextsRemapped = contextsRaw.map(v => remapEnum(v, cfg.contextsMap) ?? v);
	if (contextsRemapped.length) out.contexts = dedupe(contextsRemapped);

	// done
	return out;
}
