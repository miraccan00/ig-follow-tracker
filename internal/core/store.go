package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	FullName string `json:"fullName,omitempty"`
	Avatar   string `json:"avatar,omitempty"`
}
type Account struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}
type Counts struct {
	Followers int `json:"followers"`
	Following int `json:"following"`
}
type Snapshot struct {
	TakenAt       time.Time `json:"takenAt"`
	Account       Account   `json:"account"`
	ProfileCounts *Counts   `json:"profileCounts,omitempty"`
	Followers     []User    `json:"followers"`
	Following     []User    `json:"following"`
}
type Delta struct {
	Before int `json:"before"`
	After  int `json:"after"`
	Change int `json:"change"`
}
type Report struct {
	From                time.Time `json:"from"`
	To                  time.Time `json:"to"`
	Followers           Delta     `json:"followers"`
	Following           Delta     `json:"following"`
	UnfollowedYou       []User    `json:"unfollowedYou"`
	NewFollowers        []User    `json:"newFollowers"`
	YouUnfollowed       []User    `json:"youUnfollowed"`
	YouStartedFollowing []User    `json:"youStartedFollowing"`
}
type HistoryRow struct {
	TakenAt       time.Time `json:"takenAt"`
	Account       Account   `json:"account"`
	Followers     int       `json:"followers"`
	Following     int       `json:"following"`
	UnfollowedYou int       `json:"unfollowedYou"`
	NewFollowers  int       `json:"newFollowers"`
	First         bool      `json:"first"`
}
type Store struct{ Root string }

var validID = regexp.MustCompile(`^[0-9]{1,30}$`)

func (s Store) accountDir(id string) (string, error) {
	if !validID.MatchString(id) {
		return "", errors.New("invalid account id")
	}
	return filepath.Join(s.Root, "accounts", id), nil
}
func writeAtomic(file string, value any) error {
	dir := filepath.Dir(file)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".pending-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), file)
}
func ReadJSON[T any](file string) (v T, err error) {
	b, err := os.ReadFile(file)
	if err != nil {
		return v, err
	}
	err = json.Unmarshal(b, &v)
	return
}
func WriteJSON(file string, value any) error { return writeAtomic(file, value) }
func (s Store) Save(x Snapshot) error {
	if x.Account.Username == "" || x.TakenAt.IsZero() || x.Followers == nil || x.Following == nil {
		return errors.New("incomplete snapshot")
	}
	d, err := s.accountDir(x.Account.ID)
	if err != nil {
		return err
	}
	if x.ProfileCounts != nil {
		if x.ProfileCounts.Followers > 0 && len(x.Followers) < x.ProfileCounts.Followers*95/100 {
			return fmt.Errorf("incomplete follower scan: got %d of %d", len(x.Followers), x.ProfileCounts.Followers)
		}
		if x.ProfileCounts.Following > 0 && len(x.Following) < x.ProfileCounts.Following*95/100 {
			return fmt.Errorf("incomplete following scan: got %d of %d", len(x.Following), x.ProfileCounts.Following)
		}
	}
	for _, k := range [][]User{x.Followers, x.Following} {
		for _, u := range k {
			if !validID.MatchString(u.ID) || u.Username == "" {
				return errors.New("invalid user in snapshot")
			}
		}
	}
	// Nanosecond timestamps preserve sequential manual checks without overwriting prior runs.
	name := x.TakenAt.UTC().Format("20060102T150405.000000000Z") + ".json"
	file := filepath.Join(d, "snapshots", name)
	if _, err := os.Stat(file); err == nil {
		return errors.New("snapshot timestamp already exists")
	}
	if err = writeAtomic(file, x); err != nil {
		return err
	}
	return writeAtomic(filepath.Join(d, "profile.json"), x.Account)
}
func (s Store) List(id string) ([]Snapshot, error) {
	d, err := s.accountDir(id)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.Join(d, "snapshots"))
	if errors.Is(err, os.ErrNotExist) {
		return []Snapshot{}, nil
	}
	if err != nil {
		return nil, err
	}
	snaps := make([]Snapshot, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		x, err := ReadJSON[Snapshot](filepath.Join(d, "snapshots", e.Name()))
		if err != nil {
			return nil, fmt.Errorf("read snapshot %s: %w", e.Name(), err)
		}
		if x.Account.ID != id {
			return nil, errors.New("account ID mismatch in snapshot")
		}
		snaps = append(snaps, x)
	}
	sort.Slice(snaps, func(i, j int) bool { return snaps[i].TakenAt.Before(snaps[j].TakenAt) })
	return snaps, nil
}
func ByID(a []User) map[string]User {
	m := make(map[string]User, len(a))
	for _, u := range a {
		m[u.ID] = u
	}
	return m
}
func Subtract(a, b []User) []User {
	bm := ByID(b)
	out := make([]User, 0)
	for _, u := range a {
		if _, ok := bm[u.ID]; !ok {
			out = append(out, u)
		}
	}
	return out
}
func Compare(prev, curr Snapshot) Report {
	return Report{From: prev.TakenAt, To: curr.TakenAt,
		Followers:     Delta{len(prev.Followers), len(curr.Followers), len(curr.Followers) - len(prev.Followers)},
		Following:     Delta{len(prev.Following), len(curr.Following), len(curr.Following) - len(prev.Following)},
		UnfollowedYou: Subtract(prev.Followers, curr.Followers), NewFollowers: Subtract(curr.Followers, prev.Followers),
		YouUnfollowed: Subtract(prev.Following, curr.Following), YouStartedFollowing: Subtract(curr.Following, prev.Following)}
}
func (s Store) Current(id string) (*Snapshot, *Report, []HistoryRow, error) {
	snaps, err := s.List(id)
	if err != nil {
		return nil, nil, nil, err
	}
	rows := make([]HistoryRow, 0, len(snaps))
	var report *Report
	for i, x := range snaps {
		r := HistoryRow{TakenAt: x.TakenAt, Account: x.Account, Followers: len(x.Followers), Following: len(x.Following), First: i == 0}
		if i > 0 {
			d := Compare(snaps[i-1], x)
			r.UnfollowedYou = len(d.UnfollowedYou)
			r.NewFollowers = len(d.NewFollowers)
			if i == len(snaps)-1 {
				report = &d
			}
		}
		rows = append(rows, r)
	}
	if len(snaps) == 0 {
		return nil, nil, rows, nil
	}
	curr := snaps[len(snaps)-1]
	return &curr, report, rows, nil
}

