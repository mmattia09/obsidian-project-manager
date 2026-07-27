import { App, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import { TIMELINE_VIEW_TYPE, TimelineView, timelineViewOptions } from "./timeline-view";
import { t } from "./i18n";

interface BasesTimelineSettings {
	statusKey: string;
	priorityKey: string;
	statusOrder: string;
}

const DEFAULT_SETTINGS: BasesTimelineSettings = {
	statusKey: "status",
	priorityKey: "priority",
	statusOrder: "inbox, not started, cooking, on hold, clean, archive",
};

export default class BasesTimelinePlugin extends Plugin {
	settings: BasesTimelineSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		const registered = this.registerBasesView(TIMELINE_VIEW_TYPE, {
			name: t("timeline"),
			icon: "lucide-calendar-range",
			factory: (controller, containerEl) =>
				new TimelineView(controller, containerEl, {
					getStatusOrder: () => this.statusOrderList(),
					getStatusKey: () => this.settings.statusKey,
					getPriorityKey: () => this.settings.priorityKey,
				}),
			options: timelineViewOptions,
		});
		if (!registered) {
			new Notice(t("notice.registerFailed"));
		}

		this.addSettingTab(new BasesTimelineSettingTab(this.app, this));
	}

	statusOrderList(): string[] {
		return this.settings.statusOrder
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<BasesTimelineSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...data };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class BasesTimelineSettingTab extends PluginSettingTab {
	plugin: BasesTimelinePlugin;

	constructor(app: App, plugin: BasesTimelinePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Declarative definitions (Obsidian 1.13+): powers the settings search.
	getSettingDefinitions(): SettingDefinitionItem[] {
		const text = (name: string, desc: string, key: keyof BasesTimelineSettings) => ({
			name,
			desc,
			control: { type: "text" as const, key, defaultValue: DEFAULT_SETTINGS[key] },
		});
		return [
			text(t("settings.statusOrder"), t("settings.statusOrderDesc"), "statusOrder"),
			{
				type: "group",
				heading: t("settings.properties"),
				items: [
					text(t("settings.statusKey"), t("settings.statusKeyDesc"), "statusKey"),
					text(t("settings.priorityKey"), t("settings.priorityKeyDesc"), "priorityKey"),
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof BasesTimelineSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const k = key as keyof BasesTimelineSettings;
		this.plugin.settings[k] = (typeof value === "string" && value.trim()) || DEFAULT_SETTINGS[k];
		await this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const text = (name: string, desc: string, key: keyof BasesTimelineSettings) => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((tc) =>
					tc.setValue(this.plugin.settings[key]).onChange(async (v) => {
						this.plugin.settings[key] = v.trim() || DEFAULT_SETTINGS[key];
						await this.plugin.saveSettings();
					})
				);
		};

		text(t("settings.statusOrder"), t("settings.statusOrderDesc"), "statusOrder");

		new Setting(containerEl).setName(t("settings.properties")).setHeading();
		text(t("settings.statusKey"), t("settings.statusKeyDesc"), "statusKey");
		text(t("settings.priorityKey"), t("settings.priorityKeyDesc"), "priorityKey");
	}
}
