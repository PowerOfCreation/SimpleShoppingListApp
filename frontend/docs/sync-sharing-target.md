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

**Ownership entsteht beim ersten Push**, nicht beim Teilen: `EventController` prüft synchron vor dem Enqueuen — der asynchrone `EventIngestor` hat keinen Request-Context, siehe 7.1 — und beansprucht eine noch mitgliederlose Liste für den verifizierten JWT-sub (`ListAccessService.AuthorizeWrite`). „Claim-on-first-invite" in `ListSharingService` ist entfernt: `CreateInvite` verlangt jetzt einen bestehenden Owner, statt selbst einen zu erzeugen.

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

Geräte-lokale Einstellung (list_sync_settings.enabled = 1) plus einmaliges Einreihen der gesamten syncbaren Historie der Liste in die Outbox. Serverseitig entsteht dadurch zuerst der Owner-Eintrag (list_members, synchron beim ersten Push, siehe 3 und 7.1) und — sobald der Ingestor das erste Event asynchron verarbeitet hat — die todo_lists-Zeile.

**Für den Server bedeutet „ist synchronisiert" genau: es existiert eine todo_lists-Zeile.** Der Server kann nicht wissen, ob ein bestimmtes Gerät synct — das ist per Definition geräte-lokal. Die Produktregel „nur eine synchronisierte Liste kann geteilt werden" ist deshalb identisch mit dem requireList-Check im ListSharingService. Sie braucht keine eigene Prüfung.

Das ist bewusst ein anderer Moment als „ist beansprucht": list_members bekommt seine Zeile synchron im Push-Handler, bevor der Ingestor überhaupt läuft; todo_lists entsteht erst danach, asynchron. `CreateInvite`/`FindActiveInvites` prüfen deshalb beides — `requireList` (todo_lists existiert) *und* `access.RequireOwner` (list_members-Zeile mit role=owner) — nicht austauschbar, auch wenn sie im Normalfall im selben Moment wahr werden.

### 4.3 Teilen

Owner erzeugt einen mehrfach nutzbaren Einladungslink mit einer Server-Preset-TTL (1h | 24h | 7d | 30d). Nur der sha256-Hash des Tokens wird gespeichert; der Klartext existiert genau einmal, in der Create-Response. Der Deep-Link wird im Frontend aus dem Token gebaut — das Backend kennt keine Frontend-Routen.

Einlösen ist idempotent: wer bereits Mitglied ist, bekommt already_member: true statt eines Fehlers, damit ein Client eine verlorene Antwort gefahrlos wiederholen kann.

Nach dem Einlösen legt der Client die Liste lokal an, indem er ganz normal pullt: list_sync_settings.enabled = 1, kein Cursor → Voll-Pull ab seq 0 → der EventApplier baut die Projektion aus der Historie auf.

### 4.4 Entsyncen (Server-Kopie löschen)

Erlaubt **nur** dem Owner und **nur**, wenn list_members genau eine Zeile hat (er selbst). Sonst 409.

„Allein" heißt dabei: **kein anderer Nutzer**. Eigene weitere Geräte werden nicht mitgezählt — list_members ist auf (list_id, user_id) geschlüsselt, und client_id ist bewusst die Keycloak-sub und keine Geräte-ID (siehe sync-design-decisions.md). Der Owner ist eine Person, die diese Aktion bewusst auslöst.

Das Entsyncen ist ein **autorisierter REST-Befehl, kein Domain-Event** (siehe die erste Folgerung aus Abschnitt 2). Es löscht serverseitig **hart**: die todo_lists-Zeile, ihre Einladungen, ihre Mitgliedschaften und die domain_events der Liste — **alle vier explizit**, kein Cascade. Seit Migration `00007` referenzieren `list_members.list_id`/`list_invites.list_id` `todo_lists` ohne Fremdschlüssel (dieselbe Begründung wie bei `events.list_id` seit Migration `00004`: die Zugriffstabelle muss unabhängig von der — rebuildbaren — Projektion existieren können, siehe 7.1). Kein Soft-Delete — ein Tombstone würde die Liste dauerhaft unsyncbar machen (siehe Invariante 6.2).

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

