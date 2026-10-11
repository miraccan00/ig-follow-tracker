package security

import (
	"testing"
)

func TestAdminHashAndSessions(t *testing.T) {
	d := t.TempDir()
	if err := InitPassword(d, "a safe password 123"); err != nil {
		t.Fatal(err)
	}
	if !Verify(d, "a safe password 123") || Verify(d, "wrong") {
		t.Fatal("auth failed")
	}
	s := NewSessions()
	tok, err := s.New()
	if err != nil || !s.Valid(tok) {
		t.Fatal(err)
	}
	s.Delete(tok)
	if s.Valid(tok) {
		t.Fatal("logout failed")
	}
}

