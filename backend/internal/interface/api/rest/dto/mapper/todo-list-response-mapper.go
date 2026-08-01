package mapper

import (
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/response"
)

func ToToDoListResponse(toDoList *common.ToDoListResult) *response.ToDoListResponse {
	return &response.ToDoListResponse{
		Id:        toDoList.Id.String(),
		Name:      toDoList.Name,
		CreatedAt: toDoList.CreatedAt,
		UpdatedAt: toDoList.UpdatedAt,
	}
}

func ToToDoListListResponse(toDoLists []*common.ToDoListResult) *response.ListToDoListsResponse {
	responseList := make([]*response.ToDoListResponse, len(toDoLists))

	for i, t := range toDoLists {
		responseList[i] = ToToDoListResponse(t)
	}

	return &response.ListToDoListsResponse{ToDoLists: responseList}
}
