CREATE TABLE events (
    id            UUID PRIMARY KEY,
    event_type    TEXT NOT NULL,
    aggregate_id  UUID NOT NULL,
    aggregate_type TEXT NOT NULL,
    payload       JSONB NOT NULL,
    occurred_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    received_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    client_id     TEXT NOT NULL
);

CREATE INDEX idx_events_aggregate ON events(aggregate_type, aggregate_id);
CREATE INDEX idx_events_occurred_at ON events(occurred_at);
