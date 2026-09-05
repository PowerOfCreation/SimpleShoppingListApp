package request

// CreateListInviteRequest carries the client-chosen validity preset and a
// snapshot of the list's current name. TTL is validated against the fixed
// preset list by entities.ParseInviteTTL, not here - an invalid value
// surfaces as ErrInvalidInviteTTL from the service. ListName is stored
// as-is, unvalidated: the server is content-blind and has no way to check
// it against the list itself (see entities.ListInvite.ListName).
type CreateListInviteRequest struct {
	TTL      string `json:"ttl"`
	ListName string `json:"list_name"`
}
