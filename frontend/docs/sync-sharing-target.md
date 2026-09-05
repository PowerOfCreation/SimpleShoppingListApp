# Sync & Teilen: Sollzustand

Dieses Dokument beschreibt, **was gebaut werden soll** — die Zielarchitektur für Listen-Sync und Listen-Teilen, die Regeln, an die sich jede Änderung halten muss, und was bewusst offen ist.

Abgrenzung zu sync-design-decisions.md: das dort ist ein **Entscheidungsprotokoll** (rückblickend: „warum ist X so"). Dieses Dokument ist die **Spezifikation** (vorausschauend: „was gilt"). Bei Widerspruch gewinnt dieses Dokument, und das Protokoll wird nachgezogen.

Jeder PR in diesem Bereich sollte gegen Abschnitt 2 und 6 prüfbar sein.

## 1. Das Produktziel in einem Absatz

Die App ist offline-first: die lokale SQLite ist die Wahrheit, sie funktioniert ohne Backend und ohne Login. Wer angemeldet ist, kann **pro Liste** Sync einschalten. Eine synchronisierte Liste kann ihr **Besitzer** per Einladungslink teilen. Eingeladene sind **Mitglieder**: sie dürfen die Liste sehen und bearbeiten, aber nicht weiter einladen — sie können sie nur selbst wieder verlassen. Der Besitzer darf Sync erst wieder ausschalten, wenn kein anderer Nutzer mehr Mitglied ist; dabei wird die Server-Kopie gelöscht, die lokale bleibt. Alle Bearbeitungen funktionieren offline und mergen deterministisch über mehrere Geräte hinweg — wie git rebase, nicht wie „letzter Schreiber gewinnt nach Wanduhr".

## 2. Die vier Wahrheiten

Die Leitregel des ganzen Systems. Fast jeder Bug in diesem Bereich war eine Verletzung genau einer dieser Zuordnungen. Ursprünglich waren es drei; die *Position* ist als eigene Zeile dazugekommen, als sie aufhörte, ein Nebenprodukt der Content-Projektion zu sein, und eine eigene Tabelle bekam (R3).

| Was | Wem gehört die Wahrheit | Wo liegt es |
| --- | --- | --- |
| **Inhalt** — Listenname, Einträge | dem Event-Log. Beide Seiten *leiten ab*, keine Seite besitzt den Zustand. | events (Server) / domain_events (lokal) |
| **Zugriff** — Owner, Mitglieder, Einladungen | dem Server, relational, synchron erzwungen. **Nie** im Event-Log. | list_members, list_invites |
| **Die Position des Logs** — kennt der Server diese Liste, und wo steht sie | dem Server, als *Ref*: Existenz der Zeile plus head_seq, ohne jeden Inhalt. | synced_lists |
| **Ob dieses Gerät synct** | dem Gerät. **Nie** beim Server, nie in einer Projektion. | list_sync_settings (nur lokal) |

Daraus folgt direkt:

- Eine Autorisierungsentscheidung darf **nie** ein replaybares Domain-Event sein. Ein Event wird wiederholt zugestellt, neu eingereiht und erneut abgespielt — eine destruktive Aktion, die daran hängt, feuert irgendwann ungewollt.
- Eine Geräte-Einstellung darf **nie** in einer Projektion liegen, die aus dem Log neu aufgebaut wird — der Rebuild setzt sie sonst still auf den Default zurück.
- Es darf **keinen Schreibweg** in eine Projektion geben, der am Event-Log vorbeigeht. Das Backend zieht daraus die schärfste mögliche Konsequenz: es hat weder Listen-CRUD-Endpunkte noch überhaupt eine Content-Projektion. Der Server speichert und relayt Events, er interpretiert sie nie (R2 in Abschnitt 6). Das ist die Trennung, die diese Tabelle beschreibt, konstruktiv statt als Disziplin: *Zugriff* und *Position* gehören relational dem Server, *Inhalt* ausschließlich dem Log.

Das Bild dafür ist ein bare git-Repo: Object Database (`events`) plus eine zugriffsgeschützte Ref (`synced_lists.head_seq`), aber kein Working Tree. Der Server prüft beim Empfang die Struktur (`git fsck` → 400) und die Rechte am Repo (branch protection → 403), nie den Inhalt eines Commits. Ausgecheckt wird nur im Client.

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

**Ownership entsteht beim ersten Push**, nicht beim Teilen: `EventController.SyncEvents` beansprucht eine noch mitgliederlose Liste synchron für den verifizierten JWT-sub, bevor irgendetwas geschrieben wird (`ListAccessService.AuthorizeWrite`). „Claim-on-first-invite" in `ListSharingService` ist entfernt: `CreateInvite` verlangt jetzt einen bestehenden Owner, statt selbst einen zu erzeugen.

