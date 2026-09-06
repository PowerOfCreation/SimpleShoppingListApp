package services

import (
	"context"

	"github.com/google/uuid"

	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/entities"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/domain/repositories"
)

type ListMembersService struct {
	profiles repositories.UserProfileRepository
	access   interfaces.ListAccessService
}

func NewListMembersService(profiles repositories.UserProfileRepository, access interfaces.ListAccessService) interfaces.ListMembersService {
	return &ListMembersService{profiles: profiles, access: access}
}

func (s *ListMembersService) FindMembers(ctx context.Context, userID string, listID uuid.UUID) ([]*entities.UserProfile, error) {
	if err := s.access.RequireRead(ctx, userID, listID); err != nil {
		return nil, err
	}
	return s.profiles.FindByList(ctx, listID)
}
