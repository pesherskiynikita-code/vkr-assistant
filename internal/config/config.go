package config

import (
	"fmt"
	"os"
)

type Config struct {
	NextcloudURL         string
	NextcloudUser        string
	NextcloudAppPassword string
	NextcloudStack       string
	OllamaURL            string
	OllamaModel          string
}

func required(key string) (string, error) {
	value := os.Getenv(key)
	if value == "" {
		err := fmt.Errorf("переменная %s не найдена", key)
		return "", err
	}
	return value, nil
}

func Load() (Config, error) {
	url, err := required("NEXTCLOUD_URL")
	if err != nil {
		return Config{}, err
	}

	user, err := required("NEXTCLOUD_USER")
	if err != nil {
		return Config{}, err
	}

	pass, err := required("NEXTCLOUD_APP_PASSWORD")
	if err != nil {
		return Config{}, err
	}

	stack := os.Getenv("NEXTCLOUD_STACK")
	if stack == "" {
		stack = "принято"
	}

	model := os.Getenv("OllamaModel")
	if model == "" {
		model = "qwen2.5:7b"
	}

	olUrl := os.Getenv("OllamaURL")
	if err != nil {
		return Config{}, err
	}
	return Config{NextcloudURL: url, NextcloudUser: user, NextcloudAppPassword: pass, NextcloudStack: stack, OllamaURL: olUrl, OllamaModel: model}, nil
}
