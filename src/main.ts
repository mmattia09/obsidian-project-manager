import { App, Notice, Plugin, PluginSettingTab, Setting, normalizePath } from "obsidian";
import { TIMELINE_VIEW_TYPE, TimelineView, timelineViewOptions } from "./timeline-view";

interface ProjectManagerSettings {
	projectsFolder: string;
	statusKey: string;
	priorityKey: string;
	startKey: string;
	endKey: string;
	tagsKey: string;
	defaultStatus: string;
	defaultPriority: string;
}

const DEFAULT_SETTINGS: ProjectManagerSettings = {
	projectsFolder: "Progetti",
	statusKey: "status",
	priorityKey: "priority",
	startKey: "start",
	endKey: "end",
	tagsKey: "tags",
	defaultStatus: "inbox",
	defaultPriority: "medium",
};

export default class ProjectManagerPlugin extends Plugin {
	settings: ProjectManagerSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		const registered = this.registerBasesView(TIMELINE_VIEW_TYPE, {
			name: "Timeline",
			icon: "lucide-calendar-range",
			factory: (controller, containerEl) => new TimelineView(controller, containerEl),
			options: timelineViewOptions,
		});
		if (!registered) {
			new Notice("Project Manager: impossibile registrare la vista Timeline. Assicurati che il plugin core Bases sia attivo.");
		}

		this.addCommand({
			id: "new-project",
			name: "Nuovo progetto",
			callback: () => void this.createProject(),
		});
		this.addRibbonIcon("lucide-folder-kanban", "Nuovo progetto", () => void this.createProject());

		this.addSettingTab(new ProjectManagerSettingTab(this.app, this));
	}

	async createProject(): Promise<void> {
		const s = this.settings;
		const folder = normalizePath(s.projectsFolder || "Progetti");
		if (!this.app.vault.getFolderByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}
		let path = normalizePath(`${folder}/Nuovo progetto.md`);
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			counter++;
			path = normalizePath(`${folder}/Nuovo progetto ${counter}.md`);
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
				.addText((t) =>
					t.setValue(this.plugin.settings[key]).onChange(async (v) => {
						this.plugin.settings[key] = v.trim() || DEFAULT_SETTINGS[key];
						await this.plugin.saveSettings();
					})
				);
		};

		text("Cartella progetti", "Cartella in cui creare le nuove note progetto.", "projectsFolder");

		new Setting(containerEl).setName("Proprietà").setHeading();
		text("Stato", "Nome della proprietà per lo stato.", "statusKey");
		text("Priorità", "Nome della proprietà per la priorità.", "priorityKey");
		text("Data di inizio", "Nome della proprietà per la data di inizio.", "startKey");
		text("Data di fine", "Nome della proprietà per la data di fine.", "endKey");
		text("Tag", "Nome della proprietà per i tag.", "tagsKey");

		new Setting(containerEl).setName("Valori predefiniti").setHeading();
		text("Stato iniziale", "Stato assegnato ai nuovi progetti (es. inbox).", "defaultStatus");
		text("Priorità iniziale", "Priorità assegnata ai nuovi progetti (es. medium).", "defaultPriority");
	}
}
