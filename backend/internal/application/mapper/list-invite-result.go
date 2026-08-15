package mapper

import (
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/common"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
)

func NewListInviteResultFromEntity(invite *entities.ListInvite) *common.ListInviteResult {
	return &common.ListInviteResult{
		ID:        invite.ID,
		ListID:    invite.ListID,
		CreatedBy: invite.CreatedBy,
		CreatedAt: invite.CreatedAt,
		ExpiresAt: invite.ExpiresAt,
	}
}
