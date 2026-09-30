package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
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

	url := os.Getenv("NEXTCLOUD_URL")
	user := os.Getenv("NEXTCLOUD_USER")
	password := os.Getenv("NEXTCLOUD_APP_PASSWORD")

	client := nextcloud.NewClient(url, user, password)

	boards, err := client.ListBoards(context.Background())

	if err != nil {
		log.Fatal(err)
	}
	for _, b := range boards {
		fmt.Printf("%d - %s\n", b.ID, b.Title)
	}
}
