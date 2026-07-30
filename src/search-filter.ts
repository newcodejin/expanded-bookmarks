// Adds bookmark filters to the core Search pane: show only bookmarked files, or
// hide them. Native-looking toggle rows are inserted into the pane's filter section
// (.search-params, opened via the sliders icon); matching results are hidden with CSS.
// File-to-result mapping uses the search view's resultDomLookup (private API),
// accessed defensively so the filter silently stops instead of crashing if
// Obsidian internals change.

import { App, Setting, ToggleComponent } from "obsidian";
import { BmItem } from "./types";
import { flatten } from "./data";
import { DomWatcher } from "./dom-watcher";
import { T } from "./strings";

const ROW_CLASS = "sb-search-bm-setting";

// "only" keeps just bookmarked results, "exclude" drops them; the two are mutually exclusive
type FilterMode = "off" | "only" | "exclude";

export class SearchBookmarkFilter extends DomWatcher {
	// Current filter mode (session-only, not persisted)
	private mode: FilterMode = "off";
	// One pair of toggles per search pane; they share state, so update them together
	private toggles = new Set<{ comp: ToggleComponent; kind: "only" | "exclude" }>();
	private syncing = false;

	constructor(private app: App, private getRoot: () => BmItem[]) {
		super();
	}

	protected cleanup(): void {
		this.mode = "off";
		this.toggles.clear();
		for (const el of Array.from(document.querySelectorAll(`.${ROW_CLASS}`))) el.remove();
		for (const el of Array.from(document.querySelectorAll(".sb-search-filtered"))) {
			el.removeClass("sb-search-filtered");
		}
	}

	// Turning one filter on turns the other off — they are mutually exclusive
	private setMode(mode: FilterMode): void {
		// Toggle setValue re-fires onChange; guard against re-entry
		if (this.syncing) return;
		this.syncing = true;
		this.mode = mode;
		for (const t of this.toggles) t.comp.setValue(this.mode === t.kind);
		this.syncing = false;
		this.apply();
	}

	protected apply(): void {
		// Prune toggles whose pane was closed (no longer in the DOM)
		for (const t of this.toggles) {
			if (!t.comp.toggleEl.isConnected) this.toggles.delete(t);
		}
		const bm = this.bookmarkedPaths();
		for (const leaf of this.app.workspace.getLeavesOfType("search")) {
			const view = leaf.view as any;
			this.attachToggle(view);
			this.filterResults(view, bm);
		}
	}

	// Add both toggle rows to the search pane's filter section (.search-params)
	private attachToggle(view: any): void {
		const container: HTMLElement | undefined = view?.containerEl;
		if (!container) return;
		const params = container.querySelector(".search-params");
		if (!(params instanceof HTMLElement) || params.querySelector(`.${ROW_CLASS}`)) return;

		const row = (name: string, kind: "only" | "exclude") => {
			new Setting(params)
				.setName(name)
				.setClass("mod-toggle")
				.setClass(ROW_CLASS)
				.addToggle((t) => {
					t.setValue(this.mode === kind).onChange((v) => this.setMode(v ? kind : "off"));
					this.toggles.add({ comp: t, kind });
				});
		};
		row(T.searchFilterButton, "only");
		row(T.searchExcludeButton, "exclude");
	}

	// Toggle the hidden class on each result based on bookmark membership and mode
	private filterResults(view: any, bookmarked: Set<string>): void {
		const lookup = view?.dom?.resultDomLookup;
		if (!(lookup instanceof Map)) return;
		for (const [file, dom] of lookup) {
			const el = dom?.el;
			if (!(el instanceof HTMLElement)) continue;
			const path = typeof file?.path === "string" ? file.path : null;
			const hit = path !== null && bookmarked.has(path);
			const hide = this.mode === "only" ? !hit : this.mode === "exclude" ? hit : false;
			el.toggleClass("sb-search-filtered", hide);
		}
	}

	// Exact paths only, matching how core Bookmarks decides whether something is bookmarked:
	// bookmarking a folder does not make the files inside it count.
	// Hidden bookmarks still count (hiding only affects the panel)
	private bookmarkedPaths(): Set<string> {
		const paths = new Set<string>();
		for (const it of flatten(this.getRoot())) {
			if (it.path && (it.type === "file" || it.type === "folder")) paths.add(it.path);
		}
		return paths;
	}
}
