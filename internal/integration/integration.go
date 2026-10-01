package integration

import "context"

type Board struct {
	ID    string
	Title string
}

type Integration interface {
	ListBoards(ctx context.Context) ([]Board, error)
	CreateCard(ctx context.Context, boardID string, card NewCard) (Card, error)
}

type NewCard struct {
	Title       string
	Description string
}

type Card struct {
	ID    string
	Title string
}
