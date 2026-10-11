package main

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/yulcaribe/follower/internal/core"
	"github.com/yulcaribe/follower/internal/instagram"
	"github.com/yulcaribe/follower/internal/security"
)

//go:embed web/index.html web/app.js
var assets embed.FS

type task struct {
	Running    bool      `json:"running"`
	StartedAt  time.Time `json:"startedAt,omitempty"`
	Log        string    `json:"log"`
	Error      string    `json:"error,omitempty"`
	FinishedAt time.Time `json:"finishedAt,omitempty"`
}
type attempt struct {
	Count int
	Until time.Time
}
type app struct {
	data     string
	store    core.Store
	sessions *security.Sessions
	mu       sync.Mutex
	active   map[string]*instagram.Client
	pending  *instagram.Client
	current  string
	task     task
	failures map[string]attempt
}

func newApp(data string) *app {
	return &app{data: data, store: core.Store{Root: data}, sessions: security.NewSessions(), active: map[string]*instagram.Client{}, failures: map[string]attempt{}}
}
func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func bad(w http.ResponseWriter, status int, msg string) {
	reply(w, status, map[string]string{"error": msg})
}
func decode(r *http.Request, v any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return errors.New("JSON gönderilmeli")
	}
	if r.ContentLength > 4096 {
		return errors.New("istek fazla büyük")
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 4096))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	return nil
}
func (a *app) loggedIn(r *http.Request) bool {
	c, err := r.Cookie("follower_admin")
	return err == nil && a.sessions.Valid(c.Value)
}
func (a *app) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if a.loggedIn(r) {
		return true
	}
	bad(w, 401, "Admin şifresi gerekli")
	return false
}
func (a *app) adminLogin(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Password string `json:"password"`
	}
	if err := decode(r, &v); err != nil {
		bad(w, 400, "Geçersiz istek")
		return
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	a.mu.Lock()
	lim := a.failures[host]
	locked := lim.Count >= 6 && time.Now().Before(lim.Until)
	a.mu.Unlock()
	if locked {
		bad(w, 429, "Çok sayıda deneme; 10 dakika sonra tekrar dene")
		return
	}
	if !security.Verify(a.data, v.Password) {
		a.mu.Lock()
		lim = a.failures[host]
		if time.Now().After(lim.Until) {
			lim.Count = 0
		}
		lim.Count++
		lim.Until = time.Now().Add(10 * time.Minute)
		a.failures[host] = lim
		a.mu.Unlock()
		bad(w, 401, "Şifre yanlış")
		return
	}
	a.mu.Lock()
	delete(a.failures, host)
	a.mu.Unlock()
	token, err := a.sessions.New()
	if err != nil {
		bad(w, 500, "Oturum oluşturulamadı")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "follower_admin", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: false, MaxAge: 12 * 3600})
	reply(w, 200, map[string]bool{"ok": true})
}
func (a *app) adminLogout(w http.ResponseWriter, r *http.Request) {
	if c, e := r.Cookie("follower_admin"); e == nil {
		a.sessions.Delete(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "follower_admin", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	reply(w, 200, map[string]bool{"ok": true})
}
func (a *app) profiles() []core.Account {
	matches, _ := filepath.Glob(filepath.Join(a.data, "accounts", "*", "profile.json"))
	accounts := []core.Account{}
	for _, f := range matches {
		v, err := core.ReadJSON[core.Account](f)
		if err == nil && v.ID != "" {
			accounts = append(accounts, v)
		}
	}
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].Username < accounts[j].Username })
	return accounts
}
func (a *app) state(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	current := a.current
	job := a.task
	connected := make([]string, 0, len(a.active))
	for id := range a.active {
		connected = append(connected, id)
	}
	pending := a.pending != nil
	a.mu.Unlock()
	id := r.URL.Query().Get("id")
	if id == "" {
		id = current
	}
	accounts := a.profiles()
	if id == "" && len(accounts) > 0 {
		id = accounts[0].ID
	}
	var snap *core.Snapshot
	var rep *core.Report
	history := []core.HistoryRow{}
	if id != "" {
		var err error
		snap, rep, history, err = a.store.Current(id)
		if err != nil {
			bad(w, 400, err.Error())
			return
		}
	}
	var notBack []core.User = []core.User{}
	if snap != nil {
		notBack = core.Subtract(snap.Following, snap.Followers)
	}
	reply(w, 200, map[string]any{"accounts": accounts, "selectedId": id, "connected": connected, "needs2fa": pending, "job": job, "snapshot": snap, "report": rep, "history": history, "notFollowingBack": notBack})
}
func (a *app) instagramLogin(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decode(r, &v); err != nil {
		bad(w, 400, "Geçersiz form")
		return
	}
	a.mu.Lock()
	running := a.task.Running
	a.mu.Unlock()
	if running {
		bad(w, 409, "Tarama devam ederken giriş değiştirilemez")
		return
	}
	c, err := instagram.New()
	if err != nil {
		bad(w, 500, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 55*time.Second)
	defer cancel()
	err = c.Login(ctx, v.Username, v.Password)
	if errors.Is(err, instagram.ErrTwoFactor) {
		a.mu.Lock()
		a.pending = c
		a.mu.Unlock()
		reply(w, 202, map[string]any{"needs2fa": true})
		return
	}
	if err != nil {
		bad(w, 400, err.Error())
		return
	}
	a.mu.Lock()
	a.active[c.UserID] = c
	a.current = c.UserID
	a.pending = nil
	a.mu.Unlock()
	reply(w, 200, map[string]any{"ok": true, "id": c.UserID, "username": c.Username})
}
func (a *app) instagramTwoFactor(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Code string `json:"code"`
	}
	if err := decode(r, &v); err != nil {
		bad(w, 400, "Geçersiz istek")
		return
	}
	a.mu.Lock()
	c := a.pending
	a.mu.Unlock()
	if c == nil {
		bad(w, 400, "Bekleyen doğrulama yok")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	if err := c.TwoFactor(ctx, v.Code); err != nil {
		bad(w, 400, err.Error())
		return
	}
	a.mu.Lock()
	a.active[c.UserID] = c
	a.current = c.UserID
	a.pending = nil
	a.mu.Unlock()
	reply(w, 200, map[string]any{"ok": true, "id": c.UserID, "username": c.Username})
}
func (a *app) appendLog(line string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.task.Log += line + "\n"
	if len(a.task.Log) > 12000 {
		a.task.Log = a.task.Log[len(a.task.Log)-12000:]
	}
}
func (a *app) scan(w http.ResponseWriter, r *http.Request) {
	var v struct {
		ID string `json:"id"`
	}
	if err := decode(r, &v); err != nil {
		bad(w, 400, "Geçersiz istek")
		return
	}
	a.mu.Lock()
	if a.task.Running {
		a.mu.Unlock()
		bad(w, 409, "Bir tarama zaten çalışıyor")
		return
	}
	if v.ID == "" {
		v.ID = a.current
	}
	c := a.active[v.ID]
	if c == nil {
		a.mu.Unlock()
		bad(w, 400, "Önce bu Instagram hesabına giriş yap")
		return
	}
	a.task = task{Running: true, StartedAt: time.Now().UTC(), Log: "Tarama başlatıldı\n"}
	a.mu.Unlock()
	// Deliberately not tied to the browser request; closing the page does not discard a scan.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		snap, err := c.Scan(ctx, a.appendLog)
		if err == nil {
			err = a.store.Save(snap)
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		a.task.Running = false
		a.task.FinishedAt = time.Now().UTC()
		if err != nil {
			a.task.Error = err.Error()
			a.task.Log += "Tarama kaydedilmedi: " + err.Error() + "\n"
		} else {
			a.task.Log += fmt.Sprintf("Başarılı: %d takipçi, %d takip edilen.\n", len(snap.Followers), len(snap.Following))
		}
	}()
	reply(w, 202, map[string]bool{"ok": true})
}
func (a *app) csv(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	snap, rep, _, err := a.store.Current(id)
	if err != nil || snap == nil {
		bad(w, 404, "Kayıt yok")
		return
	}
	lists := map[string][]core.User{"followers": snap.Followers, "following": snap.Following, "notFollowingBack": core.Subtract(snap.Following, snap.Followers)}
	if rep != nil {
		lists["unfollowedYou"] = rep.UnfollowedYou
		lists["newFollowers"] = rep.NewFollowers
		lists["youUnfollowed"] = rep.YouUnfollowed
		lists["youStartedFollowing"] = rep.YouStartedFollowing
	}
	kind := r.URL.Query().Get("kind")
	rows, ok := lists[kind]
	if !ok {
		bad(w, 400, "Geçersiz liste")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=followers-"+kind+".csv")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"user_id", "username", "full_name"})
	for _, u := range rows {
		_ = cw.Write([]string{safeCSV(u.ID), safeCSV(u.Username), safeCSV(u.FullName)})
	}
	cw.Flush()
}
func safeCSV(s string) string {
	if s != "" && strings.ContainsRune("=+-@", rune(s[0])) {
		return "'" + s
	}
	return s
}
func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'")
	if r.Method == "GET" && (r.URL.Path == "/" || r.URL.Path == "/app.js") {
		p := "web/index.html"
		ct := "text/html; charset=utf-8"
		if r.URL.Path == "/app.js" {
			p = "web/app.js"
			ct = "text/javascript; charset=utf-8"
		}
		b, err := assets.ReadFile(p)
		if err != nil {
			bad(w, 500, "Arayüz bulunamadı")
			return
		}
		w.Header().Set("Content-Type", ct)
		_, _ = w.Write(b)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		bad(w, 404, "Yol bulunamadı")
		return
	}
	if r.Method == "GET" && r.URL.Path == "/api/auth" {
		reply(w, 200, map[string]bool{"authenticated": a.loggedIn(r)})
		return
	}
	if r.Method == "POST" {
		// Reject cross-origin writes, even if a browser sends the admin cookie.
		if origin := r.Header.Get("Origin"); origin != "" {
			// HTTP only for this deployment; Origin must be exactly this host.
			expected := "http://" + r.Host
			if subtle.ConstantTimeCompare([]byte(origin), []byte(expected)) != 1 {
				bad(w, 403, "Origin reddedildi")
				return
			}
		}
	}
	if r.Method == "POST" && r.URL.Path == "/api/admin/login" {
		a.adminLogin(w, r)
		return
	}
	if !a.requireAdmin(w, r) {
		return
	}
	switch {
	case r.Method == "POST" && r.URL.Path == "/api/admin/logout":
		a.adminLogout(w, r)
	case r.Method == "GET" && r.URL.Path == "/api/state":
		a.state(w, r)
	case r.Method == "POST" && r.URL.Path == "/api/instagram/login":
		a.instagramLogin(w, r)
	case r.Method == "POST" && r.URL.Path == "/api/instagram/2fa":
		a.instagramTwoFactor(w, r)
	case r.Method == "POST" && r.URL.Path == "/api/scan":
		a.scan(w, r)
	case r.Method == "GET" && r.URL.Path == "/api/csv":
		a.csv(w, r)
	default:
		bad(w, 404, "Yol bulunamadı")
	}
}
func migrateLegacy(a *app) {
	paths, _ := filepath.Glob(filepath.Join(a.data, "snapshots", "*", "*.json"))
	migrated := 0
	for _, f := range paths {
		v, err := core.ReadJSON[core.Snapshot](f)
		if err != nil || v.Account.ID == "" {
			continue
		}
		// Existing old records are read-only; imports preserve timestamps.
		if err := a.store.Save(v); err == nil {
			migrated++
		}
	}
	if migrated > 0 {
		log.Printf("Imported %d legacy JSON snapshots", migrated)
	}
}
func main() {
	data := os.Getenv("DATA_DIR")
	if data == "" {
		data = "./data"
	}
	if err := os.MkdirAll(data, 0700); err != nil {
		log.Fatal(err)
	}
	if err := security.InitPassword(data, os.Getenv("ADMIN_PASSWORD")); err != nil {
		log.Fatal(err)
	}
	a := newApp(data)
	migrateLegacy(a)
	port := os.Getenv("PORT")
	if port == "" {
		port = "3100"
	}
	host := os.Getenv("HOST")
	if host == "" {
		host = "0.0.0.0"
	}
	srv := &http.Server{Addr: net.JoinHostPort(host, port), Handler: a, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 45 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	log.Printf("follower Go HTTP server listening on %s (no scheduled scans)", srv.Addr)
	log.Fatal(srv.ListenAndServe())
}

