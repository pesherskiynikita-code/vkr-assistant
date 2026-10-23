package stt

import (
	"bytes" 
	"context"
	"encoding/json" 
	"fmt" 
	"mime/multipart" 
	"net/http" 
	"strings"
	"time"
)

type Whisper struct {
	baseURL    string
	model      string
	httpClient *http.Client
}

func NewWhisper(baseURL, model string) *Whisper {
	return &Whisper{baseURL: baseURL, model: model, httpClient: &http.Client{Timeout: 60 * time.Second}}
}

var _ Transcriber = &Whisper{}

type whisperResponse struct {
	Text string `json:"text"`
}

func (wh *Whisper) Transcribe(ctx context.Context, filename string, audio []byte) (string, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", filename) 
	if err != nil {
		return "", fmt.Errorf("неверный формат вложения:%w", err)
	}
	fw.Write(audio)
	mw.WriteField("model", wh.model)
	mw.WriteField("language", "ru")
	mw.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/v1/audio/transcriptions", wh.baseURL), &buf)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := wh.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var out whisperResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("не прочитан ответ: %w", err)
	}

	return strings.TrimSpace(out.Text), nil
}