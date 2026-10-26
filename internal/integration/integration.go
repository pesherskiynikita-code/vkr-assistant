package integration

import "context"

type Board struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Description string `json:"description,omitempty"`
}

type Integration interface {
	ListBoards(ctx context.Context) ([]Board, error)
	CreateCard(ctx context.Context, boardID string, card NewCard) (Card, error)
}

type NewCard struct {
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Attachments []Attachment `json:"-"`
}

type Card struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}
type Attachment struct {
	Filename string
	Data     []byte
}
