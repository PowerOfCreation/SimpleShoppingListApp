package realtime

import (
	"context"
	"fmt"
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

// TestHub_ConnectingWithoutSubscribingReceivesNothing is what replaced the
// ack path: a client's own push is confirmed by the push response, so
// merely being connected must deliver nothing at all. Only a subscription
// puts a connection in a fan-out.
func TestHub_ConnectingWithoutSubscribingReceivesNothing(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)
	conn := dial(t, server, "user-1")

	hub.PublishListEvent(uuid.New(), 1)

	_ = conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	var msg map[string]any
	err := conn.ReadJSON(&msg)
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

// TestHub_ReconnectDoesNotLoseTheNewConnectionsSubscriptions guards the
// by-pointer bookkeeping the Hub is specifically designed for: if cleanup
// removed "the" entry for a user rather than one specific connection, a
// dying old connection's deferred cleanup - which can run *after* a
// reconnect has already resubscribed - would unsubscribe the new
// connection too, and it would stop hearing about the list until the next
// reconnect.
func TestHub_ReconnectDoesNotLoseTheNewConnectionsSubscriptions(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	listID := uuid.New()

	oldConn := newConnection(&websocket.Conn{})
	hub.subscribe(context.Background(), "user-1", oldConn, []uuid.UUID{listID})

	newConn := newConnection(&websocket.Conn{})
	hub.subscribe(context.Background(), "user-1", newConn, []uuid.UUID{listID})

	// Simulate the old connection's read loop finally noticing it died and
	// running its deferred cleanup, well after the reconnect above.
	hub.unregister(oldConn)

	remaining := hub.subscribersFor(listID)
	require.Len(t, remaining, 1)
	assert.Same(t, newConn, remaining[0])
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

// TestHub_PublishListEvent_DoesNotBlockOnAStalledSubscriber is the reason
// the fan-out is detached: it runs inside the HTTP push handler, so a peer
// that has stopped reading must not be able to hold that request open for
// writeDeadline. A held connection.mu is the stand-in for a write that
// won't complete - it blocks writeJSON exactly the way a stalled socket
// does. The lock is deliberately never released: the parked goroutine stays
// parked for the rest of the test, which is the point.
func TestHub_PublishListEvent_DoesNotBlockOnAStalledSubscriber(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	stalled := newConnection(&websocket.Conn{})
	listID := uuid.New()
	hub.subscribe(context.Background(), "user-1", stalled, []uuid.UUID{listID})
	stalled.mu.Lock()

	done := make(chan struct{})
	go func() {
		hub.PublishListEvent(listID, 1)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("PublishListEvent blocked on a subscriber that isn't draining its writes")
	}
}

// TestHub_PublishListEvent_AStalledSubscriberDoesNotDelayAHealthyOne is the
// per-connection half of the guarantee above, and the reason the goroutine
// is inside the fan-out loop rather than around it: with one goroutine for
// the whole snapshot, a shared list whose subscribers include a peer that
// stopped reading would hold every other member's notification for
// writeDeadline.
//
// Several stalled peers rather than one on purpose. subscribersFor iterates
// a map, so a serialized fan-out only demonstrably delays the healthy
// connection when a stalled one happens to come first; with stalledPeers of
// them the healthy connection goes first only 1-in-(stalledPeers+1) times,
// which is what makes this a reliable guard rather than a coin flip.
func TestHub_PublishListEvent_AStalledSubscriberDoesNotDelayAHealthyOne(t *testing.T) {
	const stalledPeers = 8

	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)
	listID := uuid.New()

	healthy := dial(t, server, "user-1")
	require.NoError(t, healthy.WriteJSON(map[string]any{
		"type":     "subscribe",
		"list_ids": []string{listID.String()},
	}))
	require.Eventually(t, func() bool {
		return len(hub.subscribersFor(listID)) == 1
	}, time.Second, time.Millisecond)

	for i := range stalledPeers {
		stalled := newConnection(&websocket.Conn{})
		hub.subscribe(context.Background(), fmt.Sprintf("stalled-%d", i), stalled, []uuid.UUID{listID})
		stalled.mu.Lock()
	}
	require.Len(t, hub.subscribersFor(listID), stalledPeers+1)

	hub.PublishListEvent(listID, 42)

	// Comfortably below writeDeadline: if a stalled peer were serialized
	// ahead of this one, nothing would arrive here for 10s.
	_ = healthy.SetReadDeadline(time.Now().Add(time.Second))
	var msg map[string]any
	require.NoError(t, healthy.ReadJSON(&msg))
	assert.Equal(t, listID.String(), msg["list_id"])
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
	hub.subscribe(context.Background(), "user-1", conn, []uuid.UUID{listID})

	hub.unregister(conn)

	assert.Empty(t, hub.subscribersFor(listID))
	hub.mu.RLock()
	_, exists := hub.subscribedLists[conn]
	hub.mu.RUnlock()
	assert.False(t, exists, "the reverse index entry should be cleaned up too")
}

// TestHub_Shutdown_ClosesConnectionsAndWaitsForServeToReturn guards the
// wrinkle Shutdown exists for: e.Shutdown never touches hijacked
// connections, so without this the sync websocket's Serve goroutine (and
// its underlying socket) would outlive process shutdown.
func TestHub_Shutdown_ClosesConnectionsAndWaitsForServeToReturn(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)
	conn := dial(t, server, "user-1")

	require.NoError(t, conn.WriteJSON(map[string]any{
		"type":     "subscribe",
		"list_ids": []string{uuid.New().String()},
	}))
	require.Eventually(t, func() bool {
		hub.mu.RLock()
		defer hub.mu.RUnlock()
		return len(hub.conns) == 1
	}, time.Second, time.Millisecond)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, hub.Shutdown(shutdownCtx))

	hub.mu.RLock()
	remaining := len(hub.conns)
	hub.mu.RUnlock()
	assert.Zero(t, remaining, "Shutdown should wait for Serve's cleanup to unregister the connection")

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var msg map[string]any
	assert.Error(t, conn.ReadJSON(&msg), "the server should have closed the connection")
}

// TestHub_Shutdown_ReturnsContextErrorOnTimeout guards the other half: a
// Serve goroutine that never returns (e.g. stuck delivering to a stalled
// peer) must not hang Shutdown forever - it should give up once ctx expires.
func TestHub_Shutdown_ReturnsContextErrorOnTimeout(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	hub.wg.Add(1)
	t.Cleanup(hub.wg.Done)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := hub.Shutdown(shutdownCtx)
	assert.ErrorIs(t, err, context.DeadlineExceeded)
}

// TestHub_Serve_RejectsNewConnectionsAfterShutdown guards the race a
// reviewer flagged: registration (h.conns / h.wg.Add) and Shutdown's
// snapshot both happen under h.mu, so a connection arriving after Shutdown's
// snapshot must never join - if it did, Shutdown could already be past
// wg.Wait() with nothing left to observe its wg.Add.
func TestHub_Serve_RejectsNewConnectionsAfterShutdown(t *testing.T) {
	hub := NewHub(testLogger(), newFakeAccessFilter())
	server := startTestServer(t, hub)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, hub.Shutdown(shutdownCtx))

	conn := dial(t, server, "user-1")
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	var msg map[string]any
	assert.Error(t, conn.ReadJSON(&msg), "a connection established after Shutdown should be closed immediately")
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
