package integration

import "context"

type Board struct {
	ID    string
	Title string
}

type Integration interface {
	ListBoards(ctx context.Context) ([]Board, error)
}
