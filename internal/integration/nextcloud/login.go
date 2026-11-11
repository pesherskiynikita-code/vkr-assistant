package nextcloud

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Ответ на старт входа: ссылка для браузера и данные для опроса.
type LoginStart struct {
	Login string `json:"login"` // её откроет телефон
	Poll  struct {
		Token    string `json:"token"`
		Endpoint string `json:"endpoint"`
	} `json:"poll"`
}

// Что приходит, когда человек вошёл.
type LoginResult struct {
	Server      string `json:"server"`
	LoginName   string `json:"loginName"`
	AppPassword string `json:"appPassword"`
}

var loginHTTP = &http.Client{Timeout: 10 * time.Second}

func StartLogin(ctx context.Context, baseURL string) (LoginStart, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/index.php/login/v2", nil)
	if err != nil {
		return LoginStart{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "vkr-assistant") // так пароль приложения подпишется в настройках Nextcloud
	resp, err := loginHTTP.Do(req)
	if err != nil {
		return LoginStart{}, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return LoginStart{}, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	var start LoginStart
	if err := json.NewDecoder(resp.Body).Decode(&start); err != nil {
		return LoginStart{}, fmt.Errorf("decode: %w", err)
	}
	return start, nil
}

// done == false: человек ещё не вошёл, это не ошибка, просто спросим позже.
func PollLogin(ctx context.Context, endpoint, token string) (res LoginResult, done bool, err error) {
	form := url.Values{}
	form.Set("token", token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return LoginResult{}, false, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := loginHTTP.Do(req)
	if err != nil {
		return LoginResult{}, false, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusNotFound:
		return LoginResult{}, false, nil
	case http.StatusOK:
		if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
			return LoginResult{}, false, fmt.Errorf("decode: %w", err)
		}
		return res, true, nil
	default:
		return LoginResult{}, false, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
}

// RevokeAppPassword удаляет пароль приложения в Nextcloud: после этого он больше не работает.
func RevokeAppPassword(ctx context.Context, baseURL, login, appPassword string) error {
	url := strings.TrimRight(baseURL, "/") + "/ocs/v2.php/core/apppassword"
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	req.SetBasicAuth(login, appPassword)
	req.Header.Set("OCS-APIRequest", "true")

	resp, err := loginHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("revoke app password: статус %d", resp.StatusCode)
	}
	return nil
}
