package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration"
)

// Command: что ИИ предлагает сделать
type Command struct {
	Action      string `json:"action"`
	BoardID     string `json:"board_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type Assistant interface {
	Parse(ctx context.Context, msg string, boards []integration.Board) (Command, error)
}

var ErrNoBoard = errors.New("board not found")

type Stub struct{}

var _ Assistant = Stub{}

func (s Stub) Parse(ctx context.Context, msg string, boards []integration.Board) (Command, error) {
	for _, b := range boards {
		if strings.Contains(strings.ToLower(msg), strings.ToLower(b.Title)) {
			return Command{
				Action:  "create_card",
				BoardID: b.ID,
				Title:   msg,
			}, nil
		}
	}
	return Command{}, ErrNoBoard
}
