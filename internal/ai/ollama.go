package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration"
)

type Ollama struct {
	baseURL    string
	model      string
	httpClient *http.Client
}

type ollamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ollamaRequest struct {
	Model    string          `json:"model"`
	Stream   bool            `json:"stream"`
	Format   string          `json:"format"`
	Messages []ollamaMessage `json:"messages"`
}

type ollamaResponse struct {
	Message ollamaMessage `json:"message"`
}

type ollamaAnswer struct {
	BoardID string `json:"board_id"`
	Title   string `json:"title"`
}

func NewOllama(baseURL, model string) *Ollama {
	return &Ollama{baseURL: baseURL, model: model, httpClient: &http.Client{Timeout: 60 * time.Second}}
}

const systemPrompt =  `Ты раскладываешь заявки сервисной компании по доскам. Каждая доска это объект: магазин или здание. Доски (id: код (описание)): %s
Выбери доску по городу, сети, номеру магазина, адресу или названию ТЦ из заявки. Ответь только JSON: {"board_id": "id доски", "title": "суть проблемы в 3–7 словах, без кода и адреса объекта"}. Пример title: "Не работает касса". Если ни одна доска не подходит, board_id пустой.`

var _ Assistant = &Ollama{}

func (o *Ollama) Parse(ctx context.Context, msg string, boards []integration.Board) (Command, error) {

	var list strings.Builder
	for _, b := range boards {
		if b.Description != "" {
			fmt.Fprintf(&list, "%s: %s (%s); ", b.ID, b.Title, b.Description)
		} else {
			fmt.Fprintf(&list, "%s: %s; ", b.ID, b.Title)
		}
	}

	reqBody := ollamaRequest{
		Model:  o.model,
		Stream: false,
		Format: "json",
		Messages: []ollamaMessage{
			{Role: "system", Content: fmt.Sprintf(systemPrompt, list.String())},
			{Role: "user", Content: msg},
		},
	}

	
	body, err := json.Marshal(reqBody)
	if err != nil {
		return Command{}, fmt.Errorf("encode req: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/api/chat", o.baseURL), bytes.NewReader(body))
	if err != nil {
		return Command{}, fmt.Errorf("build request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := o.httpClient.Do(req)
	if err != nil {
		return Command{}, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Command{}, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var out ollamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return Command{}, fmt.Errorf("decode: %w", err)
	}

	var ans ollamaAnswer
	if err := json.Unmarshal([]byte(out.Message.Content), &ans); err != nil {
		return Command{}, fmt.Errorf("decode answer: %w", err)
	}

	found := false
	for _, b := range boards {
		if ans.BoardID == b.ID {
			found = true
			break
		}
	}
	if !found {
		return Command{}, ErrNoBoard
	}

	return Command{Action: "create_card", BoardID: ans.BoardID, Title: ans.Title, Description: msg}, nil
}