Der Claim legt **Registry- und Owner-Zeile im selben Statement** an — `ClaimListOwnership` ist ein data-modifying CTE (`INSERT INTO synced_lists ... ON CONFLICT DO NOTHING` gefolgt vom `INSERT INTO list_members ... WHERE NOT EXISTS`). „Der Server kennt diese Liste" und „diese Liste hat einen Owner" sind damit nicht zwei Zustände, die auseinanderlaufen können, sondern einer. Das `NOT EXISTS` allein ist unter READ COMMITTED kein Ausschluss — zwei nebenläufige Erstansprüche können es beide passieren, bevor einer committet. Verhindert wird der zweite Owner deshalb im Schema: `idx_list_members_single_owner`, ein partieller Unique-Index auf `list_members (list_id) WHERE role = 'owner'` (Migration `00010`). Der Verlierer bekommt SQLSTATE `23505`, was das Repository auf „nicht beansprucht, schau nach, wer es war" abbildet.

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

Geräte-lokale Einstellung (list_sync_settings.enabled = 1) plus einmaliges Einreihen der gesamten syncbaren Historie der Liste in die Outbox. Serverseitig entstehen dadurch beim ersten Push in einem Statement die Registry-Zeile (synced_lists) und der Owner-Eintrag (list_members) — siehe 3.

**Für den Server bedeutet „ist synchronisiert" genau: es existiert eine synced_lists-Zeile.** Der Server kann nicht wissen, ob ein bestimmtes Gerät synct — das ist per Definition geräte-lokal. Die Produktregel „nur eine synchronisierte Liste kann geteilt werden" ist deshalb identisch mit dem requireList-Check im ListSharingService (`SELECT EXISTS ... FROM synced_lists`). Sie braucht keine eigene Prüfung.

Anders als früher ist das **derselbe** Moment wie „ist beansprucht": beide Zeilen entstehen atomar (siehe 3). `CreateInvite`/`FindActiveInvites` prüfen weiterhin beides — `requireList` (Registry-Zeile existiert, 404) *und* `access.RequireOwner` (list_members-Zeile mit role=owner, 403) —, aber die beiden Prüfungen sind seitdem nicht mehr unabhängig voneinander wahr, sondern nur noch zwei Antworten auf dieselbe Tatsache. Das macht `requireList` zu einem Existenz-Orakel, das vor der Rechteprüfung antwortet: siehe 7.7.

### 4.3 Teilen

Owner erzeugt einen mehrfach nutzbaren Einladungslink mit einer Server-Preset-TTL (1h | 24h | 7d | 30d). Nur der sha256-Hash des Tokens wird gespeichert; der Klartext existiert genau einmal, in der Create-Response. Der Deep-Link wird im Frontend aus dem Token gebaut — das Backend kennt keine Frontend-Routen.

Einlösen ist idempotent: wer bereits Mitglied ist, bekommt already_member: true statt eines Fehlers, damit ein Client eine verlorene Antwort gefahrlos wiederholen kann. Die Mitgliedschaftsprüfung läuft dabei bewusst **vor** der Gültigkeitsprüfung des Tokens: ein Wiederholungsversuch mit einem inzwischen widerrufenen oder abgelaufenen Link gelingt weiterhin, statt 410 zu liefern. Idempotenz gilt für die Aktion, nicht für den Token — der Beitritt ist längst passiert, und ein Client, dessen Antwort verlorenging, darf nicht davon abhängen, wie lange er für den Retry braucht. 410 (widerrufen bzw. abgelaufen) trifft nur, wer noch **nicht** Mitglied ist.

Nach dem Einlösen legt der Client die Liste lokal an, indem er ganz normal pullt: list_sync_settings.enabled = 1, kein Cursor → Voll-Pull ab seq 0 → der EventApplier baut die Projektion aus der Historie auf. Der Server kann dabei nichts beisteuern: die Redeem-Response ist `{list_id, role, already_member}` und enthält **keinen Listennamen** — sie könnte ihn nach R2 gar nicht kennen. Der Name kommt aus dem ersten `todo_list.created` der gepullten Historie.

### 4.4 Entsyncen (Server-Kopie löschen)

Erlaubt **nur** dem Owner und **nur**, wenn list_members genau eine Zeile hat (er selbst). Sonst 409.

„Allein" heißt dabei: **kein anderer Nutzer**. Eigene weitere Geräte werden nicht mitgezählt — list_members ist auf (list_id, user_id) geschlüsselt, und client_id ist bewusst die Keycloak-sub und keine Geräte-ID (siehe sync-design-decisions.md). Der Owner ist eine Person, die diese Aktion bewusst auslöst.

Das Entsyncen ist ein **autorisierter REST-Befehl, kein Domain-Event** (siehe die erste Folgerung aus Abschnitt 2). Es löscht serverseitig **hart**, und zwar in zwei Schritten:

- `DELETE FROM synced_lists WHERE id = …` — Einladungen und Mitgliedschaften folgen per Cascade. Seit Migration `00008` haben `list_invites.list_id` und `list_members.list_id` wieder einen Fremdschlüssel, jetzt auf `synced_lists(id)` **mit `ON DELETE CASCADE`**. Gegen die Registry ist die Beziehung ehrlich: die Registry-Zeile entsteht in derselben Anweisung wie der Owner (siehe 3), ein Mitglied ohne Elternzeile ist also nicht darstellbar. Gegen die frühere Content-Projektion war sie es nicht, deshalb musste `00007` diese FKs überhaupt erst droppen.
- `DELETE FROM events WHERE list_id = …` — **explizit**, denn `events.list_id` hat bewusst keinen Fremdschlüssel (seit Migration `00004`): das Log muss auch für eine Liste existieren können, deren Registry-Zeile noch nicht angelegt ist, und es darf nie an einer Zeile hängen, die eine andere Wahrheit besitzt.

