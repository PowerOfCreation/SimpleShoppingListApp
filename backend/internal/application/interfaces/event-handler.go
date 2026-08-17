package interfaces

import (
	"context"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type EventHandler interface {
	EventType() string
	Handle(ctx context.Context, event *repositories.StoredEvent) error
}
