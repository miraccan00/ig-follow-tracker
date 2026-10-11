package instagram

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/yulcaribe/follower/internal/core"
)

const base = "https://www.instagram.com"
const appID = "936619743392459"

var ErrTwoFactor = errors.New("Instagram iki adımlı doğrulama kodu istiyor")
var ErrCheckpoint = errors.New("Instagram güvenlik doğrulaması istiyor; Instagram uygulamasında doğrulayarak tekrar giriş yap")

// Client holds Instagram session cookies only in memory, never the password.
// Instagram's web endpoints are unofficial, can change or refuse server IPs.
type Client struct {
	client      *http.Client
	UserID      string
	Username    string
	twoFactorID string
}

func New() (*Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return &Client{client: &http.Client{Jar: jar, Timeout: 35 * time.Second}}, nil
}

func (c *Client) cookie(name string) string {
	u, _ := url.Parse(base)
	for _, v := range c.client.Jar.Cookies(u) {
		if v.Name == name {
			return v.Value
		}
	}
	return ""
}
func (c *Client) request(ctx context.Context, method, route string, values url.Values) (*http.Response, error) {
	var body io.Reader
	if values != nil {
		body = strings.NewReader(values.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, base+route, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("X-IG-App-ID", appID)
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Referer", base+"/")
	if csrf := c.cookie("csrftoken"); csrf != "" {
		req.Header.Set("X-CSRFToken", csrf)
	}
	if values != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	return c.client.Do(req)
}
func (c *Client) json(ctx context.Context, method, route string, values url.Values, output any) error {
	res, err := c.request(ctx, method, route, values)
	if err != nil {
		return fmt.Errorf("Instagram bağlantısı: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == 429 {
		return errors.New("Instagram istek sınırı (429); daha sonra tekrar dene")
	}
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return errors.New("Instagram oturumu reddetti (401/403); yeniden giriş gerekli")
	}
	if res.StatusCode != 200 {
		return fmt.Errorf("Instagram HTTP %d: endpoint değişmiş veya erişim engellenmiş olabilir", res.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(output); err != nil {
		return fmt.Errorf("Instagram geçersiz JSON döndürdü: %w", err)
	}
	return nil
}
func (c *Client) Login(ctx context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return errors.New("Instagram kullanıcı adı ve şifresi gerekli")
	}
	res, err := c.request(ctx, "GET", "/", nil)
	if err != nil {
		return err
	}
	io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	res.Body.Close()
	if res.StatusCode >= 400 {
		return fmt.Errorf("Instagram açılış HTTP %d", res.StatusCode)
	}
	// Instagram's unofficial web login protocol may reject this password format.
	values := url.Values{"username": {username}, "enc_password": {fmt.Sprintf("#PWD_INSTAGRAM_BROWSER:0:%d:%s", time.Now().Unix(), password)}, "queryParams": {"{}"}, "optIntoOneTap": {"false"}}
	var out struct {
		Authenticated     bool   `json:"authenticated"`
		UserID            any    `json:"userId"`
		Status            string `json:"status"`
		Message           string `json:"message"`
		TwoFactorRequired bool   `json:"two_factor_required"`
		TwoFactorInfo     struct {
			Identifier string `json:"two_factor_identifier"`
		} `json:"two_factor_info"`
		CheckpointURL string `json:"checkpoint_url"`
	}
	if err := c.json(ctx, "POST", "/api/v1/web/accounts/login/ajax/", values, &out); err != nil {
		return err
	}
	if out.TwoFactorRequired {
		c.Username = username
		c.twoFactorID = out.TwoFactorInfo.Identifier
		if c.twoFactorID == "" {
			return errors.New("Instagram 2FA istiyor ancak doğrulama kimliği döndürmedi")
		}
		return ErrTwoFactor
	}
	if out.CheckpointURL != "" {
		return ErrCheckpoint
	}
	if !out.Authenticated {
		return fmt.Errorf("Instagram girişi başarısız: %s", safeMessage(out.Message))
	}
	c.Username = username
	c.UserID = fmt.Sprint(out.UserID)
	if c.UserID == "<nil>" || c.UserID == "" {
		c.UserID = c.cookie("ds_user_id")
	}
	if c.UserID == "" {
		return errors.New("Instagram kullanıcı kimliği alınamadı")
	}
	return nil
}
func safeMessage(s string) string {
	if s == "" {
		return "hesap reddedildi veya doğrulama gerekli"
	}
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}
func (c *Client) TwoFactor(ctx context.Context, code string) error {
	if c.twoFactorID == "" {
		return errors.New("bekleyen 2FA oturumu yok")
	}
	var out struct {
		Authenticated bool   `json:"authenticated"`
		Status        string `json:"status"`
		Message       string `json:"message"`
		UserID        any    `json:"userId"`
	}
	values := url.Values{"username": {c.Username}, "verificationCode": {code}, "identifier": {c.twoFactorID}, "trustThisDevice": {"0"}}
	if err := c.json(ctx, "POST", "/accounts/login/ajax/two_factor/", values, &out); err != nil {
		return err
	}
	if !out.Authenticated {
		return fmt.Errorf("Instagram 2FA başarısız: %s", safeMessage(out.Message))
	}
	c.UserID = fmt.Sprint(out.UserID)
	if c.UserID == "<nil>" || c.UserID == "" {
		c.UserID = c.cookie("ds_user_id")
	}
	if c.UserID == "" {
		return errors.New("2FA tamamlandı ancak hesap ID alınamadı")
	}
	c.twoFactorID = ""
	return nil
}
func (c *Client) Profile(ctx context.Context) (core.Counts, error) {
	var out struct {
		Data struct {
			User struct {
				ID            string `json:"id"`
				Username      string `json:"username"`
				EdgeFollowers struct {
					Count int `json:"count"`
				} `json:"edge_followed_by"`
				EdgeFollowing struct {
					Count int `json:"count"`
				} `json:"edge_follow"`
			} `json:"user"`
		} `json:"data"`
	}
	route := "/api/v1/users/web_profile_info/?username=" + url.QueryEscape(c.Username)
	if err := c.json(ctx, "GET", route, nil, &out); err != nil {
		return core.Counts{}, fmt.Errorf("takipçi sayıları doğrulanamadı: %w", err)
	}
	if out.Data.User.ID == "" || out.Data.User.ID != c.UserID {
		return core.Counts{}, errors.New("profil kimliği doğrulanamadı; yanlış hesaba tarama yapılmayacak")
	}
	return core.Counts{Followers: out.Data.User.EdgeFollowers.Count, Following: out.Data.User.EdgeFollowing.Count}, nil
}

var validID = regexp.MustCompile(`^\d{1,30}$`)

func (c *Client) list(ctx context.Context, kind string, report func(string)) ([]core.User, error) {
	if !validID.MatchString(c.UserID) {
		return nil, errors.New("geçersiz hesap ID")
	}
	users := make([]core.User, 0, 256)
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 2000; page++ {
		route := "/api/v1/friendships/" + c.UserID + "/" + kind + "/?count=50"
		if cursor != "" {
			route += "&max_id=" + url.QueryEscape(cursor)
		}
		var out struct {
			Users []struct {
				Pk       any    `json:"pk"`
				ID       any    `json:"id"`
				Username string `json:"username"`
				FullName string `json:"full_name"`
				Pic      string `json:"profile_pic_url"`
			} `json:"users"`
			NextMaxID any  `json:"next_max_id"`
			BigList   bool `json:"big_list"`
		}
		if err := c.json(ctx, "GET", route, nil, &out); err != nil {
			return nil, fmt.Errorf("%s sayfa %d: %w", kind, page+1, err)
		}
		for _, u := range out.Users {
			id := fmt.Sprint(u.Pk)
			if id == "<nil>" || id == "" {
				id = fmt.Sprint(u.ID)
			}
			if !validID.MatchString(id) || u.Username == "" {
				continue
			}
			if !seen[id] {
				users = append(users, core.User{ID: id, Username: u.Username, FullName: u.FullName, Avatar: u.Pic})
				seen[id] = true
			}
		}
		report(kind + ": " + strconv.Itoa(len(users)))
		next := ""
		if out.NextMaxID != nil {
			next = fmt.Sprint(out.NextMaxID)
			if next == "<nil>" {
				next = ""
			}
		}
		if next == "" {
			return users, nil
		}
		if next == cursor {
			return nil, errors.New("Instagram aynı sayfayı tekrar döndürdü; eksik tarama kaydedilmedi")
		}
		cursor = next
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(1300 * time.Millisecond):
		}
	}
	return nil, errors.New("çok fazla sayfa, tarama tamamlanmadı")
}
func (c *Client) Scan(ctx context.Context, report func(string)) (core.Snapshot, error) {
	if c.UserID == "" || c.Username == "" {
		return core.Snapshot{}, errors.New("önce Instagram girişi yap")
	}
	counts, err := c.Profile(ctx)
	if err != nil {
		return core.Snapshot{}, err
	}
	followers, err := c.list(ctx, "followers", report)
	if err != nil {
		return core.Snapshot{}, err
	}
	following, err := c.list(ctx, "following", report)
	if err != nil {
		return core.Snapshot{}, err
	}
	return core.Snapshot{TakenAt: time.Now().UTC(), Account: core.Account{ID: c.UserID, Username: c.Username}, ProfileCounts: &counts, Followers: followers, Following: following}, nil
}

