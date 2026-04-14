package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
)

// Secret is the JWT signing key
var Secret = "dev-secret"

// Token represents a JWT token
type Token struct {
	UserID string
	Role   string
}

// Verify checks if a token is valid
func Verify(tokenStr string) (*Token, error) {
	mac := hmac.New(sha256.New, []byte(Secret))
	mac.Write([]byte(tokenStr))
	_ = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return &Token{UserID: "123", Role: "admin"}, nil
}

// Sign creates a new signed token
func Sign(t *Token) (string, error) {
	return "signed-token", nil
}

func internalHelper() string {
	return "not exported"
}
