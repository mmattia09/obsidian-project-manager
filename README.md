# Project Manager

Plugin per [Obsidian](https://obsidian.md) che aggiunge una vista **Timeline** in stile Notion alle [Bases](https://help.obsidian.md/bases), pensata per gestire progetti come note con proprietà.

## Come funziona

Ogni progetto è una nota (ad esempio nella cartella `Progetti/`) con queste proprietà nel frontmatter:

```yaml
---
status: cooking      # inbox | not started | cooking | on hold | clean | archive
priority: high       # urgent | high | medium | low
tags: []
start: 2026-07-06
end: 2026-07-20
---
```

Il titolo del progetto è il nome del file.

## Vista Timeline

La vista si registra tra le viste delle Bases (accanto a Table, Cards, List) con il nome **Timeline**:

- pannello laterale stile Notion con l'elenco dei progetti (collassabile con animazione; su mobile è la vista predefinita);
- barre orizzontali da data di inizio a data di fine, con pillola colorata per la priorità (urgent = rosso, high = arancione, medium = giallo, low = grigio);
- indicatore rosso di "oggi" con pulsante **Oggi** per ricentrarsi;
- **trascina** una barra per spostare il progetto nel tempo, **trascina i bordi** per cambiare inizio o fine: le date vengono scritte nel frontmatter;
- clic per aprire la nota (Cmd/Ctrl+clic in una nuova scheda, Alt/Shift+clic in split), hover per l'anteprima;
- zoom Giorno / Settimana / Due settimane / Mese / Trimestre / Anno / 5 anni;
- gruppi collassabili (con "Group by" delle Bases, ad esempio per stato), ordinati per flusso di lavoro e con progetti ordinati per priorità;
- i progetti senza date compaiono solo nel pannello laterale.

Le proprietà usate per inizio, fine e priorità sono configurabili nelle opzioni della vista (default: `start`, `end`, `priority`).

## Configurazione

1. Attiva il plugin core **Bases**.
2. Crea un file `.base` (ad esempio da `examples/Progetti.base`) oppure aggiungi una vista **Timeline** a una Base esistente.
3. Filtra la Base sulla cartella dei progetti, ad esempio `file.inFolder("Progetti")`.

Il plugin aggiunge anche il comando **Nuovo progetto** (e un'icona nella ribbon) che crea una nota nella cartella progetti con il frontmatter già impostato. Cartella, nomi delle proprietà e valori predefiniti si cambiano nelle impostazioni del plugin.

## Installazione

Richiede Obsidian **1.10.2+**.

### Manuale

1. Scarica (o compila) `main.js`, `manifest.json` e `styles.css`.
2. Copiali in `<vault>/.obsidian/plugins/project-manager/`.
3. Ricarica Obsidian e attiva **Project Manager** nelle impostazioni → Community plugins.

### Compilazione

```bash
npm install
npm run build   # produce main.js
npm run dev     # build in watch mode
```

## Sviluppo

- `src/main.ts` — registrazione della vista, comando "Nuovo progetto", impostazioni.
- `src/timeline-view.ts` — la vista Timeline (`BasesView`).
- `styles.css` — stili (usa le variabili CSS di Obsidian, funziona in tema chiaro e scuro).
