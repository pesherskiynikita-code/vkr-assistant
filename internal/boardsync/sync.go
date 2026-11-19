// Пакет boardsync: фоновое описание досок через ИИ и прогресс для телефона.
package boardsync

import (
	"sync"
	"context"
	"log"
	"strings"
	"time"

	"github.com/pesherskiynikita-code/vkr-assistant/internal/ai"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/auth"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration/nextcloud"


)

// Syncer описывает доски в фоне и помнит, сколько уже готово.
type Syncer struct {
	ollama   *ai.Ollama
	sessions *auth.Store

	mu      sync.Mutex
	running bool
	done    int
	total   int
}

func New(ollama *ai.Ollama, sessions *auth.Store) *Syncer {
	return &Syncer{ollama: ollama, sessions: sessions}
}

// Status: текущее состояние, для ответа телефону.
func (s *Syncer) Status() (running bool, done, total int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running, s.done, s.total
}

// step: ещё одна доска готова (или пропущена).
func (s *Syncer) step() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.done++
}

// finish: описание закончилось.
func (s *Syncer) finish() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = false
}

// Start: запустить описание в фоне. Вернёт false, если оно уже идёт.
func (s *Syncer) Start(client *nextcloud.Client, boards []integration.Board) bool {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return false
	}
	s.running = true
	s.done = 0
	s.total = len(boards)
	s.mu.Unlock()

	go s.run(client, boards)
	return true
}

// run: описывает доски по очереди и двигает счётчик.
func (s *Syncer) run(client *nextcloud.Client, boards []integration.Board) {
	defer s.finish()
	for _, b := range boards {
		s.describe(client, b)
		s.step()
	}
}

// describe: одна доска. Карточки → qwen → база.
func (s *Syncer) describe(client *nextcloud.Client, b integration.Board) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	sample, err := client.BoardSample(ctx, b.ID, 40)
	if err != nil {
		log.Printf("профиль доски %s: карточки: %v", b.ID, err)
		return
	}
	cards := 0
	for _, line := range sample {
		if strings.HasPrefix(line, "- ") {
			cards++
		}
	}
	if cards < 3 {
		log.Printf("профиль доски %s: карточек мало (%d), пропускаю", b.ID, cards)
		return
	}
	desc, err := s.ollama.Describe(ctx, b.Title, sample)
	if err != nil {
		log.Printf("профиль доски %s: qwen: %v", b.ID, err)
		return
	}
	if err := s.sessions.SaveProfile(b.ID, desc); err != nil {
		log.Printf("профиль доски %s: сохранение: %v", b.ID, err)
		return
	}
	log.Printf("профиль доски %s (%s): %s", b.ID, b.Title, desc)
}