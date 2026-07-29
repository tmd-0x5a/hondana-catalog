# テスト仕様書

## 1. 文書情報

| 項目 | 内容 |
| --- | --- |
| 対象 | 本棚カタログ 0.5系 |
| 基準 | 現行実装、要件定義書、機能仕様書、画面仕様書 |
| 自動テスト | Node.js標準テストランナー、23ファイル82件 |
| 主対象環境 | Windows x64、Node.js 24、Electron 43、iPhone Safari |
| 更新日 | 2026-07-27 |

## 2. 目的と範囲

本書は、蔵書登録、書誌取得、本棚整理、シリーズ追跡、OCR一括取り込み、LAN連携、ローカル保存、配布EXEの品質確認方法を定める。

自動テストは副作用を分離したロジック、サービス、保存層、HTTP境界、入力検証、セキュリティ規則を対象とする。Electron画面、iPhone実機、Windows OCR、外部API、レスポンシブ表示、配布EXEは環境依存があるため手動テストを併用する。

## 3. 合否基準

リリース可能とする条件は次のとおり。

1. `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`がすべて成功する。
2. 自動テスト82件が失敗、スキップ、未完了なしで終了する。
3. ルートの`npm audit --audit-level=high`が成功し、隔離した配布依存の`npm audit --prefix packaging --audit-level=critical`が成功する。
4. 変更機能に関係する手動テストがすべて合格する。
5. 配布時はポータブルEXEが起動し、SHA-256ファイルとGitHub成果物証明を確認できる。
6. 外部APIの一時障害など、仕様上許容する制約は不具合と区別して記録する。

## 4. テスト環境とデータ

| 区分 | 条件 |
| --- | --- |
| PC | Windows x64。通常画面は1440x920、最小画面は720x560でも確認する |
| スマートフォン | iPhone Safari。PCと同じ信頼できるプライベートLANへ接続する |
| Node.js | 24以上。依存は`npm ci`でロックファイルどおりに導入する |
| 保存先 | 実データを使わず、テスト専用の`HONDANA_DATA_DIR`または一時ディレクトリを使う |
| 外部通信 | openBD、Google Books、NDL、Open Libraryの正常時と、一部失敗時を分けて確認する |
| 画像 | 正常なJPEG/PNG/WebP、拡張子偽装、巨大画像、一覧型・グリッド型の電子書店スクリーンショットを用意する |
| 蔵書 | 実本・電子書籍、マンガ・小説・技術書、同一シリーズ複数巻、読みあり・なし、旧形式JSONを含める |

自動テストでは外部APIと時刻を可能な範囲でスタブ化し、利用者の蔵書、写真、ネットワーク状態へ依存させない。手動テストで個人データを使った場合、スクリーンショットやログを公開Issueへ添付しない。

## 5. 自動テスト一覧

`npm test`は`test/all.test.mjs`が次の23ファイルを読み込み、合計82件を実行する。

