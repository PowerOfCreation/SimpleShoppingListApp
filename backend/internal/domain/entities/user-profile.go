package entities

import "errors"

// UserProfile contains only a verified subject and optional OIDC given_name.
type UserProfile struct {
	userID    string
	firstName string
}

func NewUserProfile(userID, firstName string) (*UserProfile, error) {
	if userID == "" {
		return nil, errors.New("user ID must not be empty")
	}
	return &UserProfile{userID: userID, firstName: firstName}, nil
}

func (p *UserProfile) UserID() string { return p.userID }

func (p *UserProfile) FirstName() string { return p.firstName }
