package interfaces

import (
	"errors"
	"fmt"
)

// ErrPermanent marks a dispatch failure as unfixable by retrying - a bad
// payload or a validation failure will fail exactly the same way on the
// millionth attempt as on the first. EventDispatcher's caller
// (EventIngestor.dispatchAndAck) uses errors.Is against this sentinel to
// tell such an error apart from a transient one (e.g. a DB connection
// blip), which must still be left unprocessed for a retry.
var ErrPermanent = errors.New("permanent error")

// Permanent wraps err so errors.Is(wrapped, ErrPermanent) succeeds while
// errors.Is/As against err's own type still works - callers that only care
// about "was this retryable" don't need to know the concrete cause.
func Permanent(err error) error {
	return fmt.Errorf("%w: %w", ErrPermanent, err)
}