| ID | テストファイル | 件数 | 主な確認内容 |
| --- | --- | ---: | --- |
| AUT-01 | `app-routes.test.mjs` | 1 | HTTPルートと既存APIレスポンス形式 |
| AUT-02 | `book-bulk-import-service.test.mjs` | 2 | ISBN・手動書誌の一括登録、行単位の失敗分離 |
| AUT-03 | `book-metadata-service.test.mjs` | 3 | openBD・Google Books統合、読み、紹介文、表紙候補 |
| AUT-04 | `book-model.test.mjs` | 6 | 旧データ補完、カテゴリ・媒体・シリーズ・巻数の正規化 |
| AUT-05 | `book-pack-service.test.mjs` | 13 | 候補抽選、重複除外、進捗、日次保存、障害継続 |
| AUT-06 | `book-screenshot-import-service.test.mjs` | 11 | OCR行統合、候補類似度、分割検索、429制御 |
| AUT-07 | `book-service.test.mjs` | 4 | ISBN再登録、手動登録、所蔵情報維持、補完間隔 |
| AUT-08 | `bulk-import-model.test.mjs` | 2 | ISBN一覧・TSV解析、処理件数上限 |
| AUT-09 | `cover-service.test.mjs` | 2 | 表紙許可ホスト、リダイレクト前検査 |
| AUT-10 | `http-client.test.mjs` | 1 | 外部HTTP本文の宣言・実受信サイズ上限 |
| AUT-11 | `image-validator.test.mjs` | 1 | 画像実体形式の判定、偽装拒否 |
| AUT-12 | `isbn.test.mjs` | 4 | ISBN整形、検証、10桁から13桁への変換、400エラー |
| AUT-13 | `library-model.test.mjs` | 9 | 検索、絞り込み、並び替え、棚見出し、シリーズ集約 |
| AUT-14 | `library-repository.test.mjs` | 5 | JSON保存、直列化、`.bak`復旧、スナップショット、日次パック |
| AUT-15 | `ndl-catalog-service.test.mjs` | 3 | NDL変換、キャッシュ、著者推薦、SRU一括検索 |
| AUT-16 | `network.test.mjs` | 2 | LANアドレス選択、localhostフォールバック |
| AUT-17 | `offline-library.test.mjs` | 1 | 持ち出しHTMLのscript終端エスケープ |
| AUT-18 | `request-validation.test.mjs` | 3 | 許可項目、型・長さ・列挙値、URL、配列上限 |
| AUT-19 | `security.test.mjs` | 2 | LANトークン、Host・IP・Origin、Cookie、レート制限 |
| AUT-20 | `series-service.test.mjs` | 1 | 所持巻より後の最初の巻とシリーズ全冊への保存 |
| AUT-21 | `upload-service.test.mjs` | 1 | 端末申告ISBNの画像保存前検証 |
| AUT-22 | `url-policy.test.mjs` | 2 | Electron内遷移と外部HTTPS URLの制限 |
| AUT-23 | `windows-ocr-service.test.mjs` | 3 | 座標付きOCR、旧形式互換、Windows外の拒否 |
|  | **合計** | **82** |  |

テスト追加・削除時は、同じ変更内で件数と対象説明を更新する。

## 6. 静的検査とビルド検査

| ID | コマンド | 合格条件 |
| --- | --- | --- |
| STA-01 | `npm run lint` | ESLintエラー0件 |
| STA-02 | `npm run typecheck` | JSDocを含むTypeScript checkJsエラー0件 |
| BLD-01 | `npm run build` | Vite本番ビルド成功、`dist/index.html`とアセットを生成 |
| SEC-01 | `npm run security:audit` | アプリ依存でhigh以上の既知脆弱性なし |
| SEC-02 | `npm run security:audit:packaging` | 隔離した配布依存でcriticalなし |
| REL-01 | `npm run dist:win` | `release/Hondana-Catalog-Portable-{version}.exe`を生成 |

## 7. 手動テスト

