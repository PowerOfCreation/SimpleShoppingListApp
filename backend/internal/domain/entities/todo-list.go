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

func NewToDoList(id uuid.UUID, name string) *ToDoList {
	now := time.Now()
	return &ToDoList{
		Id:        id,
		Name:      name,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func (p *ToDoList) UpdateName(name string) error {
	p.Name = name
	p.UpdatedAt = time.Now()

	return p.validate()
}
