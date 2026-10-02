package nextcloud

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration"
)

type deckBoard struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	Archived  bool   `json:"archived"`
	DeletedAt int64  `json:"deletedAt"`
}
type deckStack struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	Archived  bool   `json:"archived"`
	DeletedAt int64  `json:"deletedAt"`
}
type Client struct {
	baseURL    string
	user       string
	password   string
	httpClient *http.Client
	stack      string
}

var ErrStackNotFound = errors.New("stack not found")

func NewClient(baseURL, user, password, stack string) *Client {
	return &Client{baseURL: baseURL, user: user, password: password, stack: stack, httpClient: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) ListBoards(ctx context.Context) ([]integration.Board, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/index.php/apps/deck/api/v1.0/boards", nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("OCS-APIRequest", "true")
	req.SetBasicAuth(c.user, c.password)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var boards []deckBoard
	if err := json.NewDecoder(resp.Body).Decode(&boards); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	result := make([]integration.Board, 0, len(boards))
	for _, b := range boards {
		if b.Archived || strings.HasPrefix(strings.TrimSpace(b.Title), "$") || b.DeletedAt != 0 {
			continue
		}

		result = append(result, integration.Board{ID: strconv.Itoa(b.ID), Title: strings.TrimSpace(b.Title)})
	}
	return result, nil

}
func (c *Client) findStack(ctx context.Context, boardID int, name string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/index.php/apps/deck/api/v1.0/boards/%d/stacks", c.baseURL, boardID), nil)
	if err != nil {
		return 0, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("OCS-APIRequest", "true")
	req.SetBasicAuth(c.user, c.password)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var stacks []deckStack
	if err := json.NewDecoder(resp.Body).Decode(&stacks); err != nil {
		return 0, fmt.Errorf("decode: %w", err)
	}
	for _, s := range stacks {
		if strings.HasPrefix(strings.TrimSpace(s.Title), "$") || s.DeletedAt != 0 {
			continue

		}
		if strings.EqualFold(strings.TrimSpace(name), strings.TrimSpace(s.Title)) {
			return s.ID, nil

		}
	}
	return 0, fmt.Errorf("%d %q %w", boardID, name, ErrStackNotFound)
}
func (c *Client) CreateCard(ctx context.Context, boardID string, card integration.NewCard) (integration.Card, error) {
	n, err := strconv.Atoi(boardID)
	if err != nil {
		return integration.Card{}, fmt.Errorf("no id: %w", err)
	}
	stackID, err := c.findStack(ctx, n, c.stack)
	if err != nil {
		return integration.Card{}, fmt.Errorf("create card: %w", err)

	}
	fmt.Println(stackID)
}
