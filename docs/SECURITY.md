# セキュリティ設計と残余リスク

## 1. 結論

本アプリは、信頼できる家庭内プライベートLANで個人利用する条件に対して防御を設けている。インターネット公開、多人数利用、敵対的な同一LAN、公共Wi-Fiを安全に扱う設計ではない。

## 2. 攻撃面と対策

| 攻撃面 | 主なリスク | 実装済み対策 |
| --- | --- | --- |
| LAN HTTP | 無断閲覧・更新・削除 | 起動時256bitトークン、HttpOnly SameSite Cookie、Host・プライベートIP検査 |
| 悪意あるWebページ | CSRF、DNS rebinding | Origin・Sec-Fetch-Site検査、Host許可リスト、トークン |
| API大量要求 | CPU・メモリ・外部API枯渇 | API毎分240回、画像毎分12回のIP別制限 |
| JSON入力 | 型混乱、巨大入力、想定外項目 | 本文1MB、許可項目、型、長さ、列挙値を検査。一括取り込みは最大200件 |
| 画像アップロード | MIME偽装、パストラバーサル、画像爆弾 | 12MB、実体形式、4000万画素、静止画検査、JPEG再構築、サーバー生成名、basename表示名 |
| 外部画像 | SSRF、巨大レスポンス、画像爆弾 | HTTPS許可ホスト、追跡前リダイレクト検査、8MB、寸法・画素数・静止画検査 |
| 外部JSON/XML | メモリ枯渇、停止 | タイムアウト、2〜4MB受信上限、API単位の失敗分離 |
| Electron | rendererからPC権限取得 | `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、権限要求拒否 |
| 画面遷移 | 任意scheme・外部ページ読込 | URLパーサーによるorigin完全一致、外部は認証情報なしHTTPSだけOSブラウザへ渡す |
| XSS・埋込み | 保存文字列のスクリプト化 | Reactの標準エスケープ、CSP、持ち出しHTMLのscript終端エスケープ |
| JSON破損 | 蔵書利用不能 | 原子的置換、正常JSON一世代バックアップ、破損時読戻し |

## 3. セキュリティヘッダー

- CSP: `default-src 'self'`を基準に、画像の`data:`・`blob:`だけ追加許可する。
- `frame-ancestors 'none'`、`X-Frame-Options: DENY`で埋込みを拒否する。
- `object-src 'none'`、`base-uri 'none'`、`form-action 'self'`を指定する。
- `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`を指定する。
- camera、microphone、geolocation、payment、USBのPermissions Policyを拒否する。

画像撮影はブラウザの`<input type="file" capture>`を使用し、Electronへカメラ権限を与えない。

## 4. 依存関係

- `npm audit`をリリース前に実施する。
- 2026-07-16の監査で検出された既知脆弱性は0件。`vite 6.4.3`を使用し、`electron-builder 26.11.1`はWindows配布ビルドとCommonJS互換性を確認した版へ固定している。
- ElectronはChromiumとNode.jsを同梱するため、安定版更新とリリース再作成を継続する。
- ビルド専用パッケージは`devDependencies`へ分離し、実行時依存を減らす。

## 5. 残余リスク

| リスク | 理由 | 運用上の対応 |
| --- | --- | --- |
| LAN盗聴 | 自己署名証明書の配布を避けるためHTTP | 家庭の暗号化Wi-Fiだけで使い、公共・ゲストWi-FiではLAN連携しない |
| 同一LANの高度な攻撃者 | HTTP Cookieや画像通信を観測できる可能性 | 信頼できない端末がいるLANではアプリを終了し、Windows Firewallはプライベートだけ許可する |
| ディスク枯渇 | 登録写真は利用者データとして保持する | `data/uploads`容量を確認し、不要データはバックアップ後に整理する |
| 一世代バックアップ | 誤削除や長期破損は戻せない | アプリ終了後に`data/`を別媒体へ定期コピーする |
| 外部データ誤り | 書誌APIの登録漏れ・版違い | 現物、出版社、書店情報でも確認する |
| マルウェア検査 | ローカルアプリ内でAVエンジンを持たない | Windows Defenderを有効にし、画像以外を受け付けない現行制限を維持する |

## 6. 公開・運用チェック

1. ルーターのポート転送、DMZ配置、インターネット公開を行わない。
2. Windows Firewallではプライベートネットワークだけ許可する。
3. QRに含まれるURLをスクリーンショットやログとして公開しない。再起動でトークンは失効する。
4. `npm audit`、`npm test`、`npm run build`をリリース前に通す。
5. `data/`、`release/`、個人写真がGit追跡されていないことを確認する。
6. セキュリティ上の問題を見つけた場合、公開Issueへ個人データや再現用トークンを貼らない。

## 7. 参照基準

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Express Production Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Node.js Crypto: timingSafeEqual](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
