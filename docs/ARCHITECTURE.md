# アーキテクチャ

本棚カタログは、ElectronがPC上でExpress APIを起動し、同じUIをデスクトップとLAN内のiPhoneへ配信する構成です。クラウドサーバーや外部データベースは使いません。

```mermaid
flowchart LR
  subgraph PC[Windows PC]
    Electron[Electron main]
    API[Express app]
    Routes[HTTP routes]
    Services[Use-case services]
    Repository[LibraryRepository]
    UI[React desktop UI]
    Data[(books.json / uploads / covers)]
    Electron --> API
    Electron --> UI
    UI --> API
    API --> Routes
    Routes --> Services
    Services --> Repository
    Repository --> Data
  end

  Phone[iPhone upload / duplicate check] -->|private LAN HTTP| API
  Services -->|ISBN and search queries| Metadata[openBD / Google Books / NDL / Open Library]
```

## 責務

| 場所 | 責務 |
| --- | --- |
| `electron/main.mjs` | 単一起動、ユーザーデータの保存先、ローカルサーバー、ウィンドウと外部リンクの管理 |
| `server/index.mjs` | 保存先と各サービスを組み立て、HTTPサーバーを起動するComposition Root |
| `server/app.mjs` | Expressミドルウェア、静的配信、共通エラー形式の構成 |
| `server/routes/` | HTTPの入力とステータスをサービス呼び出しへ変換する薄いルート層 |
| `server/book-service.mjs` | 蔵書の作成・更新・削除、ISBN書誌の取り込み、表紙補完 |
| `server/series-service.mjs` | 所持巻と刊行巻の比較、シリーズ追跡結果の保存 |
| `server/upload-service.mjs` | 画像保存、解析状態、アップロード履歴、ISBN確定 |
| `server/library-repository.mjs` | `books.json`と`uploads.json`の保存境界、初期データ作成 |
| `server/book-metadata-service.mjs` | openBDとGoogle Booksの書誌統合 |
| `server/ndl-catalog-service.mjs` | NDL候補検索、シリーズ巻検索、XML変換、短期キャッシュ |
| `server/cover-service.mjs` | 表紙候補の取得、画像検証、WebP変換、ローカルキャッシュ |
| `server/barcode-scanner.mjs` | 画像領域の段階探索、ZXing解析、ISBN検証 |
| `server/http-client.mjs` | 外部HTTP通信のタイムアウトとUser-Agent統一 |
| `server/book-model.mjs` | 保存データの既定値、カテゴリ・巻数・シリーズ名の純粋な正規化 |
| `server/isbn.mjs` | ISBNの整形、検証、ISBN-10からISBN-13への変換 |
| `server/offline-library.mjs` | 店頭へ持ち出す自己完結HTMLの安全な生成 |
| `src/DesktopLibrary.jsx` | PC本棚の状態、編集、新刊操作、アップロード通知と画面構成 |
| `src/library-model.js` | 検索・絞り込み・並び替え・シリーズ集約の純粋関数 |
| `src/MobileUpload.jsx` | iPhone撮影、端末内バーコード解析、LAN送信、持ち出し本棚 |
| `src/api.js` | JSON APIの共通エラー処理 |

## データの流れ

1. Electronが `%APPDATA%\HondanaCatalog\data` を保存先としてExpressを起動します。
2. PCとiPhoneのUIはファイルを直接触らず、すべてHTTP API経由で更新します。
3. ISBNは保存前に13桁へ正規化し、同じISBNの再登録は所蔵情報を残した更新として扱います。
4. 表紙は外部URLのままにせず、取得できた画像をWebPへ変換して `covers/` に保存します。
5. iPhone写真は端末内で先に解析し、失敗時だけ元画像をPCへ送り、より広い探索を行います。

## 守るべき前提

- `applyBookDefaults` は古い保存データとの互換入口です。項目追加時はここにも既定値を追加します。
- カテゴリは「保存済みの有効値」「旧データのマンガ分類」「名前付きキーワード規則」の順で決定します。
- 状態や外部依存を持つ処理はクラスへ集約し、文字列変換や判定は副作用のない関数として残します。
- Expressルートには書誌統合、保存形式、画像解析などの業務判断を書きません。
- JSON保存はファイル単位で直列化し、一時ファイルから置換します。直前の正常な内容は `.bak` に残し、主ファイルのJSONが壊れた場合に読み戻します。
- UIの検索・並び替え規則は `library-model.js` に集約し、Reactコンポーネント内へ重複させません。
- 持ち出しHTMLは外部スクリプトを読み込まず、埋め込みJSONのscript終端を必ずエスケープします。
- `normalizeIsbn` を通していないISBNを保存キーや重複判定に使いません。
- 外部APIの一部が失敗しても、ISBNだけで登録を継続できる状態を保ちます。
- 読了状態、保管場所、電子媒体、メモ、手動並び順は書誌情報の再取得で失わないようにします。
- LAN APIは信頼できるプライベートネットワーク専用です。インターネットへ直接公開しません。
