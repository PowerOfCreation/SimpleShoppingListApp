package mapper

import (
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/response"
)

// ToSyncEventResponse converts a durably-stored event back into the same
// wire shape the client originally pushed it in (see
// request.SyncEventRequest.ToStoredEvent, its inverse), plus its assigned
// seq - so a pulled event and a pushed event parse through one code path
// on the frontend.
func ToSyncEventResponse(event *repositories.StoredEvent) response.SyncEventResponse {
	return response.SyncEventResponse{
		EventID:       event.EventID,
		EventType:     event.EventType,
		AggregateID:   event.AggregateID,
		AggregateType: event.AggregateType,
		ListID:        event.ListID,
		OccurredAt:    event.OccurredAt.UnixMilli(),
		ClientID:      event.ClientID,
		Payload:       event.Payload,
		Seq:           event.Seq,
	}
}

func ToSyncEventResponseList(events []*repositories.StoredEvent) []response.SyncEventResponse {
	responses := make([]response.SyncEventResponse, len(events))
	for i, event := range events {
		responses[i] = ToSyncEventResponse(event)
	}
	return responses
}
