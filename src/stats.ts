// Bookmark statistics modal

import { App } from "obsidian";
import { BmItem } from "./types";
import { allGroups, flatten } from "./data";
import { SheetModal } from "./modals";
import { T } from "./strings";

export class StatsModal extends SheetModal {
	constructor(app: App, private root: BmItem[]) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("sb-stats");
		contentEl.createEl("h2", { text: T.statsTitle });

		const all = flatten(this.root);
		const bookmarks = all.filter((i) => i.type !== "group");
		const groups = all.filter((i) => i.type === "group");

		// Summary cards
		const summary = contentEl.createDiv({ cls: "sb-stats-summary" });
		this.card(summary, T.statsTotal, String(bookmarks.length));
		this.card(summary, T.statsGroups, String(groups.length));

		// Bookmarks per group (counting nested groups' contents). Shown with full paths, not just names
		this.section(contentEl, T.statsPerGroup, (el) => {
			const rows = allGroups(this.root)
				.map(({ group, label }) => ({ label, n: flatten(group.items ?? []).filter((i) => i.type !== "group").length }))
				.sort((a, b) => b.n - a.n);
			if (!rows.length) return false;
			const max = Math.max(1, rows[0]?.n ?? 0);
			for (const { label, n } of rows) {
				const row = el.createDiv({ cls: "sb-stats-bar-row" });
				row.createSpan({ cls: "sb-stats-bar-label", text: label, attr: { title: label } });
				const track = row.createDiv({ cls: "sb-stats-bar-track" });
				track.createDiv({ cls: "sb-stats-bar-fill" }).style.width = `${(n / max) * 100}%`;
				row.createSpan({ cls: "sb-stats-bar-value", text: String(n) });
			}
			return true;
		});

		// Per-type counts, only for the types actually present
		this.section(contentEl, T.statsByType, (el) => {
			const counts: Record<string, number> = {};
			for (const b of bookmarks) counts[b.type] = (counts[b.type] ?? 0) + 1;
			const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
			if (!entries.length) return false;
			const max = entries[0][1];
			for (const [type, n] of entries) {
				const row = el.createDiv({ cls: "sb-stats-bar-row" });
				row.createSpan({ cls: "sb-stats-bar-label", text: T.statsTypeNames[type] ?? type });
				const track = row.createDiv({ cls: "sb-stats-bar-track" });
				track.createDiv({ cls: "sb-stats-bar-fill" }).style.width = `${(n / max) * 100}%`;
				row.createSpan({ cls: "sb-stats-bar-value", text: String(n) });
			}
			return true;
		});
	}

	private card(parent: HTMLElement, label: string, value: string): void {
		const card = parent.createDiv({ cls: "sb-stats-card" });
		card.createDiv({ cls: "sb-stats-card-value", text: value });
		card.createDiv({ cls: "sb-stats-card-label", text: label });
	}

	// When render returns false, show the "no data" placeholder
	private section(parent: HTMLElement, title: string, render: (el: HTMLElement) => boolean): void {
		parent.createEl("h4", { text: title });
		const el = parent.createDiv({ cls: "sb-stats-section" });
		if (!render(el)) el.createDiv({ cls: "sb-stats-muted", text: T.statsNoData });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
