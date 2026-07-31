// Bookmark tree utilities: traversal, sorting, validation. Kept UI-free for easy testing.

import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { BmItem, DEFAULT_SETTINGS, SortSpec, newId } from "./types";
import { T } from "./strings";

// ---------- Import converters ----------

// Where a raw item being imported came from: the core plugin, or our own export.
// The two formats differ only in the timestamp field and our extra fields.
export type ImportSource = "core" | "own";

// Convert one raw item into ours. Unsupported types (and junk) yield null.
// Fresh ids are assigned so an import never collides with existing bookmarks.
export function importItem(raw: any, from: ImportSource): BmItem | null {
	if (!raw || typeof raw !== "object") return null;
	const stamp = from === "core" ? raw.ctime : raw.added;
	const base: BmItem = {
		id: newId(),
		type: raw.type,
		added: typeof stamp === "number" ? stamp : Date.now(),
		title: raw.title || undefined,
	};
	// Only our own format carries these
	if (from === "own") {
		base.color = raw.color || undefined;
		base.hidden = raw.hidden || undefined;
	}
	switch (raw.type) {
		case "file":
			return { ...base, path: raw.path, subpath: raw.subpath || undefined };
		case "folder":
			return { ...base, path: raw.path };
		case "search":
			return { ...base, query: raw.query };
		case "url":
			return { ...base, url: raw.url };
		case "graph":
			// The options blob is kept as-is so it can be handed straight back to the graph view
			return { ...base, options: raw.options };
		case "group": {
			const group: BmItem = { ...base, title: raw.title ?? "", items: [] };
			if (from === "own") {
				group.collapsed = raw.collapsed || undefined;
				group.sort = raw.sort || undefined;
			}
			for (const child of raw.items ?? []) {
				const c = importItem(child, from);
				if (c) group.items!.push(c);
			}
			return group;
		}
		default:
			return null;
	}
}

// Convert one of our items into the core Bookmarks format (for export). Lossy:
// plugin-only fields (color, hidden, collapsed, per-group sort) are dropped.
export function toCoreItem(it: BmItem): any {
	const out: any = { type: it.type, ctime: it.added };
	if (it.title) out.title = it.title;
	if (it.type === "file") {
		out.path = it.path;
		if (it.subpath) out.subpath = it.subpath;
	} else if (it.type === "folder") {
		out.path = it.path;
	} else if (it.type === "search") {
		out.query = it.query;
	} else if (it.type === "url") {
		out.url = it.url;
	} else if (it.type === "graph") {
		out.options = it.options;
	} else if (it.type === "group") {
		out.items = (it.items ?? []).map(toCoreItem);
	}
	return out;
}

// ---------- Tree traversal ----------

// Visit every item along with its (parent list, index)
export function walk(
	items: BmItem[],
	fn: (item: BmItem, parent: BmItem[], index: number) => void
): void {
	// Iterate in reverse so callbacks may splice items out
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i];
		if (it.items) walk(it.items, fn);
		fn(it, items, i);
	}
}

export function flatten(items: BmItem[]): BmItem[] {
	const out: BmItem[] = [];
	walk(items, (it) => out.push(it));
	return out;
}

export function findParentList(root: BmItem[], id: string): { list: BmItem[]; index: number } | null {
	let found: { list: BmItem[]; index: number } | null = null;
	walk(root, (it, list, index) => {
		if (it.id === id) found = { list, index };
	});
	return found;
}

export function findById(root: BmItem[], id: string): BmItem | null {
	const loc = findParentList(root, id);
	return loc ? loc.list[loc.index] : null;
}

// All groups (for the group picker), each with its path label
export function allGroups(root: BmItem[]): { group: BmItem; label: string }[] {
	const out: { group: BmItem; label: string }[] = [];
	const rec = (items: BmItem[], prefix: string) => {
		for (const it of items) {
			if (it.type === "group") {
				const label = prefix ? `${prefix} / ${it.title ?? ""}` : it.title ?? "";
				out.push({ group: it, label });
				if (it.items) rec(it.items, label);
			}
		}
	};
	rec(root, "");
	return out;
}

