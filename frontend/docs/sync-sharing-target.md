# Sync & Teilen: Sollzustand

Dieses Dokument beschreibt, **was gebaut werden soll** — die Zielarchitektur für Listen-Sync und Listen-Teilen, die Regeln, an die sich jede Änderung halten muss, und was bewusst offen ist.

Abgrenzung zu sync-design-decisions.md: das dort ist ein **Entscheidungsprotokoll** (rückblickend: „warum ist X so"). Dieses Dokument ist die **Spezifikation** (vorausschauend: „was gilt"). Bei Widerspruch gewinnt dieses Dokument, und das Protokoll wird nachgezogen.

Jeder PR in diesem Bereich sollte gegen Abschnitt 2 und 6 prüfbar sein.

## 1. Das Produktziel in einem Absatz

Die App ist offline-first: die lokale SQLite ist die Wahrheit, sie funktioniert ohne Backend und ohne Login. Wer angemeldet ist, kann **pro Liste** Sync einschalten. Eine synchronisierte Liste kann ihr **Besitzer** per Einladungslink teilen. Eingeladene sind **Mitglieder**: sie dürfen die Liste sehen und bearbeiten, aber nicht weiter einladen — sie können sie nur selbst wieder verlassen. Der Besitzer darf Sync erst wieder ausschalten, wenn kein anderer Nutzer mehr Mitglied ist; dabei wird die Server-Kopie gelöscht, die lokale bleibt. Alle Bearbeitungen funktionieren offline und mergen deterministisch über mehrere Geräte hinweg — wie git rebase, nicht wie „letzter Schreiber gewinnt nach Wanduhr".

## 2. Die drei Wahrheiten

Die Leitregel des ganzen Systems. Fast jeder Bug in diesem Bereich war eine Verletzung genau einer dieser drei Zuordnungen.

| Was | Wem gehört die Wahrheit | Wo liegt es |
| --- | --- | --- |
| **Inhalt** — Listenname, Einträge | dem Event-Log. Beide Seiten *leiten ab*, keine Seite besitzt den Zustand. | domain_events (lokal + Server) |
| **Zugriff** — Owner, Mitglieder, Einladungen | dem Server, relational, synchron erzwungen. **Nie** im Event-Log. | list_members, list_invites |
| **Ob dieses Gerät synct** | dem Gerät. **Nie** beim Server, nie in einer Projektion. | list_sync_settings (nur lokal) |

Daraus folgt direkt:

- Eine Autorisierungsentscheidung darf **nie** ein replaybares Domain-Event sein. Ein Event wird wiederholt zugestellt, neu eingereiht und erneut abgespielt — eine destruktive Aktion, die daran hängt, feuert irgendwann ungewollt.
- Eine Geräte-Einstellung darf **nie** in einer Projektion liegen, die aus dem Log neu aufgebaut wird — der Rebuild setzt sie sonst still auf den Default zurück.
- Es darf **keinen Schreibweg** in eine Projektion geben, der am Event-Log vorbeigeht. Deshalb hat das Backend keine Listen-CRUD-Endpunkte mehr.

## 3. Rollen und erlaubte Aktionen

Es gibt genau zwei Rollen, beide in list_members.role: owner und member.

| Aktion | Owner | Member | Nicht-Mitglied |
| --- | --- | --- | --- |
| Liste lesen / bearbeiten (Events pushen & pullen) | ✅ | ✅ | ❌ |
| Einladungslink erzeugen | ✅ | ❌ | ❌ |
| Aktive Einladungen einsehen | ✅ | ❌ | ❌ |
| Einladung widerrufen | ✅ | ❌ | ❌ |
| Einladung einlösen (beitreten) | — | — | ✅ |
| Liste verlassen | ❌ | ✅ | — |
| Sync ausschalten + Server-Kopie löschen | ✅¹ | ❌ | ❌ |
| Liste löschen (für alle) | ✅ | ✅² | ❌ |

