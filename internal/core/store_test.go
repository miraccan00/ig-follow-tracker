package core

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSnapshotJSONAndRename(t *testing.T) {
	s := Store{Root: t.TempDir()}
	a := func(id, name string) User { return User{ID: id, Username: name} }
	first := Snapshot{TakenAt: time.Date(2026, 10, 11, 1, 2, 3, 0, time.UTC), Account: Account{"123", "old_name"}, Followers: []User{a("1", "old"), a("2", "lost")}, Following: []User{a("1", "old"), a("3", "gone")}}
	if err := s.Save(first); err != nil {
		t.Fatal(err)
	}
	second := Snapshot{TakenAt: first.TakenAt.Add(time.Second), Account: Account{"123", "new_name"}, Followers: []User{a("1", "renamed"), a("4", "new")}, Following: []User{a("1", "renamed"), a("5", "followed")}}
	if err := s.Save(second); err != nil {
		t.Fatal(err)
	}
	curr, rep, h, err := s.Current("123")
	if err != nil {
		t.Fatal(err)
	}
	if curr.Account.Username != "new_name" || len(h) != 2 || len(rep.UnfollowedYou) != 1 || rep.UnfollowedYou[0].ID != "2" || len(rep.NewFollowers) != 1 {
		t.Fatalf("unexpected %+v %+v %+v", curr, rep, h)
	}
	if err := s.Save(Snapshot{TakenAt: first.TakenAt.Add(2 * time.Second), Account: Account{"123", "new_name"}, Followers: nil, Following: []User{}}); err == nil {
		t.Fatal("incomplete scan allowed")
	}
	snaps, _ := s.List("123")
	if len(snaps) != 2 {
		t.Fatal("failed scan corrupted history")
	}
	if _, err := os.Stat(filepath.Join(s.Root, "accounts", "123", "profile.json")); err != nil {
		t.Fatal(err)
	}
}
func TestPathTraversalRejected(t *testing.T) {
	s := Store{Root: t.TempDir()}
	if _, err := s.List("../../etc"); err == nil {
		t.Fatal("traversal")
	}
}

