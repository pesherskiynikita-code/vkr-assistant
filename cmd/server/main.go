package main

import (
	"errors"
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/config"

	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration/nextcloud"
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

	nextcloud.NewClient(cfg.NextcloudURL, cfg.NextcloudUser, cfg.NextcloudAppPassword, cfg.NextcloudStack)
	client := nextcloud.NewClient
	_ = client

	mux := http.NewServeMux() // «табличка»: какой адрес какой функцией обслуживать

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	log.Println("слушаю :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
