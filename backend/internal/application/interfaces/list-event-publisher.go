package interfaces

import "github.com/google/uuid"

// ListEventPublisher notifies whoever is subscribed to a list that a new
// event landed for it - the trigger for a client to pull rather than wait
// on its periodic safety interval. Unlike AckPublisher (routed by user id,
// only ever meaningful to the user that sent the event this acks), this is
// routed by list_id and can reach every connection subscribed to that list
// - other devices of the same account, and other members of a shared list.
// Subscription itself is access-checked (see realtime.Hub), so reaching a
// list's subscribers here never leaks to a non-member.
type ListEventPublisher interface {
	PublishListEvent(listID uuid.UUID, seq int64)
}
