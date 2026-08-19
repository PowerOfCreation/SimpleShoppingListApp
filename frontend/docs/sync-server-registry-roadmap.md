# Server als Log statt Projektion: Roadmap

Dieses Dokument ist eine **Umsetzungs-Roadmap** — der Weg von der heutigen Backend-Architektur zu
einem Zielzustand, in dem der Server Listeninhalt nur noch speichert und weiterreicht, statt ihn zu
interpretieren. Es ergänzt, ersetzt aber nicht [`sync-sharing-target.md`](./sync-sharing-target.md)
(die Spezifikation, was gelten soll) und [`sync-design-decisions.md`](./sync-design-decisions.md)
(das Entscheidungsprotokoll, warum etwas so ist). Bei Widerspruch gewinnt weiterhin
`sync-sharing-target.md`; dieses Dokument beschreibt nur den Weg dorthin und wird nach Abschluss
jedes Schritts in die dortigen Abschnitte eingearbeitet (siehe Schritt 5).

**Für wen:** jeder Schritt unten ist so geschnitten, dass er einzeln — von einer anderen Person oder
einem anderen Agent, ohne Vorwissen aus diesem Dokument hinaus — umgesetzt werden kann. Reihenfolge
ist verbindlich (siehe Risiken), Umfang pro Schritt ist es nicht: ein Schritt kann in mehrere PRs
zerlegt werden, solange die Reihenfolge zwischen den Schritten erhalten bleibt.

## Auslöser

Review von PR #247 (`fix(backend): don't retry permanently undeliverable events forever`) fand
einen Regress: ein dauerhaft ungültiges Event (z. B. leerer Listenname) bekommt seitdem ein `seq`
und wird damit an **alle** anderen Geräte der Liste ausgeliefert, wo
`ingredient-list-projection.ts` es ohne jede Validierung anwendet. Der Fix hat den
Endlos-Retry-Loop beseitigt und dafür Fehlerausbreitung eingetauscht.

Das ist kein Einzelfall, sondern ein wiederkehrendes Muster:

| PR | Fix | Mechanismus, den er hinzufügt |
| --- | --- | --- |
| #243 | Unauthentifizierte Listen-CRUD-Routen entfernt | — |
| #244 | `todo_lists` ist Projektion, nicht Autorität | `ON CONFLICT ... WHERE deleted_at IS NULL`-Guards |
| #248 | `seq` bei Insert statt bei `MarkProcessed` | `last_applied_seq`-Watermark je Aggregat |
| #247 | Kein Endlos-Retry bei dauerhaft ungültigen Events | `interfaces.ErrPermanent` |

Jeder Fix ist für sich korrekt und gut begründet. Zusammengenommen ergeben sie ein Muster: der
serverseitige Content-Projektionspfad (`todo_lists`) bekommt bei jedem neu gefundenen Randfall einen
weiteren Mechanismus, der ihn konsistent hält. `ingredient.*` — relay-only seit jeher (siehe
`sync-sharing-target.md` §8) — hat in derselben Zeit keinen einzigen dieser Bugs produziert. Beide
Hälften laufen über dasselbe Log, denselben Transport, denselben Ingestor; der einzige Unterschied
ist, ob der Server hineinsieht. Das ist ein natürliches Experiment im selben Codebase, kein
ästhetisches Argument.

## Diagnose

Der Server behandelt `todo_list.*`-Events als **Kommandos, die er ausführt** (asynchron, können
fehlschlagen, werden wiederholt) statt als **Fakten, die er speichert** (synchron annehmen oder
ablehnen, danach unveränderlich). Drei Symptome:

1. **Entscheidungen, die synchron und autoritativ sein müssen, stecken in einem Background-Worker.**
   `EventIngestor` läuft ohne HTTP-Request-Context; ein Handler-Fehler dort kann nur „ewig retryen"
   oder „Müll schlucken" — `ErrPermanent` ist die Wahl zwischen beiden, kein Fix. `sync-sharing-target.md`
   §7.1 beschreibt exakt dasselbe Problem für Autorisierung, und PR #249
   (`feat/backend-user-scoping`) löst es dort bereits richtig: synchron im Push-Handler.
2. **Der Server hält eine Content-Projektion, für die er nicht autoritativ ist und die er nicht
   einmal rebuilden kann** (`sync-sharing-target.md` §6.1). Nur dieser Pfad kann fehlschlagen.
   Gelesen wird sie nach #249 nur noch für *ein Boolean* (`requireList`) und *einen String*
   (`list.Name` in der Redeem-Response).
