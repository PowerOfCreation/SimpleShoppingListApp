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

Das Entsyncen ist ein **autorisierter REST-Befehl, kein Domain-Event** (siehe die erste Folgerung aus Abschnitt 2). Es löscht serverseitig **hart**: die todo_lists-Zeile, ihre Einladungen und Mitgliedschaften (ON DELETE CASCADE) sowie die domain_events der Liste. Letztere **explizit** — `events.list_id` referenziert `todo_lists` ohne Fremdschlüssel (nullable Spalte, siehe Migration `00004`), das Cascade greift nur für `list_invites`/`list_members` (Migration `00005`). Kein Soft-Delete — ein Tombstone würde die Liste dauerhaft unsyncbar machen (siehe Invariante 6.2).

Nicht von diesem Cascade abgedeckt: `todos.todo_list_id` referenziert `todo_lists(id)` ohne
`ON DELETE` (Migration `00001`). Ein `DELETE FROM todo_lists` würde daran scheitern, sobald je eine
Zeile existiert. Folgenlos nur, solange `todos`/`sql/queries/todos.sql` toter Code bleiben (kein
Service, kein Controller referenziert sie) — vor der Implementierung von `DELETE .../sync` entweder
entfernen oder den Fremdschlüssel/die Löschung entsprechend ergänzen.

Lokal auf dem auslösenden Gerät danach: list_sync_settings.enabled = 0, sync_cursors-Zeile löschen, domain_events.seq = NULL für alle Events der Liste, ausstehende Outbox-Zeilen der Liste canceln. Die Liste selbst bleibt unangetastet — das ist der Zweck der Aktion.

Damit ist erneutes Einschalten exakt „Liste zum ersten Mal syncen": der Server kennt weder die ID noch die Event-IDs, der Replay läuft normal durch, die Zeile wird frisch angelegt. Wie ein gelöschter Remote-Branch, der neu gepusht wird.

### 4.5 Andere eigene Geräte nach einem Entsync

Ein Gerät, das Sync für diese Liste noch an hat, stellt beim nächsten Pull fest, dass der Server die Liste nicht mehr kennt. Es **schaltet Sync dafür lokal ab** (enabled = 0, Cursor weg, seq der Liste auf NULL, Outbox-Zeilen canceln) und behält die lokale Liste vollständig.

Es lädt sie **nicht** neu hoch — das würde den Desync faktisch wirkungslos machen, solange irgendein Gerät noch synct.

Bewusst in Kauf genommen: Schreibvorgänge, die Gerät A vor dem Desync gepusht hat und die Gerät B noch nicht gepullt hatte, sind für B verloren. Bs eigene lokale Historie bleibt vollständig; verloren geht nur der Merge. Solange Enforcement noch nicht scharf ist (7.1), ist das der einzige Schutz.

*Voraussetzung, die heute nicht erfüllt ist:* Damit B „der Server kennt die Liste nicht mehr"
überhaupt erkennt, muss `/api/v1/sync/head` das von „Liste bekannt, aber keine Events verarbeitet"
unterscheidbar machen. Aktuell liefert die Response in beiden Fällen `seq: 0, event_id: null`
(`sync-pull-controller.go`, `GetHead`). Ein Gerät, das eine Liste bereits gepusht, aber noch nie
gepullt hat, steht wegen 6.4 ebenfalls auf Cursor 0 und kann diesen Fall von einem echten Entsync
nicht unterscheiden — es würde nach Abschnitt 4.5 weiterpushen und die Liste damit serverseitig neu
anlegen, genau das, was 4.5 verhindern soll. Braucht ein explizites „unbekannt"-Signal in der
Head-Response, bevor `DELETE .../sync` (Abschnitt 5) gebaut wird.

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

`DELETE .../sync` selbst braucht dafür ein Signal, das heute fehlt: `/api/v1/sync/head` liefert für
eine dem Server unbekannte Liste dieselbe Antwort (`seq: 0, event_id: null`) wie für eine bekannte
Liste ohne verarbeitete Events (siehe 4.5 und die Ergänzung unten). Ohne eine Möglichkeit, „unbekannt"
von „bekannt, aber leer" zu unterscheiden, kann ein Gerät den Entsync-Fall aus 4.5 nicht sauber
erkennen.

**Frontend-Stand:** Kein Teil dieses Abschnitts hat eine Entsprechung im Frontend. `grep -ri invite`
über `frontend/{api,app,components,database,types}` findet keinen Treffer — es gibt weder eine
Einladungs-UI (erzeugen/auflisten/widerrufen) noch einen Redeem-Handler für den Deep-Link aus 4.3,
noch eine Owner-/Member-Unterscheidung in der Listenansicht, noch „Verlassen" oder „Entsyncen". Die
✅-Markierungen oben gelten ausschließlich für das Backend; produktseitig ist Teilen für Nutzer noch
nicht erreichbar.

## 6. Invarianten

Verletzungen sind Bugs, auch wenn kein Test rot wird.

