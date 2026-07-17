import {
	BasesAllOptions,
	BasesEntry,
	BasesPropertyId,
	BasesView,
	HoverParent,
	HoverPopover,
	Keymap,
	Menu,
	Notice,
	PaneType,
	Platform,
	QueryController,
	TFile,
	WorkspaceLeaf,
	parsePropertyId,
	setIcon,
} from "obsidian";
import { t } from "./i18n";

export interface TimelineViewDeps {
	getStatusOrder: () => string[];
	getStatusKey: () => string;
	getPriorityKey: () => string;
}

export const TIMELINE_VIEW_TYPE = "project-timeline";

const DAY_MS = 86400000;

type PriorityLevel = "urgent" | "high" | "medium" | "low" | "none";

const PRIORITY_LEVELS: Record<string, PriorityLevel> = {
	urgent: "urgent",
	urgente: "urgent",
	high: "high",
	alta: "high",
	medium: "medium",
	media: "medium",
	low: "low",
	bassa: "low",
};

const PRIORITY_RANK: Record<PriorityLevel, number> = {
	urgent: 0,
	high: 1,
	medium: 2,
	low: 3,
	none: 4,
};

const STATUS_ORDER = ["inbox", "not started", "cooking", "on hold", "clean", "archive"];

type TickKind = "day" | "week" | "month" | "quarter";

interface ZoomSpec {
	pxPerDay: number;
	tick: TickKind;
}

const ZOOMS: Record<string, ZoomSpec> = {
	day: { pxPerDay: 64, tick: "day" },
	week: { pxPerDay: 32, tick: "day" },
	biweek: { pxPerDay: 18, tick: "day" },
	month: { pxPerDay: 15, tick: "week" },
	quarter: { pxPerDay: 6, tick: "week" },
	year: { pxPerDay: 2, tick: "month" },
	fiveyear: { pxPerDay: 0.5, tick: "quarter" },
};

// Default project length (in days) when quick-scheduling at each zoom.
const DEFAULT_SPAN: Record<string, number> = {
	day: 1,
	week: 3,
	biweek: 5,
	month: 7,
	quarter: 14,
	year: 30,
	fiveyear: 90,
};

const zoomLabels = (): Record<string, string> => ({
	day: t("zoom.day"),
	week: t("zoom.week"),
	biweek: t("zoom.biweek"),
	month: t("zoom.month"),
	quarter: t("zoom.quarter"),
	year: t("zoom.year"),
	fiveyear: t("zoom.fiveyear"),
});

interface TimelineItem {
	entry: BasesEntry;
	file: TFile;
	title: string;
	start: number | null;
	end: number | null;
	scheduled: boolean;
	priority: PriorityLevel;
	priorityLabel: string | null;
}

interface RenderGroup {
	label: string | null;
	items: TimelineItem[];
}

interface BarRowInfo {
	left: number;
	right: number;
	leftArrowEl: HTMLElement;
	rightArrowEl: HTMLElement;
}

interface DragState {
	item: TimelineItem;
	barEl: HTMLElement;
	startLabelEl: HTMLElement | null;
	endLabelEl: HTMLElement | null;
	mode: "move" | "resize-left" | "resize-right";
	pointerId: number;
	x0: number;
	s0: number;
	e0: number;
	newStart: number;
	newEnd: number;
	moved: boolean;
}

function dayIndexFromISO(iso: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
	if (!m) return null;
	return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS;
}

