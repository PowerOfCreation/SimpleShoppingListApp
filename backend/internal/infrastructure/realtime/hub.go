package realtime

import (
	"context"
	"log/slog"
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

// ListAccessFilter narrows the application layer's ListAccessService down
// to the one read filter Hub needs, so subscribing to a list can't
// silently hand a non-member another list's notifications. A small
// interface defined at the point of use, not the full application
// interface - Hub only ever calls this one method.
type ListAccessFilter interface {
	FilterAccessible(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error)
}

// Hub fans out acks (by userID) and list-event notifications (by list_id,
// via subscribe) to connections. Both are access-checked at the point a
// caller could learn something: PublishAck only ever reaches connections
// registered under the verified user_id that pushed the event (see
// EventIngestor), and subscribe (below) filters requested list_ids through
// ListAccessFilter before a connection is added to a list's subscriber set.
//
// Client registration is keyed by user_id -> set of connections, and
// unregistration removes a connection by pointer identity, not just by
// user_id: a dying connection's cleanup can run *after* a new connection
// for the same user_id has already registered, and keying by user_id alone
// would delete the new connection instead of the dead one. List
// subscriptions follow the same by-pointer discipline for the same reason.
type Hub struct {
	logger  *slog.Logger
	access  ListAccessFilter
	mu      sync.RWMutex
	clients map[string]map[*connection]struct{}
	// subscriptions maps list_id -> the connections subscribed to it.
	subscriptions map[uuid.UUID]map[*connection]struct{}
	// subscribedLists is the reverse index (per connection, which lists it
	// subscribed to) - needed so unregister/resubscribe can remove exactly
	// this connection's entries from `subscriptions` without scanning it.
	subscribedLists map[*connection]map[uuid.UUID]struct{}
}

func NewHub(logger *slog.Logger, access ListAccessFilter) *Hub {
	return &Hub{
		logger:          logger,
		access:          access,
		clients:         make(map[string]map[*connection]struct{}),
		subscriptions:   make(map[uuid.UUID]map[*connection]struct{}),
		subscribedLists: make(map[*connection]map[uuid.UUID]struct{}),
	}
}

func (h *Hub) register(userID string, conn *connection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[userID] == nil {
		h.clients[userID] = make(map[*connection]struct{})
	}
	h.clients[userID][conn] = struct{}{}
}

func (h *Hub) unregister(userID string, conn *connection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	conns, ok := h.clients[userID]
	if ok {
		delete(conns, conn)
		if len(conns) == 0 {
			delete(h.clients, userID)
		}
	}
	h.unsubscribeAllLocked(conn)
}

// subscribe replaces (not accumulates) the set of lists this connection is
// subscribed to - the frontend resends its full sync-enabled list_ids
// whenever that set changes, and it must not accumulate hearing about a
// list it's since turned sync off for. listIDs is filtered through
// ListAccessFilter first, so requesting a list_id the caller isn't a
// member of is a silent no-op for that id, not an error - same "omit,
// don't leak" posture as the REST read paths.
func (h *Hub) subscribe(ctx context.Context, userID string, conn *connection, listIDs []uuid.UUID) {
	accessible, err := h.access.FilterAccessible(ctx, userID, listIDs)
	if err != nil {
		h.logger.Warn("failed to filter subscribe list_ids", "user_id", userID, "error", err)
		accessible = nil
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	h.unsubscribeAllLocked(conn)

	set := make(map[uuid.UUID]struct{}, len(accessible))
	for _, listID := range accessible {
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

func (h *Hub) connectionsFor(userID string) []*connection {
	h.mu.RLock()
	defer h.mu.RUnlock()
	conns := h.clients[userID]
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

// PublishAck implements interfaces.AckPublisher. userID is the verified
// Keycloak sub that pushed the event (StoredEvent.UserID), not client_id -
// this is what keeps an ack from being deliverable to a connection that
// merely guessed someone else's client_id. Best-effort: if no connection
// is registered for userID (offline, or never connected), this is a silent
// no-op - the client's reconcile pass is the source of truth, not the ack.
func (h *Hub) PublishAck(userID string, eventID uuid.UUID, seq int64) {
	msg := map[string]any{"type": "ack", "event_id": eventID.String(), "seq": seq}
	for _, conn := range h.connectionsFor(userID) {
		if err := conn.writeJSON(msg); err != nil {
			// Warn, not Error: a client that disconnected mid-send is
			// expected, not a server fault.
			h.logger.Warn("failed to send ack", "user_id", userID, "event_id", eventID, "error", err)
		}
	}
}

// PublishListEvent implements interfaces.ListEventPublisher. Best-effort,
// same as PublishAck: no subscriber is a silent no-op - a client's own
// periodic pull (and its next connect/foreground pull) is the fallback if
// this notification never arrives or is missed while disconnected. Safe to
// reach every subscriber unconditionally - subscribe already access-checked
// membership before adding anyone to this list's set.
func (h *Hub) PublishListEvent(listID uuid.UUID, seq int64) {
	msg := map[string]any{"type": "event", "list_id": listID.String(), "seq": seq}
	for _, conn := range h.subscribersFor(listID) {
		if err := conn.writeJSON(msg); err != nil {
			h.logger.Warn("failed to send list event", "list_id", listID, "seq", seq, "error", err)
		}
	}
}

// Serve registers the connection and blocks, running its read loop, until
// the connection closes. Meant to be called from the HTTP handler
// goroutine that performed the upgrade - it owns the connection for its
// entire lifetime, and ctx (the still-live request context - the handler
// hasn't returned yet) is what subscribe uses for its access-filter lookup.
func (h *Hub) Serve(ctx context.Context, userID string, ws *websocket.Conn) {
	conn := newConnection(ws)
	h.register(userID, conn)
	h.logger.Debug("connection registered", "user_id", userID)
	defer func() {
		h.unregister(userID, conn)
		_ = ws.Close()
		h.logger.Debug("connection closed", "user_id", userID)
	}()

	_ = ws.SetReadDeadline(time.Now().Add(readDeadline))
	for {
		var msg map[string]any
		if err := ws.ReadJSON(&msg); err != nil {
			// Debug, not Warn/Error: a client going away (app backgrounded,
			// network drop) is the normal way this loop ends.
			h.logger.Debug("read loop ended", "user_id", userID, "error", err)
			return
		}
		_ = ws.SetReadDeadline(time.Now().Add(readDeadline))

		switch msg["type"] {
		case "ping":
			if err := conn.writeJSON(map[string]string{"type": "pong"}); err != nil {
				h.logger.Debug("failed to send pong", "user_id", userID, "error", err)
				return
			}
		case "subscribe":
			listIDs := parseListIDs(msg["list_ids"])
			h.subscribe(ctx, userID, conn, listIDs)
			h.logger.Debug("subscribed", "user_id", userID, "requested_count", len(listIDs))
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
