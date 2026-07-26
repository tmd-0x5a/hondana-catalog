# セキュリティ設計と残余リスク

## 1. 結論

本アプリは、信頼できる家庭内プライベートLANで個人利用する条件に対して防御を設けている。インターネット公開、多人数利用、敵対的な同一LAN、公共Wi-Fiを安全に扱う設計ではない。

## 2. 攻撃面と対策

| 攻撃面 | 主なリスク | 実装済み対策 |
| --- | --- | --- |
| LAN HTTP | 無断閲覧・更新・削除 | 起動時256bitトークン、HttpOnly SameSite Cookie、Host・プライベートIP検査 |
| 悪意あるWebページ | CSRF、DNS rebinding | Origin・Sec-Fetch-Site検査、Host許可リスト、トークン |
| API大量要求 | CPU・メモリ・外部API枯渇 | API毎分240回、ISBN画像毎分12回、OCR一括毎分4回のIP別制限。OCR候補検索は逐次実行 |
| JSON入力 | 型混乱、巨大入力、想定外項目 | 本文1MB、許可項目、型、長さ、列挙値を検査。一括取り込みは最大200件 |
| 画像アップロード | MIME偽装、パストラバーサル、画像爆弾 | 1枚12MB、実体形式、4000万画素、静止画検査、保存用JPEG・OCR用PNG再構築、サーバー生成名、basename表示名。一括OCRは12枚まで |
| Windows OCR | コマンド注入、一時ファイル残存、画像外部送信 | `execFile`引数配列、固定PowerShellスクリプト、生成ファイル名、`finally`削除、ローカルOCRのみ |
| 外部画像 | SSRF、巨大レスポンス、画像爆弾 | HTTPS許可ホスト、追跡前リダイレクト検査、8MB、寸法・画素数・静止画検査 |
| 外部JSON/XML | メモリ枯渇、停止 | タイムアウト、2〜4MB受信上限、API単位の失敗分離 |
| Electron | rendererからPC権限取得 | `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、権限要求拒否 |
| 画面遷移 | 任意scheme・外部ページ読込 | URLパーサーによるorigin完全一致、外部は認証情報なしHTTPSだけOSブラウザへ渡す |
| XSS・埋込み | 保存文字列のスクリプト化 | Reactの標準エスケープ、CSP、持ち出しHTMLのscript終端エスケープ |
| JSON破損 | 蔵書利用不能 | 原子的置換、正常JSON一世代バックアップ、破損時読戻し、起動日ごとの蔵書スナップショット7世代 |

## 3. セキュリティヘッダー

- CSP: `default-src 'self'`を基準に、画像の`data:`・`blob:`だけ追加許可する。
- `frame-ancestors 'none'`、`X-Frame-Options: DENY`で埋込みを拒否する。
- `object-src 'none'`、`base-uri 'none'`、`form-action 'self'`を指定する。
- `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`を指定する。
- camera、microphone、geolocation、payment、USBのPermissions Policyを拒否する。

画像撮影はブラウザの`<input type="file" capture>`を使用し、Electronへカメラ権限を与えない。

## 4. 依存関係

- アプリ依存はルートの`package-lock.json`、配布ツールは`packaging/package-lock.json`で別々に固定する。
- 2026-07-27のルート`npm audit`では、実行時・開発時を合わせた既知脆弱性は0件。
- `electron-builder 26.15.7`の推移依存にはhigh 16件が残る。これは旧構成のhigh 23件から減少したが0件ではない。配布専用の`packaging/`へ隔離し、EXEへビルドツール自体を含めず、CIではcriticalを失敗条件として監視する。
- `npm run security:audit`と`npm run security:audit:packaging`をCIとリリース前に実施する。互換性のない推移依存の強制置換は行わず、Windows配布ビルドを通過する上流修正版へ更新する。
- ElectronはChromiumとNode.jsを同梱するため、安定版更新とリリース再作成を継続する。
- Dependabotでルートnpm、配布用npm、GitHub Actionsを定期確認する。

## 5. 配布経路

- CIとビルドジョブの`GITHUB_TOKEN`は読み取り専用とし、Releaseへ書き込める権限は検証済み成果物を公開する最終ジョブだけへ付与する。
- 外部Actionは移動可能なタグ名ではなく、公式リポジトリで確認した完全なコミットSHAへ固定する。Dependabotの更新時も差分と上流リリースを確認する。
- チェックアウト時のGit認証情報はワークツリーへ残さない。
- EXEのSHA-256ファイルに加え、GitHub Artifact Attestationsでリポジトリ、コミット、ビルドワークフローに結び付いた来歴証明を生成する。
- タグのバージョンと`package.json`のバージョンが一致しない場合は、ビルド前にリリースを停止する。

## 6. 残余リスク

| リスク | 理由 | 運用上の対応 |
| --- | --- | --- |
| LAN盗聴 | 自己署名証明書の配布を避けるためHTTP | 家庭の暗号化Wi-Fiだけで使い、公共・ゲストWi-FiではLAN連携しない |
| 同一LANの高度な攻撃者 | HTTP Cookieや画像通信を観測できる可能性 | 信頼できない端末がいるLANではアプリを終了し、Windows Firewallはプライベートだけ許可する |
| ディスク枯渇 | 登録写真は利用者データとして保持する | `data/uploads`容量を確認し、不要データはバックアップ後に整理する |
| PC内バックアップのみ | `.bak`と日次スナップショット7世代はPC故障・盗難には無力 | `data/`の別媒体コピー、または`/api/export/books`のJSONを定期保存する |
| 外部データ誤り | 書誌APIの登録漏れ・版違い | 現物、出版社、書店情報でも確認する |
| マルウェア検査 | ローカルアプリ内でAVエンジンを持たない | Windows Defenderを有効にし、画像以外を受け付けない現行制限を維持する |
| 配布ツールの推移依存 | `electron-builder`上流にhigh警告が残る | 隔離したロックファイル、critical監査、Dependabot、上流更新で継続監視する |
| コード署名なし | 商用コード署名証明書を使用していない | ReleaseのSHA-256と`gh attestation verify`で出所を確認し、SmartScreen警告時は安易に続行しない |
| CI基盤侵害 | GitHub ActionsやWindows runnerを完全には自前検証できない | ActionのSHA固定、最小権限、ジョブ分離、成果物証明で影響と検知範囲を限定する |

## 7. 公開・運用チェック

1. ルーターのポート転送、DMZ配置、インターネット公開を行わない。
2. Windows Firewallではプライベートネットワークだけ許可する。
3. QRに含まれるURLをスクリーンショットやログとして公開しない。再起動でトークンは失効する。
4. `npm run security:audit`、`npm run security:audit:packaging`、`npm run check`（lint、型検査、テスト、ビルド）をリリース前に通す。pushとPRではCIが同じ検査を実行する。
5. `data/`、`release/`、個人写真がGit追跡されていないことを確認する。
6. セキュリティ上の問題を見つけた場合、公開Issueへ個人データや再現用トークンを貼らない。

## 8. 参照基準

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Express Production Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Node.js Crypto: timingSafeEqual](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)
- [GitHub Artifact Attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations)
