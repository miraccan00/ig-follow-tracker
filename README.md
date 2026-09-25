# ig-follow-tracker

**EN** | [TR](#tr)

A tiny hobby app that answers life's most important question: *who unfollowed me?*

It opens Instagram in [Lightpanda](https://lightpanda.io), a headless browser written in Zig, saves your followers and following into a SQLite database, and on the next run tells you who left. Everything runs on your own machine. No server, no signup, nobody else sees your cookie.

Built for fun, to try Lightpanda on something real. Do not take it (or the results) too seriously.

## Run it

You only need Docker. No clone, no build.

```sh
mkdir -p ig-data
cat > ig-data/cookies.json <<'JSON'
{ "sessionid": "...", "csrftoken": "...", "ds_user_id": "..." }
JSON

docker run -d --name ig-follow-tracker --restart unless-stopped \
  -p 127.0.0.1:3100:3100 \
  -v "$PWD/ig-data:/data" \
  ghcr.io/miraccan00/ig-follow-tracker

open http://127.0.0.1:3100   # or just visit it in the browser
```

Where the cookie values come from: Chrome, instagram.com (logged in) → DevTools (⌥⌘I / F12) → **Application** → **Cookies** → `https://www.instagram.com` → copy `sessionid`, `csrftoken`, `ds_user_id`. You can also skip the file and paste them into the **Cookie** form in the page.

Then click **Şimdi kontrol et** (check now). The first run takes a snapshot, from the second run on you get the drama. A check takes about 45 seconds for a few hundred accounts, it waits between pages on purpose.

`ig-data/` is the only thing the container writes to:

```
ig-data/
  cookies.json                  your session, stays on your disk
  tracker.db                    SQLite: every snapshot, every account
  snapshots/<user>/<time>.json  the same snapshots as JSON, for jq and friends
```

The container also checks by itself every day at 09:00 (Europe/Istanbul). Change it with `-e CHECK_AT=21:30 -e TZ=Europe/Berlin`, turn it off with `-e CHECK_AT=`.

Handy commands:

```sh
docker logs -f ig-follow-tracker                  # what is it doing
docker exec ig-follow-tracker node src/cli.mjs check  # check from the terminal
docker exec ig-follow-tracker node src/cli.mjs diff   # compare the last two snapshots
docker pull ghcr.io/miraccan00/ig-follow-tracker && docker rm -f ig-follow-tracker   # update, then run again
sqlite3 ig-data/tracker.db "select username, taken_at from snapshots"      # poke the database
```

On Linux, if the container can't write to `ig-data`, add `--user "$(id -u):$(id -g)"`.

## What you get

- Followers / following counts and full lists, searchable
- **Unfollowed you** and **new followers** since the last check
- Who you follow that does not follow you back
- History of every check, per account

## How it works

`lightpanda serve --cookie cookies.json` starts a CDP server, `puppeteer-core` connects to it, and the page calls Instagram's own web API (`/api/v1/friendships/<id>/followers/`) with `fetch`, 50 users per page. No XPath, no clicking through the followers modal. Snapshots go into SQLite through Node's built-in `node:sqlite`, so there are no native dependencies.

Fun facts found while building it:

- Instagram's profile-info endpoints answer Lightpanda's User-Agent with `429` or `useragent mismatch`, but the followers endpoint works fine. So the user id and counts are read from the profile page HTML instead.
- Lightpanda's Linux build needs glibc 2.38. Debian bookworm has 2.36, so the image is based on trixie.

## Build or run it yourself

```sh
git clone https://github.com/miraccan00/ig-follow-tracker && cd ig-follow-tracker
docker build -t ig-follow-tracker .
```

Without Docker (Node 22.5+, macOS or Linux):

```sh
npm install     # also downloads the Lightpanda binary for your OS
npm start       # http://127.0.0.1:3100, data goes to ./data, cookie to ./cookies.json
npm test
```

## Please note

- Use it only for your own account. Automated access is against Instagram's terms, and you are responsible for how you use this.
- Too many runs can get your account rate-limited or asked to verify. Once a day is plenty.
- `sessionid` gives full access to your account. Do not commit `cookies.json`, do not paste it in screenshots, keep the port on `127.0.0.1`.
- Deactivated accounts also show up as "unfollowed you". They did not hate you, probably.
- Instagram changes its HTML from time to time. If it breaks, that is why.

---

<a id="tr"></a>
## TR

Hayatın en önemli sorusuna cevap veren küçük bir hobi projesi: *beni kim takipten çıktı?*

Instagram'ı Zig ile yazılmış headless browser [Lightpanda](https://lightpanda.io) ile açıyor, takipçi ve takip listelerini SQLite veritabanına kaydediyor, bir sonraki çalıştırmada kimin gittiğini söylüyor. Her şey senin makinende çalışıyor. Sunucu yok, kayıt yok, cookie'n kimseye gitmiyor.

Lightpanda'yı gerçek bir şeyde denemek için eğlencesine yazıldı. Sonuçları da çok ciddiye almayın.

### Çalıştırma

Sadece Docker lazım. Clone yok, build yok.

```sh
mkdir -p ig-data
cat > ig-data/cookies.json <<'JSON'
{ "sessionid": "...", "csrftoken": "...", "ds_user_id": "..." }
JSON

docker run -d --name ig-follow-tracker --restart unless-stopped \
  -p 127.0.0.1:3100:3100 \
  -v "$PWD/ig-data:/data" \
  ghcr.io/miraccan00/ig-follow-tracker

open http://127.0.0.1:3100
```

Cookie değerleri: Chrome'da instagram.com (giriş yapılmış) → DevTools → **Application** → **Cookies** → `sessionid`, `csrftoken`, `ds_user_id`. Dosyayla uğraşmak istemezsen sayfadaki **Cookie** formuna da yapıştırabilirsin.

Sonra **Şimdi kontrol et**'e bas. İlk çalıştırma snapshot alıyor, ikinciden itibaren dram başlıyor.

- Container'ın yazdığı tek yer `ig-data/`: `cookies.json`, `tracker.db` (SQLite) ve aynı verinin JSON hali `snapshots/` altında.
- Container her gün 09:00'da kendi kendine kontrol yapıyor. Değiştirmek için `-e CHECK_AT=21:30`, kapatmak için `-e CHECK_AT=`.
- Linux'ta `ig-data`'ya yazamazsa `--user "$(id -u):$(id -g)"` ekle.
- Diğer komutlar (log, güncelleme, sqlite sorgusu) yukarıdaki EN bölümünde.

### Neler var

- Takipçi / takip sayıları ve aranabilir tam listeler
- Son kontrolden beri **takipten çıkanlar** ve **yeni takipçiler**
- Senin takip ettiğin ama seni geri takip etmeyenler
- Her kontrolün geçmişi, hesap bazında

### Dikkat

- Sadece kendi hesabın için kullan. Otomatik erişim Instagram kurallarına aykırı, sorumluluk sende.
- Çok sık çalıştırırsan hesabın rate limit yiyebilir ya da doğrulama isteyebilir. Günde bir kez yeterli.
- `sessionid` hesabına tam erişim demek. `cookies.json`'ı commit'leme, ekran görüntüsünde paylaşma, portu `127.0.0.1` dışına açma.
- Hesabını donduran biri de "takipten çıktı" diye görünür. Muhtemelen sana küsmedi.

## License

MIT
