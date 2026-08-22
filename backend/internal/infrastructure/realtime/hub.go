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

// Hub fans out list-event notifications to the connections subscribed to
// that list. That is the whole job: confirming a caller's own push is the
// push response's business (see EventController.SyncEvents), so nothing
// here is routed by user identity any more and no connection registry keyed
// by user_id exists.
//
// Access is checked at the one point a caller could learn something:
// subscribe (below) filters requested list_ids through ListAccessFilter
// before a connection joins a list's subscriber set, so publishing to a
// list's subscribers can never reach a non-member.
//
// Bookkeeping removes a connection by pointer identity, never by user_id: a
// dying connection's cleanup can run *after* a new connection for the same
// user has already subscribed, and anything coarser would tear down the
// live connection's subscriptions instead of the dead one's.
type Hub struct {
	logger *slog.Logger
	access ListAccessFilter
	mu     sync.RWMutex
	// subscriptions maps list_id -> the connections subscribed to it.
	subscriptions map[uuid.UUID]map[*connection]struct{}
	// subscribedLists is the reverse index (per connection, which lists it
	// subscribed to) - needed so cleanup/resubscribe can remove exactly
	// this connection's entries from `subscriptions` without scanning it.
	subscribedLists map[*connection]map[uuid.UUID]struct{}
	// conns holds every live connection, including ones that haven't
	// subscribed to anything yet - Shutdown needs to reach those too.
	conns map[*connection]struct{}
	// wg tracks running Serve goroutines so Shutdown can wait for them to
	// actually exit, not just for their sockets to close.
	wg sync.WaitGroup
	// closed is set under mu once Shutdown has taken its snapshot - a Serve
	// that loses the race to register after that point must not join
	// (registering, and calling wg.Add, after Shutdown has already started
	// wg.Wait would be a WaitGroup misuse) since Shutdown will never see or
	// close it.
	closed bool
}

func NewHub(logger *slog.Logger, access ListAccessFilter) *Hub {
	return &Hub{
		logger:          logger,
		access:          access,
		subscriptions:   make(map[uuid.UUID]map[*connection]struct{}),
		subscribedLists: make(map[*connection]map[uuid.UUID]struct{}),
		conns:           make(map[*connection]struct{}),
	}
}

func (h *Hub) unregister(conn *connection) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.unsubscribeAllLocked(conn)
	delete(h.conns, conn)
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

// PublishListEvent implements interfaces.ListEventPublisher. Returns as
// soon as the subscriber set is snapshotted, and gives each subscriber its
// own goroutine - one per connection, not one for the fan-out, so a peer
// that has stopped reading stalls only its own delivery (up to
// writeDeadline) and never a healthy subscriber's, let alone the HTTP push
// that triggered this. Safe to reach every subscriber unconditionally -
// subscribe already access-checked membership before adding anyone to this
// list's set.
//
// A stalled peer's goroutines pile up on its own connection.mu at the rate
// that list is written, which is bounded by writeDeadline: the parked write
// gives up after 10s and the queue drains. msg is shared across them and
// only ever read.
//
// Best-effort and deliberately unordered: the notification is a pull
// trigger, not an ordering token. The client reads only list_id from it and
// debounces a pull of that list (see SyncCoordinator), so a late, duplicate
// or dropped notification costs at most a redundant pull, or one deferred
// to the periodic safety interval.
func (h *Hub) PublishListEvent(listID uuid.UUID, seq int64) {
	msg := map[string]any{"type": "event", "list_id": listID.String(), "seq": seq}
	for _, conn := range h.subscribersFor(listID) {
		go func() {
			if err := conn.writeJSON(msg); err != nil {
				// Warn, not Error: a client that disconnected mid-send is
				// expected, not a server fault.
				h.logger.Warn("failed to send list event", "list_id", listID, "seq", seq, "error", err)
			}
		}()
	}
}

// Shutdown closes every live connection, which unblocks each one's blocked
// ReadJSON in Serve and lets its deferred cleanup run, then waits for all
// Serve goroutines to actually exit. Needed because http.Server.Shutdown
// (which echo.Echo.Shutdown delegates to) explicitly does not close or wait
// for hijacked connections like these on its own.
func (h *Hub) Shutdown(ctx context.Context) error {
	h.mu.Lock()
	h.closed = true
	conns := make([]*connection, 0, len(h.conns))
	for conn := range h.conns {
		conns = append(conns, conn)
	}
	h.mu.Unlock()

	// Closed outside the lock and concurrently: ws.Close() can block on
	// network I/O, and holding mu here would stall Serve's own
	// unregister(), which needs it too. One goroutine per connection so a
	// single stuck Close() can't head-of-line block the rest, or delay
	// reaching the select below that's meant to bound this by ctx.
	for _, conn := range conns {
		go func() {
			_ = conn.ws.Close()
		}()
	}

	done := make(chan struct{})
	go func() {
		h.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Serve blocks, running the connection's read loop, until it closes. Meant
// to be called from the HTTP handler goroutine that performed the upgrade -
// it owns the connection for its entire lifetime, and ctx (the still-live
// request context - the handler hasn't returned yet) is what subscribe uses
// for its access-filter lookup. userID is the verified Keycloak sub; it is
// what subscribe access-checks against, never a client-supplied id.
//
// A connection the Hub knows nothing about is simply one with no
// subscriptions: it enters the fan-out only once it subscribes, and
// unregister on the way out is what removes it again.
func (h *Hub) Serve(ctx context.Context, userID string, ws *websocket.Conn) {
	conn := newConnection(ws)
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		_ = ws.Close()
		return
	}
	h.conns[conn] = struct{}{}
	h.wg.Add(1)
	h.mu.Unlock()
	h.logger.Debug("connection opened", "user_id", userID)
	defer func() {
		h.unregister(conn)
		_ = ws.Close()
		h.wg.Done()
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
