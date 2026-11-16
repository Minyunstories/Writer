# Writer

Eine Schreib-App für den Browser: Bücher mit Kapiteln, einem Wiki und einer Outline.

- **Schreiben** mit Markdown für Überschriften, fett und kursiv; die Formatierung ist beim Schreiben sichtbar.
- **Wiki** mit Ordnern und Einträgen (Name, weitere Namen, Eigenschaften, Bilder, Notizen). Namen aus dem Wiki werden im Kapiteltext automatisch verlinkt; ein Klick zeigt den Eintrag neben dem Text.
- **Outline** mit einer Notiz pro Kapitel und Umsortieren.
- **Offline** nutzbar und als App installierbar.
- **Synchronisation** zwischen Geräten über ein eigenes privates GitHub-Repository. Der Zugangsschlüssel bleibt im Browser des jeweiligen Geräts.

Alle Inhalte liegen lokal im Browser. Diese Seite speichert und sieht nichts davon.

## Entwicklung

```
npm install
npm run dev      # lokal starten
npm test         # Tests
npm run build    # Produktionsstand in dist/
```

Gebaut mit React, TypeScript, Vite und CodeMirror.
