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

// Hub fans out acks to every connection registered for a client_id.
//
// Deliberately not scoped by user (no auth/user-scoping exists yet - see
// the sync design doc): every ack is only ever meaningful to a client that
// already knows the event_id it's for, so broadcasting within a client_id
// is safe. Once user-scoping lands, this becomes user-scoped too.
//
// Registration is keyed by client_id -> set of connections (not a single
// connection per client_id) and unregistration removes a specific
// connection by pointer identity. That distinction matters on reconnect:
// a client's old connection dying is detected only when its read loop's
// blocking read finally errors out, which can happen *after* a new
// connection for the same client_id has already registered. Deleting "the"
// entry for that client_id at that point would delete the new connection
// instead of the dead one.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*connection]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[string]map[*connection]struct{})}
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
	if !ok {
		return
	}
	delete(conns, conn)
	if len(conns) == 0 {
		delete(h.clients, clientID)
	}
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

		if msg["type"] == "ping" {
			if err := conn.writeJSON(map[string]string{"type": "pong"}); err != nil {
				return
			}
		}
	}
}
