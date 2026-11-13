package auth

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// Store: всё, что нужно для работы с сессиями. Соединение с базой и ключ шифрования.
type Store struct {
	db  *sql.DB
	key []byte
}

// Open открывает файл базы (если его нет, SQLite создаст) и готовит таблицу.
func Open(path, sessionKey string) (*Store, error) {
	key, err := parseKey(sessionKey) // функция из crypto.go: строка base64 → 32 байта
	if err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", path) // имя драйвера
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS sessions (
		token_hash   TEXT PRIMARY KEY,
		login        TEXT NOT NULL,
		app_password BLOB NOT NULL,
		created_at   INTEGER NOT NULL
	)`)
	if err != nil {
		return nil, fmt.Errorf("create table: %w", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS board_profiles (
	board_id    TEXT PRIMARY KEY,
	description TEXT NOT NULL,
	updated_at  INTEGER NOT NULL
	)`)
	if err != nil {
		return nil, fmt.Errorf("create table board_profiles: %w", err)
	}

	return &Store{db: db, key: key}, nil
}

// Create: новая сессия. Возвращает пропуск, который уйдёт на телефон.
func (s *Store) Create(login, appPassword string) (string, error) {
	token, err := newToken() // новый пропуск, функция из crypto.go
	if err != nil {
		return "", err
	}
	enc, err := encrypt(s.key, appPassword) // что шифруем?
	if err != nil {
		return "", err
	}
	_, err = s.db.Exec(
		`INSERT INTO sessions (token_hash, login, app_password, created_at) VALUES (?, ?, ?, ?)`,
		hashToken(token), login, enc, time.Now().Unix(),
	)
	if err != nil {
		return "", fmt.Errorf("insert: %w", err)
	}
	return token, nil // телефону отдаём сам пропуск, а в базе остался только его хэш
}

var ErrNoSession = errors.New("сессия не найдена") // над функцией, в import "errors"

func (s *Store) Lookup(token string) (login, appPassword string, err error) {
	var enc []byte
	err = s.db.QueryRow(
		`SELECT login, app_password FROM sessions WHERE token_hash = ?`,
		hashToken(token), // ищем по отпечатку
	).Scan(&login, &enc)

	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrNoSession
	}
	if err != nil {
		return "", "", fmt.Errorf("select: %w", err)
	}

	appPassword, err = decrypt(s.key, enc) // обратно в открытый пароль
	if err != nil {
		return "", "", fmt.Errorf("decrypt: %w", err)
	}
	return login, appPassword, nil
}

// Delete: выход. Удаляем сессию по отпечатку пропуска.
func (s *Store) Delete(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hashToken(token))
	return err
}
