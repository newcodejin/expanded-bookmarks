// Settings tab

import { App, PluginSettingTab, Setting } from "obsidian";
import type ExpandedBookmarksPlugin from "./main";
import { ActionPlacement, ToolbarAction } from "./types";
import { T } from "./strings";

export class SBSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ExpandedBookmarksPlugin) {
		super(app, plugin);
	}

	// Description plus an optional "※ …" note on its own line
	private desc(text: string, note?: string): DocumentFragment {
		const frag = createFragment();
		frag.append(text);
		if (note) frag.append(createEl("br"), createSpan({ text: note, cls: "sb-setting-note" }));
		return frag;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.data.settings;

		// The sort order is changed from the panel's sort button, so it isn't duplicated here.
		// The sort indicators are always shown, so there is no toggle for them either.

		new Setting(containerEl)
			.setName(T.settingsHighlightName)
			.setDesc(this.desc(T.settingsHighlightDesc, T.noteCoreExplorer))
			.addToggle((t) =>
				t.setValue(s.highlightInExplorer).onChange(async (v) => {
					s.highlightInExplorer = v;
					await this.plugin.saveAll();
					this.plugin.setExplorerHighlight(v);
				})
			);

		new Setting(containerEl)
			.setName(T.settingsSearchFilterName)
			.setDesc(this.desc(T.settingsSearchFilterDesc, T.noteCoreSearch))
			.addToggle((t) =>
				t.setValue(s.searchBookmarkFilter).onChange(async (v) => {
					s.searchBookmarkFilter = v;
					await this.plugin.saveAll();
					this.plugin.setSearchFilter(v);
				})
			);

		// Moving real files always asks for confirmation, so there is no toggle for it

		new Setting(containerEl)
			.setName(T.settingsExportFolderName)
			.setDesc(T.settingsExportFolderDesc)
			.addText((t) =>
				t
					.setPlaceholder(T.settingsExportFolderPlaceholder)
					.setValue(s.exportFolder)
					.onChange(async (v) => {
						s.exportFolder = v.trim();
						await this.plugin.saveAll();
					})
			);

		// ----- Toolbar layout -----
		new Setting(containerEl).setName(T.settingsToolbarHeading).setDesc(T.settingsToolbarDesc).setHeading();

		const actions: ToolbarAction[] = ["sort", "newGroup", "collapseAll", "scrollTop", "scrollBottom", "resetSort", "batch", "stats", "showHidden", "import", "importFile", "export", "dedupe", "clean"];
		for (const id of actions) {
			const setting = new Setting(containerEl).setName(T.actionNames[id]);
			// Note the actions that reach outside the bookmark panel
			if (T.actionNotes[id]) setting.setDesc(T.actionNotes[id]);
			setting
				.addDropdown((d) =>
					d
						.addOption("toolbar", T.placementToolbar)
						.addOption("menu", T.placementMenu)
						.addOption("hidden", T.placementHidden)
						.setValue(s.toolbarLayout[id])
						.onChange(async (v) => {
							s.toolbarLayout[id] = v as ActionPlacement;
							await this.plugin.saveAll();
							this.plugin.refreshViews();
						})
				);
		}
	}
}
