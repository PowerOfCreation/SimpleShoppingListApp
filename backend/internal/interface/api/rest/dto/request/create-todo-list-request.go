package request

import (
	"github.com/google/uuid"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
)

type CreateToDoListRequest struct {
	Id             uuid.UUID `json:"id"`
	IdempotencyKey string    `json:"idempotency_key"`
	Name           string    `json:"name"`
}

func (req *CreateToDoListRequest) ToCreateToDoListCommand() (*command.CreateToDoListCommand, error) {
	return &command.CreateToDoListCommand{
		Id:             req.Id,
		IdempotencyKey: req.IdempotencyKey,
		Name:           req.Name,
	}, nil
}