¹ nur wenn kein anderer Nutzer mehr Mitglied ist — siehe 4.4
² todo_list.deleted ist ein normales Domain-Event und heute nicht rollenbeschränkt. Bewusste Lücke, siehe 7.4.

**Ownership entsteht beim Anlegen**, nicht beim Teilen: beim Ingest von todo_list.created schreibt der Server eine owner-Zeile aus dem verifizierten JWT-sub. Das „Claim-on-first-invite" in ListSharingService ist danach nur noch ein Legacy-Pfad für Listen, die vor dieser Regel entstanden sind.

## 4. Lebenszyklus einer Liste

```
    lokal ──(Sync an)──> synchronisiert ──(Einladung)──> geteilt
      ▲                        │  ▲                         │
      │                        │  └────(letzter Member       │
      └───(Sync aus, nur       │        verlässt)────────────┘
           wenn allein)────────┘
```

### 4.1 Lokal

Liste existiert nur in der lokalen SQLite. Kein Server kennt sie. Alle Events liegen in domain_events mit seq = NULL.

### 4.2 Sync einschalten

Geräte-lokale Einstellung (list_sync_settings.enabled = 1) plus einmaliges Einreihen der gesamten syncbaren Historie der Liste in die Outbox. Serverseitig entsteht dadurch die todo_lists-Zeile und der Owner-Eintrag.

**Für den Server bedeutet „ist synchronisiert" genau: es existiert eine todo_lists-Zeile.** Der Server kann nicht wissen, ob ein bestimmtes Gerät synct — das ist per Definition geräte-lokal. Die Produktregel „nur eine synchronisierte Liste kann geteilt werden" ist deshalb identisch mit dem requireList-Check im ListSharingService. Sie braucht keine eigene Prüfung.

### 4.3 Teilen

Owner erzeugt einen mehrfach nutzbaren Einladungslink mit einer Server-Preset-TTL (1h | 24h | 7d | 30d). Nur der sha256-Hash des Tokens wird gespeichert; der Klartext existiert genau einmal, in der Create-Response. Der Deep-Link wird im Frontend aus dem Token gebaut — das Backend kennt keine Frontend-Routen.

Einlösen ist idempotent: wer bereits Mitglied ist, bekommt already_member: true statt eines Fehlers, damit ein Client eine verlorene Antwort gefahrlos wiederholen kann.

Nach dem Einlösen legt der Client die Liste lokal an, indem er ganz normal pullt: list_sync_settings.enabled = 1, kein Cursor → Voll-Pull ab seq 0 → der EventApplier baut die Projektion aus der Historie auf.

### 4.4 Entsyncen (Server-Kopie löschen)

Erlaubt **nur** dem Owner und **nur**, wenn list_members genau eine Zeile hat (er selbst). Sonst 409.

„Allein" heißt dabei: **kein anderer Nutzer**. Eigene weitere Geräte werden nicht mitgezählt — list_members ist auf (list_id, user_id) geschlüsselt, und client_id ist bewusst die Keycloak-sub und keine Geräte-ID (siehe sync-design-decisions.md). Der Owner ist eine Person, die diese Aktion bewusst auslöst.

Das Entsyncen ist ein **autorisierter REST-Befehl, kein Domain-Event** (siehe die erste Folgerung aus Abschnitt 2). Es löscht serverseitig **hart**: die todo_lists-Zeile, die domain_events der Liste, ihre Einladungen und Mitgliedschaften (ON DELETE CASCADE). Kein Soft-Delete — ein Tombstone würde die Liste dauerhaft unsyncbar machen (siehe Invariante 6.2).

Lokal auf dem auslösenden Gerät danach: list_sync_settings.enabled = 0, sync_cursors-Zeile löschen, domain_events.seq = NULL für alle Events der Liste, ausstehende Outbox-Zeilen der Liste canceln. Die Liste selbst bleibt unangetastet — das ist der Zweck der Aktion.

