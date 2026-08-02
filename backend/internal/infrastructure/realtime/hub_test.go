package realtime

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// startTestServer wires the hub behind a plain net/http (not Echo) upgrade
// handler - the hub's contract doesn't depend on Echo, and this keeps the
// test focused on Hub/connection behavior with a real WebSocket handshake,
// which a hand-rolled fake *websocket.Conn couldn't exercise (it's a
// concrete struct, not an interface).
func startTestServer(t *testing.T, hub *Hub) *httptest.Server {
	t.Helper()
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("client_id")
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		hub.Serve(clientID, ws)
	}))
	t.Cleanup(server.Close)
	return server
}

func dial(t *testing.T, server *httptest.Server, clientID string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/?client_id=" + clientID
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func TestHub_PublishAck_DeliversToConnectedClient(t *testing.T) {
	hub := NewHub()
	server := startTestServer(t, hub)
	conn := dial(t, server, "client-1")

	eventID := uuid.New()
	require.Eventually(t, func() bool {
		return len(hub.connectionsFor("client-1")) == 1
	}, time.Second, time.Millisecond)

	hub.PublishAck("client-1", eventID, 42)

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var msg map[string]any
	require.NoError(t, conn.ReadJSON(&msg))
	assert.Equal(t, "ack", msg["type"])
	assert.Equal(t, eventID.String(), msg["event_id"])
	assert.Equal(t, float64(42), msg["seq"])
}

func TestHub_PublishAck_NoConnectedClientIsANoOp(t *testing.T) {
	hub := NewHub()

	assert.NotPanics(t, func() {
		hub.PublishAck("nobody-home", uuid.New(), 1)
	})
}

func TestHub_PublishAck_FansOutToEveryConnectionOfTheSameClient(t *testing.T) {
	hub := NewHub()
	server := startTestServer(t, hub)
	connA := dial(t, server, "client-1")
	connB := dial(t, server, "client-1")

	require.Eventually(t, func() bool {
		return len(hub.connectionsFor("client-1")) == 2
	}, time.Second, time.Millisecond)

	eventID := uuid.New()
	hub.PublishAck("client-1", eventID, 42)

	for _, conn := range []*websocket.Conn{connA, connB} {
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		var msg map[string]any
		require.NoError(t, conn.ReadJSON(&msg))
		assert.Equal(t, eventID.String(), msg["event_id"])
	}
}

func TestHub_PingIsAnsweredWithPong(t *testing.T) {
	hub := NewHub()
	server := startTestServer(t, hub)
	conn := dial(t, server, "client-1")

	require.NoError(t, conn.WriteJSON(map[string]string{"type": "ping"}))

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var msg map[string]string
	require.NoError(t, conn.ReadJSON(&msg))
	assert.Equal(t, "pong", msg["type"])
}

// TestHub_ReconnectDoesNotLoseTheNewConnection guards against the
// register/unregister-by-key race this Hub is specifically designed to
// avoid: if unregister deleted "the" map entry for a client_id rather than
// one specific connection by pointer identity, a dying old connection's
// deferred cleanup - which can run *after* a reconnect has already
// re-registered - would wipe out the new connection too, and acks would
// go nowhere until the next reconnect.
func TestHub_ReconnectDoesNotLoseTheNewConnection(t *testing.T) {
	hub := NewHub()

	oldConn := newConnection(&websocket.Conn{})
	hub.register("client-1", oldConn)

	newConn := newConnection(&websocket.Conn{})
	hub.register("client-1", newConn)

	// Simulate the old connection's read loop finally noticing it died and
	// running its deferred cleanup, well after the reconnect above.
	hub.unregister("client-1", oldConn)

	remaining := hub.connectionsFor("client-1")
	require.Len(t, remaining, 1)
	assert.Same(t, newConn, remaining[0])
}

func TestHub_UnregisterRemovesTheClientEntryOnceEmpty(t *testing.T) {
	hub := NewHub()
	conn := newConnection(&websocket.Conn{})
	hub.register("client-1", conn)

	hub.unregister("client-1", conn)

	hub.mu.RLock()
	_, exists := hub.clients["client-1"]
	hub.mu.RUnlock()
	assert.False(t, exists, "empty client entries should be cleaned up, not leaked")
}

func TestHub_PublishListEvent_DeliversToASubscriber(t *testing.T) {
	hub := NewHub()
	server := startTestServer(t, hub)
	conn := dial(t, server, "client-1")
	listID := uuid.New()

	require.NoError(t, conn.WriteJSON(map[string]any{
		"type":     "subscribe",
		"list_ids": []string{listID.String()},
	}))
	require.Eventually(t, func() bool {
		return len(hub.subscribersFor(listID)) == 1
	}, time.Second, time.Millisecond)

	hub.PublishListEvent(listID, 42)

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var msg map[string]any
	require.NoError(t, conn.ReadJSON(&msg))
	assert.Equal(t, "event", msg["type"])
	assert.Equal(t, listID.String(), msg["list_id"])
	assert.Equal(t, float64(42), msg["seq"])
}

func TestHub_PublishListEvent_NoSubscriberIsANoOp(t *testing.T) {
	hub := NewHub()

	assert.NotPanics(t, func() {
		hub.PublishListEvent(uuid.New(), 1)
	})
}

func TestHub_PublishListEvent_DoesNotReachAConnectionSubscribedToAnotherList(t *testing.T) {
	hub := NewHub()
	server := startTestServer(t, hub)
	subscribed := dial(t, server, "client-1")
	other := dial(t, server, "client-2")
	listA := uuid.New()
	listB := uuid.New()

	require.NoError(t, subscribed.WriteJSON(map[string]any{
		"type":     "subscribe",
		"list_ids": []string{listA.String()},
	}))
	require.NoError(t, other.WriteJSON(map[string]any{
		"type":     "subscribe",
		"list_ids": []string{listB.String()},
	}))
	require.Eventually(t, func() bool {
		return len(hub.subscribersFor(listA)) == 1 && len(hub.subscribersFor(listB)) == 1
	}, time.Second, time.Millisecond)

	hub.PublishListEvent(listA, 1)

	_ = subscribed.SetReadDeadline(time.Now().Add(time.Second))
	var msg map[string]any
	require.NoError(t, subscribed.ReadJSON(&msg))
	assert.Equal(t, listA.String(), msg["list_id"])

	// The other connection subscribed to a different list - it must not
	// see this notification at all.
	_ = other.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	err := other.ReadJSON(&msg)
	assert.Error(t, err, "expected a read timeout, not a delivered message")
}

func TestHub_Subscribe_ReplacesRatherThanAccumulatesPreviousSubscriptions(t *testing.T) {
	hub := NewHub()
	conn := newConnection(&websocket.Conn{})
	listA := uuid.New()
	listB := uuid.New()

	hub.subscribe(conn, []uuid.UUID{listA})
	hub.subscribe(conn, []uuid.UUID{listB})

	assert.Empty(t, hub.subscribersFor(listA), "the earlier subscription to list A must be dropped")
	assert.Len(t, hub.subscribersFor(listB), 1)
}

func TestHub_Unregister_RemovesTheConnectionsSubscriptions(t *testing.T) {
	hub := NewHub()
	conn := newConnection(&websocket.Conn{})
	listID := uuid.New()
	hub.register("client-1", conn)
	hub.subscribe(conn, []uuid.UUID{listID})

	hub.unregister("client-1", conn)

	assert.Empty(t, hub.subscribersFor(listID))
	hub.mu.RLock()
	_, exists := hub.subscribedLists[conn]
	hub.mu.RUnlock()
	assert.False(t, exists, "the reverse index entry should be cleaned up too")
}

func TestHub_ParseListIDs_SkipsMalformedEntriesRatherThanFailingTheWholeSubscribe(t *testing.T) {
	valid := uuid.New()

	ids := parseListIDs([]any{valid.String(), "not-a-uuid", 42, valid.String()})

	assert.Equal(t, []uuid.UUID{valid, valid}, ids)
}

func TestHub_ParseListIDs_ReturnsNilForTheWrongShape(t *testing.T) {
	assert.Nil(t, parseListIDs("not-an-array"))
	assert.Nil(t, parseListIDs(nil))
}
