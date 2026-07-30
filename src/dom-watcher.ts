// Shared scaffolding for the integrations that decorate Obsidian's own UI
// (file explorer, search pane). Obsidian rebuilds those DOM trees freely, so each
// integration has to re-apply itself; this watches for changes and coalesces bursts
// into one pass per frame. Subclasses only implement what to apply and how to clean up.

export abstract class DomWatcher {
	private observer: MutationObserver | null = null;
	private scheduled = false;

	// Attributes worth watching, when a subclass needs more than added/removed nodes.
	// Keep this narrow: watching attributes we write ourselves would recurse.
	protected watchAttributes: string[] | null = null;

	enable(): void {
		if (this.observer) return;
		this.observer = new MutationObserver(() => this.schedule());
		this.observer.observe(document.body, {
			childList: true,
			subtree: true,
			...(this.watchAttributes ? { attributes: true, attributeFilter: this.watchAttributes } : {}),
		});
		this.apply();
	}

	disable(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.cleanup();
	}

	// Called after bookmark data changes
	refresh(): void {
		if (this.observer) this.schedule();
	}

	private schedule(): void {
		if (this.scheduled) return;
		this.scheduled = true;
		requestAnimationFrame(() => {
			this.scheduled = false;
			this.apply();
		});
	}

	// Bring the watched UI in sync with the current bookmarks
	protected abstract apply(): void;

	// Remove everything this integration added
	protected abstract cleanup(): void;
}
