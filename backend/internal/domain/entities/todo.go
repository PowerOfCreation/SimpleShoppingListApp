package entities

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

type ToDo struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Completed   bool      `json:"completed"`
	ListID      uuid.UUID `json:"list_id"`
	CreatedAt   time.Time `json:"created_at,omitempty"`
	UpdatedAt   time.Time `json:"updated_at,omitempty"`
	CompletedAt time.Time `json:"completed_at,omitempty"`
}

func (p *ToDo) validate() error {
	if p.Name == "" {
		return errors.New("name must not be empty")
	}
	if p.CreatedAt.After(p.UpdatedAt) {
		return errors.New("created_at must be before updated_at")
	}
	if p.CreatedAt.After(p.CompletedAt) {
		return errors.New("created_at must be before completed_at")
	}
	if p.Completed && p.CompletedAt.IsZero() {
		return errors.New("completed_at must be set when completed is true")
	}

	return nil
}

func NewToDo(name string, listID uuid.UUID) *ToDo {
	return &ToDo{
		ID:        uuid.New(),
		Name:      name,
		Completed: false,
		ListID:    listID,
		CreatedAt: time.Now(),
	}
}

func (p *ToDo) UpdateName(name string) error {
	p.Name = name
	p.UpdatedAt = time.Now()

	return p.validate()
}

func (p *ToDo) UpdateCompleted(completed bool, completedAt time.Time) error {
	p.Completed = completed
	p.CompletedAt = completedAt
	p.UpdatedAt = time.Now()

	return p.validate()
}
