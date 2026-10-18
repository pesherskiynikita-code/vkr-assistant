package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration"
)

func TestStubFindsBoard(t *testing.T) {
	boards := []integration.Board{{ID: "29", Title: "Личное"}}

	cmd, err := Stub{}.Parse(context.Background(), "Личное: Сломалась камера", boards)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cmd.BoardID != "29" {
		t.Errorf("BoardID = %q, want %q", cmd.BoardID, "29")
	}
}
func TestStubNoBoard(t *testing.T) {
	boards := []integration.Board{{ID: "29", Title: "Личное"}}

	_, err := Stub{}.Parse(context.Background(), "Купить молоко", boards)

	if !errors.Is(err, ErrNoBoard) {
		t.Errorf("err = %v, want ErrNoBoard", err)
	}
}
