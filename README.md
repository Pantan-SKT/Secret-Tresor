# Secret-Tresor 1.0.0

Lokale Windows-Webanwendung für API-Keys, Client-Secrets, Passwörter, Anwendungs-IDs, Tenant-IDs, Tokens, Lizenzinformationen und frei definierbare Werte.

## Start

1. **Node.js 20 oder neuer (LTS)** installieren.
2. ZIP in einen eigenen Ordner entpacken (z. B. `C:\Tools\Secret-Tresor`).
3. `start.bat` doppelklicken. Es führt `npm install --no-audit --no-fund` aus und startet den Server. Der Browser öffnet sich automatisch.
4. Falls nicht, `http://127.0.0.1:6217` manuell öffnen.
5. Beim ersten Start ein **langes, einzigartiges Masterpasswort** wählen (mind. 12 Zeichen, besser 20+).

**Nicht zwei Instanzen gleichzeitig starten.** Das Konsolenfenster muss geöffnet bleiben. Mit `Strg+C` beenden.

## Funktionen

- Einträge erstellen, bearbeiten, löschen und durchsuchen; flexible Felder, pro Feld frei wählbar „Geheim“.
- Kategorien, Anbieter, Benutzernamen, URLs, Tags und Notizen.
- AES-256-GCM-verschlüsselter Tresor mit individuellem scrypt-Schlüssel (N=32768, r=8, p=1) und Zufalls-Salt.
- Masterpasswort wird **nicht auf der Festplatte gespeichert**. Entschlüsselter Schlüssel nur im laufenden Serverprozess.
- Sperren / automatische Sperre nach 15 Minuten ohne API-Zugriff; neue Anmeldung nach Neustart.
- Verschlüsselte Backups als Download, Wiederherstellung mit Passwort und Bestätigung; vor Import automatische zusätzliche verschlüsselte Sicherung.
- Wechsel des Masterpassworts mit vollständiger Neuverschlüsselung.
- Bedienung über Browser, Server nur an `127.0.0.1` gebunden.

## Wichtige Sicherheitshinweise

- Die verschlüsselte Datei liegt in `data/vault.enc.json`. **Dieser gesamte Ordner darf nicht versehentlich in Git, Cloud-Freigaben oder öffentliche Archive gelangen.**
- Ohne Masterpasswort ist eine Wiederherstellung **nicht** möglich. Sicheres Masterpasswort und verschlüsseltes Backup getrennt aufbewahren.
- Die App ist ein **Einzelplatz-Tresor**: weder für gemeinsam genutzte Server noch als Multiuser-Dienst oder über Reverse Proxy/Internet freigeben.
- Die Verschlüsselung schützt primär **gespeicherte Daten bei gesperrtem Tresor**. Ein kompromittierter Windows-PC, Malware, Bildschirmaufzeichnung, Browser-Erweiterungen oder die Zwischenablage können sichtbar gewordene Secrets auslesen.
- Kopierte Secrets bleiben in der Windows-Zwischenablage, bis sie überschrieben/geleert wird.
- Wer Zugriff auf einen entsperrten Windows-Desktop oder ein entsperrtes Browserprofil hat, kann sichtbare Einträge und Secrets auslesen. Windows-Sitzung sperren.
- Exportdateien sind verschlüsselt; beim Import wird das Passwort des importierten Backups benötigt.
- Für geschäftskritische hochsensible Unternehmens-Zugangsdaten kann ein geprüfter Passwortmanager mit zentralen Rollen, Audit-Logs, MFA und Wiederherstellungsprozessen sinnvoller sein.

## Daten / Umzug

- Exportieren: Button **Verschlüsseltes Backup** anklicken, Datei an sicheren Ort legen.
- Wiederherstellen: Button **Backup wiederherstellen**, verschlüsselte Datei auswählen, deren Passwort eingeben, `ERSETZEN` bestätigen.
- Nur die Datei `data/vault.enc.json` reicht ebenfalls für eine Migration; auf anderem Gerät mit demselben Masterpasswort entsperren.
- `data/` wird beim ersten Speichern angelegt. Im ZIP ist kein Tresor vorhanden.

## Technik

Keine zusätzlichen npm-Abhängigkeiten. Node.js Standardbibliothek (`http`, `crypto`, `fs`). Passwort/Klartext und Tresoreinträge werden nicht protokolliert. Daten werden als komplette verschlüsselte Datei atomar geschrieben. Keine Cloud, kein Telemetrie- oder KI-Dienst.

## Version 1.0.1

- Ein Klick auf den dunklen Bereich ausserhalb des Dialogs schliesst ihn nicht mehr (auch nicht beim Markieren von Text ueber den Dialogrand hinaus). Schliessen ueber X, Abbrechen, Schliessen oder Esc.
- Ein Browser-Reload behaelt Kategorie, Suche, Sortierung und den derzeit geoeffneten Eintrag bzw. Dialog bei, solange die Server-Sitzung noch entsperrt ist.
- Beim Wiederherstellen eines Bearbeitungsdialogs werden nur bereits gespeicherte Werte geladen. Ungespeicherte Eingaben werden aus Sicherheitsgruenden **nicht** im Browser-Speicher abgelegt.
- Die Benutzeroberflaeche speichert ausschliesslich Navigationszustand (inklusive Suchbegriff), keine geheimen Felder, in `sessionStorage`.