Damit ist erneutes Einschalten exakt „Liste zum ersten Mal syncen": der Server kennt weder die ID noch die Event-IDs, der Replay läuft normal durch, die Zeile wird frisch angelegt. Wie ein gelöschter Remote-Branch, der neu gepusht wird.

### 4.5 Andere eigene Geräte nach einem Entsync

Ein Gerät, das Sync für diese Liste noch an hat, stellt beim nächsten Pull fest, dass der Server die Liste nicht mehr kennt. Es **schaltet Sync dafür lokal ab** (enabled = 0, Cursor weg, seq der Liste auf NULL, Outbox-Zeilen canceln) und behält die lokale Liste vollständig.

Es lädt sie **nicht** neu hoch — das würde den Desync faktisch wirkungslos machen, solange irgendein Gerät noch synct.

Bewusst in Kauf genommen: Schreibvorgänge, die Gerät A vor dem Desync gepusht hat und die Gerät B noch nicht gepullt hatte, sind für B verloren. Bs eigene lokale Historie bleibt vollständig; verloren geht nur der Merge. Solange Enforcement noch nicht scharf ist (7.1), ist das der einzige Schutz.

### 4.6 Verlassen

Ein member entfernt seine eigene Mitgliedszeile. Danach wird sein Zugriff auf /events und /sync/* für diese Liste abgelehnt. Lokal verhält sich sein Gerät wie in 4.5. Ein Owner kann nicht „verlassen" — er entsynct (4.4) oder löscht.

## 5. Ziel-HTTP-Oberfläche

Alle Routen mit authMW. Es gibt **keine** CRUD-Endpunkte für Listen; Listeninhalt entsteht ausschließlich über den Event-Pfad.

| Methode | Pfad | Zweck | Stand |
| --- | --- | --- | --- |
| POST | /api/v1/events | Push | ✅ |
| POST | /api/v1/sync/head | Pull-Cursor je Liste | ✅ |
| GET | /api/v1/sync/events | Pull, eine Seite ab seq | ✅ |
| POST | /api/v1/sync/state | Reconcile (bekannte Event-IDs) | ✅ |
| GET | /api/v1/sync/ws | Acks + Listen-Notifications | ✅ |
| POST | /api/v1/todo-lists/:id/invites | Einladung erzeugen (owner) | ✅ |
| GET | /api/v1/todo-lists/:id/invites | Aktive Einladungen (owner) | ✅ |
| DELETE | /api/v1/invites/:inviteId | Widerrufen (owner) | ✅ |
| POST | /api/v1/invites/redeem | Beitreten | ✅ |
| GET | /api/v1/todo-lists/:id/membership | Eigene Rolle + Mitgliederzahl | ⬜ offen |
| DELETE | /api/v1/todo-lists/:id/members/me | Verlassen (member) | ⬜ offen |
| DELETE | /api/v1/todo-lists/:id/sync | Entsyncen (owner, nur allein) | ⬜ offen |

GET .../membership ist Vorbedingung für die UI: ohne sie kann das Frontend weder Owner- von Member-Ansicht unterscheiden noch den Entsync-Button korrekt sperren.

## 6. Invarianten

Verletzungen sind Bugs, auch wenn kein Test rot wird.

**6.1 Vorwärts-Anwendung == Rebuild.** Für jede Event-Folge muss die schrittweise Anwendung denselben Projektionszustand erzeugen wie ein vollständiger Replay aus dem Log. Daraus folgt: kein Handler liest eine Uhr — alle Zeitstempel stammen aus occurred_at des Events.

*Testform:* zwei getrennte Zustände vergleichen (vorwärts auf Liste A aufbauen, Zeile zurücksetzen, rebuilden, gegen A prüfen). Ein Rebuild über dieselbe, unveränderte Zeile ist kein Test — er kann nicht fehlschlagen.

**6.2 deleted_at ist terminal.** Ein todo_list.created oder .updated darf eine getombstonete Liste nie wiederbeleben. Entsyncen benutzt deshalb kein Soft-Delete, sondern löscht hart.

**6.3 Kein Schreibweg in todo_lists außer über den Event-Log.**

**6.4 seq hat genau einen Writer: den Pull-Pfad** (EventRepository.insertRemote). Ein WebSocket-Ack markiert nur die Outbox-Zeile als synced, sonst nichts. Damit ist seq IS NULL eindeutig „noch nicht im gesehenen Server-Prefix".

**6.5 Replay-Reihenfolge ist byServerSeqThenLocal, nie occurred_at.** Bestätigter Server-Prefix nach seq, danach die eigenen unbestätigten Events in lokaler Einfügereihenfolge.

**6.6 Sync-an/aus verlässt nie das Gerät** — kein Event, kein Feld in einer Projektion, kein Server-State.

**6.7 occurred_at ist Anzeige-Metadatum.** Es ist die Wanduhr des Clients, also untrusted. Nie Grundlage für Ordnung, Autorisierung oder Retention. Die daraus gespeisten Spalten (created_at/updated_at/deleted_at) sind damit client-geliefert; updated_at kann rückwärts laufen.

## 7. Offene Entscheidungen

**7.1 Enforcement-Zeitpunkt.** Heute darf jeder gültige Token jede bekannte Listen-UUID lesen und schreiben — list_members existiert, wird auf /events und /sync/* aber nicht geprüft. Plan: Owner beim created-Ingest aus dem JWT-sub setzen, Bestandslisten einmalig nachtragen, **direkt danach** Enforcement scharfschalten. Setzt voraus, dass es keine echten Nutzerdaten gibt — vor dem Umlegen verifizieren.

**7.2 Ownership-Squatting.** Solange „Claim-on-first-invite" existiert, wird der erste Aufrufer von CreateInvite auf einer mitgliederlosen Liste deren Owner. Wer eine fremde UUID kennt, kann damit den echten Besitzer dauerhaft vom Teilen aussperren — es gibt keinen Kick-, Transfer- oder Admin-Pfad zurück. Der Owner-Backfill aus 7.1 schließt das; bis dahin offen.

**7.3 list_members.invite_id hat kein ON DELETE.** Ausreichend, solange Invites nur widerrufen und nie gelöscht werden. Ein künftiger „abgelaufene Invites aufräumen"-Job würde daran scheitern; ON DELETE SET NULL wäre dann die richtige Semantik — eine gelöschte Einladung darf die Mitgliedschaft nicht mitnehmen.

**7.4 todo_list.deleted ist nicht rollenbeschränkt.** Ein Mitglied kann die Liste für alle löschen. Ob das gewollt ist (geteilter Haushalt) oder auf den Owner beschränkt gehört, ist nicht entschieden.

## 8. Bewusst nicht gebaut

- **„Meine Listen nach Neuinstallation wiederherstellen."** Pull läuft nur für Listen, die lokal bereits bekannt und sync-aktiv sind. Nach einer Neuinstallation ist die lokale DB leer, es gibt also nichts zu pullen. Ein Discovery-Endpunkt („gib mir alle Listen dieses Accounts") ist ein eigenes, größeres Feature und braucht 7.1.
- **Direkteinladung an eine Person / Freundesliste.** Nur mehrfach nutzbare Links.
- **Mitglieder entfernen (Kick).** Nur Selbst-Verlassen.
- **Ownership übertragen.**
- **Echte kausale Ordnung (Vektoruhren).** Der Rebase auf seq reicht für diese App-Klasse. Der Preis: ein lange offline gewesenes Gerät landet mit seinen Events hinter allem, was der Server zwischenzeitlich bekommen hat.
- **ingredient.* serverseitig projizieren.** Das würde die Projektionslogik des Frontends ein zweites Mal in Go duplizieren, mit der Pflicht, dass beide dauerhaft übereinstimmen. Der Server relayt Ingredient-Events und speichert sie; er interpretiert sie nicht.
