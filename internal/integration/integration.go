package integration

import "context"

type Board struct {
	ID    int
	Title string
}

type Integration interface {
	ListBoards(ctx context.Context) ([]Board, error)
}
