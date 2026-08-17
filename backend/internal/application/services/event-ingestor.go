package services

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

const eventQueueCapacity = 10_000

// sweepInterval is how often the worker retries events left unprocessed by
// a transient failure, on top of the one sweep at startup. Without this, a
// event that fails transiently (e.g. a DB blip) stays stuck until the next
// process restart - "will be retried" would otherwise be a promise the
// ingestor doesn't keep. Safe to run repeatedly: applying an event is
// guarded to be monotonic in seq (see ToDoListRepository), so re-applying
// an already-applied one is a no-op, not a re-delivery.
const sweepInterval = 30 * time.Second

// realtimePublisher is what the ingestor actually needs from the realtime
// layer: ack the sender, and notify anyone subscribed to the event's list.
// A single combined interface rather than two separate constructor
// parameters, since in practice one hub (internal/infrastructure/realtime)
// implements both and there's never a reason to wire them independently.
type realtimePublisher interface {
	interfaces.AckPublisher
	interfaces.ListEventPublisher
}

// EventIngestor durably persists incoming events and applies them to the
// domain asynchronously. This is what lets EventController.SyncEvents
// respond 202 before anything is actually written - Enqueue only pushes
// onto an in-memory queue and returns.
//
// A single worker goroutine drains that queue strictly in enqueue order.
// That single fact is what keeps two events for the same aggregate from
// ever being applied out of order without any per-aggregate locking: as
// long as a client sends its own events in order (the frontend's sync
// engine flushes one batch at a time, oldest-first), and a single request's
// events are enqueued in a simple in-order loop, this worker will apply
// them in exactly that order. It also means the "insert conflicts but is
// still unprocessed" case Insert()'s docs mention cannot arise from two
// concurrent Enqueue calls for the same event_id - the second one is
// simply queued behind the first, which will have finished (successfully
// or not) by the time the worker gets to it.
//
// The same single-worker fact is also why Insert can hand out seq: Insert
// runs in this worker as its own autocommit statement, strictly FIFO, so
// assignment order is commit order is visibility order - the same argument
// that used to justify assigning seq at MarkProcessed instead (see
// sync-design-decisions.md), now carried one step earlier. Holds only with
// exactly one EventIngestor writer; see that doc's note on multiple API
// replicas.
type EventIngestor struct {
	logger     *slog.Logger
	eventRepo  repositories.EventRepository
	dispatcher *EventDispatcher
	publisher  realtimePublisher
	queue      chan *repositories.StoredEvent
	stop       chan struct{}
	wg         sync.WaitGroup
}

func NewEventIngestor(
	logger *slog.Logger,
	eventRepo repositories.EventRepository,
	dispatcher *EventDispatcher,
	publisher realtimePublisher,
) *EventIngestor {
	return &EventIngestor{
		logger:     logger,
		eventRepo:  eventRepo,
		dispatcher: dispatcher,
		publisher:  publisher,
		queue:      make(chan *repositories.StoredEvent, eventQueueCapacity),
		stop:       make(chan struct{}),
	}
}

// Enqueue accepts an already-parsed event for background processing. It
// only blocks if the queue is momentarily full; ctx cancellation (e.g. the
// HTTP client disconnecting) is honored so a handler goroutine can't get
// stuck here.
func (ing *EventIngestor) Enqueue(ctx context.Context, event *repositories.StoredEvent) error {
	select {
	case ing.queue <- event:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Start runs the worker loop until Stop is called or ctx is cancelled. It
// first sweeps events that were durably inserted but never finished
// applying - e.g. the process crashed mid-apply, or a transient failure is
// still waiting on a retry - so those get another chance before any new
// work is processed, then repeats that sweep every sweepInterval.
func (ing *EventIngestor) Start(ctx context.Context) {
	ing.wg.Add(1)
	go func() {
		defer ing.wg.Done()
		ing.sweepUnprocessed(ctx)

		ticker := time.NewTicker(sweepInterval)
		defer ticker.Stop()

		for {
			select {
			case event := <-ing.queue:
				ing.process(ctx, event)
			case <-ticker.C:
				ing.sweepUnprocessed(ctx)
			case <-ing.stop:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
}

// Stop signals the worker to exit and waits for it to actually stop.
func (ing *EventIngestor) Stop() {
	close(ing.stop)
	ing.wg.Wait()
}

func (ing *EventIngestor) sweepUnprocessed(ctx context.Context) {
	unprocessed, err := ing.eventRepo.FindUnprocessed(ctx)
	if err != nil {
		ing.logger.Error("failed to sweep unprocessed events", "error", err)
		return
	}
	for _, event := range unprocessed {
		ing.apply(ctx, event)
	}
}

// process durably inserts a freshly enqueued event and acks it immediately
// - the ack means "durably in the log at this seq", not "projection
// applied", so it does not wait on apply. That decoupling is the point:
// under the old model, a transiently failing projection left the event
// unacked (and without a seq) indefinitely, and a later event for the same
// list could then apply - and get a seq - first. Acking (and, if this is
// the first delivery, notifying) as soon as the event is durable removes
// that ordering hazard entirely; apply's own success or failure can no
// longer affect seq.
func (ing *EventIngestor) process(ctx context.Context, event *repositories.StoredEvent) {
	alreadyProcessed, seq, listID, err := ing.eventRepo.Insert(ctx, event)
	if err != nil {
		ing.logger.Error("failed to insert event", "event_id", event.EventID, "error", err)
		return
	}
	event.Seq = seq
	ing.publisher.PublishAck(event.UserID, event.EventID, seq)
	if alreadyProcessed {
		// A previous delivery of this exact event_id already ran apply -
		// re-applying would duplicate the side effect. No PublishListEvent
		// here: nothing newly became visible (this seq was already
		// published the first time it was processed), so a client that
		// missed that original notification recovers on its next head
		// check instead.
		return
	}
	if listID != nil {
		ing.publisher.PublishListEvent(*listID, seq)
	}
	ing.apply(ctx, event)
}

// apply dispatches an already-inserted, already-acked event to the domain
// and marks the outcome. Unlike process, it never touches seq or the ack -
// both already happened at insert time, for both a fresh event and a swept
// one (whose seq was assigned on a previous delivery).
func (ing *EventIngestor) apply(ctx context.Context, event *repositories.StoredEvent) {
	// Dispatch silently no-ops for unknown event types (forward
	// compatibility, see EventDispatcher) - that still counts as "applied",
	// so it's still marked processed. A handler error wrapped in
	// interfaces.ErrPermanent (bad payload, failed validation) is unfixable
	// by retrying and gets the same treatment - only an unwrapped,
	// presumably transient error (e.g. a DB blip) is left unprocessed for
	// the next sweep to retry.
	if err := ing.dispatcher.Dispatch(ctx, event); err != nil {
		if !errors.Is(err, interfaces.ErrPermanent) {
			ing.logger.Error(
				"failed to apply event to projection, will retry on next sweep",
				"event_id", event.EventID, "event_type", event.EventType, "error", err,
			)
			return
		}
		ing.logger.Error(
			"event permanently unapplicable, recording it without applying it",
			"event_id", event.EventID, "event_type", event.EventType, "error", err,
		)
	}
	if err := ing.eventRepo.MarkProcessed(ctx, event.EventID); err != nil {
		ing.logger.Error("failed to mark event processed", "event_id", event.EventID, "error", err)
	}
}
