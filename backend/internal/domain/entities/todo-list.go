package entities

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

type ToDoList struct {
	Id        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at,omitempty"`
	UpdatedAt time.Time `json:"updated_at,omitempty"`
}

func (p *ToDoList) validate() error {
	if p.Name == "" {
		return errors.New("name must not be empty")
	}
	if p.CreatedAt.After(p.UpdatedAt) {
		return errors.New("created_at must be before updated_at")
	}

	return nil
}

// NewToDoListAt builds a list stamped with at (the originating event's
// OccurredAt), not the server clock - so a rebuild replaying the same
// events lands on the exact same timestamps as forward application.
func NewToDoListAt(id uuid.UUID, name string, at time.Time) *ToDoList {
	return &ToDoList{
		Id:        id,
		Name:      name,
		CreatedAt: at,
		UpdatedAt: at,
	}
}
