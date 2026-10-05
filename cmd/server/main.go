package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/config"
	"github.com/pesherskiynikita-code/vkr-assistant/internal/integration"
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

	url := cfg.NextcloudURL
	user := cfg.NextcloudUser
	password := cfg.NextcloudAppPassword
	stack := cfg.NextcloudStack
	client := nextcloud.NewClient(url, user, password, stack)
	boards, err := client.ListBoards(context.Background())

	if err != nil {
		log.Fatal(err)
	}
	for _, b := range boards {
		fmt.Printf("%s - %s\n", b.ID, b.Title)
	}
	created, err := client.CreateCard(context.Background(), "29", integration.NewCard{Title: "тест"})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%s - %s\n", created.ID, created.Title)
}
