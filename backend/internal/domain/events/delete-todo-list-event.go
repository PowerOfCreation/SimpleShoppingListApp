package events

const EventTypeDeleteToDoList = "todo_list.deleted"

type DeleteToDoListEvent struct {
	DomainEvent
}