// Id of the group directly containing an item, or null when it sits at the top level
export function parentGroupId(root: BmItem[], id: string): string | null {
	let result: string | null = null;
	const rec = (items: BmItem[], groupId: string | null) => {
		for (const it of items) {
			if (it.id === id) {
				result = groupId;
				return;
			}
			if (it.type === "group" && it.items) rec(it.items, it.id);
		}
	};
	rec(root, null);
	return result;
}

// Groups in the order the panel displays them, so pickers list them exactly as the user
// sees them. Each level is sorted with the sort actually in effect there.
export function orderedGroups(
	app: App,
	root: BmItem[],
	defaultSort: SortSpec
): { group: BmItem; label: string }[] {
	const out: { group: BmItem; label: string }[] = [];
	const rec = (items: BmItem[], prefix: string, inherited: SortSpec) => {
		for (const it of sortItems(app, items, inherited)) {
			if (it.type !== "group") continue;
			const label = prefix ? `${prefix} / ${it.title ?? ""}` : it.title ?? "";
			out.push({ group: it, label });
			if (it.items) rec(it.items, label, it.sort ?? inherited);
		}
	};
	rec(root, "", defaultSort);
	return out;
}

// The same list for the add/edit dialog dropdown: a stable id plus its path label
export function groupChoices(app: App, root: BmItem[], defaultSort: SortSpec): { id: string; label: string }[] {
	return orderedGroups(app, root, defaultSort).map((g) => ({ id: g.group.id, label: g.label }));
}

// Clear every sort override, and put the global order back to the default
export function resetAllSorts(root: BmItem[]): SortSpec {
	for (const it of flatten(root)) {
		if (it.type === "group") it.sort = undefined;
	}
	return { ...DEFAULT_SETTINGS.defaultSort };
}

// ---------- Display names ----------

// The target's own name, ignoring any custom title (file base name, search query, URL, ...)
export function originalName(it: BmItem): string {
	if (it.type === "search") return it.query ?? "";
	if (it.type === "url") return it.url ?? "";
	// A graph bookmark has no target name of its own; it relies on its title
	if (it.type === "graph") return "";
	if (!it.path) return "";
	const base = it.path.split("/").pop() ?? it.path;
	// Hide the extension for notes (same behavior as core Bookmarks)
	return base.replace(/\.md$/, "");
}

export function displayName(it: BmItem): string {
	if (it.title) return it.title;
	if (it.type === "graph") return T.untitledGraph;
	const name = originalName(it);
	return it.type !== "search" && it.subpath ? `${name} ${it.subpath}` : name;
}

// ---------- Sorting ----------

export function sortItems(app: App, items: BmItem[], spec: SortSpec): BmItem[] {
	// Custom is the manual (drag & drop) order; descending just shows it bottom-up
	if (spec.key === "custom") return spec.asc ? items : [...items].reverse();
	const stat = (it: BmItem): { mtime: number; ctime: number; ext: string } => {
		const f = it.path ? app.vault.getAbstractFileByPath(it.path) : null;
		if (f instanceof TFile) return { mtime: f.stat.mtime, ctime: f.stat.ctime, ext: f.extension };
		return { mtime: 0, ctime: 0, ext: "" };
	};
	const dir = spec.asc ? 1 : -1;
	// Groups always stay on top (same convention as core Bookmarks)
	const groups = items.filter((i) => i.type === "group");
	const rest = items.filter((i) => i.type !== "group");
	const cmpName = (a: BmItem, b: BmItem) =>
		displayName(a).localeCompare(displayName(b), undefined, { numeric: true, sensitivity: "base" });
	const cmp = (a: BmItem, b: BmItem): number => {
		let r = 0;
		switch (spec.key) {
			case "name": r = cmpName(a, b); break;
			case "added": r = a.added - b.added; break;
			case "mtime": r = stat(a).mtime - stat(b).mtime; break;
			case "ctime": r = stat(a).ctime - stat(b).ctime; break;
			case "ext": r = stat(a).ext.localeCompare(stat(b).ext); break;
		}
		// Stabilize ties by name
		return (r || cmpName(a, b)) * dir;
	};
	groups.sort(cmpName);
	if (!spec.asc) groups.reverse();
	rest.sort(cmp);
	return [...groups, ...rest];
}

