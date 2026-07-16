# API仕様書

## 1. 共通仕様

| 項目 | 内容 |
| --- | --- |
| Base URL | PC: `http://127.0.0.1:{port}` / LAN: `http://{private-ip}:{port}` |
| 形式 | JSON。画像受信だけ`multipart/form-data` |
| 文字コード | UTF-8 |
| キャッシュ | `/api/*`は`Cache-Control: no-store` |
| 成功 | 200、201、204 |
| 入力エラー | 400 |
| LAN認証不足 | 401 |
| ネットワーク・Host・Origin違反 | 403 |
| 対象なし | 404 |
| バーコード読取不能 | 422 |
| レート超過 | 429 |
| 内部エラー | 500。内部詳細は応答へ含めない |

エラー形式:

```json
{ "error": "利用者向けメッセージ" }
```

## 2. LAN認証

- ループバック以外の全ページ、API、画像に認証を要求する。
- PCの`GET /api/config`が返すQRには`/upload?access_token={token}`を埋め込む。
- 初回GET成功時、サーバーは`hondana_access` Cookieを`HttpOnly; SameSite=Strict; Path=/`で設定し、トークンを除いたURLへ303リダイレクトする。
- トークンは起動ごとに変わる。有効期間は12時間だが、再起動後の旧Cookieは無効になる。
- LAN側はプライベートIP、許可Host、同一Originも検査する。

## 3. システムAPI

| Method | Path | 説明 | 応答 |
| --- | --- | --- | --- |
| GET | `/api/health` | 稼働確認 | `{ok, service, port}` |
| GET | `/api/config` | LAN URLとQR | `{lanIp, port, baseUrl, uploadUrl, authorizedUploadUrl, checkUrl, qrCode}` |
| GET | `/api/offline-library` | 持ち出し本棚 | `text/html`添付 |

`authorizedUploadUrl`は画面表示・ログ保存を避け、QRまたはPCからの起動だけに使用する。

## 4. 蔵書API

| Method | Path | 入力 | 成功応答 |
| --- | --- | --- | --- |
| GET | `/api/books` | なし | `200 {books: Book[]}` |
| GET | `/api/books/suggest?q=` | q: 0〜200文字。2文字未満は空配列 | `200 {suggestions, source}` |
| GET | `/api/covers/preview/:isbn` | 検証済みISBN | ローカル表紙へ`302`、取得不能は`404` |
| POST | `/api/books` | BookCreate | `201 {book}` |
| POST | `/api/books/bulk` | BulkBookImport | 新規を含む場合`201`、更新のみ`200` |
| PATCH | `/api/books/:id` | BookUpdate | `200 {book}` |
| DELETE | `/api/books/:id` | なし | `204` |
| POST | `/api/books/reorder` | `{ids: string[]}` | `200 {books}` |
| POST | `/api/books/:id/refresh-cover` | なし | `200 {book}` |
| POST | `/api/isbn` | `{isbn: string}` | 新規`201`、既存更新`200`、`{book, duplicate}` |

候補検索の`coverUrl`は同一オリジンの`/api/covers/preview/:isbn`を返す。プレビューはopenBD・Google Books・Open Library等の許可済みHTTPS候補を検査し、WebPへキャッシュできた場合だけローカル表紙へ転送する。

### BookCreate

- 必須: `title`（1〜300文字）。
- 任意: `isbn`、`titleReading`、`author`、`authorReading`、`publisher`、`published`、`pages`、`status`、`rating`、`shelf`、`tags`、`note`、`category`、`format`、`physicalLocation`、`electronicPlatform`、`electronicUrl`、`seriesName`、`volumeNumber`、`reminderDate`、`reminderNote`。
- 未定義項目は400。ISBNがあればチェックディジットを検証する。

### BookUpdate

BookCreateの任意項目から`isbn`を除いた差分。空オブジェクトと未定義項目は400。`id`、ISBN、表紙、外部書誌取得元、日時は直接変更できない。

### BulkBookImport

```json
{
  "format": "electronic",
  "physicalLocation": "",
  "electronicPlatform": "DMMブックス",
  "entries": [
    { "isbn": "9780306406157", "title": "", "author": "" },
    { "isbn": "", "title": "書名", "author": "著者名" }
  ]
}
```

- `format`は`physical`または`electronic`。電子書籍では`electronicPlatform`が必須。
- `entries`は1〜200件。各行はISBN、または1〜300文字のタイトルが必要。
- ISBNはチェックディジットを検証する。既存ISBNは書誌と指定した所有形態・保存先を更新する。
- 外部取得・保存に失敗した行は`failures`へ含め、後続行は処理を継続する。
- 応答は`{books, processedCount, createdCount, duplicateCount, failedCount, failures}`。

### ID・並び順

- `:id`は英数字とハイフンの1〜64文字。
- `ids`は1〜10000件、重複不可。指定されなかった蔵書は後方へ元順序で残る。

## 5. おすすめAPI

| Method | Path | 入力 | 成功応答 |
| --- | --- | --- | --- |
| GET | `/api/recommendations` | なし | `200 {recommendations, seedCount, source}` |

`recommendations`は最大8件で、`title`、`author`、`publisher`、`published`、`isbn`、`url`、`coverUrl`、`reason`を含む。所蔵済みISBNと同名タイトルは除外する。

## 6. シリーズAPI

| Method | Path | 入力 | 成功応答 |
| --- | --- | --- | --- |
| POST | `/api/series/check` | `{seriesName: string}` 1〜300文字 | `200 {seriesName, ownedMax, latest, nextAvailable, hasNewVolume, checkedAt, count, message}` |
| POST | `/api/series/check-all` | なし | `200 {checked, results}` |

全件確認はシリーズを逐次処理し、個別失敗を`{seriesName, error}`として結果へ含める。

## 7. アップロードAPI

| Method | Path | 入力 | 成功応答 |
| --- | --- | --- | --- |
| GET | `/api/uploads?limit=` | 1〜100、既定10 | `200 {uploads}` |
| POST | `/api/upload` | multipart: `image`必須、`isbn`任意 | 新規`201`、既存`200` |
| POST | `/api/uploads/:id/isbn` | `{isbn}` | 新規`201`、既存`200` |
| POST | `/api/uploads/:id/retry` | なし | 新規`201`、既存`200` |
| POST | `/api/uploads/:id/dismiss` | なし | `204` |

画像制約:

- MIME許可: JPEG、PNG、WebP、HEIC/HEIF。
- 実体許可: JPEG、PNG、WebP、HEIFの単一静止画。検査後は最大3200pxのJPEGへ再エンコードして保存する。
- 最大12MB、最大4000万画素、縦横80px以上。
- 画像受信はクライアントIPごとに毎分12回まで。API全体は毎分240回まで。

バーコード読取不能時の422は、手動補完に使う`upload`も返す。

```json
{
  "error": "ISBNバーコードを読み取れませんでした。...",
  "upload": { "id": "...", "status": "needs_isbn" }
}
```

データ項目の完全な意味は[DB設計書](DATA-DESIGN.md)を参照する。
