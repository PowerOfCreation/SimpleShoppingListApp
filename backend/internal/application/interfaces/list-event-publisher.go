package interfaces

import "github.com/google/uuid"

// ListEventPublisher notifies whoever is subscribed to a list that a new
// event landed for it - the trigger for a client to pull rather than wait
// on its periodic safety interval. Unlike AckPublisher (routed by
// client_id, only ever meaningful to the client that sent the event this
// acks), this is routed by list_id and can reach every connection
// subscribed to that list - other devices of the same account today, and
// eventually other users once lists can be shared (see
// frontend/docs/sync-design-decisions.md).
type ListEventPublisher interface {
	PublishListEvent(listID uuid.UUID, seq int64)
}
