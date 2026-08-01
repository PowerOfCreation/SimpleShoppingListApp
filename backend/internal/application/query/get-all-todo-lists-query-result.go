package query

import "github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"

type GetAllToDoListsQueryResult struct {
	Result []*common.ToDoListResult
}