**6.1 Vorwärts-Anwendung == Rebuild.** Für jede Event-Folge muss die schrittweise Anwendung denselben Projektionszustand erzeugen wie ein vollständiger Replay aus dem Log. Daraus folgt: kein Handler liest eine Uhr — alle Zeitstempel stammen aus occurred_at des Events.

*Testform:* zwei getrennte Zustände vergleichen (vorwärts auf Liste A aufbauen, Zeile zurücksetzen, rebuilden, gegen A prüfen). Ein Rebuild über dieselbe, unveränderte Zeile ist kein Test — er kann nicht fehlschlagen.

*Backend-Stand:* Es gibt aktuell **keinen** Rebuild-Mechanismus für `todo_lists` (die frühere
`ToDoListService.RebuildList` wurde ungenutzt wieder entfernt). Die Invariante ist im Backend also nur
als *Konstruktions-Disziplin* eingehalten und getestet — keine Uhr in einem Handler, Determinismus bei
zweifacher Vorwärts-Anwendung derselben Event-Folge (`TestToDoListService_ForwardApplication_IsDeterministic_…`)
— nicht als tatsächlicher Vorwärts-vs-Rebuild-Vergleich. Fürs Frontend gilt 6.1 unverändert wörtlich:
`IngredientListProjection.rebuildForList` ist genau dieser Rebuild.

*Bekannte Lücke im Vorwärtspfad:* `sweepUnprocessed` sortiert nach `received_at`, nicht nach `seq`. Ein nachgeholtes `created` (z. B. nach einem vorübergehenden Dispatch-Fehler) kann so ein bereits verarbeitetes `updated` überschreiben — der Create-Upsert setzt `name`/`created_at` mit, der Name fällt auf den Create-Wert zurück. Sehr schmaler Pfad, aber eine echte 6.1-Verletzung; ohne einen Rebuild-Mechanismus gibt es dafür aktuell keinen Reparaturweg. Die Auswirkung bleibt dabei nicht auf die Serverzeile beschränkt: `seq` wird erst bei `MarkEventProcessed` vergeben, das nachgeholte `created` bekommt also ein *höheres* `seq` als das `updated`, das eigentlich danach kam. Jeder Client repliziert diese Reihenfolge über `GetEventsSince`/`byServerSeqThenLocal` 1:1 und landet lokal beim selben falschen Namen.

**6.2 deleted_at ist terminal.** Ein todo_list.created oder .updated darf eine getombstonete Liste nie wiederbeleben. Entsyncen benutzt deshalb kein Soft-Delete, sondern löscht hart.

**6.3 Kein Schreibweg in todo_lists außer über den Event-Log.**

**6.4 seq hat genau einen Writer: den Pull-Pfad** (EventRepository.insertRemote). Ein WebSocket-Ack markiert nur die Outbox-Zeile als synced, sonst nichts. Damit ist seq IS NULL eindeutig „noch nicht im gesehenen Server-Prefix".

**6.5 Replay-Reihenfolge ist byServerSeqThenLocal, nie occurred_at.** Bestätigter Server-Prefix nach seq, danach die eigenen unbestätigten Events in lokaler Einfügereihenfolge.

**6.6 Sync-an/aus verlässt nie das Gerät** — kein Event, kein Feld in einer Projektion, kein Server-State.

**6.7 occurred_at ist Anzeige-Metadatum.** Es ist die Wanduhr des Clients, also untrusted. Nie Grundlage für Ordnung, Autorisierung oder Retention. Die daraus gespeisten Spalten (created_at/updated_at/deleted_at) sind damit client-geliefert; updated_at kann rückwärts laufen.

**6.8 Jedes durabel angenommene Event bekommt genau einmal ein seq.** `GetEventsSince`, `GetListHeads`
und `GetKnownEventIdsByList` filtern alle `seq IS NOT NULL` — ein Event, dessen Handler dauerhaft
fehlschlägt (heute z. B. `UpdateToDoList`/`DeleteToDoList` mit leerem Namen, siehe `validate()` in
`entities/todo-list.go`), bekommt nie ein `seq` und ist damit für Pull *und* Reconcile unsichtbar.
`dispatchAndAck` überspringt in diesem Fall auch `MarkProcessed` und den Ack (siehe `event-ingestor.go`),
der Client resendet also unbegrenzt, ohne dass der Server je „fertig" meldet. Das ist derselbe
Mechanismus, den `b81caa1`/`3821b45` für „Zeile nicht gefunden" bereits behoben haben — für dauerhafte
Handler-Fehler (kaputtes Payload, leerer Name) steht die gleichwertige Behebung noch aus.

## 7. Offene Entscheidungen

