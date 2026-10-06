package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/config"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration/nextcloud"
)

type createCardRequest struct {
	BoardID     string `json:"board_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

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

		var req createCardRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "некорректный JSON", http.StatusBadRequest)
			return
		}
		if req.BoardID == "" {
			http.Error(w, "board_id обязателен", http.StatusBadRequest)
			return
		}
		if req.Title == "" {
			http.Error(w, "title обязателен", http.StatusBadRequest)
			return
		}
		card, err := client.CreateCard(r.Context(), req.BoardID, integration.NewCard{Title: req.Title, Description: req.Description})
		if err != nil {
			log.Println("create card:", err)
			http.Error(w, "не удалось создать карточку", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(card)
	})

	log.Println("слушаю :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))

}
