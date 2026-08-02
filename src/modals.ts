// Shared modals: group picker, folder picker, text prompt, confirm dialog

import { App, FuzzyMatch, FuzzySuggestModal, Modal, Setting, TFile, TFolder } from "obsidian";
import { orderedGroups } from "./data";
import { BmItem, SortSpec } from "./types";
import { T } from "./strings";

type GroupChoice = { group: BmItem | null; label: string };

// Bases for this plugin's dialogs. On mobile they slide up from the bottom edge as a sheet
// instead of appearing in the middle (see .sb-sheet in styles.css); desktop is unchanged.
export class SheetModal extends Modal {
	constructor(app: App) {
		super(app);
		this.containerEl.addClass("sb-sheet");
	}
}

abstract class SheetSuggestModal<T> extends FuzzySuggestModal<T> {
	constructor(app: App) {
		super(app);
		this.containerEl.addClass("sb-sheet");
	}
}

// Render an "A / B / C" path label as a hierarchy:
// show only the last name, indented by depth (the list is in DFS order, so it reads as a tree)
function renderGroupPath(el: HTMLElement, label: string): void {
	const segs = label.split(" / ");
	el.addClass("sb-suggest-item");
	el.style.paddingLeft = `${8 + (segs.length - 1) * 16}px`;
	el.setText(segs[segs.length - 1] ?? label);
}

export class GroupPickerModal extends SheetSuggestModal<GroupChoice> {
	constructor(
		app: App,
		private root: BmItem[],
		private defaultSort: SortSpec,
		// Group ids excluded as destinations (the item itself, etc.)
		private excludeIds: Set<string>,
		private onPick: (group: BmItem | null) => void
	) {
		super(app);
		this.setPlaceholder(T.pickGroupPlaceholder);
	}

	getItems(): GroupChoice[] {
		// Listed in the panel's order, so the two never disagree
		const groups: GroupChoice[] = orderedGroups(this.app, this.root, this.defaultSort)
			.filter((g) => !this.excludeIds.has(g.group.id))
			.map((g) => ({ group: g.group, label: g.label }));
		return [{ group: null, label: T.rootGroupName }, ...groups];
	}

	getItemText(item: GroupChoice): string {
		return item.label;
	}

	// Fuzzy matching uses the full path; display is hierarchical
	renderSuggestion(match: FuzzyMatch<GroupChoice>, el: HTMLElement): void {
		renderGroupPath(el, match.item.label);
	}

	onChooseItem(item: GroupChoice): void {
		this.onPick(item.group);
	}
}

// Pick a .json file from the vault (for importing an export file)
export class JsonFilePickerModal extends SheetSuggestModal<TFile> {
	constructor(app: App, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(T.pickJsonPlaceholder);
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => f.extension === "json");
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

export class FolderPickerModal extends SheetSuggestModal<TFolder> {
	constructor(app: App, private onPick: (folder: TFolder) => void) {
		super(app);
		this.setPlaceholder(T.pickFolderPlaceholder);
	}

	getItems(): TFolder[] {
		return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
	}

	getItemText(folder: TFolder): string {
		return folder.path === "/" ? "/" : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onPick(folder);
	}
}

export class TextPromptModal extends SheetModal {
	private value: string;

	constructor(
		app: App,
		private label: string,
		initial: string,
		private onSubmit: (value: string) => void
	) {
		super(app);
		this.value = initial;
	}

