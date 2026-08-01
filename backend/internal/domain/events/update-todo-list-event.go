package events

const EventTypeUpdateToDoList = "todo_list.updated"

type UpdateToDoListEvent struct {
	DomainEvent
	Name string `json:"name"`
}