**7.1 Enforcement-Zeitpunkt.** Heute darf jeder gültige Token jede bekannte Listen-UUID lesen und schreiben — list_members existiert, wird auf /events und /sync/* aber nicht geprüft. Plan: Owner beim created-Ingest aus dem JWT-sub setzen, Bestandslisten einmalig nachtragen, **direkt danach** Enforcement scharfschalten. Setzt voraus, dass es keine echten Nutzerdaten gibt — vor dem Umlegen verifizieren.

*Woher der Owner beim Ingest kommt, ist noch offen.* Der `EventIngestor` läuft auf einer
Hintergrund-Goroutine ohne HTTP-Request-Context — `middleware.UserIDFromContext` (der verifizierte
JWT-sub) ist dort nicht erreichbar, auch nicht rückwirkend beim `sweepUnprocessed`-Replay aus der DB.
Das einzige heute auf `StoredEvent`/`events` vorhandene Identitätsfeld ist `client_id`, und das ist
unverifizierte Client-Eingabe aus dem Request-Body (`dto/request/sync-events-request.go`) — als
Ownership-Quelle ungeeignet. „Owner beim created-Ingest setzen" braucht also entweder ein neues,
serverseitig verifiziertes Feld auf `StoredEvent` *und* der `events`-Tabelle (vom Push-Handler gesetzt,
der den Request-Context noch hat, nicht vom Ingestor-Worker), oder Ownership entsteht stattdessen am
Push-Endpunkt statt beim asynchronen Dispatch.

*Woher der Bestandslisten-Backfill seine Daten nimmt, ist ebenfalls offen.* Es gibt keine
vertrauenswürdige Quelle dafür, wem eine vor diesem Feature entstandene Liste gehört — die einzige
existierende Spur ist wieder `client_id`. Entweder der Backfill vertraut diesem Feld explizit (mit den
Konsequenzen aus 7.2/7.5, falls ein `client_id`-Wert erraten oder gefälscht wurde), oder es gibt vor
dem Scharfschalten keine echten Bestandsdaten zu migrieren (siehe „Setzt voraus, dass es keine echten
Nutzerdaten gibt" oben) und der Backfill entfällt. Diese Entscheidung muss vor der Umsetzung von 7.1
getroffen werden, nicht währenddessen.

**7.2 Ownership-Squatting.** Solange „Claim-on-first-invite" existiert, wird der erste Aufrufer von CreateInvite auf einer mitgliederlosen Liste deren Owner. Wer eine fremde UUID kennt, kann damit den echten Besitzer dauerhaft vom Teilen aussperren — es gibt keinen Kick-, Transfer- oder Admin-Pfad zurück. Der Owner-Backfill aus 7.1 schließt das; bis dahin offen.

**7.3 list_members.invite_id hat kein ON DELETE.** Ausreichend, solange Invites nur widerrufen und nie gelöscht werden. Ein künftiger „abgelaufene Invites aufräumen"-Job würde daran scheitern; ON DELETE SET NULL wäre dann die richtige Semantik — eine gelöschte Einladung darf die Mitgliedschaft nicht mitnehmen.

**7.4 todo_list.deleted ist nicht rollenbeschränkt.** Ein Mitglied kann die Liste für alle löschen. Ob das gewollt ist (geteilter Haushalt) oder auf den Owner beschränkt gehört, ist nicht entschieden.

**7.5 Tombstone-Squatting.** Der Tombstone-Upsert von `DeleteToDoList` legt eine `todo_lists`-Zeile für Listen-UUIDs an, die der Server nie gesehen hat (vorher: Fehler, aber keine Zeile). Zusammen mit **6.2** (terminal) und **7.1** (kein Enforcement auf `/events`) heißt das: wer eine fremde UUID rät und ein `todo_list.deleted` pusht, macht die Liste für ihren echten Besitzer **dauerhaft unsyncbar** — `CreateToDoList` prallt am Tombstone ab, und „synchronisiert" ist laut **4.2** genau „es existiert eine `todo_lists`-Zeile". Selbe Klasse wie 7.2, aber irreversibel. Schließt sich mit dem Owner-Backfill aus 7.1; bis dahin offen.

## 8. Bewusst nicht gebaut

- **„Meine Listen nach Neuinstallation wiederherstellen."** Pull läuft nur für Listen, die lokal bereits bekannt und sync-aktiv sind. Nach einer Neuinstallation ist die lokale DB leer, es gibt also nichts zu pullen. Ein Discovery-Endpunkt („gib mir alle Listen dieses Accounts") ist ein eigenes, größeres Feature und braucht 7.1.
- **Direkteinladung an eine Person / Freundesliste.** Nur mehrfach nutzbare Links.
- **Mitglieder entfernen (Kick).** Nur Selbst-Verlassen.
- **Ownership übertragen.**
- **Echte kausale Ordnung (Vektoruhren).** Der Rebase auf seq reicht für diese App-Klasse. Der Preis: ein lange offline gewesenes Gerät landet mit seinen Events hinter allem, was der Server zwischenzeitlich bekommen hat.
- **ingredient.* serverseitig projizieren.** Das würde die Projektionslogik des Frontends ein zweites Mal in Go duplizieren, mit der Pflicht, dass beide dauerhaft übereinstimmen. Der Server relayt Ingredient-Events und speichert sie; er interpretiert sie nicht.