Alle ✅-Routen sind seit 7.1 zugriffsgeprüft, nicht nur erreichbar: `/events` und `GET /sync/events` lehnen mit 403 ab, wer kein Mitglied ist; `/sync/head` und `/sync/state` filtern nicht zugängliche Listen-IDs still aus der Antwort statt zu 403en (kein Enumerations-Orakel); `/sync/ws` routet Acks über den verifizierten user_id, nicht den unverifizierten client_id-Query-Parameter, und subscribe filtert list_ids genauso wie die Lesepfade.

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

*Ehemals bekannte Lücke im Vorwärtspfad, geschlossen durch `00006-events-seq-at-insert`:* `sweepUnprocessed` sortierte nach `received_at`, nicht nach `seq` — und `seq` wurde erst bei `MarkEventProcessed` vergeben. Ein nachgeholtes `created` (z. B. nach einem vorübergehenden Dispatch-Fehler) konnte so ein *höheres* `seq` bekommen als ein zwischenzeitlich bereits verarbeitetes `updated`, obwohl es zuerst eintraf, und den Create-Upsert dessen `name`/`created_at` überschreiben lassen. Jeder Client repliziert diese Reihenfolge über `GetEventsSince`/`byServerSeqThenLocal` 1:1 — nicht nur eine Serverzeile, sondern eine echte 6.1-Verletzung überall. Seit `00006` bekommt jedes Event sein `seq` beim Insert, unabhängig vom Projektionserfolg (siehe 6.8); `sweepUnprocessed` sortiert entsprechend nach `seq`, und `todo_lists.last_applied_seq` macht `CreateToDoList`/`UpdateToDoList` monoton in `seq` — ein außer der Reihe angewendetes `created`/`updated` kann eine bereits neuere Zeile nicht mehr zurückdrehen. `DeleteToDoList` bekommt bewusst keinen solchen Guard: ein Delete muss auch mit einem *niedrigeren* `seq` als dem bereits angewendeten noch greifen, weil ein vollständiger Rebuild in Reihenfolge das Delete zuerst anwenden und ein danach kommendes Update über dessen eigenen `deleted_at IS NULL`-Guard ablehnen würde (das Frontend-Pendant, `handleDeleted` in `ingredient-list-projection.ts`, löscht die Zeile hart — ein später verarbeitetes Update im selben Rebuild liefe dort ins Leere). Ein `last_applied_seq`-Guard auf dem Delete würde diese Projektion vom Rebuild-Ergebnis wegdrehen statt daran anzugleichen. Die Invariante gilt damit für `created`/`updated` konstruktiv, nicht mehr nur, weil der Pfad selten getroffen wird; für `deleted` galt sie es schon vorher (terminal, siehe 6.2) und bleibt unverändert.

**6.2 deleted_at ist terminal.** Ein todo_list.created oder .updated darf eine getombstonete Liste nie wiederbeleben. Entsyncen benutzt deshalb kein Soft-Delete, sondern löscht hart.

**6.3 Kein Schreibweg in todo_lists außer über den Event-Log.**

**6.4 seq hat genau einen Writer: den Pull-Pfad** (EventRepository.insertRemote). Ein WebSocket-Ack markiert nur die Outbox-Zeile als synced, sonst nichts. Damit ist seq IS NULL eindeutig „noch nicht im gesehenen Server-Prefix".

**6.5 Replay-Reihenfolge ist byServerSeqThenLocal, nie occurred_at.** Bestätigter Server-Prefix nach seq, danach die eigenen unbestätigten Events in lokaler Einfügereihenfolge.

