package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

func hashPassword(password string) string {
	sum := sha256.Sum256([]byte("canal-plus:" + password))
	return hex.EncodeToString(sum[:])
}

func verifyPassword(password string, expectedHash string) bool {
	actual, err := hex.DecodeString(hashPassword(password))
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(expectedHash)
	if err != nil {
		return false
	}
	return hmac.Equal(actual, expected)
}

func secretKey() []byte {
	source := os.Getenv("CANAL_PLUS_SECRET")
	if source == "" {
		source = "canal-plus-dev-secret-change-me"
	}
	sum := sha256.Sum256([]byte(source))
	return sum[:]
}

func encryptText(plainText string) (string, error) {
	block, err := aes.NewCipher(secretKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(plainText), nil)
	tagSize := gcm.Overhead()
	ciphertext := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]
	encode := base64.RawURLEncoding.EncodeToString
	return "enc:v1:" + encode(nonce) + ":" + encode(tag) + ":" + encode(ciphertext), nil
}

func decryptText(secret string) (string, error) {
	if !strings.HasPrefix(secret, "enc:v1:") {
		return secret, nil
	}
	parts := strings.Split(secret, ":")
	if len(parts) != 5 {
		return "", fmt.Errorf("invalid encrypted value")
	}
	decode := base64.RawURLEncoding.DecodeString
	nonce, err := decode(parts[2])
	if err != nil {
		return "", err
	}
	tag, err := decode(parts[3])
	if err != nil {
		return "", err
	}
	ciphertext, err := decode(parts[4])
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(secretKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	sealed := append(ciphertext, tag...)
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func toPublicUser(user User) PublicUser {
	return PublicUser{
		ID:       user.ID,
		Name:     user.Name,
		Username: user.Username,
		Role:     user.Role,
	}
}

func toPublicDatasource(datasource Datasource) PublicDatasource {
	return PublicDatasource{
		ID:               datasource.ID,
		Name:             datasource.Name,
		Purpose:          datasource.Purpose,
		Host:             datasource.Host,
		Port:             datasource.Port,
		Username:         datasource.Username,
		DefaultSchema:    datasource.DefaultSchema,
		ConnectionStatus: datasource.ConnectionStatus,
		LastTestedAt:     datasource.LastTestedAt,
		LastTestMessage:  datasource.LastTestMessage,
		HasPassword:      datasource.PasswordSecret != "",
		IsDemo:           datasource.IsDemo,
		CreatedAt:        datasource.CreatedAt,
		UpdatedAt:        datasource.UpdatedAt,
	}
}
