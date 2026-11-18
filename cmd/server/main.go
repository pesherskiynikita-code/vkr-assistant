package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"context"
	"time"

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
	ollama := ai.NewOllama(cfg.OllamaURL, cfg.OllamaModel)
	var assistant ai.Assistant = ollama
	var transcriber stt.Transcriber = stt.Stub{}
	if cfg.WhisperURL != "" {
		transcriber = stt.NewWhisper(cfg.WhisperURL, cfg.WhisperModel, cfg.WhisperPrompt)
	}
	sessions, err := auth.Open(cfg.DBPath, cfg.SessionKey)
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /boards", requireAuth(sessions, cfg, func(w http.ResponseWriter, r *http.Request, client *nextcloud.Client) {
		boards, err := client.ListBoards(r.Context())
		if err != nil {
			log.Println("list boards:", err)
			http.Error(w, "не удалось получить доски", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(boards)
	}))

	mux.HandleFunc("POST /cards", requireAuth(sessions, cfg, func(w http.ResponseWriter, r *http.Request, client *nextcloud.Client) {
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
	}))

	mux.HandleFunc("POST /assist", requireAuth(sessions, cfg, func(w http.ResponseWriter, r *http.Request, client *nextcloud.Client) {
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

		profiles, err := sessions.Profiles()
		if err != nil {
			log.Println("profiles:", err) // не беда: просто пойдём без автоописаний
		}

		var missing []integration.Board // доски, для которых описания ещё нет
		for i, b := range boards {
			if desc, ok := dir[b.ID]; ok {
				boards[i].Description = desc // ручное описание из boards.json важнее
			} else if desc, ok := profiles[b.ID]; ok {
				boards[i].Description = desc // автоописание из базы
			} else {
				missing = append(missing, b)
			}
		}
		if len(missing) > 0 && describing.TryLock() {
			go describeBoards(client, ollama, sessions, missing)
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

	}))

	mux.HandleFunc("POST /transcribe", requireAuth(sessions, cfg, func(w http.ResponseWriter, r *http.Request, client *nextcloud.Client) {
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
	}))

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
	mux.HandleFunc("POST /auth/logout", func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		login, appPassword, err := sessions.Lookup(token)
		if errors.Is(err, auth.ErrNoSession) {
			w.WriteHeader(http.StatusNoContent) // 204: и так не вошёл, считаем, что вышел
			return
		}
		if err != nil {
			log.Println("logout:", err)
			http.Error(w, "ошибка сервера", http.StatusInternalServerError)
			return
		}
		if err := nextcloud.RevokeAppPassword(r.Context(), cfg.NextcloudURL, login, appPassword); err != nil {
			log.Println("revoke:", err) // записываем, но выход не останавливаем
		}
		if err := sessions.Delete(token); err != nil {
			log.Println("logout delete:", err)
			http.Error(w, "ошибка сервера", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
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

// authedHandler это обработчик, который получает клиента Nextcloud вошедшего пользователя.
type authedHandler func(w http.ResponseWriter, r *http.Request, client *nextcloud.Client)

// requireAuth пропускает запрос к next, только если в нём действующий токен.

func requireAuth(sessions *auth.Store, cfg config.Config, next authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		login, appPassword, err := sessions.Lookup(bearerToken(r))
		if errors.Is(err, auth.ErrNoSession) {
			http.Error(w, "нужно войти", http.StatusUnauthorized)
			return
		}
		if err != nil {
			log.Println("auth:", err)
			http.Error(w, "ошибка сервера", http.StatusInternalServerError)
			return
		}

		client := nextcloud.NewClient(cfg.NextcloudURL, login, appPassword, cfg.NextcloudStack)
		next(w, r, client)
	}
}
// describing не даёт запустить два фоновых описания одновременно.
var describing sync.Mutex

// describeBoards: для досок без описания берёт карточки, просит qwen описать доску и сохраняет в базу.
func describeBoards(client *nextcloud.Client, ollama *ai.Ollama, sessions *auth.Store, boards []integration.Board) {
	defer describing.Unlock()
	for _, b := range boards {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		sample, err := client.BoardSample(ctx, b.ID, 40)
		if err != nil {
			cancel()
			log.Printf("профиль доски %s: карточки: %v", b.ID, err)
			continue
		}
		desc, err := ollama.Describe(ctx, b.Title, sample)
		cancel()
		if err != nil {	
			log.Printf("профиль доски %s: qwen: %v", b.ID, err)
			continue
		}
		if err := sessions.SaveProfile(b.ID, desc); err != nil {
			log.Printf("профиль доски %s: сохранение: %v", b.ID, err)
			continue
		}
		log.Printf("профиль доски %s (%s): %s", b.ID, b.Title, desc)
	}
}