// Sidebar bookmarks panel

import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type ExpandedBookmarksPlugin from "./main";
import { BmItem, HIGHLIGHT_COLOR, SortKey, SortSpec, ToolbarAction, newId } from "./types";
import { displayName, findById, findParentList, flatten, isBroken, moveItems, removeItems, sortItems } from "./data";
import { ConfirmModal, FolderPickerModal, GroupPickerModal, TextPromptModal } from "./modals";
import { internalPluginInstance } from "./util";
import { T } from "./strings";

export const VIEW_TYPE = "expanded-bookmarks-view";

// Touch gesture timings. Holding picks the row up for dragging; holding on without moving
// opens its menu instead. Well apart, so a slow tap does neither.
const DRAG_HOLD_MS = 400;
const MENU_HOLD_MS = 2000;
// Movement thresholds. Before the row is picked up, a small slide already means the user is
// scrolling, so bail out early. Once it is picked up, dragging needs a deliberate move —
// roughly what the platforms themselves use (~8dp on Android, ~10pt on iOS).
const SCROLL_SLOP = 5;
const TOUCH_DRAG_SLOP = 10;
const MOUSE_DRAG_SLOP = 4;

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
	// In-flight pointer gesture: a press that may turn into a drag, or (on touch) the item menu
	private drag: {
		id: string;
		pointerId: number;
		startX: number;
		startY: number;
		armed: boolean;
		active: boolean;
		menuShown: boolean;
		row: HTMLElement;
	} | null = null;
	private pressTimer: number | null = null;
	private menuTimer: number | null = null;
	// When the last touch press began, used to tell a touch-raised contextmenu from a real right-click
	private lastTouchAt = 0;
	// Set when a drag or the touch menu handled the gesture, so the click it produces is ignored
	private suppressNextClick = false;

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
			// A drag or the touch menu already handled this gesture
			if (this.suppressNextClick) {
				this.suppressNextClick = false;
				return;
			}
			if (it.type === "group") {
				it.collapsed = !it.collapsed;
				void this.save();
			} else {
				void this.openBookmark(it, e.ctrlKey || e.metaKey);
			}
		});

		// Dragging and the touch menu both run on pointer events. HTML5 drag events are never
		// produced by touch on iOS (and not dependably on Android), so the gesture is handled
		// here: press and move to drag; on touch, hold to pick the row up, then move to drag —
		// or keep holding still and its menu opens.
		row.dataset.sbId = it.id;
		// Reordering by hand only makes sense while this list is in custom order.
		// inheritedSort is the sort this row's list is displayed with.
		row.dataset.sbReorder = inheritedSort.key === "custom" ? "1" : "0";
		row.addEventListener("pointerdown", (e) => this.onPointerDown(e, row));

		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			// A touch long-press raises contextmenu too; ignore it, because the gesture code
			// opens the menu itself when the press ends without moving
			if (Date.now() - this.lastTouchAt < 1000) return;
			this.showItemMenu({ x: e.clientX, y: e.clientY }, it);
		});

		// Render group children
		if (it.type === "group" && !it.collapsed) {
			const childSort = it.sort ?? inheritedSort;
			this.renderList(parent, it.items ?? [], childSort, depth + 1);
		}
	}

	// ---------- Pointer gesture: drag, and the item menu on touch ----------

	private onPointerDown(e: PointerEvent, row: HTMLElement): void {
		// Left button only, and let the select-mode checkbox handle its own presses
		if (e.pointerType === "mouse" && e.button !== 0) return;
		if ((e.target as HTMLElement | null)?.closest("input")) return;
		const byTouch = e.pointerType !== "mouse";
		if (byTouch) this.lastTouchAt = Date.now();
		this.drag = {
			id: row.dataset.sbId ?? "",
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			// A mouse can start dragging right away; touch has to hold first, otherwise
			// every swipe would drag instead of scrolling the list
			armed: !byTouch,
			active: false,
			menuShown: false,
			row,
		};
		if (byTouch) {
			this.pressTimer = window.setTimeout(() => {
				this.pressTimer = null;
				if (!this.drag) return;
				this.drag.armed = true;
				this.drag.row.addClass("sb-press");
				// Block touch scrolling from here on, not once movement starts: by then the
				// browser already owns the gesture and would cancel the drag
				this.contentEl.addClass("sb-drag-active");
			}, DRAG_HOLD_MS);
			// Keep holding still, without dragging, and the item menu opens on its own
			this.menuTimer = window.setTimeout(() => {
				this.menuTimer = null;
				const d = this.drag;
				if (!d || d.active) return;
				const item = findById(this.root, d.id);
				if (!item) return;
				d.menuShown = true;
				this.suppressNextClick = true;
				this.showItemMenu({ x: e.clientX, y: e.clientY }, item);
			}, MENU_HOLD_MS);
		}
		document.addEventListener("pointermove", this.onPointerMove, { passive: false });
		document.addEventListener("pointerup", this.onPointerUp);
		document.addEventListener("pointercancel", this.onPointerUp);
	}

	private onPointerMove = (e: PointerEvent): void => {
		const d = this.drag;
		if (!d || e.pointerId !== d.pointerId) return;
		if (d.menuShown) return;
		const dist = Math.max(Math.abs(e.clientX - d.startX), Math.abs(e.clientY - d.startY));
		if (!d.active) {
			// Sliding before the row is picked up means the user is scrolling, not dragging
			if (!d.armed) {
				if (dist > SCROLL_SLOP) this.endDrag();
				return;
			}
			if (dist <= (e.pointerType === "mouse" ? MOUSE_DRAG_SLOP : TOUCH_DRAG_SLOP)) return;
			// A real move means a drag, so stop waiting for the menu
			if (this.menuTimer !== null) {
				window.clearTimeout(this.menuTimer);
				this.menuTimer = null;
			}
			d.active = true;
			d.row.addClass("sb-dragging");
			this.contentEl.addClass("sb-drag-active");
			this.suppressNextClick = true;
		}
		// Keep the touch gesture from scrolling the panel while dragging
		e.preventDefault();
		this.showDropTarget(e);
		this.autoScroll(e);
	};

	private onPointerUp = (e: PointerEvent): void => {
		const d = this.drag;
		if (!d) return;
		const dropped = d.active ? this.dropTargetAt(e) : null;
		const dragId = d.id;
		this.endDrag();
		if (!dropped) return;
		this.suppressNextClick = true;
		// Refuse reordering unless the list is in custom order, so a stray drag
		// never silently switches the sort
		if (dropped.mode !== "into" && !dropped.canReorder) new Notice(T.noticeReorderNeedsCustom);
		else this.handleDrop(dragId, dropped.item, dropped.mode);
	};

	private endDrag(): void {
		for (const timer of [this.pressTimer, this.menuTimer]) {
			if (timer !== null) window.clearTimeout(timer);
		}
		this.pressTimer = null;
		this.menuTimer = null;
		document.removeEventListener("pointermove", this.onPointerMove);
		document.removeEventListener("pointerup", this.onPointerUp);
		document.removeEventListener("pointercancel", this.onPointerUp);
		this.drag?.row.removeClasses(["sb-dragging", "sb-press"]);
		this.contentEl.removeClass("sb-drag-active");
		this.clearDropMarks();
		this.drag = null;
	}

	private clearDropMarks(): void {
		for (const el of Array.from(this.contentEl.querySelectorAll(".sb-item"))) {
			el.removeClasses(["sb-drop-into", "sb-drop-above", "sb-drop-below"]);
		}
	}

	// Which row is under the pointer, and where the item would land on it.
	// A group has three zones — near the edges you drop between rows, in the middle you
	// drop into the group. Other rows just split in half (before/after).
	private dropTargetAt(e: PointerEvent): { item: BmItem; mode: DropMode; canReorder: boolean } | null {
		const under = document.elementFromPoint(e.clientX, e.clientY);
		const row = under instanceof HTMLElement ? under.closest(".sb-item") : null;
		if (!(row instanceof HTMLElement)) return null;
		const id = row.dataset.sbId;
		if (!id || id === this.drag?.id) return null;
		const item = findById(this.root, id);
		if (!item) return null;
		const box = row.getBoundingClientRect();
		const y = box.height ? (e.clientY - box.top) / box.height : 0.5;
		let mode: DropMode;
		if (item.type !== "group") mode = y > 0.5 ? "after" : "before";
		else if (y < 0.25) mode = "before";
		else if (y > 0.75) mode = "after";
		else mode = "into";
		return { item, mode, canReorder: row.dataset.sbReorder === "1" };
	}

	private showDropTarget(e: PointerEvent): void {
		this.clearDropMarks();
		const hit = this.dropTargetAt(e);
		if (!hit) return;
		const row = this.contentEl.querySelector(`.sb-item[data-sb-id="${CSS.escape(hit.item.id)}"]`);
		if (!(row instanceof HTMLElement)) return;
		if (hit.mode === "into") row.addClass("sb-drop-into");
		// No insertion line where reordering would be refused
		else if (hit.canReorder) row.addClass(hit.mode === "after" ? "sb-drop-below" : "sb-drop-above");
	}

	// Scroll the list when the pointer is dragged near its top or bottom edge
	private autoScroll(e: PointerEvent): void {
		const tree = this.contentEl.querySelector(".sb-tree");
		if (!(tree instanceof HTMLElement)) return;
		const box = tree.getBoundingClientRect();
		const edge = 36;
		if (e.clientY < box.top + edge) tree.scrollTop -= 12;
		else if (e.clientY > box.bottom - edge) tree.scrollTop += 12;
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
