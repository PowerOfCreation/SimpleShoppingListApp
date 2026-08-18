package realtime

import (
	"context"
	"log/slog"
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

func testLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

// fakeAccessFilter lets every list through by default - most tests here
// aren't about access control at all, they're about connection/fan-out
// behavior, so the filter should be invisible unless a test explicitly
// denies something.
type fakeAccessFilter struct {
	denied map[uuid.UUID]bool
}

func newFakeAccessFilter() *fakeAccessFilter {
	return &fakeAccessFilter{denied: map[uuid.UUID]bool{}}
}

func (f *fakeAccessFilter) FilterAccessible(ctx context.Context, userID string, listIDs []uuid.UUID) ([]uuid.UUID, error) {
	accessible := make([]uuid.UUID, 0, len(listIDs))
	for _, id := range listIDs {
		if !f.denied[id] {
			accessible = append(accessible, id)
		}
	}
	return accessible, nil
}

// startTestServer wires the hub behind a plain net/http (not Echo) upgrade
// handler - the hub's contract doesn't depend on Echo, and this keeps the
// test focused on Hub/connection behavior with a real WebSocket handshake,
// which a hand-rolled fake *websocket.Conn couldn't exercise (it's a
// concrete struct, not an interface). user_id stands in for what
// SyncWebSocketController.Connect would normally read from the verified
// token via middleware.UserIDFromContext.
func startTestServer(t *testing.T, hub *Hub) *httptest.Server {
	t.Helper()
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		hub.Serve(r.Context(), userID, ws)
	}))
	t.Cleanup(server.Close)
	return server
}

func dial(t *testing.T, server *httptest.Server, userID string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/?user_id=" + userID
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func TestHub_PublishAck_DeliversToConnectedClient(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)
	conn := dial(t, server, "user-1")

	eventID := uuid.New()
	require.Eventually(t, func() bool {
		return len(hub.connectionsFor("user-1")) == 1
	}, time.Second, time.Millisecond)

	hub.PublishAck("user-1", eventID, 42)

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var msg map[string]any
	require.NoError(t, conn.ReadJSON(&msg))
	assert.Equal(t, "ack", msg["type"])
	assert.Equal(t, eventID.String(), msg["event_id"])
	assert.Equal(t, float64(42), msg["seq"])
}

func TestHub_PublishAck_NoConnectedClientIsANoOp(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())

	assert.NotPanics(t, func() {
		hub.PublishAck("nobody-home", uuid.New(), 1)
	})
}

func TestHub_PublishAck_FansOutToEveryConnectionOfTheSameUser(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)
	connA := dial(t, server, "user-1")
	connB := dial(t, server, "user-1")

	require.Eventually(t, func() bool {
		return len(hub.connectionsFor("user-1")) == 2
	}, time.Second, time.Millisecond)

	eventID := uuid.New()
	hub.PublishAck("user-1", eventID, 42)

	for _, conn := range []*websocket.Conn{connA, connB} {
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		var msg map[string]any
		require.NoError(t, conn.ReadJSON(&msg))
		assert.Equal(t, eventID.String(), msg["event_id"])
	}
}

// TestHub_PublishAck_DoesNotReachAnotherUser guards the reason PublishAck
// is now routed by verified user_id instead of the client-supplied
// client_id it used before: a connection registered under a different
// user_id must never receive an ack it didn't earn.
func TestHub_PublishAck_DoesNotReachAnotherUser(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)
	other := dial(t, server, "user-2")

	require.Eventually(t, func() bool {
		return len(hub.connectionsFor("user-2")) == 1
	}, time.Second, time.Millisecond)

	hub.PublishAck("user-1", uuid.New(), 1)

	_ = other.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	var msg map[string]any
	err := other.ReadJSON(&msg)
	assert.Error(t, err, "expected a read timeout, not a delivered message")
}

func TestHub_PingIsAnsweredWithPong(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)
	conn := dial(t, server, "user-1")

	require.NoError(t, conn.WriteJSON(map[string]string{"type": "ping"}))

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var msg map[string]string
	require.NoError(t, conn.ReadJSON(&msg))
	assert.Equal(t, "pong", msg["type"])
}

// TestHub_ReconnectDoesNotLoseTheNewConnection guards against the
// register/unregister-by-key race this Hub is specifically designed to
// avoid: if unregister deleted "the" map entry for a user_id rather than
// one specific connection by pointer identity, a dying old connection's
// deferred cleanup - which can run *after* a reconnect has already
// re-registered - would wipe out the new connection too, and acks would
// go nowhere until the next reconnect.
func TestHub_ReconnectDoesNotLoseTheNewConnection(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())

	oldConn := newConnection(&websocket.Conn{})
	hub.register("user-1", oldConn)

	newConn := newConnection(&websocket.Conn{})
	hub.register("user-1", newConn)

	// Simulate the old connection's read loop finally noticing it died and
	// running its deferred cleanup, well after the reconnect above.
	hub.unregister("user-1", oldConn)

	remaining := hub.connectionsFor("user-1")
	require.Len(t, remaining, 1)
	assert.Same(t, newConn, remaining[0])
}

func TestHub_UnregisterRemovesTheClientEntryOnceEmpty(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	conn := newConnection(&websocket.Conn{})
	hub.register("user-1", conn)

	hub.unregister("user-1", conn)

	hub.mu.RLock()
	_, exists := hub.clients["user-1"]
	hub.mu.RUnlock()
	assert.False(t, exists, "empty client entries should be cleaned up, not leaked")
}

func TestHub_PublishListEvent_DeliversToASubscriber(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)
	conn := dial(t, server, "user-1")
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
	hub := NewHub(testLogger(), newFakeAccessFilter())

	assert.NotPanics(t, func() {
		hub.PublishListEvent(uuid.New(), 1)
	})
}

func TestHub_PublishListEvent_DoesNotReachAConnectionSubscribedToAnotherList(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)
	subscribed := dial(t, server, "user-1")
	other := dial(t, server, "user-2")
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

// TestHub_Subscribe_DoesNotSubscribeToAListTheCallerCannotAccess is the
// point of injecting ListAccessFilter at all: a client asking to subscribe
// to a list_id it isn't a member of must not end up in that list's
// subscriber set, or it would learn (via PublishListEvent notifications)
// that a list it has no access to just changed.
func TestHub_Subscribe_DoesNotSubscribeToAListTheCallerCannotAccess(t *testing.T) {
	access := newFakeAccessFilter()
	forbidden := uuid.New()
	access.denied[forbidden] = true

	hub := NewHub(testLogger(), access)
	conn := newConnection(&websocket.Conn{})

	hub.subscribe(context.Background(), "user-1", conn, []uuid.UUID{forbidden})

	assert.Empty(t, hub.subscribersFor(forbidden))
}

func TestHub_Subscribe_ReplacesRatherThanAccumulatesPreviousSubscriptions(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	conn := newConnection(&websocket.Conn{})
	listA := uuid.New()
	listB := uuid.New()

	hub.subscribe(context.Background(), "user-1", conn, []uuid.UUID{listA})
	hub.subscribe(context.Background(), "user-1", conn, []uuid.UUID{listB})

	assert.Empty(t, hub.subscribersFor(listA), "the earlier subscription to list A must be dropped")
	assert.Len(t, hub.subscribersFor(listB), 1)
}

func TestHub_Unregister_RemovesTheConnectionsSubscriptions(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	conn := newConnection(&websocket.Conn{})
	listID := uuid.New()
	hub.register("user-1", conn)
	hub.subscribe(context.Background(), "user-1", conn, []uuid.UUID{listID})

	hub.unregister("user-1", conn)

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
