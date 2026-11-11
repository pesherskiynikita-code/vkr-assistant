package auth

import (
	"errors"
	"path/filepath"
	"testing"
)

// Ключ только для тестов: 32 байта 0, 1, 2 … 31 в base64. Настоящий лежит в Portainer.
const testKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

func TestStore(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "test.db"), testKey)
	if err != nil {
		t.Fatal(err)
	}

	// 1. Create
	token, err := s.Create("nikita", "secret")
	if err != nil {
		t.Fatal(err)
	}

	// 2. Lookup того же токена
	login, pass, err := s.Lookup(token)
	if err != nil || login != "nikita" || pass != "secret" {
		t.Fatalf("Lookup: %q %q %v", login, pass, err)
	}
	_, _, err = s.Lookup("чужой")
	if !errors.Is(err, ErrNoSession) {
		t.Fatalf("ждали ErrNoSession, получили %v", err)
	}
	
	if err := s.Delete(token); err != nil {
		t.Fatal(err)
	}
	_, _, err = s.Lookup(token)
	if !errors.Is(err, ErrNoSession) {
		t.Fatalf("ждали ErrNoSession, получили %v", err)
	}
}

