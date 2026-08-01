package response

import "github.com/google/uuid"

// ListHeadResponse is a list's pull cursor as seen by the server. EventID
// is nil and Seq is 0 for a list the server has no processed events for -
// every requested list_id gets an entry either way, so the client never
// has to distinguish "not in the response" from "server has nothing".
type ListHeadResponse struct {
	ListID  uuid.UUID  `json:"list_id"`
	Seq     int64      `json:"seq"`
	EventID *uuid.UUID `json:"event_id"`
}

type SyncHeadResponse struct {
	Heads []ListHeadResponse `json:"heads"`
}
