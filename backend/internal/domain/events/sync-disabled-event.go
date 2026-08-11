package events

const EventTypeSyncDisabled = "todo_list.sync_disabled"

type SyncDisabledEvent struct {
	DomainEvent
}
