import {
	BasesAllOptions,
	BasesEntry,
	BasesPropertyId,
	BasesView,
	HoverParent,
	HoverPopover,
	Keymap,
	Notice,
	PaneType,
	Platform,
	QueryController,
	TFile,
	parsePropertyId,
	setIcon,
} from "obsidian";

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

interface DragState {
	item: TimelineItem;
	barEl: HTMLElement;
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
			displayName: "Timeline",
			items: [
				{
					type: "property",
					key: "start",
					displayName: "Data di inizio",
					default: "note.start",
					placeholder: "Proprietà",
					filter: noteOnly,
				},
				{
					type: "property",
					key: "end",
					displayName: "Data di fine",
					default: "note.end",
					placeholder: "Proprietà",
					filter: noteOnly,
				},
				{
					type: "property",
					key: "priority",
					displayName: "Priorità",
					default: "note.priority",
					placeholder: "Proprietà",
					filter: noteOnly,
				},
				{
					type: "dropdown",
					key: "zoom",
					displayName: "Zoom",
					default: "month",
					options: {
						day: "Giorno",
						week: "Settimana",
						biweek: "Due settimane",
						month: "Mese",
						quarter: "Trimestre",
						year: "Anno",
						fiveyear: "5 anni",
					},
				},
				{
					type: "toggle",
					key: "sortByPriority",
					displayName: "Ordina per priorità",
					default: true,
				},
				{
					type: "toggle",
					key: "sidebar",
					displayName: "Mostra pannello laterale",
					default: true,
				},
				{
					type: "toggle",
					key: "showUnscheduled",
					displayName: "Mostra progetti senza data",
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

	private minDay = 0;
	private pxPerDay = ZOOMS.month.pxPerDay;
	private startPid: BasesPropertyId | null = null;
	private endPid: BasesPropertyId | null = null;

	private anchorDay: number | null = null;
	private scrollTopSaved = 0;
	private firstRender = true;
	private syncingScroll = false;

	private drag: DragState | null = null;
	private pendingUpdate = false;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.rootEl = parentEl.createDiv("ptl-container");
		const main = this.rootEl.createDiv("ptl-main");

		this.sidebarEl = main.createDiv("ptl-sidebar");
		const sideHeader = this.sidebarEl.createDiv("ptl-sidebar-header");
		const todayBtn = sideHeader.createEl("button", { text: "Oggi", cls: "ptl-btn ptl-today-btn" });
		this.registerDomEvent(todayBtn, "click", () => this.scrollToToday());
		sideHeader.createDiv("ptl-spacer");
		const collapseBtn = sideHeader.createEl("button", { cls: "ptl-icon-btn ptl-collapse-btn" });
		setIcon(collapseBtn, "lucide-chevrons-left");
		collapseBtn.setAttr("aria-label", "Nascondi pannello laterale");
		this.registerDomEvent(collapseBtn, "click", () => this.toggleSidebar());
		this.sidebarBodyEl = this.sidebarEl.createDiv("ptl-sidebar-body");

		this.scrollerEl = main.createDiv("ptl-scroller");

		// Floating controls shown when the sidebar is collapsed.
		const expand = this.rootEl.createDiv("ptl-expand-controls");
		const expandBtn = expand.createEl("button", { cls: "ptl-icon-btn" });
		setIcon(expandBtn, "lucide-chevrons-right");
		expandBtn.setAttr("aria-label", "Mostra pannello laterale");
		this.registerDomEvent(expandBtn, "click", () => this.toggleSidebar());
		const todayBtn2 = expand.createEl("button", { text: "Oggi", cls: "ptl-btn" });
		this.registerDomEvent(todayBtn2, "click", () => this.scrollToToday());

		this.registerDomEvent(this.scrollerEl, "scroll", () => {
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
		const statusIndex = (g: RenderGroup) => {
			const i = STATUS_ORDER.indexOf((g.label ?? "").toLowerCase());
			return i === -1 ? STATUS_ORDER.length : i;
		};
		groups.sort((a, b) => statusIndex(a) - statusIndex(b));
		return groups;
	}

	// ----- rendering -----

	private render(): void {
		const zoomKey = (this.config.get("zoom") as string) ?? "month";
		const zoom = ZOOMS[zoomKey] ?? ZOOMS.month;
		this.pxPerDay = zoom.pxPerDay;

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
			empty.createSpan({ text: "Nessun progetto da mostrare" });
		}

		this.restoreScroll();
	}

	private renderHeader(canvas: HTMLElement, minDay: number, maxDay: number, today: number, tick: TickKind): void {
		const header = canvas.createDiv("ptl-header");
		const monthsRow = header.createDiv("ptl-months");
		const ticksRow = header.createDiv("ptl-ticks");
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

	private openFile(e: MouseEvent, file: TFile): void {
		const paneType: PaneType | boolean = e.altKey || e.shiftKey ? "split" : Keymap.isModEvent(e);
		void this.app.workspace.getLeaf(paneType).openFile(file);
	}

	private renderSideRow(item: TimelineItem): void {
		const row = this.sidebarBodyEl.createDiv("ptl-side-row");
		row.createSpan({ cls: "ptl-side-title", text: item.title });
		this.registerDomEvent(row, "click", (e) => this.openFile(e, item.file));
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
		// Unscheduled projects are listed in the sidebar only: keep the
		// timeline row as an empty spacer so the two panes stay aligned.
		if (!item.scheduled) return;
		const start = item.start ?? item.end!;
		const end = item.end ?? item.start!;

		const bar = row.createDiv(`ptl-bar mod-${item.priority}`);
		const left = (start - this.minDay) * this.pxPerDay;
		const width = Math.max((end - start + 1) * this.pxPerDay - 2, 8);
		bar.style.left = `${left + 1}px`;
		bar.style.width = `${width}px`;

		const labelInside = width >= 110;
		const labelHost = labelInside ? bar : row;
		if (!labelInside) {
			bar.addClass("mod-narrow");
		}
		const label = labelHost.createDiv(`ptl-label${labelInside ? "" : " mod-outside"}`);
		if (!labelInside) label.style.left = `${left + width + 8}px`;
		label.createSpan({ cls: "ptl-title", text: item.title });
		if (item.priorityLabel) {
			label.createSpan({ cls: `ptl-pill mod-${item.priority}`, text: item.priorityLabel });
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

	private scrollToToday(): void {
		if (this.scrollerEl.clientWidth === 0) {
			this.firstRender = true;
			return;
		}
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
		this.drag = {
			item,
			barEl: bar,
			mode,
			pointerId: e.pointerId,
			x0: e.clientX,
			s0,
			e0,
			newStart: s0,
			newEnd: e0,
			moved: false,
		};
		bar.setPointerCapture(e.pointerId);
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
		d.barEl.style.left = `${(d.newStart - this.minDay) * this.pxPerDay + 1}px`;
		d.barEl.style.width = `${Math.max((d.newEnd - d.newStart + 1) * this.pxPerDay - 2, 8)}px`;
		this.rootEl.toggleClass("is-dragging", d.moved);
	};

	private onBarPointerUp = (e: PointerEvent): void => {
		const d = this.drag;
		if (!d || e.pointerId !== d.pointerId) return;
		d.barEl.releasePointerCapture(d.pointerId);
		this.drag = null;
		this.rootEl.removeClass("is-dragging");
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
			console.error("Project Manager: failed to update dates", err);
			new Notice("Impossibile aggiornare le date del progetto.");
			this.render();
		}
	}
}
