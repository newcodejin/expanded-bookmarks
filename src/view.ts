// Sidebar bookmarks panel

import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type ExpandedBookmarksPlugin from "./main";
import { BmItem, HIGHLIGHT_COLOR, SortKey, SortSpec, ToolbarAction, newId } from "./types";
import { displayName, findById, findParentList, flatten, isBroken, moveItems, removeItems, sortItems } from "./data";
import { ConfirmModal, FolderPickerModal, GroupPickerModal, TextPromptModal } from "./modals";
import { internalPluginInstance } from "./util";
import { T } from "./strings";

export const VIEW_TYPE = "expanded-bookmarks-view";

// Where a dragged item lands relative to the row it was dropped on
type DropMode = "into" | "before" | "after";

const TYPE_ICONS: Record<string, string> = {
	file: "file",
	folder: "folder",
	search: "search",
	url: "link",
	graph: "git-fork",
	group: "chevron-down",
};

// Icons per file extension (the same lucide icons Obsidian uses for tabs)
const EXT_ICONS: Record<string, string> = {
	canvas: "layout-dashboard",
	pdf: "file-text",
	png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image", webp: "image", bmp: "image",
	mp3: "file-audio", wav: "file-audio", ogg: "file-audio", flac: "file-audio", m4a: "file-audio",
	mp4: "file-video", mov: "file-video", mkv: "file-video", webm: "file-video",
};

// Icon for a file bookmark: extension-specific when available, else the type default
function itemIcon(it: BmItem): string {
	if (it.type === "file" && it.path) {
		const ext = it.path.split(".").pop()?.toLowerCase() ?? "";
		if (EXT_ICONS[ext]) return EXT_ICONS[ext];
	}
	return TYPE_ICONS[it.type] ?? "bookmark";
}

