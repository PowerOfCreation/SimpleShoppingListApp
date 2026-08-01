package interfaces

import "github.com/google/uuid"

// AckPublisher pushes a durable-commit confirmation back to whichever
// client sent an event, over whatever transport is wired up (a WebSocket
// hub in production; a no-op in tests/before that transport exists). An
// "ack" means the server has durably processed the event, not just
// received it - see EventIngestor.
type AckPublisher interface {
	PublishAck(clientID string, eventID uuid.UUID)
}
