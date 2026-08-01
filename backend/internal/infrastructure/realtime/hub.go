package realtime

import (
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// The client pings every 50s to keep the connection alive through
// firewalls/NATs. Pings are app-level JSON, not protocol frames, so
// SetPongHandler is never triggered - the read deadline is reset on every
// message received instead, with margin above the client's interval.
const (
	readDeadline  = 75 * time.Second
	writeDeadline = 10 * time.Second
)

// connection wraps one WebSocket. gorilla's *websocket.Conn does not
// support concurrent writes, so all writes go through writeJSON, which
// serializes on mu.
type connection struct {
	ws *websocket.Conn
	mu sync.Mutex
}

func newConnection(ws *websocket.Conn) *connection {
	return &connection{ws: ws}
}

func (c *connection) writeJSON(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.ws.SetWriteDeadline(time.Now().Add(writeDeadline))
	return c.ws.WriteJSON(v)
}

// Hub fans out acks (by client_id) and list-event notifications (by
// list_id, via subscribe) to connections.
//
// Deliberately not scoped by user (no auth/user-scoping exists yet - see
// the sync design doc): every ack is only ever meaningful to a client that
// already knows the event_id it's for, so broadcasting within a client_id
// is safe, and subscribing to a list_id requires already knowing that
// list's UUID - the same (missing) trust boundary as the REST endpoints,
// not a new one. Once user-scoping lands, both become user-scoped too.
//
// Client registration is keyed by client_id -> set of connections (not a
// single connection per client_id) and unregistration removes a specific
// connection by pointer identity. That distinction matters on reconnect:
// a client's old connection dying is detected only when its read loop's
// blocking read finally errors out, which can happen *after* a new
// connection for the same client_id has already registered. Deleting "the"
// entry for that client_id at that point would delete the new connection
// instead of the dead one. List subscriptions follow the same by-pointer
// discipline for the same reason.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*connection]struct{}
	// subscriptions maps list_id -> the connections subscribed to it.
	subscriptions map[uuid.UUID]map[*connection]struct{}
	// subscribedLists is the reverse index (per connection, which lists it
	// subscribed to) - needed so unregister/resubscribe can remove exactly
	// this connection's entries from `subscriptions` without scanning it.
	subscribedLists map[*connection]map[uuid.UUID]struct{}
}

func NewHub() *Hub {
	return &Hub{
		clients:         make(map[string]map[*connection]struct{}),
		subscriptions:   make(map[uuid.UUID]map[*connection]struct{}),
		subscribedLists: make(map[*connection]map[uuid.UUID]struct{}),
	}
}

func (h *Hub) register(clientID string, conn *connection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[clientID] == nil {
		h.clients[clientID] = make(map[*connection]struct{})
	}
	h.clients[clientID][conn] = struct{}{}
}

func (h *Hub) unregister(clientID string, conn *connection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	conns, ok := h.clients[clientID]
	if ok {
		delete(conns, conn)
		if len(conns) == 0 {
			delete(h.clients, clientID)
		}
	}
	h.unsubscribeAllLocked(conn)
}

// subscribe replaces (not accumulates) the set of lists this connection is
// subscribed to - the frontend resends its full sync-enabled list_ids
// whenever that set changes, and it must not accumulate hearing about a
// list it's since turned sync off for.
func (h *Hub) subscribe(conn *connection, listIDs []uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.unsubscribeAllLocked(conn)

	set := make(map[uuid.UUID]struct{}, len(listIDs))
	for _, listID := range listIDs {
		if h.subscriptions[listID] == nil {
			h.subscriptions[listID] = make(map[*connection]struct{})
		}
		h.subscriptions[listID][conn] = struct{}{}
		set[listID] = struct{}{}
	}
	h.subscribedLists[conn] = set
}

// unsubscribeAllLocked removes conn from every list it's currently
// subscribed to. Caller must hold h.mu.
func (h *Hub) unsubscribeAllLocked(conn *connection) {
	for listID := range h.subscribedLists[conn] {
		delete(h.subscriptions[listID], conn)
		if len(h.subscriptions[listID]) == 0 {
			delete(h.subscriptions, listID)
		}
	}
	delete(h.subscribedLists, conn)
}

func (h *Hub) connectionsFor(clientID string) []*connection {
	h.mu.RLock()
	defer h.mu.RUnlock()
	conns := h.clients[clientID]
	out := make([]*connection, 0, len(conns))
	for c := range conns {
		out = append(out, c)
	}
	return out
}

func (h *Hub) subscribersFor(listID uuid.UUID) []*connection {
	h.mu.RLock()
	defer h.mu.RUnlock()
	conns := h.subscriptions[listID]
	out := make([]*connection, 0, len(conns))
	for c := range conns {
		out = append(out, c)
	}
	return out
}

// PublishAck implements interfaces.AckPublisher. Best-effort: if no
// connection is registered for clientID (offline, or never connected),
// this is a silent no-op - the client's reconcile pass is the source of
// truth, not the ack.
func (h *Hub) PublishAck(clientID string, eventID uuid.UUID) {
	msg := map[string]string{"type": "ack", "event_id": eventID.String()}
	for _, conn := range h.connectionsFor(clientID) {
		if err := conn.writeJSON(msg); err != nil {
			log.Printf("realtime: failed to send ack to client %s: %v", clientID, err)
		}
	}
}

// PublishListEvent implements interfaces.ListEventPublisher. Best-effort,
// same as PublishAck: no subscriber is a silent no-op - a client's own
// periodic pull (and its next connect/foreground pull) is the fallback if
// this notification never arrives or is missed while disconnected.
func (h *Hub) PublishListEvent(listID uuid.UUID, seq int64) {
	msg := map[string]any{"type": "event", "list_id": listID.String(), "seq": seq}
	for _, conn := range h.subscribersFor(listID) {
		if err := conn.writeJSON(msg); err != nil {
			log.Printf("realtime: failed to send list event for %s: %v", listID, err)
		}
	}
}

// Serve registers the connection and blocks, running its read loop, until
// the connection closes. Meant to be called from the HTTP handler
// goroutine that performed the upgrade - it owns the connection for its
// entire lifetime.
func (h *Hub) Serve(clientID string, ws *websocket.Conn) {
	conn := newConnection(ws)
	h.register(clientID, conn)
	defer func() {
		h.unregister(clientID, conn)
		_ = ws.Close()
	}()

	_ = ws.SetReadDeadline(time.Now().Add(readDeadline))
	for {
		var msg map[string]any
		if err := ws.ReadJSON(&msg); err != nil {
			return
		}
		_ = ws.SetReadDeadline(time.Now().Add(readDeadline))

		switch msg["type"] {
		case "ping":
			if err := conn.writeJSON(map[string]string{"type": "pong"}); err != nil {
				return
			}
		case "subscribe":
			h.subscribe(conn, parseListIDs(msg["list_ids"]))
		}
	}
}

// parseListIDs pulls a []uuid.UUID out of a decoded JSON message's
// "list_ids" field. Individual malformed entries are skipped rather than
// failing the whole subscribe - a client-side bug in one id shouldn't cost
// the connection every other valid subscription.
func parseListIDs(raw any) []uuid.UUID {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		s, ok := item.(string)
		if !ok {
			continue
		}
		id, err := uuid.Parse(s)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}
	return ids
}