Kein Soft-Delete — ein Tombstone würde die Liste dauerhaft unsyncbar machen (siehe Invariante 6.2). Die Registry hat entsprechend gar kein `deleted_at`; sie könnte einen Löschzustand nach R2 auch nicht kennen, das wäre Inhalt.

Lokal auf dem auslösenden Gerät danach: list_sync_settings.enabled = 0, sync_cursors-Zeile löschen, domain_events.seq = NULL für alle Events der Liste, ausstehende Outbox-Zeilen der Liste canceln. Die Liste selbst bleibt unangetastet — das ist der Zweck der Aktion.

Damit ist erneutes Einschalten exakt „Liste zum ersten Mal syncen": der Server kennt weder die ID noch die Event-IDs, der Replay läuft normal durch, die Zeile wird frisch angelegt. Wie ein gelöschter Remote-Branch, der neu gepusht wird.

### 4.5 Andere eigene Geräte nach einem Entsync

Ein Gerät, das Sync für diese Liste noch an hat, stellt beim nächsten Pull fest, dass der Server die Liste nicht mehr kennt. Es **schaltet Sync dafür lokal ab** (enabled = 0, Cursor weg, seq der Liste auf NULL, Outbox-Zeilen canceln) und behält die lokale Liste vollständig.

Es lädt sie **nicht** neu hoch — das würde den Desync faktisch wirkungslos machen, solange irgendein Gerät noch synct.

Bewusst in Kauf genommen: Schreibvorgänge, die Gerät A vor dem Desync gepusht hat und die Gerät B noch nicht gepullt hatte, sind für B verloren. Bs eigene lokale Historie bleibt vollständig; verloren geht nur der Merge. Solange Enforcement noch nicht scharf ist (7.1), ist das der einzige Schutz.

*Voraussetzung, die heute nicht erfüllt ist:* B kann den Fall aktuell nicht erkennen.
`/api/v1/sync/head` liefert für eine unbekannte Liste dieselbe Antwort (`seq: 0, event_id: null`) wie
für eine bekannte, aber leere — und ein Gerät, das bereits gepusht, aber noch nie gepullt hat, steht
wegen 6.4 ebenfalls auf Cursor 0. Es würde nach diesem Abschnitt weiterpushen und die Liste
serverseitig neu anlegen, genau das, was hier verhindert werden soll.

**Ein „unbekannt"-Signal in der Head-Response ist trotzdem die falsche Lösung und wird nicht
gebaut.** `GetHead` macht „unbekannt" und „nicht zugänglich" *absichtlich* ununterscheidbar, damit
der Lesepfad kein Existenz-Orakel für geratene fremde UUIDs wird (Begründung im Code, `GetHead` in
`sync-pull-controller.go`). Das Signal, das dieser Abschnitt wirklich braucht, ist ein anderes: nicht
„kennt der Server die Liste", sondern **„bin *ich* noch Mitglied"**. Das deckt alle drei Fälle mit
derselben lokalen Reaktion ab — Entsync (das Cascade aus 4.4 nimmt die Mitgliedszeile mit), Verlassen
(4.6) und Entferntwerden — und verrät nichts über fremde Listen: nicht-existent und
existiert-aber-nicht-deine liefern beide `false`. Als Pro-Liste-`accessible`-Angabe gehört es zu
`DELETE .../sync` (Abschnitt 5), nicht in den Head-Pfad.

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
| GET | /api/v1/sync/ws | Listen-Notifications | ✅ |
| POST | /api/v1/todo-lists/:id/invites | Einladung erzeugen (owner) | ✅ |
| GET | /api/v1/todo-lists/:id/invites | Aktive Einladungen (owner) | ✅ |
| DELETE | /api/v1/invites/:inviteId | Widerrufen (owner) | ✅ |
| POST | /api/v1/invites/redeem | Beitreten | ✅ |
| GET | /api/v1/todo-lists | Meine Listen (Discovery, alle Rollen) | ✅ |
| GET | /api/v1/todo-lists/:id/membership | Eigene Rolle + Mitgliederzahl | ⬜ offen |
| DELETE | /api/v1/todo-lists/:id/members/me | Verlassen (member) | ⬜ offen |
| DELETE | /api/v1/todo-lists/:id/sync | Entsyncen (owner, nur allein) | ⬜ offen |

Das Pfadsegment `todo-lists` ist historisch — die gleichnamige Tabelle existiert nicht mehr, die Routen adressieren eine Listen-ID in der Registry. Umbenennen kostet einen Client-Breaking-Change und lohnt erst, wenn ohnehin ein Frontend daran hängt (siehe Frontend-Stand unten).

