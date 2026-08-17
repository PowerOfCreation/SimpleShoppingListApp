package interfaces

import "github.com/google/uuid"

// AckPublisher pushes a durable-commit confirmation back to whichever user
// sent an event, over whatever transport is wired up (a WebSocket hub in
// production; a no-op in tests/before that transport exists). An "ack"
// means the server has durably processed the event, not just received it -
// see EventIngestor. Routed by the verified Keycloak sub (StoredEvent.UserID),
// not client_id - client_id is unverified request-body input and, for a
// signed-out client, not even stable identity (see
// sync-design-decisions.md).
type AckPublisher interface {
	PublishAck(userID string, eventID uuid.UUID, seq int64)
}
