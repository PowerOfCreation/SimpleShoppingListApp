package common

import (
	"time"

	"github.com/google/uuid"
)

type TodoResult struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Completed   bool      `json:"completed"`
	CreatedAt   time.Time `json:"created_at,omitempty"`
	UpdatedAt   time.Time `json:"updated_at,omitempty"`
	CompletedAt time.Time `json:"completed_at,omitempty"`
}
