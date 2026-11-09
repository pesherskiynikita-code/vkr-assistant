package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
)

// newToken: 32 случайных байта, записанные как hex-строка (символы 0-9 и a-f).
func newToken() (string, error) {
	b := make([]byte, 32)                   // срез на 32 байта, пока нули
	if _, err := rand.Read(b); err != nil { // rand.Read заполняет его случайными байтами
		return "", err
	}
	return hex.EncodeToString(b), nil // байты в строку: функция EncodeToString
}

// hashToken: отпечаток токена, его кладём в базу.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// parseKey: SESSION_KEY из base64 в 32 байта.
func parseKey(b64 string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(b64) // «декодировать строку»
	if err != nil {
		return nil, fmt.Errorf("SESSION_KEY не base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("SESSION_KEY должен быть 32 байта, а не %d", len(key))
	}
	return key, nil
}
func encrypt(key []byte, plain string) ([]byte, error) {
	block, err := aes.NewCipher(key) // AES с нашим ключом
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block) // режим GCM поверх AES
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())      // 12 байт
	if _, err := rand.Read(nonce); err != nil { // заполни nonce случайными байтами, как в newToken
		return nil, err
	}
	// Seal(куда_дописать, nonce, что_шифровать, доп_данные)
	return gcm.Seal(nonce, nonce, []byte(plain), nil), nil
}

func decrypt(key, data []byte) (string, error) {
	// первые 8 строк такие же, как в encrypt: aes.NewCipher и cipher.NewGCM с проверками
	block, err := aes.NewCipher(key) // AES с нашим ключом
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block) // режим GCM поверх AES
	if err != nil {
		return "", err
	}

	// защита: если данных меньше, чем длина nonce, резать нечего
	if len(data) < gcm.NonceSize() {
		return "", errors.New("шифротекст слишком короткий")
	}
	nonce, sealed := data[:gcm.NonceSize()], data[____:] // две переменные одной строкой

	// Open(куда_дописать, nonce, что_расшифровать, доп_данные): зеркально Seal
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", err // другой ключ или испорченные данные
	}
	return ____(plain), nil // байты обратно в строку
}