Alle ✅-Routen sind seit 7.1 zugriffsgeprüft, nicht nur erreichbar: `/events` und `GET /sync/events` lehnen mit 403 ab, wer kein Mitglied ist; `/sync/head` und `/sync/state` filtern nicht zugängliche Listen-IDs still aus der Antwort statt zu 403en (kein Enumerations-Orakel); `/sync/ws` filtert die `list_ids` eines `subscribe` genauso wie die Lesepfade. Der `?client_id=`-Query-Parameter am WebSocket wird nicht mehr ausgewertet — er diente nur dem Ack-Routing, und der Ack ist entfallen (siehe unten).

### 5.1 Push-Semantik

Was `POST /api/v1/events` zusagt, bestimmt das Verhalten der Outbox und gehört deshalb hierher, nicht nur in den Code:

- **Annahme ist synchron und für die ganze Batch fail-closed.** Strukturprüfung (400) und Autorisierung (403) laufen vor jedem Schreibvorgang und über den kompletten Batch: ein einziges ungültiges oder nicht autorisiertes Event lehnt alle ab. Die Grenzen sind Envelope- und Größenprüfungen, nie Feldsemantik (R2): `event_id`/`aggregate_id` gesetzt, `aggregate_id == list_id` für `todo_list.*`, `payload` syntaktisch valides JSON und ≤ 8 KiB, Batch ≤ 64 KiB. Unbekannte `event_type`s werden **angenommen** — das ist die Forward-Kompatibilität, nicht eine Lücke.
- **Der Append läuft eine Transaktion pro Liste, nicht eine pro Batch.** Eine Batch über zwei Listen kann halb gelingen und danach mit 500 enden. Das ist zulässig, weil die Bestätigung pro Event geführt wird: die nicht quittierten Outbox-Zeilen bleiben `pending`, der nächste Flush pusht sie erneut, `AppendToList` ist idempotent auf `event_id` und liefert dieselbe `seq` zurück.
- **Die Antwort ist die Bestätigung**, 200 mit `{"queued": n, "acked": [{event_id, seq}]}` — ein `acked`-Eintrag pro Event der Anfrage, Duplikate eingeschlossen (sie echoen ihre ursprüngliche `seq`). Geht die Antwort verloren, bleibt die Zeile `pending` und der Retry heilt sich selbst. Es gibt **keinen zweiten Bestätigungskanal**; der frühere WebSocket-Ack ist entfallen.
- **`/sync/ws` trägt nur, was Request/Response nicht kann:** `{"type":"event","list_id":…,"seq":…}` an Geräte, die auf diese Liste subscribed sind, damit sie von *fremden* Schreibvorgängen erfahren, ohne zu pollen. Ein debouncter Pull-Trigger, kein Ordnungstoken — der Fan-out ist vom Request abgesetzt und bewusst ungeordnet.
- **Mengengrenzen der Lesepfade:** `/sync/head` und `/sync/state` nehmen ≤ 200 `list_ids`, `GET /sync/events` ein `limit` ≤ 500.

GET .../membership ist Vorbedingung für die UI: ohne sie kann das Frontend weder Owner- von Member-Ansicht unterscheiden noch den Entsync-Button korrekt sperren.

`DELETE .../sync` braucht zwei Dinge, die es heute nicht gibt. Erstens das `accessible`-Signal aus 4.5
— „bin ich noch Mitglied", pro Liste — damit die anderen Geräte des Owners den Entsync überhaupt
bemerken, ohne dass daraus ein Existenz-Orakel für fremde UUIDs wird. Zweitens die Entscheidung, was
mit dem Cascade aus 4.4 passiert: `DELETE FROM synced_lists` reißt Mitgliedschaften und Einladungen
mit, und Zugriffsdaten sind das Einzige in diesem System, was sich *nicht* aus dem Log rekonstruieren
lässt.

**Frontend-Stand:** Gebaut sind Owner- und Redeem-Seite von 4.3.
`app/(home)/share_shopping_list.tsx` — erreichbar über „Invite people" im Kontextmenü einer Liste,
und zwar nur solange dieses Gerät sie synct und ein Login besteht (beides Vorbedingung dafür, dass
der Server überhaupt eine Registry-Zeile hat, siehe 4.2) — erzeugt, listet und widerruft
Einladungen über `api/sharing/sharing-client.ts`. Der Deep-Link wird clientseitig aus dem Token
gebaut (`api/sharing/invite-link.ts`), als verifizierter Android App Link
(`https://static.ops.light-dev-solutions.de/invite?token=…`; assetlinks.json unter
`docs/.well-known/`, `android.intentFilters` in `app.config.js`), passend zu „das Backend kennt
keine Frontend-Routen". Expo Router matcht den Pfad `/invite` automatisch gegen
`app/(home)/invite.tsx` — dafür war keine Sonderbehandlung in `+native-intent.ts` nötig.

`app/(home)/invite.tsx` (`useRedeemInvite`) verlangt zuerst ein Login — die einzige Stelle, die
das tut, der Rest der App braucht keins —, ruft dann `POST /api/v1/invites/redeem` auf und schaltet
`list_sync_settings` für die neue Liste ein. Anders als `ShoppingListService.setSyncEnabled` (pusht
vorhandene lokale Historie nach außen) gibt es hier noch keine lokale Historie; sie kommt per
Voll-Pull vom Server. Landet der Pull mangels Verbindung nichts, ist das kein Fehler: der Screen
zeigt „pending", SyncCoordinators eigene Retries holen es nach.

