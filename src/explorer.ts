// Marks bookmarked files/folders in the file explorer.
// Works by matching data-path attributes in the explorer DOM and adding the
// sb-bookmarked class, so it does not depend on explorer internals
// (if the DOM structure changes, the marker just silently disappears)

import { BmItem } from "./types";
import { flatten } from "./data";
import { DomWatcher } from "./dom-watcher";

export class ExplorerHighlighter extends DomWatcher {
	// Rows sometimes get their data-path after being created, so watch that attribute too.
	// We only ever write `class`, so this never feeds back into the observer.
	protected watchAttributes = ["data-path"];

	constructor(private getRoot: () => BmItem[]) {
		super();
	}

	protected apply(): void {
		const paths = new Set(
			flatten(this.getRoot())
				.filter((it) => (it.type === "file" || it.type === "folder") && it.path && !it.hidden)
				.map((it) => it.path as string)
		);
		const els = document.querySelectorAll(".nav-file-title[data-path], .nav-folder-title[data-path]");
		for (const el of Array.from(els)) {
			el.toggleClass("sb-bookmarked", paths.has(el.getAttribute("data-path") ?? ""));
		}
	}

	protected cleanup(): void {
		for (const el of Array.from(document.querySelectorAll(".sb-bookmarked"))) {
			el.removeClass("sb-bookmarked");
		}
	}
}
