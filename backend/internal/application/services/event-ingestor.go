package services

import (
	"context"
	"log/slog"
	"sync"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

const eventQueueCapacity = 10_000

// realtimePublisher is what the ingestor actually needs from the realtime
// layer: ack the sender, and notify anyone subscribed to the event's list.
// A single combined interface rather than two separate constructor
// parameters, since in practice one hub (internal/infrastructure/realtime)
// implements both and there's never a reason to wire them independently.
type realtimePublisher interface {
	interfaces.AckPublisher
	interfaces.ListEventPublisher
}

// EventIngestor durably persists incoming events and dispatches them to the
// domain asynchronously. This is what lets EventController.SyncEvents
// respond 202 before anything is actually written - Enqueue only pushes
// onto an in-memory queue and returns.
//
// A single worker goroutine drains that queue strictly in enqueue order.
// That single fact is what keeps two events for the same aggregate from
// ever being processed out of order without any per-aggregate locking: as
// long as a client sends its own events in order (the frontend's sync
// engine flushes one batch at a time, oldest-first), and a single request's
// events are enqueued in a simple in-order loop, this worker will process
// them in exactly that order. It also means the "insert conflicts but is
// still unprocessed" case Insert()'s docs mention cannot arise from two
// concurrent Enqueue calls for the same event_id - the second one is
// simply queued behind the first, which will have finished (successfully
// or not) by the time the worker gets to it.
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
// processing - e.g. the process crashed between Insert and the
// dispatch+MarkProcessed step - so those get another chance before any new
// work is processed.
func (ing *EventIngestor) Start(ctx context.Context) {
	ing.wg.Add(1)
	go func() {
		defer ing.wg.Done()
		ing.sweepUnprocessed(ctx)

		for {
			select {
			case event := <-ing.queue:
				ing.process(ctx, event)
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
		ing.dispatchAndAck(ctx, event)
	}
}

func (ing *EventIngestor) process(ctx context.Context, event *repositories.StoredEvent) {
	alreadyProcessed, seq, _, err := ing.eventRepo.Insert(ctx, event)
	if err != nil {
		ing.logger.Error("failed to insert event", "event_id", event.EventID, "error", err)
		return
	}
	if alreadyProcessed {
		// A previous delivery of this exact event_id already ran the
		// dispatch and marked it processed - re-dispatching would
		// duplicate the side effect. The server does durably have it, so
		// still ack: this is exactly the case a client resends after a
		// lost ack (self-heal), and it must not loop forever. No
		// PublishListEvent here: nothing newly became visible (the seq this
		// event got was already published the first time it was
		// processed), so a client that missed that original notification
		// recovers on its next head check instead.
		ing.publisher.PublishAck(event.ClientID, event.EventID, seq)
		return
	}
	ing.dispatchAndAck(ctx, event)
}

func (ing *EventIngestor) dispatchAndAck(ctx context.Context, event *repositories.StoredEvent) {
	// Dispatch silently no-ops for unknown event types (forward
	// compatibility, see EventDispatcher) - that still counts as "durably
	// received", so it's still marked processed and acked. Only handled
	// types that error should stay unprocessed for a retry.
	if err := ing.dispatcher.Dispatch(ctx, event.EventType, event.AggregateID, event.Payload); err != nil {
		ing.logger.Error(
			"failed to dispatch event",
			"event_id", event.EventID, "event_type", event.EventType, "error", err,
		)
		return
	}
	seq, listID, err := ing.eventRepo.MarkProcessed(ctx, event.EventID)
	if err != nil {
		ing.logger.Error("failed to mark event processed", "event_id", event.EventID, "error", err)
		return
	}
	ing.publisher.PublishAck(event.ClientID, event.EventID, seq)
	if listID != nil {
		ing.publisher.PublishListEvent(*listID, seq)
	}
}