// ---------- Delete/rename sync ----------

// Find bookmarks pointing at a deleted file/folder. Folder deletion also matches descendants
export function itemsPointingTo(root: BmItem[], path: string, isFolder: boolean): BmItem[] {
	const out: BmItem[] = [];
	walk(root, (it) => {
		if (!it.path) return;
		if (it.path === path) out.push(it);
		else if (isFolder && it.path.startsWith(path + "/")) out.push(it);
	});
	return out;
}

export function applyRename(root: BmItem[], oldPath: string, newPath: string): number {
	let n = 0;
	walk(root, (it) => {
		if (!it.path) return;
		if (it.path === oldPath) { it.path = newPath; n++; }
		else if (it.path.startsWith(oldPath + "/")) {
			it.path = newPath + it.path.slice(oldPath.length);
			n++;
		}
	});
	return n;
}

// ---------- Validation / cleanup ----------

export function isBroken(app: App, it: BmItem): boolean {
	if (it.type !== "file" && it.type !== "folder") return false;
	if (!it.path) return true;
	const f: TAbstractFile | null = app.vault.getAbstractFileByPath(it.path);
	if (!f) return true;
	if (it.type === "file" && !(f instanceof TFile)) return true;
	if (it.type === "folder" && !(f instanceof TFolder)) return true;
	return false;
}

// Remove all broken bookmarks (missing target) and return the count.
// Used at startup to clean up files deleted while Obsidian was closed
export function validateAll(app: App, root: BmItem[]): number {
	let n = 0;
	walk(root, (it, list, index) => {
		if (it.type === "group") return;
		if (isBroken(app, it)) {
			n++;
			list.splice(index, 1);
		}
	});
	return n;
}

// Duplicates = bookmarks pointing at the same target (type+path+subpath+query). Keeps the first
export function findDuplicates(root: BmItem[]): BmItem[] {
	const seen = new Map<string, BmItem>();
	const dups: BmItem[] = [];
	// walk() iterates in reverse; traverse forward here to preserve order
	const rec = (items: BmItem[]) => {
		for (const it of items) {
			if (it.type === "group") { if (it.items) rec(it.items); continue; }
			const key = `${it.type}|${it.path ?? ""}|${it.subpath ?? ""}|${it.query ?? ""}`;
			if (seen.has(key)) dups.push(it);
			else seen.set(key, it);
		}
	};
	rec(root);
	return dups;
}

export function removeItems(root: BmItem[], ids: Set<string>): number {
	let n = 0;
	walk(root, (it, list, index) => {
		if (ids.has(it.id)) { list.splice(index, 1); n++; }
	});
	return n;
}

// Move items into a target group (null = top level). Moves into self/descendants are ignored
export function moveItems(root: BmItem[], ids: string[], target: BmItem | null): number {
	const targetList = target ? (target.items ?? (target.items = [])) : root;
	let n = 0;
	for (const id of ids) {
		const item = findById(root, id);
		if (!item) continue;
		// Prevent moving a group into itself or its own descendant
		if (item.type === "group" && target && (item.id === target.id || findById(item.items ?? [], target.id))) continue;
		const loc = findParentList(root, id);
		if (!loc || loc.list === targetList) continue;
		loc.list.splice(loc.index, 1);
		targetList.push(item);
		n++;
	}
	return n;
}
