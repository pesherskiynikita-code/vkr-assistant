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
	"github.com/pesherskiynikita-code/vkr-assistant/internal/auth"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/config"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/directory"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration/nextcloud"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/stt"
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
	dir, err := directory.Load(cfg.BoardsFile)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("справочник досок: %d записей", len(dir))
	var assistant ai.Assistant = ai.NewOllama(cfg.OllamaURL, cfg.OllamaModel)
	var transcriber stt.Transcriber = stt.Stub{}
	if cfg.WhisperURL != "" {
		transcriber = stt.NewWhisper(cfg.WhisperURL, cfg.WhisperModel, cfg.WhisperPrompt)
	}
	sessions, err := auth.Open(cfg.DBPath, cfg.SessionKey)
	if err != nil {
		log.Fatal(err)
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
		json.NewEncoder(w).Encode(struct {
			Text string `json:"text"`
		}{text})
	})
	mux.HandleFunc("POST /auth/start", func(w http.ResponseWriter, r *http.Request) {
		start, err := nextcloud.StartLogin(r.Context(), cfg.NextcloudURL)
		if err != nil {
			log.Println("auth start:", err)
			http.Error(w, "Nextcloud недоступен", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"login_url":  start.Login,
			"poll_token": start.Poll.Token,
		})
	})
	mux.HandleFunc("POST /auth/poll", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			PollToken string `json:"poll_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PollToken == "" {
			http.Error(w, "нужен poll_token", http.StatusBadRequest)
			return
		}

		endpoint := strings.TrimRight(cfg.NextcloudURL, "/") + "/index.php/login/v2/poll"
		res, done, err := nextcloud.PollLogin(r.Context(), endpoint, req.PollToken)
		if err != nil {
			log.Println("auth poll:", err)
			http.Error(w, "Nextcloud недоступен", http.StatusBadGateway)
			return
		}
		if !done {
			w.WriteHeader(http.StatusAccepted) // 202: запрос принят, но результата ещё нет
			return
		}

		token, err := sessions.Create(res.LoginName, res.AppPassword)
		if err != nil {
			log.Println("create session:", err)
			http.Error(w, "не удалось создать сессию", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"token": token,
			"login": res.LoginName,
		})
	})
	mux.HandleFunc("GET /me", func(w http.ResponseWriter, r *http.Request) {
		login, _, err := sessions.Lookup(bearerToken(r))
		if errors.Is(err, auth.ErrNoSession) {
			http.Error(w, "нужно войти", http.StatusUnauthorized) // 401
			return
		}
		if err != nil {
			log.Println("me:", err)
			http.Error(w, "ошибка сервера", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"login": login})
	})

	log.Println("слушаю :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))

}

// bearerToken достаёт токен из заголовка "Authorization: Bearer <токен>".
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(h, "Bearer ")
	if !ok {
		return ""
	}
	return token
}
