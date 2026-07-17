import { App, Notice, Plugin, PluginSettingTab, Setting, normalizePath } from "obsidian";
import { TIMELINE_VIEW_TYPE, TimelineView, timelineViewOptions } from "./timeline-view";
import { t } from "./i18n";

interface ProjectManagerSettings {
	projectsFolder: string;
	statusKey: string;
	priorityKey: string;
	startKey: string;
	endKey: string;
	tagsKey: string;
	defaultStatus: string;
	defaultPriority: string;
	statusOrder: string;
}

const DEFAULT_SETTINGS: ProjectManagerSettings = {
	projectsFolder: "projects",
	statusKey: "status",
	priorityKey: "priority",
	startKey: "start",
	endKey: "end",
	tagsKey: "tags",
	defaultStatus: "inbox",
	defaultPriority: "medium",
	statusOrder: "inbox, not started, cooking, on hold, clean, archive",
};

export default class ProjectManagerPlugin extends Plugin {
	settings: ProjectManagerSettings = DEFAULT_SETTINGS;

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

		this.addCommand({
			id: "new-project",
			name: t("command.newProject"),
			callback: () => void this.createProject(),
		});
		this.addRibbonIcon("lucide-folder-kanban", t("command.newProject"), () => void this.createProject());

		this.addSettingTab(new ProjectManagerSettingTab(this.app, this));
	}

	statusOrderList(): string[] {
		return this.settings.statusOrder
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);
	}

	async createProject(): Promise<void> {
		const s = this.settings;
		const folder = normalizePath(s.projectsFolder || "projects");
		if (!this.app.vault.getFolderByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		const base = t("command.newProject");
		let path = normalizePath(`${folder}/${base}.md`);
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			counter++;
			path = normalizePath(`${folder}/${base} ${counter}.md`);
		}
		const file = await this.app.vault.create(path, "");
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm[s.statusKey] = s.defaultStatus;
			fm[s.priorityKey] = s.defaultPriority;
			fm[s.tagsKey] = [];
			fm[s.startKey] = null;
			fm[s.endKey] = null;
		});
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class ProjectManagerSettingTab extends PluginSettingTab {
	plugin: ProjectManagerPlugin;

	constructor(app: App, plugin: ProjectManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const text = (name: string, desc: string, key: keyof ProjectManagerSettings) => {
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

		text(t("settings.folder"), t("settings.folderDesc"), "projectsFolder");
		text(t("settings.statusOrder"), t("settings.statusOrderDesc"), "statusOrder");

		new Setting(containerEl).setName(t("settings.properties")).setHeading();
		text(t("settings.statusKey"), t("settings.statusKeyDesc"), "statusKey");
		text(t("settings.priorityKey"), t("settings.priorityKeyDesc"), "priorityKey");
		text(t("settings.startKey"), t("settings.startKeyDesc"), "startKey");
		text(t("settings.endKey"), t("settings.endKeyDesc"), "endKey");
		text(t("settings.tagsKey"), t("settings.tagsKeyDesc"), "tagsKey");

		new Setting(containerEl).setName(t("settings.defaults")).setHeading();
		text(t("settings.defaultStatus"), t("settings.defaultStatusDesc"), "defaultStatus");
		text(t("settings.defaultPriority"), t("settings.defaultPriorityDesc"), "defaultPriority");
	}
}