	onOpen(): void {
		const { contentEl } = this;
		// Put the label in the title bar so the close button doesn't overlap the input
		this.setTitle(this.label);
		new Setting(contentEl).setClass("sb-prompt").addText((t) => {
			t.setValue(this.value).onChange((v) => (this.value = v));
			t.inputEl.focus();
			t.inputEl.select();
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") this.submit();
			});
		});
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(T.confirmButton).setCta().onClick(() => this.submit()))
			.addButton((b) => b.setButtonText(T.cancelButton).onClick(() => this.close()));
	}

	private submit(): void {
		const v = this.value.trim();
		this.close();
		if (v) this.onSubmit(v);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// Result of the add/edit modal
export interface BookmarkEditResult {
	// Custom name, or undefined to fall back to the original name
	title: string | undefined;
	// Destination group id, or null for the top level
	groupId: string | null;
}

// Add/edit a bookmark: original name (read-only), custom name, and a group dropdown.
// The group is chosen by id, so it never lands in the wrong group (unlike free-text matching).
// Pressing Enter saves; the group defaults to the top level, so a quick Enter adds there.
export class BookmarkEditModal extends SheetModal {
	private title: string;
	private groupId: string | null;

	constructor(
		app: App,
		private opts: {
			isEdit: boolean;
			originalName: string;
			initialTitle: string;
			groups: { id: string; label: string }[];
			initialGroupId: string | null;
			onSubmit: (result: BookmarkEditResult) => void;
			onDelete?: () => void;
		}
	) {
		super(app);
		this.title = opts.initialTitle;
		this.groupId = opts.initialGroupId;
		// This one runs nearly the full height on mobile: it has text fields, so a half-height
		// sheet leaves the inputs sitting right above the keyboard (see .sb-sheet-tall in
		// styles.css).
		this.containerEl.addClass("sb-sheet-tall");
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(T.modalTitle);

		// Original name (read-only reference)
		new Setting(contentEl).setName(T.fieldOriginalName).addText((t) => {
			t.setValue(this.opts.originalName).setDisabled(true);
		});

		// Custom bookmark name; blank falls back to the original
		new Setting(contentEl).setName(T.fieldBookmarkName).addText((t) => {
			t.setPlaceholder(this.opts.originalName).setValue(this.title).onChange((v) => (this.title = v));
			t.inputEl.focus();
			t.inputEl.select();
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) this.submit();
			});
		});

		// Destination group, chosen by id. Blank = no group (added at the top level).
		// Options are indented by depth to show the group hierarchy.
		new Setting(contentEl).setName(T.fieldGroup).addDropdown((d) => {
			d.addOption("", T.fieldGroupNone);
			for (const g of this.opts.groups) {
				const segs = g.label.split(" / ");
				// Non-breaking spaces: a <select> collapses/trims ordinary leading spaces,
				// so the hierarchy indentation would otherwise disappear
				const indent = "    ".repeat(segs.length - 1);
				d.addOption(g.id, indent + (segs[segs.length - 1] ?? g.label));
			}
			d.setValue(this.groupId ?? "").onChange((v) => (this.groupId = v || null));
		});

		// Buttons: Delete on the left (like core Bookmarks), Save/Cancel on the right
		const btns = contentEl.createDiv({ cls: "sb-modal-buttons" });
		if (this.opts.isEdit && this.opts.onDelete) {
			const del = btns.createEl("button", { text: T.btnDelete, cls: "mod-warning" });
			del.addEventListener("click", () => {
				this.close();
				this.opts.onDelete?.();
			});
		}
		const right = btns.createDiv({ cls: "sb-modal-buttons-right" });
		const cancel = right.createEl("button", { text: T.cancelButton });
		cancel.addEventListener("click", () => this.close());
		const save = right.createEl("button", { text: T.btnSave, cls: "mod-cta" });
		save.addEventListener("click", () => this.submit());
	}

	private submit(): void {
		const title = this.title.trim();
		this.close();
		this.opts.onSubmit({ title: title || undefined, groupId: this.groupId });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ConfirmModal extends SheetModal {
	constructor(
		app: App,
		private title: string,
		private body: string,
		private onConfirm: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.title });
		contentEl.createEl("p", { text: this.body });
		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText(T.confirmButton).setCta().onClick(() => {
					this.close();
					this.onConfirm();
				})
			)
			.addButton((b) => b.setButtonText(T.cancelButton).onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
