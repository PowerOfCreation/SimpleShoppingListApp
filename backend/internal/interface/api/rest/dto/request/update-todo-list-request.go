package request

import (
	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
)

type UpdateToDoListRequest struct {
	Name string `json:"name"`
}

func (req *UpdateToDoListRequest) ToUpdateToDoListCommand(id uuid.UUID) *command.UpdateToDoListCommand {
	return &command.UpdateToDoListCommand{
		Id:   id,
		Name: req.Name,
	}
}