export class BookmarksView extends ItemView {
	private batchMode = false;
	// Whether hidden bookmarks are shown (session-only, not persisted)
	private showHidden = false;
	private selected = new Set<string>();
	private dragId: string | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: ExpandedBookmarksPlugin) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return T.viewName; }
	getIcon(): string { return "bookmark"; }

	async onOpen(): Promise<void> {
		this.render();
	}

	private get root(): BmItem[] {
		return this.plugin.data.root;
	}

	private async save(): Promise<void> {
		await this.plugin.saveAll();
		this.render();
	}

	// ---------- Rendering ----------

	render(): void {
		const el = this.contentEl;
		// Rebuilding the tree resets scrolling, so carry the old position over
		// (drag & drop, collapsing a group, any save — all re-render)
		const prev = el.querySelector(".sb-tree");
		const scrollTop = prev instanceof HTMLElement ? prev.scrollTop : 0;

		el.empty();
		el.addClass("sb-view");

		this.renderToolbar(el);

		const treeEl = el.createDiv({ cls: "sb-tree" });
		this.renderList(treeEl, this.root, this.plugin.data.settings.defaultSort, 0);
		treeEl.scrollTop = scrollTop;

		if (this.batchMode) this.renderBatchBar(el);
	}

	private renderToolbar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: "sb-toolbar" });
		const layout = this.plugin.data.settings.toolbarLayout;

		// Action definitions. Placed as toolbar buttons or in the ⋮ menu per the toolbarLayout setting.
		// The label defaults to T.actionNames[id]; only actions with a dynamic label override it.
		const actions: {
			id: ToolbarAction;
			icon: () => string;
			label?: () => string;
			checked?: () => boolean;
			onClick: (e: MouseEvent) => void;
		}[] = [
			{ id: "sort", icon: () => "arrow-up-narrow-wide", onClick: (e) => this.showSortMenu({ x: e.clientX, y: e.clientY }, null) },
			{
				id: "newGroup", icon: () => "folder-plus",
				onClick: () => {
					new TextPromptModal(this.app, T.newGroupPrompt, "", (name) => {
						this.root.push({ id: newId(), type: "group", title: name, added: Date.now(), items: [] });
						void this.save();
					}).open();
				},
			},
			{ id: "collapseAll", icon: () => "chevrons-down-up", onClick: () => this.collapseAll() },
			{ id: "scrollTop", icon: () => "arrow-up-to-line", onClick: () => this.scrollTree("top") },
			{ id: "scrollBottom", icon: () => "arrow-down-to-line", onClick: () => this.scrollTree("bottom") },
			{
				id: "batch", icon: () => "copy-check", checked: () => this.batchMode,
				onClick: () => {
					this.batchMode = !this.batchMode;
					if (!this.batchMode) this.selected.clear();
					this.render();
				},
			},
			{ id: "stats", icon: () => "bar-chart-2", onClick: () => this.plugin.openStats() },
			{
				id: "showHidden", icon: () => (this.showHidden ? "eye-off" : "eye"),
				label: () => (this.showHidden ? T.showHiddenOff : T.showHiddenOn), checked: () => this.showHidden,
				onClick: () => {
					this.showHidden = !this.showHidden;
					this.render();
				},
			},
			{ id: "import", icon: () => "import", onClick: () => this.plugin.importFromCore() },
			{ id: "importFile", icon: () => "file-input", onClick: () => this.plugin.importFromFile() },
			{ id: "export", icon: () => "download", onClick: () => void this.plugin.exportBookmarks() },
			{ id: "dedupe", icon: () => "copy-x", onClick: () => void this.plugin.dedupe() },
			{ id: "clean", icon: () => "unlink", onClick: () => void this.plugin.cleanBroken() },
		];
		const labelOf = (a: (typeof actions)[number]) => (a.label ? a.label() : T.actionNames[a.id]);

		let sortOnToolbar = false;
		for (const a of actions) {
			if (layout[a.id] !== "toolbar") continue;
			const btn = this.iconButton(bar, a.icon(), labelOf(a), a.onClick);
			if (a.checked?.()) btn.addClass("sb-active");
			// The current sort order is shown right next to the sort button (can be turned off in settings)
			if (a.id === "sort") {
				sortOnToolbar = true;
				this.renderSortIndicator(bar);
			}
		}
		if (!sortOnToolbar) this.renderSortIndicator(bar);

		const menuActions = actions.filter((a) => layout[a.id] === "menu");
		if (menuActions.length) {
			this.iconButton(bar, "more-vertical", T.moreButton, (e) => {
				const menu = new Menu();
				for (const a of menuActions) {
					menu.addItem((i) => {
						i.setTitle(labelOf(a)).setIcon(a.icon()).onClick(() => a.onClick(e));
						if (a.checked) i.setChecked(a.checked());
					});
				}
				menu.showAtMouseEvent(e);
			});
		}
	}

	// Short sort label with its direction arrow
	private sortLabel(spec: SortSpec): string {
		return `${T.sortShort[spec.key]} ${spec.asc ? "↑" : "↓"}`;
	}

	private renderSortIndicator(bar: HTMLElement): void {
		bar.createSpan({
			cls: "sb-sort-indicator",
			text: this.sortLabel(this.plugin.data.settings.defaultSort),
		});
	}

	// Jump the bookmark tree straight to the top or the bottom (no smooth scrolling)
	private scrollTree(to: "top" | "bottom"): void {
		const tree = this.contentEl.querySelector(".sb-tree");
		if (!(tree instanceof HTMLElement)) return;
		tree.scrollTop = to === "top" ? 0 : tree.scrollHeight;
	}

	private collapseAll(): void {
		let anyOpen = false;
		const rec = (items: BmItem[]) => {
			for (const it of items) {
				if (it.type === "group") { if (!it.collapsed) anyOpen = true; if (it.items) rec(it.items); }
			}
		};
		rec(this.root);
		const rec2 = (items: BmItem[]) => {
			for (const it of items) {
				if (it.type === "group") { it.collapsed = anyOpen; if (it.items) rec2(it.items); }
			}
		};
		rec2(this.root);
		void this.save();
	}

	private iconButton(parent: HTMLElement, icon: string, tooltip: string, onClick: (e: MouseEvent) => void): HTMLElement {
		const btn = parent.createDiv({ cls: "sb-icon-btn clickable-icon", attr: { "aria-label": tooltip } });
		setIcon(btn, icon);
		btn.addEventListener("click", onClick);
		return btn;
	}

	// Reveal a bookmark for the given path: expand its groups, scroll to it, and flash it.
	// Mirrors Obsidian's "Reveal file in navigation" but for this panel.
	revealFile(path: string): void {
		let target: BmItem | null = null;
		// Expand every ancestor group on the way to the matching bookmark
		const reveal = (items: BmItem[]): boolean => {
			for (const it of items) {
				if ((it.type === "file" || it.type === "folder") && it.path === path) { target = it; return true; }
				if (it.type === "group" && it.items && reveal(it.items)) { it.collapsed = false; return true; }
			}
			return false;
		};
		if (!reveal(this.root)) {
			new Notice(T.noticeNotBookmarked);
			return;
		}
		// A hidden bookmark must be shown to be revealed
		if ((target as BmItem | null)?.hidden) this.showHidden = true;
		void this.plugin.saveAll();
		this.render();

		const row = this.contentEl.querySelector(`.sb-item[data-sb-path="${CSS.escape(path)}"]`);
		if (row instanceof HTMLElement) {
			row.scrollIntoView({ block: "center" });
			row.addClass("sb-flash");
			window.setTimeout(() => row.removeClass("sb-flash"), 1500);
		}
	}

	// Update only the active-file highlight, without rebuilding the tree (keeps scroll position)
	updateActiveFile(): void {
		const active = this.app.workspace.getActiveFile()?.path ?? null;
		for (const el of Array.from(this.contentEl.querySelectorAll(".sb-item[data-sb-path]"))) {
			el.toggleClass("sb-active-file", el.getAttribute("data-sb-path") === active);
		}
	}

	private renderList(parent: HTMLElement, items: BmItem[], inheritedSort: SortSpec, depth: number): void {
		const sorted = sortItems(this.app, items, inheritedSort);
		for (const it of sorted) {
			if (it.hidden && !this.showHidden) continue;
			this.renderItem(parent, it, inheritedSort, depth);
		}
	}

	private renderItem(parent: HTMLElement, it: BmItem, inheritedSort: SortSpec, depth: number): void {
		const row = parent.createDiv({ cls: "sb-item" });
		row.style.paddingLeft = `${depth * 16 + 4}px`;
		if (it.color) row.style.borderLeft = `3px solid ${it.color}`;
		const broken = it.type !== "group" && isBroken(this.app, it);
		if (broken) row.addClass("sb-broken");
		if (it.hidden) row.addClass("sb-hidden");
		// Tag file/folder rows with their path (used by reveal, and by the active-file highlight)
		if ((it.type === "file" || it.type === "folder") && it.path) {
			row.setAttribute("data-sb-path", it.path);
			if (it.type === "file" && it.path === this.app.workspace.getActiveFile()?.path) row.addClass("sb-active-file");
		}

		// Batch-select checkbox
		if (this.batchMode) {
			const cb = row.createEl("input", { type: "checkbox", cls: "sb-check" });
			cb.checked = this.selected.has(it.id);
			cb.addEventListener("click", (e) => {
				e.stopPropagation();
				if (cb.checked) this.selected.add(it.id);
				else this.selected.delete(it.id);
				this.updateBatchBar();
			});
		}

		const iconEl = row.createDiv({ cls: "sb-item-icon" });
		if (it.type === "group") {
			setIcon(iconEl, it.collapsed ? "chevron-right" : "chevron-down");
		} else {
			setIcon(iconEl, it.subpath ? "heading" : itemIcon(it));
		}

		row.createSpan({ cls: "sb-item-title", text: displayName(it) });

		if (broken) row.createSpan({ cls: "sb-badge sb-badge-broken", text: T.brokenBadge });
		if (it.hidden) row.createSpan({ cls: "sb-badge", text: T.hiddenBadge });
		// Badge a group only when its order actually differs from the global default —
		// dragging inside a group silently sets it to custom, which would otherwise
		// badge every group with a meaningless "Custom"
		if (it.type === "group" && it.sort) {
			const def = this.plugin.data.settings.defaultSort;
			const differs = it.sort.key !== def.key || (it.sort.key !== "custom" && it.sort.asc !== def.asc);
			if (differs) row.createSpan({ cls: "sb-badge", text: this.sortLabel(it.sort) });
		}

		// Click: groups collapse/expand, everything else opens.
		// In select mode only the checkbox toggles selection; the name still opens normally.
		row.addEventListener("click", (e) => {
			if (it.type === "group") {
				it.collapsed = !it.collapsed;
				void this.save();
			} else {
				void this.openBookmark(it, e.ctrlKey || e.metaKey);
			}
		});

		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.showItemMenu({ x: e.clientX, y: e.clientY }, it);
		});

		// Drag & drop via the HTML5 API, the same way Obsidian's own panes do it. On touch this
		// gives the platform behaviour for free: a long press starts the drag, and holding still
		// fires contextmenu instead, which opens the item menu above.
		row.draggable = true;
		row.addEventListener("dragstart", (e) => {
			this.dragId = it.id;
			e.dataTransfer?.setData("text/plain", it.id);
		});
		// Reordering by hand only makes sense while this list is in custom order.
		// inheritedSort is the sort this row's list is displayed with.
		const canReorder = inheritedSort.key === "custom";
		const clearDropMarks = () => row.removeClasses(["sb-drop-into", "sb-drop-above", "sb-drop-below"]);

		// A group has three zones — near the edges you drop between rows, in the middle you
		// drop into the group. Other rows just split in half (before/after). Measured against
		// the row's own box, since offsetY would be relative to whichever child is under the cursor.
		const dropMode = (e: DragEvent): DropMode => {
			const box = row.getBoundingClientRect();
			const y = box.height ? (e.clientY - box.top) / box.height : 0.5;
			if (it.type !== "group") return y > 0.5 ? "after" : "before";
			if (y < 0.25) return "before";
			if (y > 0.75) return "after";
			return "into";
		};

		row.addEventListener("dragover", (e) => {
			e.preventDefault();
			clearDropMarks();
			const mode = dropMode(e);
			if (mode === "into") row.addClass("sb-drop-into");
			else if (canReorder) row.addClass(mode === "after" ? "sb-drop-below" : "sb-drop-above");
			// Otherwise show no insertion line: dropping here would be refused
			else if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
		});
		row.addEventListener("dragleave", clearDropMarks);
		row.addEventListener("drop", (e) => {
			e.preventDefault();
			e.stopPropagation();
			clearDropMarks();
			const dragId = this.dragId;
			this.dragId = null;
			if (!dragId || dragId === it.id) return;
			const mode = dropMode(e);
			// Refuse reordering unless the list is in custom order, so a stray drag
			// never silently switches the sort
			if (mode !== "into" && !canReorder) {
				new Notice(T.noticeReorderNeedsCustom);
				return;
			}
			this.handleDrop(dragId, it, mode);
		});

		// Render group children
		if (it.type === "group" && !it.collapsed) {
			const childSort = it.sort ?? inheritedSort;
			this.renderList(parent, it.items ?? [], childSort, depth + 1);
		}
	}

	// Handle a drop: "into" moves the item inside a group, "before"/"after" place it next to
	// the target row (so groups can be reordered, not only dropped into).
	// Reordering is only allowed where the order is custom — see canReorder in renderItem.
	private handleDrop(dragId: string, target: BmItem, mode: DropMode): void {
		if (mode === "into") {
			moveItems(this.root, [dragId], target);
		} else {
			const from = findParentList(this.root, dragId);
			const to = findParentList(this.root, target.id);
			if (!from || !to) return;
			const item = from.list[from.index];
			// Block dragging a group into its own descendant, same reason as in moveItems
			if (item.type === "group" && item.items && findParentList(item.items, target.id)) return;
			from.list.splice(from.index, 1);

			// Insert where the user saw the line, then store it back in the stored orientation —
			// with custom descending the display runs opposite to the array
			const spec = this.effectiveSort(to.list);
			const displayed = [...sortItems(this.app, to.list, spec)];
			const at = Math.max(0, displayed.indexOf(target) + (mode === "after" ? 1 : 0));
			displayed.splice(at, 0, item);
			const stored = spec.asc ? displayed : [...displayed].reverse();
			to.list.splice(0, to.list.length, ...stored);
		}
		void this.save();
	}

	// The sort actually used to display a list, following the group inheritance chain
	private effectiveSort(list: BmItem[]): SortSpec {
		const def = this.plugin.data.settings.defaultSort;
		let result = def;
		const rec = (items: BmItem[], inherited: SortSpec): boolean => {
			if (items === list) {
				result = inherited;
				return true;
			}
			for (const it of items) {
				if (it.type === "group" && it.items && rec(it.items, it.sort ?? inherited)) return true;
			}
			return false;
		};
		rec(this.root, def);
		return result;
	}

	// ---------- Opening bookmarks ----------

	async openBookmark(it: BmItem, newTab: boolean): Promise<void> {
		if (it.type === "search") {
			// Invoke the core Search plugin (private API, accessed defensively)
			internalPluginInstance(this.app, "global-search")?.openGlobalSearch?.(it.query ?? "");
			return;
		}
		if (it.type === "url") {
			if (it.url) window.open(it.url, "_blank");
			return;
		}
		if (it.type === "graph") {
			// Open the graph view, then re-apply the saved options.
			// setOptions is a private API, so it's accessed defensively: if it ever
			// disappears the bookmark still opens, just with the default graph.
			const leaf = this.app.workspace.getLeaf(newTab);
			await leaf.setViewState({ type: "graph", active: true });
			(leaf.view as any)?.dataEngine?.setOptions?.(it.options);
			return;
		}
		if (!it.path) return;
		const file = this.app.vault.getAbstractFileByPath(it.path);
		if (!file) {
			new Notice(T.noticeBrokenTarget);
			return;
		}
		if (it.type === "folder") {
			// Reveal the folder in the file explorer
			internalPluginInstance(this.app, "file-explorer")?.revealInFolder?.(file);
			return;
		}
		if (file instanceof TFile) {
			const link = it.subpath ? it.path + it.subpath : it.path;
			await this.app.workspace.openLinkText(link, "", newTab);
		}
	}

	// ---------- Menus ----------

	private showSortMenu(pos: { x: number; y: number }, group: BmItem | null): void {
		const menu = new Menu();
		const current = group ? group.sort : this.plugin.data.settings.defaultSort;
		const keys: SortKey[] = ["custom", "name", "added", "mtime", "ctime", "ext"];

		// Group menus get an extra "use default sort" entry
		if (group) {
			menu.addItem((i) =>
				i.setTitle(T.sortGroupDefault).setChecked(!group.sort).onClick(() => {
					group.sort = undefined;
					void this.save();
				})
			);
			menu.addSeparator();
		}
		for (const key of keys) {
			menu.addItem((i) =>
				i.setTitle(T.sort[key]).setChecked(current?.key === key).onClick(() => {
					this.setSort(group, { key, asc: current?.key === key ? current.asc : true });
				})
			);
		}
		// Direction applies to every key, including custom (descending shows the manual order bottom-up).
		// A group without its own sort inherits the global default's key.
		const effectiveKey = current?.key ?? this.plugin.data.settings.defaultSort.key;
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle(T.sortAsc).setChecked(current ? current.asc : true).onClick(() => {
				this.setSort(group, { key: effectiveKey, asc: true });
			})
		);
		menu.addItem((i) =>
			i.setTitle(T.sortDesc).setChecked(current ? !current.asc : false).onClick(() => {
				this.setSort(group, { key: effectiveKey, asc: false });
			})
		);
		menu.showAtPosition(pos);
	}

	private setSort(group: BmItem | null, spec: SortSpec): void {
		if (group) group.sort = spec;
		else this.plugin.data.settings.defaultSort = spec;
		void this.save();
	}

	// Position-based so it works for both right-click and mobile long-press
	private showItemMenu(pos: { x: number; y: number }, it: BmItem): void {
		const menu = new Menu();

		if (it.type !== "group") {
			menu.addItem((i) => i.setTitle(T.menuOpen).setIcon("file").onClick(() => void this.openBookmark(it, false)));
			menu.addItem((i) => i.setTitle(T.menuOpenNewTab).setIcon("file-plus").onClick(() => void this.openBookmark(it, true)));
			menu.addSeparator();
			// Name + group + delete all live in the edit dialog
			menu.addItem((i) => i.setTitle(T.menuEditBookmark).setIcon("pencil").onClick(() => this.plugin.editBookmark(it)));
		} else {
			menu.addItem((i) => i.setTitle(T.sortGroupOverride).setIcon("arrow-up-narrow-wide").onClick(() => {
				// Show the sort menu at the same spot instead of a submenu
				this.showSortMenu(pos, it);
			}));
			menu.addSeparator();
			// Groups keep a simple rename
			menu.addItem((i) => i.setTitle(T.menuRename).setIcon("pencil").onClick(() => {
				new TextPromptModal(this.app, T.renamePrompt, it.title ?? displayName(it), (name) => {
					it.title = name;
					void this.save();
				}).open();
			}));
		}

		// Highlight with the accent color (single on/off)
		menu.addItem((i) =>
			i.setTitle(T.menuHighlight).setIcon("palette").setChecked(!!it.color).onClick(() => {
				it.color = it.color ? undefined : HIGHLIGHT_COLOR;
				void this.save();
			})
		);

		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle(it.hidden ? T.menuUnhide : T.menuHide)
				.setIcon(it.hidden ? "eye" : "eye-off")
				.onClick(() => {
					it.hidden = it.hidden ? undefined : true;
					void this.save();
				})
		);
		menu.addItem((i) =>
			i.setTitle(it.type === "group" ? T.menuRemoveGroup : T.menuRemove)
				.setIcon("trash")
				.onClick(() => {
					const remove = () => {
						removeItems(this.root, new Set([it.id]));
						void this.save();
					};
					// Removing a group takes its contents with it, so it always asks first
					if (it.type === "group") {
						const inside = flatten(it.items ?? []).length;
						new ConfirmModal(this.app, T.confirmRemoveGroupTitle, T.confirmRemoveGroupBody(displayName(it), inside), remove).open();
					} else remove();
				})
		);
		menu.showAtPosition(pos);
	}

	// ---------- Batch action bar ----------

	private renderBatchBar(parent: HTMLElement): void {
		const bar = parent.createDiv({ cls: "sb-batch-bar" });
		bar.createSpan({ cls: "sb-batch-count", text: T.batchSelected(this.selected.size) });

		// Buttons wrap responsively; Remove + Done are kept together on one line
		const actions = bar.createDiv({ cls: "sb-batch-actions" });
		const btn = (parentEl: HTMLElement, label: string, cls: string, onClick: () => void) => {
			const b = parentEl.createEl("button", { text: label, cls });
			b.addEventListener("click", onClick);
			return b;
		};

		btn(actions, T.batchMoveToGroup, "", () => {
			if (!this.selected.size) return;
			new GroupPickerModal(this.app, this.root, new Set(this.selected), (group) => {
				const n = moveItems(this.root, [...this.selected], group);
				new Notice(T.noticeMovedBm(n));
				this.selected.clear();
				void this.save();
			}).open();
		});

		btn(actions, T.batchMoveFiles, "", () => {
			if (!this.selected.size) return;
			new FolderPickerModal(this.app, (folder) => {
				// Always confirm: this moves real files in the vault
				new ConfirmModal(
					this.app,
					T.confirmFileMoveTitle,
					T.confirmFileMoveBody(this.countSelectedFiles(), folder.path),
					() => void this.moveActualFiles(folder.path)
				).open();
			}).open();
		});

		const end = actions.createDiv({ cls: "sb-batch-end" });
		btn(end, T.batchRemove, "mod-warning", () => {
			if (!this.selected.size) return;
			new ConfirmModal(this.app, T.confirmBatchRemoveTitle, T.confirmBatchRemoveBody(this.selected.size), () => {
				const n = removeItems(this.root, this.selected);
				new Notice(T.noticeRemoved(n));
				this.selected.clear();
				void this.save();
			}).open();
		});
		btn(end, T.batchCancel, "mod-cta", () => {
			this.batchMode = false;
			this.selected.clear();
			this.render();
		});
	}

	private updateBatchBar(): void {
		const count = this.contentEl.querySelector(".sb-batch-count");
		if (count) count.textContent = T.batchSelected(this.selected.size);
	}

	private countSelectedFiles(): number {
		let n = 0;
		for (const id of this.selected) {
			const loc = findParentList(this.root, id);
			if (loc && loc.list[loc.index].type === "file") n++;
		}
		return n;
	}

	// Move the actual files behind the selected bookmarks to the given folder.
	// fileManager.renameFile updates in-vault links, and our rename handler updates bookmark paths
	private async moveActualFiles(folderPath: string): Promise<void> {
		let moved = 0;
		let failed = 0;
		for (const id of [...this.selected]) {
			const loc = findParentList(this.root, id);
			if (!loc) continue;
			const it = loc.list[loc.index];
			if (it.type !== "file" || !it.path) continue;
			const file = this.app.vault.getAbstractFileByPath(it.path);
			if (!(file instanceof TFile)) { failed++; continue; }
			const dest = (folderPath === "/" ? "" : folderPath + "/") + file.name;
			if (dest === it.path) continue;
			try {
				await this.app.fileManager.renameFile(file, dest);
				moved++;
			} catch {
				failed++;
			}
		}
		new Notice(T.noticeMovedFiles(moved, failed));
		this.selected.clear();
		await this.save();
	}
}
