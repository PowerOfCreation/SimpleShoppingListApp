package interfaces

import "github.com/google/uuid"

// ListEventPublisher notifies whoever is subscribed to a list that a new
// event landed for it - the trigger for a client to pull rather than wait
// on its periodic safety interval. Routed by list_id, so it reaches every
// connection subscribed to that list: other devices of the same account,
// and other members of a shared list. Subscription itself is access-checked
// (see realtime.Hub), so reaching a list's subscribers here never leaks to
// a non-member.
//
// This is the only thing the realtime transport still carries. Confirming
// the sender's own push is the push response's job (see
// EventController.SyncEvents) - notifying *other* devices is what an HTTP
// request/response cannot do.
type ListEventPublisher interface {
	PublishListEvent(listID uuid.UUID, seq int64)
}