**6.6 Sync-an/aus verlässt nie das Gerät** — kein Event, kein Feld in einer Projektion, kein Server-State.

**6.7 occurred_at ist Anzeige-Metadatum.** Es ist die Wanduhr des Clients, also untrusted. Nie Grundlage für Ordnung, Autorisierung oder Retention. Die daraus gespeisten Spalten (created_at/updated_at/deleted_at) sind damit client-geliefert; updated_at kann rückwärts laufen.

**6.8 Jedes durabel angenommene Event bekommt genau einmal ein seq — beim Insert, unabhängig vom
Projektionserfolg.** `GetEventsSince`, `GetListHeads` und `GetKnownEventIdsByList` filtern alle
`seq IS NOT NULL`; seit `00006-events-seq-at-insert` gilt das für jedes durabel eingefügte Event, nicht
erst für ein erfolgreich projiziertes. `EventIngestor.process` ackt entsprechend sofort nach `Insert`
(`event-ingestor.go`) — der Ack bedeutet „durabel im Log", nicht „Projektion angewendet". `apply`
markiert danach nur noch den Projektionsversuch als abgeschlossen (`MarkProcessed`), ohne erneut zu
acken oder `seq` zu berühren. Ein Handler, der dauerhaft fehlschlägt (z. B. `CreateToDoList`/
`UpdateToDoList` mit leerem Namen, siehe `validate()` in `entities/todo-list.go`, oder ein Payload, an
dem `json.Unmarshal` scheitert), wird über `interfaces.ErrPermanent`/`interfaces.Permanent(err)`
(`permanent-error.go`) trotzdem als abgeschlossen markiert — wie der Unknown-Event-Type-Pfad. Ein
transienter (unwrapped) Fehler bleibt unprocessed für den nächsten Sweep, ist aber, anders als vor
`00006`, bereits geackt und für Pull/Reconcile sichtbar; nur der Backend-eigenen (nicht-autoritativen)
`todo_lists`-Projektion fehlt er noch. Das ist derselbe strukturelle Fix, den `b81caa1`/`3821b45` für
„Zeile nicht gefunden" und #247 für dauerhafte Handler-Fehler eingeführt haben, jetzt eine Ebene
tiefer: an der Log-Position selbst statt nur am Ack.

## 7. Offene Entscheidungen

**7.1 Enforcement-Zeitpunkt. ✅ Erledigt.** `/events` und jede `/sync/*`-Route prüfen list_members jetzt synchron, auf jeder Anfrage.

Gelöst wurde das Ingest-Problem, indem Ownership **nicht** beim `EventIngestor` entsteht, sondern am Push-Endpunkt: `EventController.SyncEvents` liest den verifizierten JWT-sub via `middleware.UserIDFromContext` (der Request-Context existiert dort noch), sammelt die distinkten `list_id`s des Batches und ruft `ListAccessService.AuthorizeWrite` **vor** dem Enqueuen auf — der asynchrone Ingestor-Worker selbst bleibt ohne Identität, wie ursprünglich befürchtet, aber er braucht sie jetzt auch nicht mehr. `events.user_id` (Migration `00007`, vom Push-Handler gesetzt, nie vom Client) hängt die verifizierte Identität zusätzlich an die Zeile, damit auch der asynchrone Ack-Pfad (inkl. `sweepUnprocessed`, das aus der DB neu lädt) user-scoped bleibt, statt über das unverifizierte `client_id` zu routen.

Der Bestandslisten-Backfill entfällt: es gab keine echten Nutzerdaten zu migrieren, Enforcement wurde deshalb ohne Backfill hart scharfgeschaltet. Events, die vor `00007` eingegangen sind, haben `user_id = NULL`, gehören also keiner Mitgliedschaft und sind seither für niemanden mehr über `/sync/*` erreichbar — bewusste Konsequenz, nicht übersehen.

