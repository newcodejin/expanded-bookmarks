// Expanded Bookmarks plugin entry point

import { Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { BmItem, DEFAULT_SETTINGS, SBData, newId } from "./types";
import { ImportSource, applyRename, findById, findDuplicates, flatten, groupChoices, importItem, itemsPointingTo, moveItems, originalName, parentGroupId, removeItems, toCoreItem, validateAll } from "./data";
import { BookmarkEditModal, ConfirmModal, JsonFilePickerModal } from "./modals";
import { ExplorerHighlighter } from "./explorer";
import { SearchBookmarkFilter } from "./search-filter";
import { internalPluginInstance } from "./util";
import { BookmarksView, VIEW_TYPE } from "./view";
import { StatsModal } from "./stats";
import { SBSettingTab } from "./settings";
import { T } from "./strings";

export default class ExpandedBookmarksPlugin extends Plugin {
	data: SBData = { settings: { ...DEFAULT_SETTINGS }, root: [] };
	highlighter: ExplorerHighlighter = new ExplorerHighlighter(() => this.data.root);
	searchFilter: SearchBookmarkFilter = new SearchBookmarkFilter(this.app, () => this.data.root);

	async onload(): Promise<void> {
		await this.loadAll();

		this.registerView(VIEW_TYPE, (leaf) => new BookmarksView(leaf, this));
		this.addRibbonIcon("bookmark", T.ribbonTooltip, () => void this.activateView());
		this.addSettingTab(new SBSettingTab(this.app, this));

		// ----- Commands -----
		this.addCommand({ id: "open-view", name: T.cmdOpen, callback: () => void this.activateView() });
		this.addCommand({ id: "import-core", name: T.cmdImport, callback: () => this.importFromCore() });
		this.addCommand({ id: "import-file", name: T.cmdImportFile, callback: () => this.importFromFile() });
		this.addCommand({ id: "export", name: T.cmdExport, callback: () => void this.exportBookmarks() });
		this.addCommand({ id: "clean-broken", name: T.cmdClean, callback: () => void this.cleanBroken() });
		this.addCommand({ id: "dedupe", name: T.cmdDedupe, callback: () => void this.dedupe() });
		this.addCommand({ id: "stats", name: T.cmdStats, callback: () => this.openStats() });
		this.addCommand({
			id: "bookmark-current",
			name: T.cmdBookmarkCurrent,
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.addBookmarkFor(file);
				return true;
			},
		});
		this.addCommand({
			id: "reveal-active",
			name: T.cmdReveal,
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.revealInBookmarks(file);
				return true;
			},
		});

		// ----- Core fix: reflect file delete/rename in bookmarks -----
		this.registerEvent(
			this.app.vault.on("delete", (file) => void this.onFileDeleted(file))
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => void this.onFileRenamed(oldPath, file.path))
		);

		// Add "bookmark this" and "reveal in panel" entries to the file context menu
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				menu.addItem((i) =>
					i.setTitle(T.menuAddBookmark).setIcon("bookmark").onClick(() => void this.addBookmarkFor(file))
				);
				menu.addItem((i) =>
					i.setTitle(T.menuReveal).setIcon("search").onClick(() => void this.revealInBookmarks(file))
				);
			})
		);

		// Move the active-file highlight when the active file changes.
		// Light update only (no full re-render), so the panel's scroll position is kept.
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.forEachPanel((view) => view.updateActiveFile());
				this.updateHeaderMarkers();
			})
		);
		// Keep the file-header bookmark markers in sync as panes/layout change
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateHeaderMarkers()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.updateHeaderMarkers()));

		// Validate everything at startup (once the vault has loaded),
		// cleaning up bookmarks for files deleted while Obsidian was closed
		this.app.workspace.onLayoutReady(() => {
			const n = validateAll(this.app, this.data.root);
			if (n > 0) void this.saveAll();
			this.ensurePanel();
			this.refreshViews();
			this.updateHeaderMarkers();
			if (this.data.settings.highlightInExplorer) this.highlighter.enable();
			if (this.data.settings.searchBookmarkFilter) this.searchFilter.enable();
		});
	}

	onunload(): void {
		this.highlighter.disable();
		this.searchFilter.disable();
		// Remove any bookmark markers we added to file headers
		for (const el of Array.from(document.querySelectorAll(".sb-header-bookmark"))) el.remove();
	}

	// Show a bookmark icon in a file's header (next to the ⋮ button) only when that file
	// is bookmarked here. It's our own action button, so it coexists with the core plugin's.
	private headerButtons = new WeakMap<object, HTMLElement>();

	updateHeaderMarkers(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view: any = leaf.view;
			if (typeof view?.addAction !== "function") return;
			const file = view.file;
			const marked = file instanceof TFile && this.isFileBookmarked(file.path);
			const existing = this.headerButtons.get(view);
			const connected = existing?.isConnected ?? false;
			if (marked && !connected) {
				const btn = view.addAction("bookmark", T.headerTooltip, () => void this.addBookmarkFor(view.file));
				btn.addClass("sb-header-bookmark");
				this.headerButtons.set(view, btn);
			} else if (!marked && connected) {
				existing!.remove();
				this.headerButtons.delete(view);
			}
		});
	}

	private isFileBookmarked(path: string): boolean {
		return flatten(this.data.root).some((it) => it.type === "file" && it.path === path);
	}

	// Called from the settings toggle
	setExplorerHighlight(on: boolean): void {
		if (on) this.highlighter.enable();
		else this.highlighter.disable();
	}

	// Called from the settings toggle
	setSearchFilter(on: boolean): void {
		if (on) this.searchFilter.enable();
		else this.searchFilter.disable();
	}

	// ---------- Data load/save ----------

	async loadAll(): Promise<void> {
		const raw = (await this.loadData()) as Partial<SBData> | null;
		this.data = {
			settings: {
				...DEFAULT_SETTINGS,
				...(raw?.settings ?? {}),
				// Shallow merge would replace this nested object wholesale, so merge it
				// separately to keep defaults for actions added in later updates
				toolbarLayout: { ...DEFAULT_SETTINGS.toolbarLayout, ...(raw?.settings?.toolbarLayout ?? {}) },
			},
			root: raw?.root ?? [],
		};
		// Reset to default if a removed sort key (e.g. old clicks/path) was saved
		const valid = new Set(["custom", "name", "added", "mtime", "ctime", "ext"]);
		if (!valid.has(this.data.settings.defaultSort.key)) this.data.settings.defaultSort.key = "custom";
		for (const it of flatten(this.data.root)) {
			if (it.sort && !valid.has(it.sort.key)) it.sort = undefined;
		}
	}

	async saveAll(): Promise<void> {
		await this.saveData(this.data);
		// Refresh explorer markers, the search filter, and file-header markers when bookmarks change
		this.highlighter.refresh();
		this.searchFilter.refresh();
		this.updateHeaderMarkers();
	}

	// Run something on every open bookmark panel
	private forEachPanel(fn: (view: BookmarksView) => void): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof BookmarksView) fn(leaf.view);
		}
	}

	refreshViews(): void {
		this.forEachPanel((view) => view.render());
	}

	// Persist and re-render the panel — the common tail of every mutation
	async saveAndRefresh(): Promise<void> {
		await this.saveAll();
		this.refreshViews();
	}

	// ---------- Opening the view ----------

	// Auto-add the panel to the left sidebar at startup.
	// Leaves an existing one alone; if several are open, keeps just one.
	// Does not steal focus (adds without activating)
	private ensurePanel(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		for (const extra of leaves.slice(1)) extra.detach();
		if (leaves.length) return;
		const leaf = this.app.workspace.getLeftLeaf(false);
		if (leaf) void leaf.setViewState({ type: VIEW_TYPE });
	}

	async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length) {
			void this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf: WorkspaceLeaf | null = this.app.workspace.getLeftLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		void this.app.workspace.revealLeaf(leaf);
	}

	openStats(): void {
		new StatsModal(this.app, this.data.root).open();
	}

	// Open the panel, then scroll to and flash the bookmark for this file
	async revealInBookmarks(file: TAbstractFile): Promise<void> {
		await this.activateView();
		this.forEachPanel((view) => view.revealFile(file.path));
	}

	// ---------- Delete/rename sync ----------

	// When a file is deleted, remove its bookmark immediately (fixes core's leftover-bookmark bug)
	private async onFileDeleted(file: TAbstractFile): Promise<void> {
		const isFolder = file instanceof TFolder;
		const hits = itemsPointingTo(this.data.root, file.path, isFolder);
		if (!hits.length) return;
		removeItems(this.data.root, new Set(hits.map((h) => h.id)));
		await this.saveAndRefresh();
	}

	private async onFileRenamed(oldPath: string, newPath: string): Promise<void> {
		const n = applyRename(this.data.root, oldPath, newPath);
		if (n > 0) {
			await this.saveAndRefresh();
		}
	}

	// ---------- Adding bookmarks ----------

	// Add dialog: original name, optional custom name, and a group dropdown.
	// The group is chosen by id, and defaults to the top level (Enter adds there).
	async addBookmarkFor(file: TAbstractFile): Promise<void> {
		const type = file instanceof TFolder ? "folder" : "file";
		// If already bookmarked, open its edit dialog instead (also how you change its group)
		const existing = flatten(this.data.root).find(
			(it) => it.type === type && it.path === file.path && !it.subpath
		);
		if (existing) {
			this.editBookmark(existing);
			return;
		}
		const original = file instanceof TFile ? file.basename : file.name;
		new BookmarkEditModal(this.app, {
			isEdit: false,
			originalName: original,
			initialTitle: "",
			groups: groupChoices(this.data.root),
			initialGroupId: null,
			onSubmit: async ({ title, groupId }) => {
				const group = groupId ? findById(this.data.root, groupId) : null;
				const list = group ? (group.items ?? (group.items = [])) : this.data.root;
				list.push({ id: newId(), type, path: file.path, added: Date.now(), title });
				await this.saveAndRefresh();
				new Notice(T.noticeAdded(original));
			},
		}).open();
	}

	// Edit an existing bookmark: name, group (moves it), or delete
	editBookmark(it: BmItem): void {
		new BookmarkEditModal(this.app, {
			isEdit: true,
			originalName: originalName(it),
			initialTitle: it.title ?? "",
			groups: groupChoices(this.data.root),
			initialGroupId: parentGroupId(this.data.root, it.id),
			onSubmit: ({ title, groupId }) => {
				it.title = title;
				if (groupId !== parentGroupId(this.data.root, it.id)) {
					const target = groupId ? findById(this.data.root, groupId) : null;
					moveItems(this.data.root, [it.id], target);
				}
				void this.saveAndRefresh();
			},
			onDelete: () => {
				removeItems(this.data.root, new Set([it.id]));
				void this.saveAndRefresh();
			},
		}).open();
	}

	// ---------- Cleanup commands ----------

	async cleanBroken(): Promise<void> {
		const n = validateAll(this.app, this.data.root);
		if (n > 0) {
			await this.saveAndRefresh();
			new Notice(T.noticeCleaned(n));
		} else {
			new Notice(T.noticeNoBroken);
		}
	}

	// Confirm first (naming the destination and the caveats), then export
	exportBookmarks(): void {
		const folder = this.exportFolder();
		const where = folder ? `"${folder}"` : T.exportRootLabel;
		new ConfirmModal(this.app, T.confirmExportTitle, T.confirmExportBody(where), () => void this.doExport()).open();
	}

	// Configured export folder, trimmed of stray slashes (blank = vault root)
	private exportFolder(): string {
		return this.data.settings.exportFolder.replace(/^\/+|\/+$/g, "");
	}

	// Export in the core Bookmarks format ({ items: ... }) so the file round-trips with
	// the core plugin. Plugin-only fields (color, hidden, per-group sort) are not included.
	private async doExport(): Promise<void> {
		const json = JSON.stringify({ items: this.data.root.map(toCoreItem) }, null, 2);
		const stamp = new Date().toISOString().slice(0, 10);
		// Optional destination folder from settings (blank = vault root)
		const folder = this.exportFolder();
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			try { await this.app.vault.createFolder(folder); } catch { /* already exists or invalid */ }
		}
		const dir = folder ? `${folder}/` : "";
		let path = `${dir}Expanded Bookmarks export ${stamp}.json`;
		for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) {
			path = `${dir}Expanded Bookmarks export ${stamp} (${i}).json`;
		}
		try {
			await this.app.vault.create(path, json);
			new Notice(T.noticeExported(path));
		} catch {
			new Notice(T.noticeExportFailed);
		}
	}

	async dedupe(): Promise<void> {
		const dups = findDuplicates(this.data.root);
		if (!dups.length) {
			new Notice(T.noticeNoDups);
			return;
		}
		removeItems(this.data.root, new Set(dups.map((d) => d.id)));
		await this.saveAndRefresh();
		new Notice(T.noticeDupsRemoved(dups.length));
	}

	// ---------- Import ----------

	// Import from the core Bookmarks plugin's live data (private API, accessed defensively)
	importFromCore(): void {
		const items: any[] | undefined = internalPluginInstance(this.app, "bookmarks")?.items;
		if (!items || !Array.isArray(items)) {
			new Notice(T.noticeImportFailed);
			return;
		}
		new ConfirmModal(this.app, T.confirmImportTitle, T.confirmImportBody(T.importSourceCore), () => {
			this.mergeImport(items.map((raw) => importItem(raw, "core")));
		}).open();
	}

	// Import from a JSON file in the vault — either this plugin's export (`root`)
	// or a core Bookmarks file (`items`). Enables a full export → import round-trip.
	importFromFile(): void {
		new JsonFilePickerModal(this.app, async (file) => {
			let parsed: any;
			try {
				parsed = JSON.parse(await this.app.vault.read(file));
			} catch {
				new Notice(T.noticeImportBadFile);
				return;
			}
			// Our own export uses `root`; a core Bookmarks file uses `items`
			const [raws, from]: [any[], ImportSource] = Array.isArray(parsed?.root)
				? [parsed.root, "own"]
				: Array.isArray(parsed?.items)
					? [parsed.items, "core"]
					: [[], "core"];
			if (!raws.length) {
				new Notice(T.noticeImportBadFile);
				return;
			}
			const converted = raws.map((raw) => importItem(raw, from));
			new ConfirmModal(this.app, T.confirmImportTitle, T.confirmImportBody(`"${file.name}"`), () => {
				this.mergeImport(converted);
			}).open();
		}).open();
	}

	// Merge converted items into the tree, skipping targets already bookmarked at the top level
	private mergeImport(converted: (BmItem | null)[]): void {
		const key = (it: BmItem) => `${it.type}|${it.path ?? ""}|${it.subpath ?? ""}|${it.query ?? ""}`;
		const existing = new Set(flatten(this.data.root).map(key));
		let imported = 0;
		let skipped = 0;
		for (const c of converted) {
			if (!c) { skipped++; continue; }
			if (c.type !== "group" && existing.has(key(c))) { skipped++; continue; }
			this.data.root.push(c);
			imported += c.type === "group" ? flatten([c]).filter((i) => i.type !== "group").length : 1;
		}
		void this.saveAndRefresh();
		new Notice(T.noticeImported(imported, skipped));
	}
}
