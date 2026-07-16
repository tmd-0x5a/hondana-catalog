---
name: hondana-maintenance
description: 本棚カタログの機能追加、リファクタリング、セキュリティ改善、JSDoc追加、レスポンシブ修正、配布前確認に使用する。server、src、electron、docsを変更するとき、既存データ互換とLAN公開面を守りながら責務分離と検証を一貫して行うためのプロジェクト保守Skill。
---

# Hondana Maintenance

## Start With Evidence

1. `git status --short`で利用者の未コミット変更を把握し、無関係な変更を戻さない。
2. `docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、対象仕様書を読む。
3. `rg`で呼出元、保存既定値、入力検証、テストを同時に探す。
4. 画面変更では現状スクリーンショットを確認し、固定幅、はみ出し、重なりの原因を特定する。

## Keep Responsibilities Explicit

- 文字列変換、分類、絞り込み、並び替え、表示モデル生成は副作用のない名前付き関数にする。
- 外部HTTP、キャッシュ、保存、時刻、複数工程の状態を持つ処理だけをクラスにする。クラス化自体を目的にしない。
- Expressルートは入力を受け、サービスを呼び、HTTP応答へ変換するだけにする。
- `server/index.mjs`はComposition Rootとして依存の組立と起動だけを行う。
- React最上位は状態とユースケースを調停し、独立した画面・ツール・繰返し表示は`src/components/`へ分ける。
- 条件分岐の根拠を関数名で表す。許可リスト判定だけでは理由が読めない場合は、規則の優先順位をJSDocか直前コメントに残す。

## Preserve Data

- Book項目を増やすときは`src/types.js`、`server/book-model.mjs`、`server/book-record.mjs`、`server/request-validation.mjs`、設計書、テストを一組で更新する。
- ISBN再取得で読書状態、評価、所蔵、メモ、手動順を失わない。
- JSONの読込・変更・保存は`LibraryRepository.updateBooks`または`updateUploads`内で直列化する。
- データ移行は冪等にし、古いレコードを起動不能にしない。

## Defend The LAN Surface

- HTTP入力は許可項目、型、長さ、列挙値、配列件数を検証してからサービスへ渡す。
- URLは必要なHTTPSホストだけを許可し、リダイレクト後も再検査する。ローカルIPへの外部取得を許さない。
- 画像は拡張子やMIMEだけで信用せず、実体形式、容量、画素数、寸法を検査して再エンコードする。
- Host、プライベートIP、Origin、LANトークン、レート制限、CSPを弱める変更は行わない。
- 5xx応答へ内部パス、スタック、外部API本文を含めない。

## Write Useful JSDoc

- exportする関数、クラス、公開メソッドには目的、引数、戻り値、重要な副作用を記す。
- 複雑な内部関数には「何をするか」より、優先順位、失敗時の継続方針、守る不変条件を書く。
- 代入や単純な条件を言い換えるコメントは追加しない。
- JSDocの型は可能な限り`src/types.js`の共有契約を参照する。

## Check The Interface

- 1,426px前後では右詳細をオーバーレイ化し、上部操作を欠けさせない。
- 1,180px、900px、780px以下も確認し、ボタン文字、棚カード、モーダルを重ねない。
- 固定形式の本カードはCSS変数と縦横比で寸法を安定させる。
- シリーズ集約、見出し非表示、最大・最小カードサイズ、詳細フィルターを組み合わせて確認する。
- 操作アイコンには`aria-label`または`title`を付け、キーボード操作できる要素を使う。

## Verify Before Finishing

1. 変更した純粋関数とサービスへ正常系・除外条件・失敗系のテストを追加する。
2. `npm test`と`npm run build`を実行する。環境のNodeが使えない場合はワークスペースのbundled Nodeを使う。
3. 依存変更時は`npm audit`を実行する。
4. 開発サーバーでデスクトップと狭幅のスクリーンショットを撮り、空白、横スクロール、重なりを確認する。
5. `git diff --check`、秘密情報・個人情報・プライベートIPの検索、`git status --short`を確認する。
6. 実装と同じターンで要件、機能、画面、API、データ、セキュリティの該当文書を更新する。

内部メモや「次のリファクタリング候補」は公開READMEへ載せない。利用者が明示した場合だけIssue向けの具体的な作業単位として整理する。
