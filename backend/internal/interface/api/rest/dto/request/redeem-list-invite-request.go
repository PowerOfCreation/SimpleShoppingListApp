package request

// RedeemListInviteRequest carries the plaintext token from the invite link.
type RedeemListInviteRequest struct {
	Token string `json:"token"`
}