function isoFromDayIndex(day: number): string {
	return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function todayIndex(): number {
	const now = new Date();
	return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
}

function dateOf(day: number): Date {
	return new Date(day * DAY_MS);
}

// Epoch day 0 (1970-01-01) was a Thursday: weekday index 0=Thu ... 6=Wed.
function isWeekend(day: number): boolean {
	const w = ((day % 7) + 7) % 7;
	return w === 2 || w === 3;
}

function isMonday(day: number): boolean {
	return ((day % 7) + 7) % 7 === 4;
}

function isQuarterStart(date: Date): boolean {
	return date.getUTCDate() === 1 && date.getUTCMonth() % 3 === 0;
}

export function timelineViewOptions(): BasesAllOptions[] {
	const noteOnly = (prop: BasesPropertyId) => prop.startsWith("note.");
	return [
		{
			type: "group",
			displayName: t("timeline"),
			items: [
				{
					type: "property",
					key: "start",
					displayName: t("option.start"),
					default: "note.start",
					placeholder: t("property"),
					filter: noteOnly,
				},
				{
					type: "property",
					key: "end",
					displayName: t("option.end"),
					default: "note.end",
					placeholder: t("property"),
					filter: noteOnly,
				},
				{
					type: "property",
					key: "priority",
					displayName: t("option.priority"),
					default: "note.priority",
					placeholder: t("property"),
					filter: noteOnly,
				},
				{
					type: "dropdown",
					key: "zoom",
					displayName: t("zoom.label"),
					default: "month",
					options: zoomLabels(),
				},
				{
					type: "toggle",
					key: "sortByPriority",
					displayName: t("option.sortByPriority"),
					default: true,
				},
				{
					type: "toggle",
					key: "sidebar",
					displayName: t("option.sidebar"),
					default: true,
				},
				{
					type: "toggle",
					key: "showUnscheduled",
					displayName: t("option.showUnscheduled"),
					default: true,
				},
			],
		},
	];
}

export class TimelineView extends BasesView implements HoverParent {
	readonly type = TIMELINE_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	private rootEl: HTMLElement;
	private sidebarEl: HTMLElement;
	private sidebarBodyEl: HTMLElement;
	private scrollerEl: HTMLElement;
	private zoomSelects: HTMLSelectElement[] = [];

	private minDay = 0;
	private pxPerDay = ZOOMS.month.pxPerDay;
	private zoomKey = "month";
	private startPid: BasesPropertyId | null = null;
	private endPid: BasesPropertyId | null = null;

	private anchorDay: number | null = null;
	private scrollTopSaved = 0;
	private firstRender = true;
	private syncingScroll = false;

	private drag: DragState | null = null;
	private pendingUpdate = false;
	private ticksRowEl: HTMLElement | null = null;
	private dateLabels: HTMLElement[] = [];
	private barRows: BarRowInfo[] = [];
	private arrowRaf = 0;

	constructor(
		controller: QueryController,
		parentEl: HTMLElement,
		private deps: TimelineViewDeps = {
			getStatusOrder: () => STATUS_ORDER,
			getStatusKey: () => "status",
			getPriorityKey: () => "priority",
		}
	) {
		super(controller);
		this.rootEl = parentEl.createDiv("ptl-container");
		const main = this.rootEl.createDiv("ptl-main");

		this.sidebarEl = main.createDiv("ptl-sidebar");
		const sideHeader = this.sidebarEl.createDiv("ptl-sidebar-header");
		const todayBtn = sideHeader.createEl("button", { text: t("today"), cls: "ptl-btn ptl-today-btn" });
		this.registerDomEvent(todayBtn, "click", () => this.scrollToToday());
		this.createZoomSelect(sideHeader);
		sideHeader.createDiv("ptl-spacer");
		const collapseBtn = sideHeader.createEl("button", { cls: "ptl-icon-btn ptl-collapse-btn" });
		setIcon(collapseBtn, "lucide-chevrons-left");
		collapseBtn.setAttr("aria-label", t("sidebar.hide"));
		this.registerDomEvent(collapseBtn, "click", () => this.toggleSidebar());
		this.sidebarBodyEl = this.sidebarEl.createDiv("ptl-sidebar-body");

		this.scrollerEl = main.createDiv("ptl-scroller");

		// Floating controls shown when the sidebar is collapsed.
		const expand = this.rootEl.createDiv("ptl-expand-controls");
		const expandBtn = expand.createEl("button", { cls: "ptl-icon-btn" });
		setIcon(expandBtn, "lucide-chevrons-right");
		expandBtn.setAttr("aria-label", t("sidebar.show"));
		this.registerDomEvent(expandBtn, "click", () => this.toggleSidebar());
		const todayBtn2 = expand.createEl("button", { text: t("today"), cls: "ptl-btn" });
		this.registerDomEvent(todayBtn2, "click", () => this.scrollToToday());
		this.createZoomSelect(expand);

		this.registerDomEvent(this.scrollerEl, "scroll", () => {
			this.scheduleArrowUpdate();
			if (this.drag) return;
			this.anchorDay = this.minDay + this.scrollerEl.scrollLeft / this.pxPerDay;
			this.scrollTopSaved = this.scrollerEl.scrollTop;
			if (!this.syncingScroll) {
				this.syncingScroll = true;
				this.sidebarBodyEl.scrollTop = this.scrollerEl.scrollTop;
				this.syncingScroll = false;
			}
		});
		this.registerDomEvent(this.sidebarBodyEl, "scroll", () => {
			if (this.syncingScroll) return;
			this.syncingScroll = true;
			this.scrollerEl.scrollTop = this.sidebarBodyEl.scrollTop;
			this.syncingScroll = false;
		});
	}

	onDataUpdated(): void {
		if (this.drag) {
			// Re-rendering mid-drag would destroy the dragged bar; defer.
			this.pendingUpdate = true;
			return;
		}
		this.render();
	}

	// ----- config helpers -----

	private sidebarVisible(): boolean {
		return (this.config.get("sidebar") as boolean) ?? true;
	}

	private toggleSidebar(): void {
		this.config.set("sidebar", !this.sidebarVisible());
		this.render();
	}

	private createZoomSelect(host: HTMLElement): void {
		const select = host.createEl("select", { cls: "dropdown ptl-zoom-select" });
		for (const [key, label] of Object.entries(zoomLabels())) {
			select.createEl("option", { text: label, value: key });
		}
		this.registerDomEvent(select, "change", () => {
			this.config.set("zoom", select.value);
			this.render();
		});
		this.zoomSelects.push(select);
	}

	private collapsedGroups(): string[] {
		const v = this.config.get("collapsed");
		return Array.isArray(v) ? v.map(String) : [];
	}

	private toggleGroup(label: string): void {
		const collapsed = this.collapsedGroups();
		const i = collapsed.indexOf(label);
		if (i >= 0) collapsed.splice(i, 1);
		else collapsed.push(label);
		this.config.set("collapsed", collapsed);
		this.render();
	}

	// ----- data extraction -----

	private readDay(entry: BasesEntry, pid: BasesPropertyId | null): number | null {
		if (!pid) return null;
		const value = entry.getValue(pid);
		if (!value || !value.isTruthy()) return null;
		return dayIndexFromISO(value.toString());
	}

	private readPriority(entry: BasesEntry, pid: BasesPropertyId | null): [PriorityLevel, string | null] {
		if (!pid) return ["none", null];
		const value = entry.getValue(pid);
		if (!value || !value.isTruthy()) return ["none", null];
		const label = value.toString().trim();
		return [PRIORITY_LEVELS[label.toLowerCase()] ?? "none", label];
	}

	private buildGroups(): RenderGroup[] {
		this.startPid = this.config.getAsPropertyId("start") ?? "note.start";
		this.endPid = this.config.getAsPropertyId("end") ?? "note.end";
		const priorityPid = this.config.getAsPropertyId("priority") ?? "note.priority";
		const sortByPriority = (this.config.get("sortByPriority") as boolean) ?? true;
		const showUnscheduled = (this.config.get("showUnscheduled") as boolean) ?? true;

		const groups: RenderGroup[] = [];
		for (const group of this.data.groupedData) {
			const rg: RenderGroup = {
				label: group.hasKey() ? group.key?.toString() ?? null : null,
				items: [],
			};
			for (const entry of group.entries) {
				let start = this.readDay(entry, this.startPid);
				let end = this.readDay(entry, this.endPid);
				if (start !== null && end !== null && end < start) [start, end] = [end, start];
				const scheduled = start !== null || end !== null;
				if (!scheduled && !showUnscheduled) continue;
				const [priority, priorityLabel] = this.readPriority(entry, priorityPid);
				rg.items.push({
					entry,
					file: entry.file,
					title: entry.file.basename,
					start,
					end,
					scheduled,
					priority,
					priorityLabel,
				});
			}
			if (sortByPriority) {
				rg.items.sort(
					(a, b) =>
						Number(b.scheduled) - Number(a.scheduled) ||
						PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
				);
			}
			if (rg.items.length) groups.push(rg);
		}

		// Order groups by workflow status when the labels match known statuses.
		const order = this.deps.getStatusOrder();
		const statusIndex = (g: RenderGroup) => {
			const i = order.indexOf((g.label ?? "").toLowerCase());
			return i === -1 ? order.length : i;
		};
		groups.sort((a, b) => statusIndex(a) - statusIndex(b));
		return groups;
	}

	// ----- rendering -----

	private render(): void {
		const zoomKey = (this.config.get("zoom") as string) ?? "month";
		const zoom = ZOOMS[zoomKey] ?? ZOOMS.month;
		this.pxPerDay = zoom.pxPerDay;
		this.zoomKey = ZOOMS[zoomKey] ? zoomKey : "month";
		for (const s of this.zoomSelects) s.value = this.zoomKey;

		const groups = this.buildGroups();
		const collapsed = new Set(this.collapsedGroups());
		const today = todayIndex();

		const sidebarVisible = this.sidebarVisible();
		this.rootEl.toggleClass("is-sidebar-hidden", !sidebarVisible);
		this.rootEl.toggleClass("is-list-only", Platform.isMobile && sidebarVisible);
		this.rootEl.toggleClass("is-mobile", Platform.isMobile);

		let minDay = today;
		let maxDay = today;
		for (const g of groups) {
			for (const item of g.items) {
				const s = item.start ?? item.end;
				const e = item.end ?? item.start;
				if (s !== null && s < minDay) minDay = s;
				if (e !== null && e > maxDay) maxDay = e;
			}
		}
		const pad = Math.max(14, Math.ceil(500 / this.pxPerDay));
		minDay -= pad;
		maxDay += pad;
		// Align range to Mondays so week ticks/grid start cleanly.
		while (!isMonday(minDay)) minDay--;
		this.minDay = minDay;
		const totalDays = maxDay - minDay + 1;

		this.scrollerEl.empty();
		this.sidebarBodyEl.empty();
		this.barRows = [];
		this.dateLabels = [];
		const canvas = this.scrollerEl.createDiv("ptl-canvas");
		canvas.style.width = `${totalDays * this.pxPerDay}px`;

		this.renderHeader(canvas, minDay, maxDay, today, zoom.tick);
		this.renderGrid(canvas, minDay, maxDay, zoom.tick);

		const todayLine = canvas.createDiv("ptl-today-line");
		todayLine.style.left = `${(today - minDay + 0.5) * this.pxPerDay}px`;

		const body = canvas.createDiv("ptl-body");
		const showGroups = groups.length > 1 || (groups.length === 1 && groups[0].label !== null);
		let anyRow = false;
		for (const g of groups) {
			const label = g.label ?? "—";
			const isCollapsed = collapsed.has(label);
			if (showGroups) {
				// Sidebar group header: chevron + label + count.
				const sideGroup = this.sidebarBodyEl.createDiv("ptl-side-group");
				const chevron = sideGroup.createSpan("ptl-chevron");
				setIcon(chevron, isCollapsed ? "lucide-chevron-right" : "lucide-chevron-down");
				sideGroup.createSpan({ cls: "ptl-side-group-label", text: label });
				sideGroup.createSpan({ cls: "ptl-side-group-count", text: String(g.items.length) });
				this.registerDomEvent(sideGroup, "click", () => this.toggleGroup(label));
				if (g.label !== null) this.setupStatusDrop(sideGroup, g.label);

				// Matching spacer row in the timeline; carries the label when the sidebar is hidden.
				const gh = body.createDiv("ptl-group-row");
				if (!sidebarVisible) {
					const inner = gh.createSpan("ptl-group-label");
					const chev = inner.createSpan("ptl-chevron");
					setIcon(chev, isCollapsed ? "lucide-chevron-right" : "lucide-chevron-down");
					inner.createSpan({ text: label });
					this.registerDomEvent(gh, "click", () => this.toggleGroup(label));
				}
			}
			if (showGroups && isCollapsed) continue;
			for (const item of g.items) {
				// With the sidebar hidden there is nothing to align with:
				// drop the unscheduled spacer rows entirely.
				if (!item.scheduled && !sidebarVisible) continue;
				anyRow = true;
				this.renderSideRow(item);
				this.renderRow(body, item);
			}
		}
		if (!anyRow) {
			const empty = body.createDiv("ptl-empty");
			empty.createSpan({ text: t("empty") });
		}

		this.restoreScroll();
		this.scheduleArrowUpdate();
	}

	private renderHeader(canvas: HTMLElement, minDay: number, maxDay: number, today: number, tick: TickKind): void {
		const header = canvas.createDiv("ptl-header");
		const monthsRow = header.createDiv("ptl-months");
		const ticksRow = header.createDiv("ptl-ticks");
		this.ticksRowEl = ticksRow;
		const yearBlocks = tick === "month" || tick === "quarter";

		// Top row: month labels, or year labels at wide zooms.
		let d = minDay;
		while (d <= maxDay) {
			const date = dateOf(d);
			let blockStart: number;
			let next: number;
			let label: string;
			if (yearBlocks) {
				blockStart = Date.UTC(date.getUTCFullYear(), 0, 1) / DAY_MS;
				next = Date.UTC(date.getUTCFullYear() + 1, 0, 1) / DAY_MS;
				label = String(date.getUTCFullYear());
			} else {
				blockStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY_MS;
				next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / DAY_MS;
				label = date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
			}
			const from = Math.max(blockStart, minDay);
			const to = Math.min(next - 1, maxDay);
			const blockWidth = (to - from + 1) * this.pxPerDay;
			const el = monthsRow.createDiv("ptl-month");
			el.style.left = `${(from - minDay) * this.pxPerDay}px`;
			el.style.width = `${blockWidth}px`;
			// Partial blocks at the range edges can be narrower than the label:
			// skip the label to avoid overlapping the next block's.
			if (blockWidth >= 90) el.createSpan({ cls: "ptl-month-label", text: label });
			d = next;
		}

		// Tick labels.
		for (let day = minDay; day <= maxDay; day++) {
			const date = dateOf(day);
			let show = false;
			let text = "";
			if (tick === "day") {
				show = true;
				text = String(date.getUTCDate());
			} else if (tick === "week" && isMonday(day)) {
				show = true;
				text = String(date.getUTCDate());
			} else if (tick === "month" && date.getUTCDate() === 1) {
				show = true;
				text = date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
			} else if (tick === "quarter" && isQuarterStart(date)) {
				show = true;
				text = date.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
			}
			if (!show) continue;
			const el = ticksRow.createDiv("ptl-tick");
			el.style.left = `${(day - minDay) * this.pxPerDay}px`;
			if (tick === "day") {
				el.style.width = `${this.pxPerDay}px`;
				el.addClass("mod-centered");
				if (isWeekend(day)) el.addClass("mod-weekend");
			}
			el.setText(text);
		}

		// Today badge.
		if (today >= minDay && today <= maxDay) {
			const badge = ticksRow.createDiv("ptl-today-badge");
			badge.style.left = `${(today - minDay + 0.5) * this.pxPerDay}px`;
			badge.setText(String(dateOf(today).getUTCDate()));
		}
	}

	private renderGrid(canvas: HTMLElement, minDay: number, maxDay: number, tick: TickKind): void {
		const grid = canvas.createDiv("ptl-grid");
		if (this.pxPerDay >= 10) {
			for (let day = minDay; day <= maxDay; day++) {
				if (((day % 7) + 7) % 7 === 2) {
					const w = grid.createDiv("ptl-weekend");
					w.style.left = `${(day - minDay) * this.pxPerDay}px`;
					w.style.width = `${2 * this.pxPerDay}px`;
				}
			}
		}
		for (let day = minDay; day <= maxDay; day++) {
			const date = dateOf(day);
			const lineHere =
				tick === "month"
					? date.getUTCDate() === 1
					: tick === "quarter"
						? isQuarterStart(date)
						: isMonday(day);
			if (!lineHere) continue;
			const line = grid.createDiv("ptl-gridline");
			line.style.left = `${(day - minDay) * this.pxPerDay}px`;
		}
	}

	private splitLeaf: WorkspaceLeaf | null = null;

	private openFile(e: MouseEvent, file: TFile): void {
		let leaf: WorkspaceLeaf;
		const mod: PaneType | boolean = Keymap.isModEvent(e);
		if (e.altKey || e.shiftKey) {
			leaf = this.app.workspace.getLeaf("split");
			this.splitLeaf = leaf;
		} else if (!mod && this.isLeafAlive(this.splitLeaf)) {
			// A side split opened from this view is still around: open the
			// note as a new tab next to it instead of replacing this view.
			this.app.workspace.setActiveLeaf(this.splitLeaf!, { focus: false });
			leaf = this.app.workspace.getLeaf("tab");
			this.splitLeaf = leaf;
		} else {
			leaf = this.app.workspace.getLeaf(mod);
		}
		void leaf.openFile(file);
	}

	private isLeafAlive(leaf: WorkspaceLeaf | null): boolean {
		// A detached leaf loses its parent; also ignore leaves whose view
		// container is no longer connected to the DOM.
		return !!leaf && !!(leaf as unknown as { parent?: unknown }).parent;
	}

	// Dragging a sidebar row onto another group header moves the project
	// to that status.
	private draggingItem: TimelineItem | null = null;

	private setupStatusDrop(groupEl: HTMLElement, status: string): void {
		this.registerDomEvent(groupEl, "dragover", (e) => {
			if (!this.draggingItem) return;
			e.preventDefault();
			groupEl.addClass("is-drop-target");
		});
		this.registerDomEvent(groupEl, "dragleave", () => groupEl.removeClass("is-drop-target"));
		this.registerDomEvent(groupEl, "drop", (e) => {
			groupEl.removeClass("is-drop-target");
			const item = this.draggingItem;
			this.draggingItem = null;
			if (!item) return;
			e.preventDefault();
			void this.setFrontmatterValue(item.file, this.deps.getStatusKey(), status);
		});
	}

	private async setFrontmatterValue(file: TFile, key: string, value: string): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (fm) => {
				fm[key] = value;
			});
		} catch (err) {
			console.error("Bases Timeline: failed to update property", err);
			new Notice(t("notice.updateFailed"));
		}
	}

	// Small menu with the four priority levels.
	private openPriorityMenu(e: MouseEvent, item: TimelineItem): void {
		const menu = new Menu();
		for (const level of ["urgent", "high", "medium", "low"] as const) {
			menu.addItem((mi) => {
				mi.setTitle(level);
				if (item.priority === level) mi.setChecked(true);
				mi.onClick(() => {
					void this.setFrontmatterValue(item.file, this.deps.getPriorityKey(), level);
				});
			});
		}
		menu.showAtMouseEvent(e);
	}

	// Optional Iconize (obsidian-icon-folder) integration: render the
	// file's icon, whether it is an emoji or a named icon pack glyph.
	private renderFileIcon(host: HTMLElement, path: string): void {
		type IconizePlugin = {
			data?: Record<string, unknown>;
			api?: {
				util?: { dom?: { setIconForNode?: (p: unknown, icon: string, node: HTMLElement) => void } };
				getIconByName?: (icon: string) => { svgElement?: string } | null;
			};
		};
		const iconize = (
			this.app as unknown as { plugins?: { plugins?: Record<string, IconizePlugin> } }
		).plugins?.plugins?.["obsidian-icon-folder"];
		if (!iconize) return;
		const entry = iconize.data?.[path];
		const icon =
			typeof entry === "string" ? entry : (entry as { iconName?: string } | undefined)?.iconName;
		if (!icon || typeof icon !== "string") return;
		const span = host.createSpan("ptl-icon");
		if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(icon)) {
			// Emoji / plain unicode icon.
			span.setText(icon);
			return;
		}
		try {
			iconize.api?.util?.dom?.setIconForNode?.(iconize, icon, span);
		} catch {
			// Ignore and try the lower-level API below.
		}
		if (!span.hasChildNodes()) {
			try {
				const svg = iconize.api?.getIconByName?.(icon)?.svgElement;
				if (typeof svg === "string") {
					const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
					if (doc.documentElement.nodeName.toLowerCase() === "svg") {
						span.appendChild(document.importNode(doc.documentElement, true));
					}
				}
			} catch {
				// Icon pack not available: drop the placeholder below.
			}
		}
		if (!span.hasChildNodes() && !span.textContent) span.remove();
	}

	private renderSideRow(item: TimelineItem): void {
		const row = this.sidebarBodyEl.createDiv("ptl-side-row");
		this.renderFileIcon(row, item.file.path);
		row.createSpan({ cls: "ptl-side-title", text: item.title });
		this.registerDomEvent(row, "click", (e) => this.openFile(e, item.file));
		row.draggable = true;
		this.registerDomEvent(row, "dragstart", (e) => {
			this.draggingItem = item;
			e.dataTransfer?.setData("text/plain", item.file.path);
		});
		this.registerDomEvent(row, "dragend", () => {
			this.draggingItem = null;
		});
		this.registerDomEvent(row, "mouseover", (e) => {
			this.app.workspace.trigger("hover-link", {
				event: e,
				source: TIMELINE_VIEW_TYPE,
				hoverParent: this,
				targetEl: row,
				linktext: item.file.path,
			});
		});
	}

	private renderRow(body: HTMLElement, item: TimelineItem): void {
		const row = body.createDiv("ptl-row");
		// Unscheduled projects are listed in the sidebar only; their timeline
		// row is an empty spacer that supports quick scheduling on hover.
		if (!item.scheduled) {
			if (this.canEdit()) this.setupQuickSchedule(row, item);
			return;
		}
		const start = item.start ?? item.end!;
		const end = item.end ?? item.start!;

		const bar = row.createDiv(`ptl-bar mod-${item.priority}`);
		const left = (start - this.minDay) * this.pxPerDay;
		const width = Math.max((end - start + 1) * this.pxPerDay - 2, 8);
		bar.style.left = `${left + 1}px`;
		bar.style.width = `${width}px`;

		// Sticky edge arrows, revealed when the bar is scrolled out of view.
		const makeArrow = (side: "left" | "right") => {
			const el = row.createDiv(`ptl-edge-arrow mod-${side}`);
			const icon = el.createSpan("ptl-edge-icon");
			setIcon(icon, side === "left" ? "lucide-arrow-left" : "lucide-arrow-right");
			el.createSpan({
				cls: "ptl-edge-dates",
				text: `${this.formatDayFull(start)} → ${this.formatDayFull(end)}`,
			});
			this.registerDomEvent(el, "click", (e) => {
				e.stopPropagation();
				const target =
					side === "left" ? left - 40 : left + width - this.scrollerEl.clientWidth + 40;
				this.scrollerEl.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
			});
			return el;
		};
		const leftArrowEl = makeArrow("left");
		row.createDiv("ptl-spacer");
		const rightArrowEl = makeArrow("right");
		this.barRows.push({ left, right: left + width, leftArrowEl, rightArrowEl });

		// Static date labels at the bar edges, revealed on hover / drag via CSS.
		const startLabel = row.createDiv("ptl-date-label mod-start");
		startLabel.setText(this.formatDay(start));
		startLabel.style.left = `${left - 8}px`;
		const endLabel = row.createDiv("ptl-date-label mod-end");
		endLabel.setText(this.formatDay(end));
		endLabel.style.left = `${left + width + 8}px`;

		// Label lives inside the bar but may overflow past its edge when
		// the bar is too small for the title.
		const label = bar.createDiv("ptl-label");
		this.renderFileIcon(label, item.file.path);
		label.createSpan({ cls: "ptl-title", text: item.title });
		if (item.priorityLabel) {
			const pill = label.createSpan({ cls: `ptl-pill mod-${item.priority}`, text: item.priorityLabel });
			if (this.canEdit()) {
				pill.addClass("is-clickable");
				this.registerDomEvent(pill, "pointerdown", (e) => e.stopPropagation());
				this.registerDomEvent(pill, "click", (e) => {
					e.stopPropagation();
					this.openPriorityMenu(e, item);
				});
			}
		}

		if (this.canEdit()) {
			bar.createDiv("ptl-handle mod-left");
			bar.createDiv("ptl-handle mod-right");
			this.registerDomEvent(bar, "pointerdown", (e) => this.onBarPointerDown(e, item, bar));
			this.registerDomEvent(bar, "pointermove", this.onBarPointerMove);
			this.registerDomEvent(bar, "pointerup", this.onBarPointerUp);
			this.registerDomEvent(bar, "pointercancel", this.onBarPointerUp);
		}

		this.registerDomEvent(bar, "click", (e) => {
			if (this.drag || bar.hasClass("mod-dragged")) {
				bar.removeClass("mod-dragged");
				return;
			}
			this.openFile(e, item.file);
		});
		this.registerDomEvent(bar, "mouseover", (e) => {
			this.app.workspace.trigger("hover-link", {
				event: e,
				source: TIMELINE_VIEW_TYPE,
				hoverParent: this,
				targetEl: bar,
				linktext: item.file.path,
			});
		});
	}

	private formatDayFull(day: number): string {
		return dateOf(day).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
	}

	private scheduleArrowUpdate(): void {
		if (this.arrowRaf) return;
		this.arrowRaf = requestAnimationFrame(() => {
			this.arrowRaf = 0;
			this.updateEdgeArrows();
		});
	}

	// The arrows are position:sticky, so the browser keeps them anchored
	// during (smooth) scrolling; here we only toggle their visibility.
	private updateEdgeArrows(): void {
		const viewLeft = this.scrollerEl.scrollLeft;
		const viewRight = viewLeft + this.scrollerEl.clientWidth;
		for (const info of this.barRows) {
			info.leftArrowEl.toggleClass("is-visible", info.right < viewLeft + 16);
			info.rightArrowEl.toggleClass("is-visible", info.left > viewRight - 16);
		}
	}

	// Hovering an unscheduled row previews a bar under the cursor;
	// clicking writes the previewed dates to the note.
	private setupQuickSchedule(row: HTMLElement, item: TimelineItem): void {
		row.addClass("mod-unscheduled");
		let ghost: HTMLElement | null = null;
		let ghostStart = 0;
		let ghostEnd = 0;
		this.registerDomEvent(row, "mousemove", (e) => {
			if (this.drag) return;
			const rect = row.getBoundingClientRect();
			const day = this.minDay + Math.floor((e.clientX - rect.left) / this.pxPerDay);
			const span = DEFAULT_SPAN[this.zoomKey] ?? 7;
			ghostStart = day;
			ghostEnd = day + span - 1;
			if (!ghost) {
				ghost = row.createDiv("ptl-ghost");
				ghost.createDiv("ptl-label").createSpan({ cls: "ptl-title", text: item.title });
			}
			ghost.style.left = `${(ghostStart - this.minDay) * this.pxPerDay + 1}px`;
			ghost.style.width = `${Math.max((ghostEnd - ghostStart + 1) * this.pxPerDay - 2, 8)}px`;
			this.showDateLabels(row, ghostStart, ghostEnd, "both");
		});
		this.registerDomEvent(row, "mouseleave", () => {
			ghost?.remove();
			ghost = null;
			this.clearDateLabels();
		});
		this.registerDomEvent(row, "click", () => {
			if (!ghost) return;
			void this.applyQuickDates(item, ghostStart, ghostEnd);
		});
	}

	private async applyQuickDates(item: TimelineItem, start: number, end: number): Promise<void> {
		const startProp = this.startPid ? parsePropertyId(this.startPid) : null;
		const endProp = this.endPid ? parsePropertyId(this.endPid) : null;
		try {
			await this.app.fileManager.processFrontMatter(item.file, (fm) => {
				if (startProp?.type === "note") fm[startProp.name] = isoFromDayIndex(start);
				if (endProp?.type === "note") fm[endProp.name] = isoFromDayIndex(end);
			});
		} catch (err) {
			console.error("Bases Timeline: failed to set dates", err);
			new Notice(t("notice.updateFailed"));
		}
	}

	private restoreScroll(): void {
		if (this.scrollerEl.clientWidth === 0) {
			// Timeline hidden (mobile list mode): scroll to today once visible again.
			this.firstRender = true;
			return;
		}
		if (this.firstRender || this.anchorDay === null) {
			this.firstRender = false;
			// Wait for layout so clientWidth is meaningful.
			requestAnimationFrame(() => this.scrollToToday());
			return;
		}
		this.scrollerEl.scrollLeft = (this.anchorDay - this.minDay) * this.pxPerDay;
		this.scrollerEl.scrollTop = this.scrollTopSaved;
		this.sidebarBodyEl.scrollTop = this.scrollTopSaved;
	}

	private scrollToToday(attempt = 0): void {
		if (this.scrollerEl.clientWidth === 0) {
			// Not laid out yet (or hidden in mobile list mode): retry briefly.
			this.firstRender = true;
			if (attempt < 30) requestAnimationFrame(() => this.scrollToToday(attempt + 1));
			return;
		}
		this.firstRender = false;
		const today = todayIndex();
		const target = (today - this.minDay) * this.pxPerDay - this.scrollerEl.clientWidth / 3;
		this.scrollerEl.scrollLeft = Math.max(0, target);
		this.anchorDay = this.minDay + this.scrollerEl.scrollLeft / this.pxPerDay;
	}

	// ----- date editing -----

	private canEdit(): boolean {
		const s = this.startPid ? parsePropertyId(this.startPid) : null;
		const e = this.endPid ? parsePropertyId(this.endPid) : null;
		return s?.type === "note" || e?.type === "note";
	}

	private onBarPointerDown(e: PointerEvent, item: TimelineItem, bar: HTMLElement): void {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement;
		let mode: DragState["mode"] = "move";
		if (target.hasClass("ptl-handle")) {
			mode = target.hasClass("mod-left") ? "resize-left" : "resize-right";
		}
		const s0 = item.start ?? item.end!;
		const e0 = item.end ?? item.start!;
		const row = bar.parentElement;
		const startLabelEl = row?.querySelector<HTMLElement>(".ptl-date-label.mod-start") ?? null;
		const endLabelEl = row?.querySelector<HTMLElement>(".ptl-date-label.mod-end") ?? null;
		this.drag = {
			item,
			barEl: bar,
			startLabelEl,
			endLabelEl,
			mode,
			pointerId: e.pointerId,
			x0: e.clientX,
			s0,
			e0,
			newStart: s0,
			newEnd: e0,
			moved: false,
		};
		try {
			bar.setPointerCapture(e.pointerId);
		} catch {
			// Pointer capture can fail for synthetic events; drag still works.
		}
	}

	private onBarPointerMove = (e: PointerEvent): void => {
		const d = this.drag;
		if (!d || e.pointerId !== d.pointerId) return;
		const deltaDays = Math.round((e.clientX - d.x0) / this.pxPerDay);
		if (deltaDays !== 0) d.moved = true;
		if (d.mode === "move") {
			d.newStart = d.s0 + deltaDays;
			d.newEnd = d.e0 + deltaDays;
		} else if (d.mode === "resize-left") {
			d.newStart = Math.min(d.s0 + deltaDays, d.e0);
			d.newEnd = d.e0;
		} else {
			d.newStart = d.s0;
			d.newEnd = Math.max(d.e0 + deltaDays, d.s0);
		}
		const barLeft = (d.newStart - this.minDay) * this.pxPerDay;
		const barWidth = Math.max((d.newEnd - d.newStart + 1) * this.pxPerDay - 2, 8);
		d.barEl.style.left = `${barLeft + 1}px`;
		d.barEl.style.width = `${barWidth}px`;
		this.rootEl.toggleClass("is-dragging", d.moved);
		if (d.moved) {
			// Keep the static labels pinned to the moving bar edges.
			if (d.startLabelEl) {
				d.startLabelEl.setText(this.formatDay(d.newStart));
				d.startLabelEl.style.left = `${barLeft - 8}px`;
				d.startLabelEl.addClass("mod-active");
			}
			if (d.endLabelEl) {
				d.endLabelEl.setText(this.formatDay(d.newEnd));
				d.endLabelEl.style.left = `${barLeft + barWidth + 8}px`;
				d.endLabelEl.addClass("mod-active");
			}
		}
	};

	private formatDay(day: number): string {
		return dateOf(day).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
	}

	// Transient date labels for the quick-schedule ghost preview.
	private showDateLabels(row: HTMLElement, startDay: number, endDay: number, which: "both" | "start" | "end"): void {
		this.clearDateLabels();
		const barLeft = (startDay - this.minDay) * this.pxPerDay;
		const barRight = (endDay - this.minDay + 1) * this.pxPerDay;
		const make = (cls: string, text: string, left: number) => {
			const b = row.createDiv(`ptl-date-label mod-active ${cls}`);
			b.setText(text);
			b.style.left = `${left}px`;
			this.dateLabels.push(b);
		};
		if (which !== "end") make("mod-start", this.formatDay(startDay), barLeft - 8);
		if (which !== "start") make("mod-end", this.formatDay(endDay), barRight + 8);
	}

	private clearDateLabels(): void {
		for (const b of this.dateLabels) b.remove();
		this.dateLabels = [];
	}

	private onBarPointerUp = (e: PointerEvent): void => {
		const d = this.drag;
		if (!d || e.pointerId !== d.pointerId) return;
		try {
			d.barEl.releasePointerCapture(d.pointerId);
		} catch {
			// No capture to release (e.g. synthetic events).
		}
		this.drag = null;
		this.rootEl.removeClass("is-dragging");
		d.startLabelEl?.removeClass("mod-active");
		d.endLabelEl?.removeClass("mod-active");
		if (d.moved) {
			d.barEl.addClass("mod-dragged");
			void this.applyDates(d);
		}
		if (this.pendingUpdate) {
			this.pendingUpdate = false;
			this.render();
		}
	};

	private async applyDates(d: DragState): Promise<void> {
		const startProp = this.startPid ? parsePropertyId(this.startPid) : null;
		const endProp = this.endPid ? parsePropertyId(this.endPid) : null;
		try {
			await this.app.fileManager.processFrontMatter(d.item.file, (fm) => {
				if (startProp?.type === "note" && (d.item.start !== null || d.newStart !== d.s0)) {
					fm[startProp.name] = isoFromDayIndex(d.newStart);
				}
				if (endProp?.type === "note" && (d.item.end !== null || d.newEnd !== d.e0)) {
					fm[endProp.name] = isoFromDayIndex(d.newEnd);
				}
			});
		} catch (err) {
			console.error("Bases Timeline: failed to update dates", err);
			new Notice(t("notice.updateFailed"));
			this.render();
		}
	}
}
