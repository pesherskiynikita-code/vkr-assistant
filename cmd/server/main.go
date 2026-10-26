package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/ai"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/config"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration/nextcloud" 
	"github.com/pesherskiynikita-code/vkr-assistant/internal/stt"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/directory"
)

func main() {
	err := godotenv.Load()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			log.Println(".env не найдена")
		} else {
			log.Fatal(err)
		}
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	dir, err := directory.Load(cfg.boardsFile)
	if err != nil {
		log.Fatal(err)
	}
log.Printf("справочник досок: %d записей", len(dir))
	var assistant ai.Assistant = ai.NewOllama(cfg.OllamaURL, cfg.OllamaModel)
	var transcriber stt.Transcriber = stt.Stub{}
	if cfg.WhisperURL != "" {
		transcriber = stt.NewWhisper(cfg.WhisperURL, cfg.WhisperModel)
	}	
	client := nextcloud.NewClient(cfg.NextcloudURL, cfg.NextcloudUser, cfg.NextcloudAppPassword, cfg.NextcloudStack)
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /boards", func(w http.ResponseWriter, r *http.Request) {
		boards, err := client.ListBoards(r.Context())
		if err != nil {
			log.Println("list boards:", err)
			http.Error(w, "не удалось получить доски", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(boards)
	})

	mux.HandleFunc("POST /cards", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(32 << 20); err != nil { // разобрать форму, до 32 МБ в памяти
			http.Error(w, "некорректная форма", http.StatusBadRequest)
			return
		}
		boardID := r.FormValue("board_id")
		title := r.FormValue("title")
		description := r.FormValue("description")

		if boardID == "" {
			http.Error(w, "board_id обязателен", http.StatusBadRequest)
			return
		}
		if title == "" {
			http.Error(w, "title обязателен", http.StatusBadRequest)
			return
		}

		var attachments []integration.Attachment
		for _, fh := range r.MultipartForm.File["files"] {
			f, err := fh.Open()
			if err != nil {
				http.Error(w, "не удалось прочитать файл", http.StatusBadRequest)
				return
			}
			data, err := io.ReadAll(f)
			f.Close()
			if err != nil {
				http.Error(w, "не удалось прочитать файл", http.StatusBadRequest)
				return
			}
			attachments = append(attachments, integration.Attachment{Filename: fh.Filename, Data: data})
		}

		card, err := client.CreateCard(r.Context(), boardID, integration.NewCard{Title: title, Description: description, Attachments: attachments})
		if err != nil {
			log.Println("create card:", err)
			http.Error(w, "не удалось создать карточку", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(card)
	})

	mux.HandleFunc("POST /assist", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Text string `json:"text"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(req.Text) == "" {
			http.Error(w, "text is required", http.StatusBadRequest)
			return
		}

		boards, err := client.ListBoards(r.Context())
		if err != nil {
			log.Println("list boards:", err)
			http.Error(w, "не удалось получить доски", http.StatusBadGateway)
			return
		}

		if len(dir) > 0 {
			var known []integration.Board
			for _, b := range boards {
				if desc, ok := dir[b.ID]; ok {   
					b.Description = desc
					known = append(known, b)
					}
			}
			boards = known
		}
		cmd, err := assistant.Parse(r.Context(), req.Text, boards)
		if errors.Is(err, ai.ErrNoBoard) {
			http.Error(w, "не удалось определить доску", http.StatusUnprocessableEntity)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		json.NewEncoder(w).Encode(cmd)

	})
	mux.HandleFunc("POST /transcribe", func(w http.ResponseWriter, r *http.Request) {
	// 1. r.ParseMultipartForm(32 << 20), ошибка → 400
		if err := r.ParseMultipartForm(32 << 20); err != nil { // разобрать форму, до 32 МБ в памяти
			http.Error(w, "некорректная форма", http.StatusBadRequest)
			return
		}
		file, header, err := r.FormFile("audio")
		if err != nil {
			http.Error(w, "нет поля аудио", http.StatusBadRequest)
			return
		}
		defer file.Close()

		data, err := io.ReadAll(file)
		if err != nil {
			http.Error(w, "нет поля аудио", http.StatusBadRequest)
			return
		}
		text, err := transcriber.Transcribe(r.Context(), header.Filename, data)
		if err != nil {
			log.Println("не удалось прочитать файл", err)
			http.Error(w, "не удалось получить текст", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(struct{ Text string `json:"text"`}{text})
})

	log.Println("слушаю :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))

}