Weiterhin offen: eine Mitgliederliste (es gibt keinen Endpunkt dafür), die Owner-/Member-
Unterscheidung in der Listenansicht, „Verlassen" und „Entsyncen". Solange `GET .../membership`
offen ist, kann der Client seine eigene Rolle nicht erfragen: ein Member erfährt erst aus dem 403
der Einladungsroute, dass die Liste ihm nicht gehört — die Einladungs-UI zeigt das als
Fehlermeldung, statt den Einstieg zu verstecken.

**„Meine Listen nach Neuinstallation wiederherstellen" ist seitdem gebaut** (`GET
/api/v1/todo-lists`, siehe Abschnitt 5; frontend `SharingClient.listMyLists`). `SyncCoordinator`
ruft es einmal pro `start()` (also einmal pro angemeldeter Session) auf, schaltet
`list_sync_settings` für jede vom Server gemeldete, dem Gerät noch unbekannte Liste ein und stößt
über `notifySyncListsChanged()` genau denselben Re-Subscribe/Re-Pull-Pfad an, den `useRedeemInvite`
schon für eine einzelne eingelöste Einladung nutzt — Namen/Inhalt kommen wie dort per Voll-Pull ab
seq 0, der Server liefert nur `{list_id, role}` je Mitgliedschaft.

## 6. Invarianten

Verletzungen sind Bugs, auch wenn kein Test rot wird.

**6.1 Vorwärts-Anwendung == Rebuild.** Für jede Event-Folge muss die schrittweise Anwendung denselben Projektionszustand erzeugen wie ein vollständiger Replay aus dem Log. Daraus folgt: kein Handler liest eine Uhr — alle Zeitstempel stammen aus occurred_at des Events.

*Testform:* zwei getrennte Zustände vergleichen (vorwärts auf Liste A aufbauen, Zeile zurücksetzen, rebuilden, gegen A prüfen). Ein Rebuild über dieselbe, unveränderte Zeile ist kein Test — er kann nicht fehlschlagen.

*Backend-Stand:* gegenstandslos. Der Server hält keine Projektion mehr, es gibt also nichts vorwärts anzuwenden und nichts zu rebuilden — die frühere Lücke „Projektion ohne Rebuild-Mechanismus" ist nicht geschlossen, sondern entfallen (siehe R2/R3). Die Invariante gilt seitdem ausschließlich im Client, dort aber wörtlich: `IngredientListProjection.rebuildForList` ist genau dieser Rebuild.

*Historie:* die einst schärfste Verletzung dieser Invariante saß im Backend — `sweepUnprocessed` sortierte nach `received_at`, während `seq` erst beim Projektionserfolg vergeben wurde, sodass ein nachgeholtes Event eine *höhere* Position bekommen konnte als ein später eingetroffenes, und jeder Client diese falsche Reihenfolge 1:1 replizierte. Der Weg über `00006` (seq beim Insert) und `last_applied_seq` bis zur Abschaffung des ganzen Pfades steht in `sync-design-decisions.md`.

**6.2 deleted_at ist terminal.** Ein todo_list.created oder .updated darf eine gelöschte Liste nie wiederbeleben. Das ist heute eine reine **Client-Invariante**: `rebuildListProjections` (`event-applier.ts`) prüft `history.some(e => e.event_type === TODO_LIST_DELETED)` — reihenfolgeunabhängig und an keinen Serverzustand gebunden. Zwei Folgen, die man kennen muss:

- *Sie hängt an der vollständigen Historie.* Die Prüfung läuft über das komplette Log der Liste und hält nur, solange der Client es nie kompaktiert. Das ist eine explizite Abhängigkeit, kein Zufall — jede Snapshot-/Kompaktierungslösung (siehe 8) muss sie ausdrücklich mitbeantworten.
- *Der Server kennt keine Löschung.* Ein Redeem auf eine gelöschte Liste **gelingt** serverseitig; die Registry hat kein `deleted_at` und könnte nach R2 auch keins haben. Der Client stellt die Löschung beim ersten Voll-Pull fest und verwirft die Liste lokal. Kein Datenverlust, nur ein wirkungsloser Beitritt.

Entsyncen benutzt aus demselben Grund kein Soft-Delete, sondern löscht hart (4.4): ein Tombstone in der Registry würde die Liste dauerhaft unsyncbar machen.

**6.3 Der Server hat keinen Zustand, in den ein Schreibweg am Event-Log vorbeiführen könnte.** Früher lautete diese Invariante „kein Schreibweg in todo_lists außer über den Event-Log" und musste durchgesetzt werden; seit die Tabelle nicht mehr existiert, ist sie durch R2/R3 konstruktiv erfüllt. Was bleibt, ist die Zugriffsseite — list_members/list_invites —, und die ist per Abschnitt 2 ausdrücklich *kein* abgeleiteter Zustand, sondern eine eigene Wahrheit.

**6.4 seq hat genau einen Writer je Seite.** Im Client ist es der Pull-Pfad (EventRepository.insertRemote); die Push-Bestätigung markiert nur die Outbox-Zeile als synced, sonst nichts, sodass `seq IS NULL` eindeutig „noch nicht im gesehenen Server-Prefix" bedeutet. Auf dem Server ist es die row-gelockte Registry-Zeile: `LockOrCreateSyncedList` nimmt den Lock auf `synced_lists`, die Events werden mit `head_seq+1..+n` eingefügt, `head_seq` wird gesetzt, dann committet. Vorher hing die Lückenlosigkeit an „genau eine EventIngestor-Goroutine in genau einem Prozess" — eine Annahme, die das Backend auf **eine** Replik festnagelte. Der Lock je Liste ersetzt sie; mehrere API-Repliken sind seitdem zulässig.

**6.5 Replay-Reihenfolge ist byServerSeqThenLocal, nie occurred_at.** Bestätigter Server-Prefix nach seq, danach die eigenen unbestätigten Events in lokaler Einfügereihenfolge.

**6.6 Sync-an/aus verlässt nie das Gerät** — kein Event, kein Feld in einer Projektion, kein Server-State.

**6.7 occurred_at ist Anzeige-Metadatum.** Es ist die Wanduhr des Clients, also untrusted. Nie Grundlage für Ordnung, Autorisierung oder Retention. Die daraus gespeisten Spalten (created_at/updated_at/deleted_at) sind damit client-geliefert; updated_at kann rückwärts laufen.

**6.8 Jedes angenommene Event bekommt genau einmal ein seq, in derselben Transaktion wie sein Append.**
Früher war das eine erkämpfte Eigenschaft: `seq` hing am Projektionserfolg, Handler konnten dauerhaft
scheitern, und es brauchte eine Permanent-vs-transient-Klassifikation, um „angenommen" von
„angewendet" zu trennen. Heute ist sie trivial wahr. `InsertEventAtSeq` (`ON CONFLICT (id) DO NOTHING
RETURNING seq`) vergibt die Position im selben Transaktionsblock, in dem der Row-Lock auf der
Registry gehalten wird; ein bereits bekanntes `event_id` verbraucht keinen Slot und bekommt seine
alte `seq` zurück. Davor gibt es nur 400 oder 403, danach ist das Event ein Fakt — es gibt keinen
Zustand mehr dazwischen, den ein Hintergrundlauf noch nachholen oder verwerfen könnte (R1).

### Die vier Invarianten des Log-Servers

Sie sind das Ergebnis des Umbaus vom Content-Projizierer zum append-only Log und stehen gleichrangig neben 6.1–6.8.

**R1 — Annahme ist synchron und endgültig.** Alles, was zu einem Event „nein" sagen kann, passiert im Push-Handler: Autorisierung (403), Struktur (400). Ab dem Moment der Annahme ist das Event ein Fakt; kein nachgelagerter Schritt darf es noch ablehnen. *Durchsetzungsort:* `event-controller.go` (`validateEventStructure`, `AuthorizeWrite`) vor `EventRepository.AppendToList`.

**R2 — Der Server liest nie in einen Payload.** Weder für `todo_list.*` noch für `ingredient.*`. Die Prüfung endet am Envelope plus „ist syntaktisch JSON". *Falsifizierbar:* jedes `json.Unmarshal` oder `payload ->>` auf `payload` im Backend außerhalb von Migrationen ist eine Verletzung. **Eine benannte Ausnahme, die keine ist:** `validateEventStructure` sieht das Envelope-Feld `event_type` an (Präfix `todo_list.` ⇒ `aggregate_id` muss `list_id` sein). Das ist Adressierung, nicht Inhalt.

Warum keine semantische Payload-Validierung am Push, obwohl sie naheläge: ein Validator pro Event-Typ müsste unbekannte Typen entweder ablehnen oder durchlassen. Lehnt er ab, killt ein neuer Event-Typ gegenüber einem älteren Server nicht ein Event, sondern — über `nonRetryableError` → `giveUpOnGroup` — den Sync der ganzen Liste auf diesem Gerät. Lässt er durch, ist „kein ungültiger Payload kommt je ins Log" falsch und der Client braucht R4 ohnehin. Eine dritte Option gibt es nicht. Der Prüfstein: *könnte man die Payloads morgen verschlüsseln?* Mit Relay + Registry + Membership ja — mit semantischer Validierung konstruktiv nein.

**R3 — Die Registry-Zeile ist die Ref.** Existenz und `head_seq` beantworten „kennt der Server diese Liste" und „wo steht sie", ohne jeden Inhalt. Nicht die Existenz einer Content-Zeile. *Durchsetzungsort:* `synced_lists`, gelesen von `requireList` und `FindListHeads`, geschrieben von `ClaimListOwnership` und `AppendToList`.

**R4 — Projektionen sind total.** Kein Event darf eine Projektion werfen lassen. Unlesbar oder unvollständig heißt übersprungen, geloggt, gezählt, an den Reparaturpfad gemeldet. Gilt für beide Seiten; wirksam ist die Invariante im Client, weil dort der letzte Interpret sitzt. *Durchsetzungsort:* `ingredient-list-projection.ts`, `ingredient-projection.ts`. Sie ist die einzige Abwehr, die noch trägt, wenn der Server per Design blind ist — ohne sie ist ein einziges kaputtes Event eine Poison Pill, die den Cursor nicht mehr vorrücken lässt und die Liste auf diesem Gerät dauerhaft unsynchronisierbar macht.

## 7. Offene Entscheidungen

**7.1 Enforcement-Zeitpunkt. ✅ Erledigt.** `/events` und jede `/sync/*`-Route prüfen list_members jetzt synchron, auf jeder Anfrage.

Das ursprüngliche Problem war, dass Ownership beim asynchronen Ingest entstehen sollte, wo es keinen Request-Context und damit keine verifizierte Identität gibt. Gelöst wurde es, indem der Zeitpunkt verschoben wurde statt der Mechanismus: `EventController.SyncEvents` liest den verifizierten JWT-sub via `middleware.UserIDFromContext`, sammelt die distinkten `list_id`s des Batches und ruft `ListAccessService.AuthorizeWrite` auf, bevor irgendetwas geschrieben wird. Inzwischen ist die Frage doppelt erledigt: es gibt keinen asynchronen Pfad mehr, der eine Identität bräuchte (R1).

`events.user_id` (Migration `00007`, vom Push-Handler gesetzt, nie vom Client) hängt die verifizierte Identität zusätzlich an die Zeile — als forensisches Feld („wer hat dieses Event geschrieben") und war die Grundlage für den Discovery-Endpunkt „meine Listen" (`GET /api/v1/todo-lists`, seitdem gebaut — siehe Abschnitt 5 und 8.1).

Der Bestandslisten-Backfill entfällt: es gab keine echten Nutzerdaten zu migrieren, Enforcement wurde deshalb ohne Backfill hart scharfgeschaltet. Events, die vor `00007` eingegangen sind, haben `user_id = NULL`, gehören also keiner Mitgliedschaft und sind seither für niemanden mehr über `/sync/*` erreichbar — bewusste Konsequenz, nicht übersehen.

**7.2 Ownership-Squatting. ✅ Geschlossen für bereits beanspruchte Listen.** „Claim-on-first-invite" existiert in `ListSharingService` nicht mehr; Claiming passiert ausschließlich in `ListAccessService.AuthorizeWrite`, beim ersten Push. `CreateInvite` verlangt jetzt einen bestehenden Owner (`RequireOwner`, kein Claim) — wer eine fremde, bereits von jemand anderem beanspruchte UUID kennt, kann sie über keinen Pfad mehr an sich reißen. Strukturell unverändert bleibt: „beanspruchen, wer zuerst pusht" ist das Bootstrap-Modell selbst (Listen-IDs sind client-generierte UUIDs, es gibt keine serverseitige Vergabe) — wer eine UUID errät, bevor ihr eigentlicher Besitzer sie je gepusht hat, wird genauso ihr Owner wie vorher. Das ist keine neue Lücke, sondern der Preis des Bootstrap-Modells — zu schließen nur, indem man dieses selbst ändert. Dass der Erstanspruch dabei *eindeutig* ist, garantiert seit Migration `00010` das Schema und nicht mehr nur das `NOT EXISTS` der Abfrage (siehe 3).

**7.3 list_members.invite_id hat kein ON DELETE.** Ausreichend, solange Invites nur widerrufen und nie gelöscht werden. Ein künftiger „abgelaufene Invites aufräumen"-Job würde daran scheitern; ON DELETE SET NULL wäre dann die richtige Semantik — eine gelöschte Einladung darf die Mitgliedschaft nicht mitnehmen.

**7.4 todo_list.deleted ist nicht rollenbeschränkt.** Ein Mitglied kann die Liste für alle löschen. Ob das gewollt ist (geteilter Haushalt) oder auf den Owner beschränkt gehört, ist nicht entschieden.

**7.5 Tombstone-Squatting. ✅ Gegenstandslos.** Der Angriff hing am Tombstone-Upsert von `DeleteToDoList`, der für eine ungesehene UUID eine gelöschte `todo_lists`-Zeile anlegte und die Liste damit dauerhaft unsyncbar machte. Diesen Schreibweg gibt es nicht mehr: kein Handler, keine Projektion, kein Tombstone (R2/R3). Ein `todo_list.deleted` ist heute eine Zeile im Log wie jede andere; ob sie eine Liste löscht, entscheidet der Client beim Rebuild (6.2). Es bleibt der Restfall aus 7.2 — wer eine noch nie gepushte UUID errät, wird ihr Owner —, aber der ist das Bootstrap-Modell selbst und keine eigene Lücke.

**7.6 WS-Subscriptions werden nach dem Aufbau nicht neu geprüft. Bekannte Einschränkung.** `Hub.subscribe` filtert die angeforderten `list_id`s einmal, beim Verbindungsaufbau bzw. beim nächsten `subscribe`-Frame, durch `ListAccessFilter`; ein Fehler im Filter führt fail-closed zu *null* Subscriptions. Ein `subscribe` **ersetzt** die Menge der Subscriptions einer Verbindung, es akkumuliert nicht, und die Buchführung läuft ausschließlich über die Verbindungsidentität — der Hub kennt seit dem Wegfall des Acks keine user_id mehr. Verliert ein Nutzer danach den Zugriff (verlässt eine Liste, wird entfernt), bleibt die bestehende Subscription bis zum nächsten `subscribe`/Reconnect aktiv — `PublishListEvent` prüft beim Zustellen selbst nicht erneut. Der Leak ist eng begrenzt: `{"type":"event","list_id":...,"seq":...}` verrät nur eine Listen-ID und Position, die der Client ohnehin schon kannte, nie Inhalte, und der folgende Pull-Versuch bekommt korrekt 403. Zu beheben, falls das je zum Problem wird: `subscribe` bei jedem `todo_list.member_removed`/„left"-Event neu anstoßen, statt nur beim Verbindungsaufbau.

**7.7 `requireList` antwortet vor der Rechteprüfung. Bekannte Inkonsistenz.** Die Sharing-Routen rufen `requireList` (404, wenn keine `synced_lists`-Zeile existiert) vor `RequireOwner` (403). Wer eine fremde UUID rät, unterscheidet damit „kennt der Server nicht" von „kennt er, gehört dir nicht" — genau das Existenz-Orakel, das `GetHead` auf den Lesepfaden bewusst vermeidet (4.5). Vorbestehend, aber seit 4.2 minimal aussagekräftiger: Registry-Existenz fällt jetzt mit „beansprucht" zusammen. Die Behebung ist trivial (Reihenfolge tauschen bzw. beides auf 404 vereinheitlichen) und gehört zusammen mit dem `accessible`-Signal aus 4.5 angefasst, damit die Antwortsemantik über alle Pfade dieselbe ist. Nebenbei: `RevokeInvite` ruft als einziger Sharing-Pfad gar kein `requireList` — funktional folgenlos, weil die Owner-Prüfung greift, aber dieselbe Inkonsistenz von der anderen Seite.

**7.8 Die Down-Migrationen sind Attrappen.** `Migrate` globbt ausschließlich `*.up.sql`; kein Code führt je ein Down aus, und getestet sind sie nur gegen eine leere Datenbank. Mit Daten löscht das Down von `00007` sämtliche `list_members`/`list_invites` — und Zugriffsdaten sind das Einzige in diesem System, was sich *nicht* aus dem Log ableiten lässt, während der Down-Kommentar von `00009` („nichts geht verloren, was nicht aus dem Log ableitbar wäre") genau das Gegenteil suggeriert. Solange es keine echten Nutzerdaten gibt, ist das folgenlos; vor dem ersten echten Rollback ist es das nicht.

## 8. Bewusst nicht gebaut

- **Direkteinladung an eine Person / Freundesliste.** Nur mehrfach nutzbare Links.
- **Mitglieder entfernen (Kick).** Nur Selbst-Verlassen.
- **Ownership übertragen.**
- **Echte kausale Ordnung (Vektoruhren).** Der Rebase auf seq reicht für diese App-Klasse. Der Preis: ein lange offline gewesenes Gerät landet mit seinen Events hinter allem, was der Server zwischenzeitlich bekommen hat.
- **Irgendetwas serverseitig projizieren.** Früher stand hier nur `ingredient.*`; inzwischen gilt es für beide Loghälften. Der Server relayt und speichert, er interpretiert nicht (R2). Eine Projektion in Go wäre eine zweite Implementierung derselben Logik mit der Pflicht, dass beide dauerhaft übereinstimmen — und genau der Pfad, an dem jeder gefundene Randfall einen weiteren Konsistenzmechanismus nachgezogen hat.

### 8.1 Was Content-Blindheit *nicht* verbaut

Der Verzicht auf serverseitigen Inhalt klingt nach einer Einschränkung für künftige Features. Geprüft:

- **Discovery nach Neuinstallation:** nicht blockiert. Registry und `list_members` liefern die Listen-IDs des Nutzers, der Voll-Pull ab `seq 0` liefert Namen und Inhalt aus dem Log. „Der Server kennt keine Namen" liest sich wie ein Blocker und ist keiner.
- **Push-Notifications:** nicht blockiert, content-blind sogar die bessere Variante — ein inhaltsleerer „Liste X geändert"-Ping, das Gerät pullt und rendert lokal. Nur „Anna hat Milch hinzugefügt" *im Benachrichtigungstext* bräuchte Serverinhalt, und das ist eine Privacy-Entscheidung, keine technische.
- **Web-Client:** nicht blockiert. Er replayt das Log im Browser und nutzt dieselben TS-Projektionen.
- **E2E-Verschlüsselung:** durch die Content-Blindheit überhaupt erst möglich. Einzige Sperre wäre semantische Payload-Validierung — siehe R2.

### 8.2 Die nächste offene Architekturfrage: Log-Kompaktierung

Die einzige echte Lücke. `ingredient.updated` pro Häkchen wächst unbegrenzt, und der Voll-Pull nach einer Neuinstallation wird dauerhaft langsamer. Eine content-blinde Antwort existiert — der Client liefert einen Snapshot-Blob bei `seq N`, der Server verwirft darunter, analog zu git-Packfiles und `gc` —, aber sie berührt 6.2 (die Terminalität von `deleted_at` hängt an der vollständigen Historie) und die Rebuild-aus-voller-Historie-Annahme des Frontends insgesamt. Bewusst nicht Teil des Log-Umbaus; hier notiert, damit sie nicht als Überraschung auftaucht.
