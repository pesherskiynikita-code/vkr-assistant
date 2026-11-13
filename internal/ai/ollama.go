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
	Format   string          `json:"format,omitempty"`
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

const systemPrompt = `Ты раскладываешь заявки сервисной компании по доскам. Каждая доска это объект: магазин или здание. Доски (id: код (описание)): %s
Выбери доску по городу, сети, номеру магазина, адресу или названию ТЦ из заявки. Ответь только JSON: {"board_id": "id доски", "title": "суть проблемы в 3–7 словах, без кода и адреса объекта"}. Пример title: "Не работает касса". Если ни одна доска не подходит, board_id пустой.`

const describePrompt = `Тебе дают название доски Nextcloud Deck, её списки и примеры карточек. Опиши доску одной-двумя строками: город, сеть или объект, адрес или ТЦ, если они видны, и какие заявки туда попадают. Пиши только описание, без вступления.`

// Describe: по названию доски и примерам карточек qwen пишет короткое описание доски.
func (o *Ollama) Describe(ctx context.Context, title string, sample []string) (string, error) {
	user := "Доска: " + title + "\n" + strings.Join(sample, "\n")
	text, err := o.chat(ctx, describePrompt, user, "")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(text), nil
}

var _ Assistant = &Ollama{}

// chat: один вопрос к модели. format "json" — ответ строго JSON, "" — обычный текст.
func (o *Ollama) chat(ctx context.Context, system, user, format string) (string, error) {
	reqBody := ollamaRequest{
		Model:  o.model,
		Stream: false,
		Format: format,
		Messages: []ollamaMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("encode req: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/api/chat", o.baseURL), bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := o.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var out ollamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decode: %w", err)
	}
	return out.Message.Content, nil
}

func (o *Ollama) Parse(ctx context.Context, msg string, boards []integration.Board) (Command, error) {
	var list strings.Builder
	for _, b := range boards {
		if b.Description != "" {
			fmt.Fprintf(&list, "%s: %s (%s); ", b.ID, b.Title, b.Description)
		} else {
			fmt.Fprintf(&list, "%s: %s; ", b.ID, b.Title)
		}
	}
	content, err := o.chat(ctx, fmt.Sprintf(systemPrompt, list.String()), msg, "json")
	if err != nil {
		return Command{}, err
	}
	var ans ollamaAnswer
	if err := json.Unmarshal([]byte(content), &ans); err != nil {
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
