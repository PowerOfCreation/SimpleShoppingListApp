package response

import "time"

type ToDoListResponse struct {
	Id        string
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type ListToDoListsResponse struct {
	ToDoLists []*ToDoListResponse `json:"ToDoLists"`
}