| ID | 対応要件 | 事前条件・操作 | 期待結果 |
| --- | --- | --- | --- |
| MAN-PC-01 | FR-11、NFR-03 | 新しいテスト用保存先でポータブルEXEを起動し、終了後に再起動する | 独立したElectron画面が開き、白画面やブラウザUIにならない。再起動後も登録内容を保持する |
| MAN-PC-02 | FR-01〜FR-04 | 手動、ISBN-10、ISBN-13で本を追加し、所蔵情報を編集後、確認を経て1冊削除する | 重複ISBNは既存本の書誌を更新し、場所・媒体・状態等を失わない。削除は対象だけに反映する |
| MAN-PC-03 | FR-05、FR-06 | 検索と全フィルターを組み合わせ、名前・著者・出版社・シリーズ・場所・手動順を切り替える。仕切り、本の大きさ、シリーズ集約も変更する | 条件どおりの本だけを表示し、読みベースのかな見出しを出す。仕切り非表示と設定保存が機能する |
| MAN-PC-04 | FR-07、FR-08、FR-12 | 同一シリーズ複数巻を集約して詳細へ移動し、新刊確認、リマインダー、おすすめ、本のパックを操作する | 巻数順の共通本棚UI、次巻、期限、未所持候補、当日同一パックを正しく表示する |
| MAN-PC-07 | FR-12 | 封筒の口とカード束を順番に上へドラッグし、並んだカードを任意の順で1枚ずつめくる | カードが時間差で同じ裏面のまま並ぶ。通常カードからレアを事前判別できず、レアをめくった時だけ専用演出と正しい選定理由を表示する |
| MAN-PC-05 | FR-13 | ISBN改行一覧とタイトル・著者TSVを実本・電子書籍それぞれへ一括登録する | 入力プレビュー、保存先、成功・失敗件数が正しく、1行の失敗で残りを中断しない |
| MAN-PC-06 | FR-13、NFR-10 | 一覧型・グリッド型スクリーンショットを最大12枚選び、OCR候補を確認・修正して登録する | 画像を外部送信せず、書名候補と表紙を表示する。無関係候補を抑制し、ISBNなしは書名のみで登録できる |
| MAN-UI-01 | FR-06 | 1440x920、1024x768、720x560で本棚、詳細、モーダル、シリーズ画面を操作する | 横方向の不自然なはみ出しや重なりがなく、必要な領域をスクロールでき、主要操作へ到達できる |
| MAN-MOB-01 | FR-09 | PCのQRをiPhoneで読み、初回接続後にページ更新し、写真とISBNを送信する | URLからトークンが消え、Cookieで継続利用できる。PCへ処理状況と登録結果が反映される |
| MAN-MOB-02 | FR-01、FR-09 | 明るい場所でバーコードを撮影し、読取不能画像では手動ISBNを入力する | 端末内解析を先に行い、成功時は待ち時間を短縮する。失敗時は写真を保持して手動入力へ進める |
| MAN-MOB-03 | FR-10 | 出発前同期後にiPhoneを機内モードへし、タイトル・著者・ISBNで検索する | PCやLANなしでも登録済み本を検索でき、重複購入確認に利用できる |
| MAN-DATA-01 | FR-11、FR-14、NFR-04 | 登録・編集後に終了、再起動、JSON書き出しを行う。テスト用主JSONを破損させて再起動する | 原子的保存、`.bak`読戻し、日次スナップショット、JSON書き出しが機能し、他の保存先へ影響しない |
| MAN-ERR-01 | FR-02、NFR-05 | 書誌APIまたは表紙APIの一部を利用不能にしてISBN登録と候補検索を行う | 利用可能な情報で継続し、ISBNだけまたは書名だけでも登録できる。再試行可能な案内を表示する |
| MAN-SEC-01 | NFR-01〜NFR-03 | 無効トークン、未知Host、外部Origin、公開IP相当の要求、画像偽装を送る | API・画像を拒否し、任意ファイルを保存・実行しない。外部URLはElectron内で開かない |
| MAN-REL-01 | 配布 | GitHub ReleaseからEXEと`.sha256.txt`を取得し、SHA-256と成果物証明を検証して起動する | ハッシュが一致し、`gh attestation verify`が成功し、ポータブルEXEが本棚画面を表示する |

## 8. 要件トレーサビリティ

| 要件 | 主な確認ID |
| --- | --- |
| FR-01〜FR-04 | AUT-01、AUT-07、AUT-12、AUT-18、MAN-PC-02 |
| FR-05〜FR-06 | AUT-13、MAN-PC-03、MAN-UI-01 |
| FR-07〜FR-08 | AUT-13、AUT-15、AUT-20、MAN-PC-04 |
| FR-09〜FR-10 | AUT-16、AUT-17、AUT-19、AUT-21、MAN-MOB-01〜03 |
| FR-11 | AUT-14、AUT-21、MAN-PC-01、MAN-DATA-01 |
| FR-12 | AUT-05、AUT-15、MAN-PC-04 |
| FR-13 | AUT-02、AUT-06、AUT-08、AUT-11、AUT-18、AUT-23、MAN-PC-05〜06 |
| FR-14 | AUT-14、MAN-DATA-01 |
| NFR-01〜NFR-03 | AUT-18、AUT-19、AUT-22、MAN-SEC-01 |
| NFR-04〜NFR-06 | AUT-03、AUT-05、AUT-09、AUT-10、AUT-14、AUT-19、MAN-ERR-01 |
| NFR-07 | STA-01、STA-02、GitHub Actions CI |
| NFR-08 | AUT-17、MAN-DATA-01、MAN-MOB-03 |
| NFR-09 | AUT-04、AUT-14 |
| NFR-10 | AUT-06、AUT-23、MAN-PC-06 |

## 9. 実施記録

テスト実施時は、次をIssue、Pull Request、またはリリース記録へ残す。

| 項目 | 記録内容 |
| --- | --- |
| 対象 | バージョン、コミットSHA、変更概要 |
| 環境 | Windows、Node.js、Electron、iPhone・Safariのバージョン |
| 自動結果 | 実行コマンド、成功件数、失敗件数、CI URL |
| 手動結果 | 実施ID、合否、確認者、確認日 |
| 証跡 | 個人情報とLANトークンを除いた画面、ログ、ハッシュ |
| 未解決 | 再現手順、期待値、実結果、重大度、回避策 |

不具合修正では、可能な限り失敗を再現する自動テストを先に追加し、修正後に関連する手動テストも再実施する。
