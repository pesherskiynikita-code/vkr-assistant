package stt

import "context"

// Transcriber превращает аудиофайл в текст.
type Transcriber interface {
	Transcribe(ctx context.Context, filename string, audio []byte) (string, error)
}

type Stub struct{}

var _ Transcriber = Stub{} // проверка, что Stub подходит под интерфейс (как в ai.go)

func (s Stub) Transcribe(ctx context.Context, filename string, audio []byte) (string, error) {
	return "сломалась камера", nil
}