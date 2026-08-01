package events

const EventTypeCreateToDoList = "todo_list.created"

type CreateToDoListEvent struct {
	DomainEvent
	Name string `json:"name"`
}