3. **Die Regel „der Server interpretiert nicht" hat heute eine Ausnahme von der Größe der anderen
   Loghälfte.** §8 schreibt fest, dass `ingredient.*` nie serverseitig projiziert wird; `todo_list.*`
   wird es. Das ist keine Regel, das ist ein Sonderfall mit Begründung. Nach dem Umbau interpretiert
   der Server *nichts* — das ist das eigentliche Anti-Flickenteppich-Argument, stärker als die
   Bugliste darüber.

## Zielbild: append-only Log pro Liste mit einer geschützten Ref

Ein bare Repo hat keinen Working Tree — genau den betreibt der Server heute für `todo_lists`, und
der Checkout kann fehlschlagen und dadurch den Push blockieren.

| git | hier |
| --- | --- |
| Object Database, unveränderlich | `events` |
| `fsck` beim Receive — **Struktur**, nie Semantik → Push abgelehnt | Envelope-/JSON-Strukturprüfung in `POST /events` → 400 |
| pre-receive hook / branch protection — Rechte am **Repo/Ref**, nie am Commit-*Inhalt* | `ListAccessService.AuthorizeWrite` → 403 (PR #249) |
| Ref (`refs/heads/main`) — zeigt auf die Spitze, Update ist die Push-Bestätigung | `synced_lists.head_seq` — Row-Lock, `seq`-Vergabe, Ack |
| Working Tree / Checkout — abgeleitet, jederzeit neu baubar | Frontend-Projektionen |
| bare Repo hat *keinen* Working Tree | Server hat **keine** `todo_lists`-Content-Projektion |

**Zielbild in einem Satz, per grep falsifizierbar:** *Der Server ist ein append-only Log pro Liste
mit einer zugriffsgeschützten Ref. Er parst niemals einen Payload.* Verletzung = jedes
`json.Unmarshal` oder `payload ->>` auf `payload` im Backend außerhalb von Migrationen.

Berechtigungen bleiben dabei so scharf wie heute — git prüft die auch, nur am Receive-Boundary, auf
Repo/Ref-Ebene, synchron, **nie** durch Interpretation des Commit-Inhalts. Das ist dieselbe Trennung,
die `sync-sharing-target.md` §2 („die drei Wahrheiten") bereits festschreibt: *Zugriff* gehört
relational dem Server, *Inhalt* dem Log.

## Vier neue Invarianten (für §6, siehe Schritt 5)

**R1 — Annahme ist synchron und endgültig.** Alles, was zu einem Event „nein" sagen kann, passiert im
Push-Handler: Auth (403), Struktur (400). Ab dem Moment, in dem ein Event angenommen ist, ist es ein
Fakt — kein nachgelagerter Schritt darf es mehr ablehnen. `ErrPermanent` entfällt ersatzlos: die
Unterscheidung permanent/transient existiert nur, weil an der falschen Stelle validiert wird.

**R2 — Der Server liest nie in einen Payload.** Weder für `todo_list.*` noch für `ingredient.*`. Die
Strukturprüfung endet am Envelope plus „ist syntaktisch JSON".

**R3 — Die Registry-Zeile ist die Ref.** Existenz und `head_seq` beantworten „kennt der Server diese
Liste" und „wo steht sie" ohne jeden Inhalt. Nicht die Existenz einer Content-Zeile.

**R4 — Projektionen sind total.** Kein Event darf eine Projektion werfen lassen. Unlesbar oder
unvollständig heißt übersprungen, gezählt, diagnostizierbar. Gilt für beide Seiten; wirksam ist die
Invariante im Client, weil dort der letzte Interpret sitzt.

## Warum keine semantische Payload-Validierung am Push

Die naheliegende Sofortlösung für den Auslöser wäre, im Push-Handler pro Event-Typ zu validieren
(`json.Unmarshal` in den Zieltyp, `name != ""`). Das ist bewusst **nicht** Teil dieser Roadmap:

- Es ist Content-Interpretation an genau der Grenze, die R2 blind machen soll — der Interpreter
  wandert eine Schicht nach oben statt zu verschwinden. `git fsck` prüft, ob ein Objekt wohlgeformt
  ist und seine Referenzen auflösen; nie, ob die Commit-Message leer ist. Ein leerer Listenname ist
  Semantik.
- Es kostet Forward-Kompatibilität, und zwar teuer. Ein Validator pro Event-Typ muss unbekannte Typen
  ablehnen oder durchlassen. Lehnt er ab, bekommt ein neuerer Client von einem älteren Server 400 →
  `sync-client.ts` (`nonRetryableError`) → `sync-engine.ts::sendGroup` → `giveUpOnGroup`
  **schaltet Sync für die ganze Liste auf diesem Gerät ab** und canceled ihre Outbox-Zeilen. Ein
  neuer Event-Typ killt dann nicht ein Event, sondern die Synchronisation der Liste. Lässt er durch,
  ist „kein ungültiger Payload kommt je ins Log" falsch und der Client braucht R4 ohnehin. Eine
  dritte Option gibt es nicht. Das heutige Verhalten (`EventDispatcher` no-opt bewusst auf unbekannte
  Typen) ist besser als das, was eine solche Validierung daraus machen würde.
- Sie repariert den Auslöser gar nicht (siehe Schritt 1): der ungültige Payload, der heute schon im
  Log liegt, und der Payload eines neueren Clients bleiben unberührt.
- Prüfstein für „ein Ganzes oder ein Flickenteppich": **könnte man die Payloads morgen
  verschlüsseln?** Mit Relay + Registry + Membership ja, nichts bricht. Mit semantischer Validierung
  konstruktiv nein.

## Widerspruchsprüfung gegen den heutigen Code

Jeder Konsument von `todo_lists` und jede betroffene Invariante aus `sync-sharing-target.md`,
geprüft am Stand von PR #249 (`feat/backend-user-scoping`, Basis `origin/main`):

| Betroffen | Befund |
| --- | --- |
| `requireList` (`list-sharing-service.go`) — einziger `todo_lists`-Leser außer den Handlern | Auf #249 folgt direkt danach `access.RequireOwner`. Ownership wird beim Push geclaimt, jede dem Server bekannte Liste hat also eine `list_members`-Owner-Zeile → Registry beantwortet dasselbe. Kein Verlust. |
| `list.Name` in der Redeem-Response | Einziger echter Content-Read. **Entscheidung: entfällt** — §4.3 sagt ohnehin, der Client legt die Liste danach per Voll-Pull an. |
| §6.2 „`deleted_at` ist terminal" | Hält. `event-applier.ts` (`rebuildListProjections`) prüft `history.some(e => e.event_type === TODO_LIST_DELETED)` — reihenfolgeunabhängig, hängt an keinem Server-Zustand. **Aber:** die Prüfung läuft über die *vollständige* Historie und hält nur, solange der Client sein Log nie kompaktiert. Als explizite Abhängigkeit in §6.2 notieren, nicht als Zufall stehen lassen. |
| §6.1 Backend-Rebuild-Lücke + `sweepUnprocessed`-Reordering | Löst sich auf: ohne Projektion nichts zu rebuilden, kein fehlschlagender Dispatch, der nachgeholt werden müsste. |
| §6.3 „Kein Schreibweg in `todo_lists` außer über den Event-Log" | Löst sich auf — die Tabelle verschwindet. |
| §6.4 „`seq` hat genau einen Writer" | Bleibt clientseitig gültig; serverseitig wird der Writer die Ref-Zeile statt der Ingestor-Goroutine (Schritt 3). |
| §6.8 „Jedes Event bekommt genau einmal ein `seq`" | Wird trivial wahr statt durch `ErrPermanent` erzwungen. |
| §7.1 „Enforcement-Zeitpunkt" (woher kommt der Owner beim Ingest) | Durch #249 bereits gelöst (Claim beim Push, synchron, mit Request-Context). |
| §7.2 Ownership-Squatting | Durch #249 bereits gelöst (`claim-on-first-invite` entfernt). |
| §7.5 Tombstone-Squatting | **Verschwindet zusätzlich** — ohne Tombstone-Upsert nichts zu squatten. |
| §4.5 / §5 „unbekannt vs. bekannt-aber-leer" | **Wird gelöst statt gebrochen:** Registry-Zeile fehlt = unbekannt, Zeile mit `head_seq = 0` = bekannt und leer. Genau das Signal, das `DELETE .../sync` laut §5 heute blockiert. |
| FKs `list_invites`/`list_members` → `todo_lists` (Migration 00005) | In `00007` bereits gedroppt. Schritt 2 baut sie gegen `synced_lists` wieder auf — bewusster Rückbau, kein Churn. |
| `todos`-Tabelle (FK auf `todo_lists`, Migration 00001) | Verifiziert toter Code — kein Service/Controller referenziert sie. §4.4 verlangt ohnehin ihre Entfernung vor `DELETE .../sync`. Wird mitgelöscht. |
| `last_applied_seq` (PR #248) | Existiert nur, um die Content-Projektion vor Out-of-order-Apply zu schützen. Entfällt komplett in Schritt 3 — nicht „einsortieren", sondern entfernen. |

**Ergebnis: kein Widerspruch.** Der Umbau löst zusätzlich §7.5 und den §4.5-Blocker; §6.2, die
einzige Invariante mit echtem Risiko, ist clientseitig abgesichert — unter der oben notierten
Bedingung.

## Bedrohungsanalyse: bösartige Clients

Geprüft am Stand von PR #249. Der Umbau verschlechtert keinen dieser Punkte, schließt zwei
bestehende Lücken zusätzlich mit:

| Angriff | Status heute (#249) | Wirkung des Umbaus |
| --- | --- | --- |
| Auf fremde Listen schreiben | Dicht — `AuthorizeWrite` synchron im Push-Handler, ganze Batch fail-closed | unverändert |
| Fremde Listen ziehen | Dicht — `GetEvents`→`RequireRead` (403), `GetHead`/Reconcile→`FilterAccessible` | unverändert |
| Fremde Notifications/Acks abgreifen | Dicht — WS-Identität aus verifiziertem JWT, nicht aus `client_id`-Query-Param; `hub.subscribe` filtert per `FilterAccessible` | unverändert |
| Gefälschte `occurred_at`-Zeitstempel | Entschärft per Design (§6.7: untrusted, nie Grundlage für Ordnung/Autorisierung — `seq` ordnet) | unverändert |
| Ungültige Payloads (leerer Name, kaputtes JSON) | **Offen** — der Auslöser-Regress: angenommen, `seq` vergeben, an alle Mitglieder relayt, dort ungeprüft angewendet | **geschlossen durch Schritt 1** (Client überspringt statt zu brechen). Kaputtes JSON zusätzlich in Schritt 2 (400). Ein leerer Name bleibt bewusst annehmbar — der Server ist blind, der Client hält es aus. |
| Envelope/Payload-Divergenz (`list_id` im Envelope ≠ `listId` im Payload) | **Offen, vorbestehend.** Autorisiert wird über `list_id` im Envelope, aber `ingredient-projection.ts` schreibt `ingredients.list_id` aus dem **Payload**. Ein Mitglied von Liste Y kann `ingredient.created` mit Envelope-`list_id=Y` (erlaubt) und Payload-`listId=X` pushen — bei Y-Mitgliedern erscheint der Eintrag lokal in Liste X | **geschlossen durch Schritt 1**: die Projektion nimmt das Envelope-Feld, das Payload-Feld wird ignoriert. Die Divergenz wird nicht geprüft, sondern nicht darstellbar. |
| Ownership-Squatting auf unbekannte UUID | Rest-Risiko, nicht durch diese Roadmap verursacht. UUIDv4 raten ist praktisch ausgeschlossen; reales Fenster ist Entsyncen→Neu-Syncen | §7.5 entfällt zusätzlich |
| `event_id`-Kollision | Rest-Risiko. Insert ist ON-CONFLICT-No-op; setzt Insider-Zugriff auf dieselbe Liste voraus (Mitglieder sind per Produktdesign vertrauenswürdig, §3) | unverändert |
| Payload-Bombe (riesiges Event) | **Offen** — keine Größengrenze | **geschlossen durch Schritt 2** (Limit pro Event und pro Batch) |

**Multi-Device:** unproblematisch, unverändert. `list_members` ist auf `(list_id, user_id)`
geschlüsselt — alle Geräte einer Person teilen die Mitgliedschaft.

## Zukunftsanforderungen gegen den Zielzustand

Content-Blindheit klingt wie ein Verzicht. Geprüft, was sie tatsächlich verbaut:

| Anforderung | Blockiert? |
| --- | --- |
| **Discovery nach Neuinstallation** (§8 heute „nicht gebaut") | **Nein.** Registry + `list_members` liefern die Listen-IDs des Nutzers; der Voll-Pull ab `seq 0` liefert Namen und Inhalt aus dem Log. „Der Server kennt keine Namen" liest sich wie ein Blocker und ist keiner. |
| **Push-Notifications** | **Nein**, content-blind ist sogar die bessere Variante: inhaltsleerer „Liste X geändert"-Ping, das Gerät pullt und rendert lokal. Nur „Anna hat Milch hinzugefügt" *im Notification-Text* bräuchte Serverinhalt — eine Privacy-Entscheidung, keine technische. |
| **Web-Client** | **Nein.** Replayt das Log im Browser und nutzt die vorhandenen TS-Projektionen wieder. |
| **E2E-Verschlüsselung** | **Nein — der Umbau macht sie erst möglich.** Der größte Gewinn dieser Roadmap. Einzige Sperre wäre semantische Payload-Validierung (siehe oben). |
| **Log-Kompaktierung / Snapshots** | **Die einzige echte Lücke.** `ingredient.updated` pro Häkchen wächst unbegrenzt, und der Voll-Pull nach Neuinstallation wird dauerhaft langsamer. Die content-blinde Antwort existiert (Client liefert einen Snapshot-Blob bei `seq N`, Server verwirft darunter — git-Packfile/`gc`), berührt aber §6.2 und die „Rebuild aus voller Historie"-Annahme des Frontends. **Nicht Teil dieses Umbaus, aber die nächste offene Architekturfrage** — gehört als solche in §8, damit sie nicht als Überraschung auftaucht. |

## Umsetzung

### Schritt 0 — Voraussetzung: PR #249 mergen

`feat/backend-user-scoping` liefert synchrone Auth im Push-Handler, `events.user_id` und
`list_members` als Registry-Grundlage. Kein Teil dieser Roadmap ändert daran etwas.

### Schritt 1 — Client härten (R4)

Das ist der Fix für den auslösenden Regress. Er hält unabhängig davon, was der Server tut, und ist
die einzige Abwehr, die noch trägt, wenn der Server per Design blind ist.

Der heutige Pfad ist schlimmer als ein leerer Name: `ingredient-list-projection.ts` macht
`JSON.parse(event.payload)` ungeschützt. Malformter Payload → throw → aus `rebuildForList` → aus der
Transaktion in `EventApplier.apply` → gefangen, `Result.fail` → `sync-engine.ts::pullListToHead`
(der private Helper, den `pullList` nur aufruft) loggt und
`return`t, **ohne den Cursor zu setzen**. Der nächste Pull holt dieselbe Seite und scheitert
identisch. Diese Liste synchronisiert auf diesem Gerät nie wieder — eine Logzeile, kein
Nutzer-Signal, keine Selbstheilung.

- [ ] `frontend/database/ingredient-list-projection.ts` und `frontend/database/ingredient-projection.ts`:
      Payload-Parsen pro Event in `try`/`catch`. Unlesbares oder unvollständiges Event →
      überspringen, `logger.warn`, zählen; nie werfen. Betrifft alle `handle*`-Methoden und die
      Schleifen in `rebuildForList`/`rebuild`.
- [ ] `ingredient-projection.ts`: `listId` aus `event.list_id` (Envelope) statt aus dem Payload.
      `DomainEventRow.list_id` existiert bereits (`types/DomainEvent.ts`).
- [ ] Übersprungene Events an den vorhandenen Reparaturpfad melden (`SyncEngine.repairList`, #230),
      damit der Fall sichtbar statt still ist.
- [ ] Test: Event mit kaputtem JSON mitten in einer Seite → Rebuild läuft durch, restliche Events
      angewendet, Cursor rückt vor, Liste synchronisiert weiter. Das ist der Beweis, dass der
      Poison-Pill-Pfad zu ist.
- [ ] Test: `ingredient.created` mit Envelope-`list_id=Y`/Payload-`listId=X` → Eintrag landet in Y.

### Schritt 2 — Annahmegrenze härten, strukturell (R1, R2)

In `backend/internal/interface/api/rest/event-controller.go`, direkt neben `AuthorizeWrite`:

- [ ] `list_id`, `event_id`, `aggregate_id` vorhanden und UUID-förmig (`distinctListIDs` deckt
      `list_id` bereits ab).
- [ ] `aggregate_id == list_id` für `todo_list.*` — Adressierung, nicht Inhalt.
- [ ] `payload` ist syntaktisch valides JSON (`json.Valid`, **kein** `Unmarshal` in einen Zieltyp).
- [ ] Größenobergrenze pro Event und pro Batch.
- [ ] **Keine** semantischen Feldprüfungen, **keine** Ablehnung unbekannter Event-Typen (siehe oben).
- [ ] Ungültig → 400, ganze Batch abgelehnt (analog zur bestehenden All-or-nothing-Semantik von
      `distinctListIDs`/`AuthorizeWrite`).
- [ ] Frontend: keine Änderung nötig — der lokale Schreibpfad (`shopping-list-service.tsx`) validiert
      bereits vor dem Enqueue.

**`ErrPermanent` bleibt in diesem Schritt stehen** — es gehört in Schritt 3. Grund: die strukturelle
Validierung lässt einen leeren Listennamen bewusst durch (der Server ist blind). Das Event erreicht
also weiterhin `CreateToDoList`, scheitert dort an `NewValidatedToDoList` und wäre ohne `ErrPermanent`
wieder das, was PR #247 beseitigt hat: ein Event, das der Sweep alle 30 s erneut versucht, mit einer
Fehlerzeile pro Versuch, für immer. Erst wenn der Dispatch-Pfad in Schritt 3 verschwindet, gibt es
keinen Handler mehr, der dauerhaft „nein" sagen kann — dann entfällt der Mechanismus wirklich
ersatzlos statt einen Regress freizulegen.

### Schritt 3 — Registry als Ref + synchroner Append (R3, R1)

Der heutige `seq` ist **eine globale Sequenz** (`events_seq_seq`), aber jeder Lesepfad ist pro Liste
(`GetEventsSince`, `GetListHeads` filtern beide `list_id`). Ein globales Ordnungstoken macht also
Pro-Listen-Arbeit, und das Einzige, was seine Korrektheit trägt, ist „genau eine
`EventIngestor`-Goroutine in genau einem Prozess" (dokumentiert in `00006` und `event-ingestor.go` —
`00004`s eigener Kommentar dazu beschreibt noch den alten, seit `00006` selbst als historisch
markierten Mechanismus, der `seq` erst bei `MarkProcessed` statt bei `Insert` vergab).
Damit kann das Backend **nie mehr als eine Replik** fahren: Replik A zieht `seq` 10, B zieht 11 und
committet zuerst; ein Pull dazwischen sieht 11, setzt den Cursor auf 11 — Event 10 ist für diesen
Client dauerhaft unsichtbar. Die Projektion zu löschen und den Worker zu behalten würde diese Grenze
zementieren, obwohl sein Grund entfällt.

Die Lösung fällt aus der Registry heraus: **die Registry-Zeile ist die Ref.** Damit wird R1 zu Ende
gedacht — „Annahme synchron, Verarbeitung asynchron"; wenn keine Verarbeitung übrig ist, ist auch
nichts Asynchrones übrig.

Migration:

- [ ] `synced_lists (id UUID PRIMARY KEY, head_seq BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ)`
      — keine Content-Spalten. Backfill aus `events.list_id` ∪ `todo_lists.id`.
- [ ] `events.seq` pro Liste neu nummerieren
      (`row_number() OVER (PARTITION BY list_id ORDER BY seq)`), `head_seq` daraus setzen,
      `events_seq_seq` und `idx_events_seq` entfernen, `UNIQUE (list_id, seq)`.
- [ ] **Cursor-Entscheidung:** vorhandene Client-Cursor werden durch die Umnummerierung bedeutungslos.
      Der saubere Weg ist ein erzwungener Voll-Pull (Cursor zurücksetzen), nicht der Clamp-Down-Pfad
      in `sync-engine.ts` — der ist für „Server ist zurückgefallen" gebaut und könnte beim Renumbering
      Events überspringen. §7.1s Hinweis auf fehlende echte Nutzerdaten ist eine einmalige historische
      Notiz zur Backfill-Entscheidung von Migration `00007`, keine für den Zeitpunkt dieses Schritts
      weiterhin geltende Annahme — **unabhängig davon vor der Umsetzung erneut verifizieren, dass
      keine echten Nutzerdaten existieren.**
- [ ] FKs `list_invites.list_id`/`list_members.list_id` → `synced_lists(id)`, `ON DELETE CASCADE`
      (Rückbau der in `00007` gedroppten FKs, jetzt gegen den richtigen Parent).
- [ ] `todo_lists` und `todos` droppen, inkl. `last_applied_seq`.
- [ ] **Down-Migration bewusst als Schema-only-Rollback schreiben und so kommentieren.** Ab hier ist
      die Rückwärtskette fiktiv: `todo_lists` war eine Projektion ohne Rebuild-Mechanismus (§6.1), ein
      Down kann die Tabelle also wiederherstellen, aber nie ihren Inhalt. Das ist genau dann
      unproblematisch, wenn man es hinschreibt — die Projektion war nie autoritativ, es geht nichts
      verloren, was nicht aus dem Log ableitbar wäre. Beachten: `00007`s Down referenziert `todo_lists`
      und funktioniert nur, wenn die Kette in Reihenfolge zurückgefahren wird.

Code:

- [ ] `POST /api/v1/events` wird synchron: eine Transaktion pro Liste — `SELECT ... FOR UPDATE` auf
      `synced_lists` (Insert-on-missing), Events mit `head_seq+1..+n` einfügen (`ON CONFLICT (id)`
      behält die alte `seq` für Redelivery), `head_seq` setzen, committen. Response trägt die
      vergebenen `seq`-Werte. **Korrektur:** ursprünglich war hier vorgesehen, diesen Schritt in
      derselben Transaktion wie der Owner-Claim aus `ListAccessService.AuthorizeWrite` laufen zu
      lassen — dafür gibt es aber keine Schnittstelle: `AuthorizeWrite` nimmt nur einen
      `context.Context`, keinen transaktionsgebundenen Querier, den sich diese Transaktion hier
      einhängen könnte. Nötig ist das auch nicht mehr: `ClaimListOwnership`s CTE (siehe „Registry als
      Ref" oben) legt Registry- und Owner-Zeile bereits atomar in einem Statement an, bevor der Push
      diesen Schritt überhaupt erreicht. Schlägt der Append danach fehl, bleibt höchstens eine gültige,
      inhaltsleere Registry-Zeile (`head_seq = 0`) stehen — keine Drift im Sinne der drei Wahrheiten
      aus §2, da Owner und Registry-Existenz weiterhin übereinstimmen.
- [ ] Löschen: `interfaces/permanent-error.go`, der `ErrPermanent`-Zweig in `event-ingestor.go::apply`
      und die `Permanent(...)`-Wraps in `todo-list-service.go` und den Event-Handlern (aus Schritt 2
      hierher verschoben, siehe dort).
- [ ] Löschen: `EventIngestor`-Queue/Sweep, `processed_at`/`FindUnprocessed`/`MarkProcessed`,
      `EventDispatcher`, `create/update/delete-todo-list-event-handler.go`, `todo-list-service.go`,
      `interfaces.ToDoListService`, `repositories.ToDoListRepository`,
      `postgres/sqlc_todo-list-repository.go`, `entities/todo-list.go`,
      `entities/validated-todo-list.go`, `sql/queries/todo-lists.sql`, `sql/queries/todos.sql` +
      zugehörige Tests und die `main.go`-Verdrahtung.
- [ ] `requireList` in `list-sharing-service.go` liest `synced_lists`.
- [ ] `GetListHeads` liest `synced_lists.head_seq`.
- [ ] **Kein Existenz-Signal in der Head-Response.** Ursprünglich war hier ein explizites „Liste
      unbekannt" geplant, um den §4.5/§5-Blocker zu lösen. Das ist falsch: `GetHead` macht
      „unbekannt" und „nicht zugänglich" *absichtlich* ununterscheidbar, damit der Pfad kein
      Existenz-Orakel für geratene fremde UUIDs wird (Kommentar in `sync-pull-controller.go`). Das
      Signal, das §4.5 wirklich braucht, ist ohnehin ein anderes: nicht „kennt der Server die Liste",
      sondern „bin *ich* noch Mitglied" — nach einem Entsync nimmt das Cascade die Mitgliedszeile
      mit, und Verlassen (§4.6) sowie Entfernt-werden verlangen dieselbe lokale Reaktion. Eine
      Pro-Liste-`accessible`-Angabe beantwortet das, ohne irgendetwas über fremde Listen zu verraten
      (nicht-existent und existiert-aber-nicht-deine liefern beide `false`). Gehört zu
      `DELETE .../sync`, nicht in diesen Umbau.
- [ ] `RedeemListInviteCommandResult.ListName` entfernen (inkl. Response-DTO).
- [ ] **Folge, die dokumentiert werden muss:** `requireList` prüft danach die Registry statt
      `todo_lists`, und die Registry hat kein `deleted_at`. Die heutige Prüfung „eine gelöschte Liste
      kann man nicht beitreten" entfällt damit ersatzlos — der Server kann sie nach R2 gar nicht
      haben, sie wäre Inhaltsinterpretation. Redeem auf eine gelöschte Liste gelingt serverseitig;
      der Client stellt die Löschung beim ersten Voll-Pull fest, wenn er aus der Historie rebuildet,
      und verwirft die Liste lokal. Kein Datenverlust, nur ein wirkungsloser Beitritt.
- [ ] **Folgeentscheidung, eigener PR:** Der WS-Ack für *eigene* Events wird durch die synchrone
      Response überflüssig; die Listen-Notification an *andere* Geräte bleibt nötig. Der Hub behält
      also `PublishListEvent`, während `PublishAck` und der clientseitige Ack-Pfad (`sync-socket.ts`,
      Outbox-`synced`-Markierung) entfallen können.

### Schritt 4 — Verifikation

- [ ] `cd backend && go build ./... && go vet ./... && go test ./...` (Docker muss laufen —
      testcontainers).
- [ ] Migrationstest analog `migration_00006_test.go`/`migration_00007_test.go`: Registry-Backfill,
      ordnungserhaltendes Pro-Listen-Renumbering, Invites/Members überleben, FKs greifen.
- [ ] Test: `todo_list.created` mit gültigem Payload → 2xx mit `seq`, taucht unverändert im Pull eines
      zweiten Clients auf (Relay-Round-Trip ohne Interpretation).
- [ ] Test: unbekannter Event-Typ mit validem Envelope → **akzeptiert und relayt** (Forward-Compat).
- [ ] Test: leerer Name → **akzeptiert** (der Server ist blind); der Client-Test aus Schritt 1 zeigt,
      dass kein Gerät daran hängenbleibt.
- [ ] Test: kaputtes JSON im Payload → 400, Event danach weder in `events` noch über
      `GET /sync/events` sichtbar.
- [ ] Nebenläufigkeitstest: zwei parallele Pushes auf dieselbe Liste → lückenlose, eindeutige `seq`.
      Dieser Test ist heute nicht schreibbar, weil die Garantie am Single-Process hängt.
- [ ] `cd frontend && pnpm test && pnpm lint`.
- [ ] Manuell: zwei Geräte, Liste offline umbenennen → Sync → Name propagiert; danach handgebautes
      `curl` mit kaputtem JSON → 400, und eines mit leerem Namen → akzeptiert, beide Geräte bleiben
      synchronisierbar.

### Schritt 5 — Doku nachziehen

- [ ] `sync-sharing-target.md`: §2-Tabelle, §4.2 („ist synchronisiert" = Registry-Zeile), §4.4, §4.5,
      §5, §6.1, §6.2 (inkl. Kompaktierungs-Abhängigkeit), §6.3, §6.4, §6.8, §7.5, §8 aktualisieren;
      R1–R4 als neue Invarianten übernehmen. §8 ergänzen: Discovery, Push-Notifications und
      Web-Client sind durch Content-Blindheit **nicht** blockiert; Log-Kompaktierung ist die nächste
      offene Architekturfrage.
- [ ] `AGENTS.md`: „Validated types", „Soft deletes", die „Events"-Zeile (`EventDispatcher` existiert
      nicht mehr, siehe „Was danach verschwindet") und der Sync-Abschnitt auf den neuen Stand
      (`todo_lists` existiert nicht mehr, Push ist synchron, `seq` ist pro Liste).
- [ ] Dieses Dokument entweder löschen oder als „umgesetzt" markieren, sobald Schritt 1–4 gemergt
      sind — sein Inhalt lebt danach in `sync-sharing-target.md` weiter.

## Was danach verschwindet

`ErrPermanent` · permanent-vs-transient-Klassifikation · `EventDispatcher` · alle drei
`todo_list.*`-Handler · `ToDoListService` · `ToDoListRepository` · `entities/todo-list.go` +
`validated-todo-list.go` · `last_applied_seq` · `processed_at` / `FindUnprocessed` / `MarkProcessed` ·
Ingestor-Queue + Sweep · Tombstone-Upsert · §7.5 Tombstone-Squatting · die serverseitige
Forward-vs-Rebuild-Lücke aus §6.1 · das globale `events_seq_seq` · die Single-Replica-Grenze · zwei
Tabellen (`todo_lists`, `todos`) · der Poison-Pill-Pfad im Client-Pull.

## Risiken

- **Schritt 3 ist eine destruktive Migration** (zwei Tabellen droppen, FKs umhängen, `seq`
  umnummerieren). §7.1s „keine echten Nutzerdaten" ist nur eine historische Notiz zu Migration `00007`,
  keine Zusicherung für heute — vor der Umsetzung eigenständig verifizieren, sonst ist die
  Cursor-Frage kein Detail mehr.
- **Reihenfolge ist bindend, aber anders als naheliegend:** Schritt 1 (Client) kommt vor allem
  anderen. Er blockiert nichts und ist die einzige Abwehr, die wirklich hält. Das oft genannte
  Gegenargument — „ohne Serverprüfung entsteht ein Fenster, in dem ungültige Payloads ungeprüft
  relayt werden" — beschreibt den Ist-Zustand: seit #247/#248 bekommt ein ungültiges Event sein `seq`
  und wird relayt, unabhängig vom Handler-Ergebnis. Schritt 3 verbreitert dieses Fenster nicht.
- Schritt 2 kann direkt nach #249 mergen — aber nur, solange er auf die strukturelle Validierung
  beschränkt bleibt. Nimmt man die `ErrPermanent`-Löschung mit hinein, ist er kein reiner Zugewinn
  mehr, sondern legt den Regress aus #247 wieder frei (siehe Schritt 2).
- **Schritt 3 ist größer als eine reine Projektions-Löschung.** Er darf in mehrere PRs zerfallen
  (Registry + FKs / synchroner Append + `seq`-Renumbering / Löschungen / Ack-Pfad), solange die
  Reihenfolge zwischen den Schritten steht.
