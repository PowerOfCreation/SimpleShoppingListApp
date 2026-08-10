package request

// CreateListInviteRequest carries the client-chosen validity preset. TTL is
// validated against the fixed preset list by entities.ParseInviteTTL, not
// here - an invalid value surfaces as ErrInvalidInviteTTL from the service.
type CreateListInviteRequest struct {
	TTL string `json:"ttl"`
}
