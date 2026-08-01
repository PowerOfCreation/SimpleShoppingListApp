# Sync: wichtige Entscheidungen

Kurzreferenz zu den nicht-offensichtlichen Entscheidungen aus der Listen-Sync-Implementierung (`api/sync/`, `database/outbox-repository.ts`, `backend/internal/application/services/event-ingestor.go`, `backend/internal/infrastructure/realtime/`).

## Client-ID vs. Keycloak-Identität

**`client_id`** (`api/common/client-id.ts`) ist **keine** separat erzeugte, persistierte Geräte-ID mehr. Eine frühere Version schrieb beim allerersten App-Start eine Zufalls-UUID nach `app_preferences`; das ist entfernt. Stattdessen liefert `getClientId()`:

- die **Keycloak-`sub`** (via `getCurrentUserId()` in `api/auth/auth-service.ts`, ein synchroner Cache der bei `login`/`restoreSession`/`logout` gepflegt wird), sobald ein Nutzer angemeldet ist;
- sonst den **`Device.deviceName`** (`expo-device`, Fallback `"unknown-device"`), rein für Lesbarkeit im lokalen Event-Log.

Zweck: (1) WebSocket-Ack-Routing (Server muss wissen, an welche Verbindung ein Ack geht), (2) Attribution auf `domain_events.client_id` ("wer hat das erzeugt").

**Warum zusammenlegen:** Sync läuft nur, wenn angemeldet (SyncProvider gated auf `signedIn`). In dem Moment, wo die ID überhaupt über eine lokale Attribution hinaus gebraucht wird, existiert immer eine Keycloak-`sub` — eine parallel generierte Zufalls-ID wäre überflüssiger Mechanismus. Dass mehrere Geräte desselben Accounts denselben Routing-Key teilen, ist harmlos (ein Ack für ein Event, das ein Gerät nicht in seiner Outbox hat, ist beim `markSynced` ein No-Op) und ist genau das, was ein künftiges "andere Geräte benachrichtigen"-Feature will. Zusätzlich ist die `sub` eine echte Identität statt einer unbeaufsichtigten Self-Declared-String (die alte `?client_id=` im Query-Param war komplett ungeprüft; später wird der Server das aus dem verifizierten Token statt aus dem Query-Param lesen).

**Zur eigentlichen Frage — App löschen + gleicher Keycloak-Account:** Das lässt sich mit client_id gar nicht lösen. Bei einer Neuinstallation ist die lokale SQLite-DB komplett leer — das ist korrekt so, das Gerät hat ja wirklich keine Daten mehr. Damit der Nutzer nach Neu-Login "seine" Listen wiederbekommt, braucht es einen **Pull-Sync** (Server → neues Gerät), den es noch nicht gibt (aktuell nur Push: Client → Server). Das ist explizit ein separates, größeres Feature (im Plan als "kein Server→Client-Sync" vermerkt), keine client_id-Frage.

**Dein Instinkt zu "keine Migration nötig" ist trotzdem genau richtig** — nur für das spätere User-Scoping-Feature, nicht für client_id. Wenn Nutzer-Zuordnung kommt: **kein** `user_id`-Feld lokal in SQLite, keine Migration. Der Server liest die Nutzer-Identität aus dem verifizierten JWT der eingehenden Sync-Anfrage und setzt `user_id` beim Insert von `todo_lists`/`events` selbst — nie vom Client mitgeliefert (sonst könnte man sich als anderer Nutzer ausgeben). Das passt exakt zu deiner Idee "wird automatisch die eigene ID gesetzt", nur dass das serverseitig beim Empfangen passiert, nicht clientseitig beim Laden aus der lokalen DB.

## Weitere Kernentscheidungen (kurz)

- **Kein persistierter "sent"-Zustand** in der Outbox — nur `pending`/`synced`. Ein "sent" ohne Ack hätte keinen Weg zurück. In-Flight wird nur im Speicher gehalten (App-Neustart macht alles wieder `pending`, harmlos dank `ON CONFLICT DO NOTHING`/Upsert serverseitig).
- **Ack-Modell:** 202 = "angenommen", **nicht** committed. Erst ein WebSocket-Ack (nach echtem DB-Write) markiert `synced`. Reconcile (`/api/v1/sync/state`) ist die Ausfallsicherung, wenn ein Ack verloren geht.
- **Backend-Reihenfolge:** Ein einziger Worker verarbeitet alle Events strikt FIFO (statt Upsert-Semantik in den Domain-Handlern). Dadurch kann pro Aggregat nichts in falscher Reihenfolge verarbeitet werden, ohne die geteilte `ToDoListService`-Logik anzufassen, die auch die normalen REST-Endpunkte nutzt.
- **WebSocket-Hub:** Verbindungen werden über Zeiger-Identität abgemeldet, nicht über die client_id als Schlüssel direkt — verhindert, dass ein Reconnect durch die verspätete Cleanup-Routine der alten (toten) Verbindung wieder gelöscht wird.
- **Sync-Toggle nur nutzbar wenn angemeldet** — abgemeldet ist der Schalter sichtbar, aber deaktiviert. Kein Zustand, den die App nicht einlösen kann.
- **Backend-URL** kommt aus `.env.development`/`.env.production` (nicht `Constants.expoConfig.extra`), weil das zur Bundle-Zeit fest verdrahtet wird und nicht davon abhängt, welcher Prozess gerade `app.config.js` ausgewertet hat.
- **Kein User-Scoping/JWT-Prüfung im Backend** — bewusst aufgeschoben. Jeder mit einer geratenen UUID kann aktuell Events schreiben/lesen. Muss vor Produktivbetrieb mit echten Nutzerdaten nachgezogen werden.
