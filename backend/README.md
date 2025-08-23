# AccessChecker Starter (Backend)

Dies ist ein minimal lauffähiges Starterpaket für das Projekt **accesschecker**.
Es ermöglicht bereits jetzt einen **Hello-Scan** via GitHub Actions, der zwei
PDF-Berichte (intern/öffentlich) als Build-Artefakte erzeugt – **ohne** dass eine
eigene Cloud-Infrastruktur nötig ist.

## Schnellstart (ohne lokale Installation)

1. Push dieses Repos (Ordner `backend/`) nach GitHub.
2. Öffne in GitHub den Tab **Actions** → Workflow **Hello Scan** → **Run workflow**.
3. Gib eine URL an (z. B. `https://www.w3.org/WAI/demos/bad/`) und starte.
4. Nach ~1–3 Minuten findest du unter dem Workflowlauf die **Artifacts**:
   - `accesschecker-reports.zip` mit `report_internal.pdf` und `report_public.pdf`.

## Lokal ausführen (optional)

Voraussetzungen: Node 20+

```bash
cd backend
npm ci
npm run hello-scan -- --url=https://www.w3.org/WAI/demos/bad/ --out=out
```

Ergebnis: HTML + PDF im Ordner `out/`.

## Ordnerstruktur
- `src/` – Platzhalter für API/Worker (später)
- `scripts/hello-scan.ts` – Einmal-Scanner (Playwright + axe-core)
- `reports/templates/` – Nunjucks-Templates für Berichte
- `.github/workflows/` – CI & manuell startbarer Hello-Scan

## Parametrisierung & Beispiele

Der Hauptscanner `crawl-scan.ts` lässt sich über Umgebungsvariablen bzw. Flags steuern. Beispiele:

> Hinweis: Die sehr umfangreiche axe-Regel `link-in-text-block` ist standardmäßig deaktiviert, um eine Flut identischer Meldungen zu vermeiden.

```bash
START_URL=https://www.w3.org/WAI/demos/bad/ \
RESPECT_ROBOTS=true \
SCAN_IFRAMES=true \
SIMULATE_BROWSER=true \
npx tsx scripts/crawl-scan.ts --simulate-browser --scan-iframes --respect-robots
```

Wichtige Flags:

- `--simulate-browser` – führt Scrollen und Interaktionen (Tabs, Menüs, Accordeons) aus
- `--scan-iframes` – prüft iframes gleicher Origin
- `--respect-robots` – beachtet `robots.txt`
- `--jurisdiction DE-XX` – setzt die zuständige Durchsetzungsstelle (Bund/Land)

## Durchsetzungsstellen (Bund/Land)

- Die Zuordnung von Bundes- und Landesstellen erfolgt über `config/ombudspersons.json`.
- Die Datei ist maschinenlesbar und wird beim Report-Build strikt gegen `config/schemas/ombudspersons.schema.json` validiert.
- Die Jurisdiktion kann über `--jurisdiction DE-XX` oder in `config/scan.defaults.json` festgelegt werden.
- Fehlt eine Zuordnung, wird automatisch die Bundes-Schlichtungsstelle verwendet und im JSON markiert.
- Enthalten Einträge Platzhalter wie `TODO`, wird ein Hinweis im öffentlichen Bericht ausgegeben.

## Module

### landmarks

Analysiert die semantische Struktur einer Seite und bewertet, ob Inhalte in
Landmark-Bereichen wie `main`, `banner`, `nav` oder `contentinfo` liegen.
Berichtet Abdeckungsquote, listet fehlende oder doppelte Landmarks und liefert
HTML-Snippets zur Behebung.

### links

Analysiert Linktexte hinsichtlich Aussagekraft und Konsistenz. Meldet generische
Texte wie "hier" oder "mehr", nackte URLs sowie gleiche Linktexte mit
verschiedenen Zielen bzw. gleiche Ziele mit stark abweichenden Linktexten.
Erkennt außerdem Icon-Links ohne zugängliche Beschriftung. Bezug: WCAG 2.4.4 / BITV 2.0.
