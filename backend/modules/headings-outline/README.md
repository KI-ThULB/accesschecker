# headings-outline

Analysiert die Überschriftenstruktur einer Seite. Ermittelt H1–H6 sowie Elemente mit `role="heading"` und `aria-level`.

**Findings**
- `headings:missing-h1` – keine `<h1>` vorhanden.
- `headings:multiple-h1` – mehr als eine `<h1>` vorhanden.
- `headings:jump-level` – Sprung in der Hierarchie (z. B. `h2` direkt gefolgt von `h4`).
- `headings:empty-text` – Überschrift ohne sichtbaren Text.

**Normbezug**
- WCAG 2.1 [1.3.1], [2.4.6]
- BITV 2.0 [1.3.1], [2.4.6]

Grenzen: Nur sichtbare Elemente im DOM; dynamisch eingefügte Inhalte nach Ladezeitpunkt bleiben unberücksichtigt.