**7.2 Ownership-Squatting. ✅ Geschlossen für bereits beanspruchte Listen.** „Claim-on-first-invite" existiert in `ListSharingService` nicht mehr; Claiming passiert ausschließlich in `ListAccessService.AuthorizeWrite`, beim ersten Push. `CreateInvite` verlangt jetzt einen bestehenden Owner (`RequireOwner`, kein Claim) — wer eine fremde, bereits von jemand anderem beanspruchte UUID kennt, kann sie über keinen Pfad mehr an sich reißen. Strukturell unverändert bleibt: „beanspruchen, wer zuerst pusht" ist das Bootstrap-Modell selbst (Listen-IDs sind client-generierte UUIDs, es gibt keine serverseitige Vergabe) — wer eine UUID errät, bevor ihr eigentlicher Besitzer sie je gepusht hat, wird genauso ihr Owner wie vorher. Das ist keine neue Lücke, nur keine, die dieser PR schließen konnte, ohne das Bootstrap-Modell selbst zu ändern.

**7.3 list_members.invite_id hat kein ON DELETE.** Ausreichend, solange Invites nur widerrufen und nie gelöscht werden. Ein künftiger „abgelaufene Invites aufräumen"-Job würde daran scheitern; ON DELETE SET NULL wäre dann die richtige Semantik — eine gelöschte Einladung darf die Mitgliedschaft nicht mitnehmen.

**7.4 todo_list.deleted ist nicht rollenbeschränkt.** Ein Mitglied kann die Liste für alle löschen. Ob das gewollt ist (geteilter Haushalt) oder auf den Owner beschränkt gehört, ist nicht entschieden.

**7.5 Tombstone-Squatting. ✅ Geschlossen für bereits beanspruchte Listen.** Der Tombstone-Upsert von `DeleteToDoList` legt weiterhin eine `todo_lists`-Zeile für ungesehene UUIDs an, aber ein `todo_list.deleted` für eine fremde, bereits beanspruchte UUID erreicht diesen Pfad jetzt gar nicht mehr: `AuthorizeWrite` lehnt den Push mit 403 ab, sobald die Liste schon einen anderen Owner hat. Der irreversible Fall aus der ursprünglichen Beschreibung — beliebiger Token macht eine *fremde, bereits existierende* Liste dauerhaft unsyncbar — ist damit ausgeschlossen. Wer stattdessen eine noch nie gepushte UUID errät und dafür sofort ein `deleted` sendet, wird formal ihr Owner (siehe 7.2) und tombstoned damit nur seine eigene, gerade erst beanspruchte Liste — derselbe strukturelle Restfall wie in 7.2, keine eigene Lücke mehr.

## 8. Bewusst nicht gebaut

- **„Meine Listen nach Neuinstallation wiederherstellen."** Pull läuft nur für Listen, die lokal bereits bekannt und sync-aktiv sind. Nach einer Neuinstallation ist die lokale DB leer, es gibt also nichts zu pullen. Ein Discovery-Endpunkt („gib mir alle Listen dieses Accounts") ist ein eigenes, größeres Feature — 7.1 (jetzt erledigt) war nur seine Voraussetzung, nicht seine Umsetzung.
- **Direkteinladung an eine Person / Freundesliste.** Nur mehrfach nutzbare Links.
- **Mitglieder entfernen (Kick).** Nur Selbst-Verlassen.
- **Ownership übertragen.**
- **Echte kausale Ordnung (Vektoruhren).** Der Rebase auf seq reicht für diese App-Klasse. Der Preis: ein lange offline gewesenes Gerät landet mit seinen Events hinter allem, was der Server zwischenzeitlich bekommen hat.
- **ingredient.* serverseitig projizieren.** Das würde die Projektionslogik des Frontends ein zweites Mal in Go duplizieren, mit der Pflicht, dass beide dauerhaft übereinstimmen. Der Server relayt Ingredient-Events und speichert sie; er interpretiert sie nicht.
