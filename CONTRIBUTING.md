# 本棚カタログへのコントリビューション

不具合報告、改善提案、ドキュメント修正、コード変更を歓迎します。利用者向けの導入方法は [README.md](README.md)、設計資料は [docs/README.md](docs/README.md) を参照してください。

## 開発環境

- Windows 10またはWindows 11
- Node.js 24以上
- npm
- Git

配布EXEを利用するだけの場合、Node.jsとnpmは不要です。

## セットアップ

ロックファイルと同じ依存関係をインストールします。

```powershell
npm ci
```

開発中の最新版を独立したElectron画面で確認します。

```powershell
npm run desktop
```

ビルドしたフロントエンドとAPIサーバーを1コマンドで確認する場合は、次を実行して `http://127.0.0.1:8080` を開きます。

```powershell
npm run app
```

フロントエンドとAPIを別々に起動する場合は、2つのターミナルを使います。

```powershell
npm run server
```

```powershell
npm run dev
```

`npm run dev` はフロントエンドだけを起動します。APIサーバーを併用しない場合、蔵書一覧、表紙、バーコード登録などはオフライン表示になります。

## 検査

Pull Requestを作成する前に、静的検査、型検査、テスト、ビルドをまとめて実行します。

```powershell
npm run check
```

個別のコマンドは次のとおりです。

| コマンド | 内容 |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScriptによるJSDocの型検査 |
| `npm test` | Node.jsテスト |
| `npm run build` | Vite本番ビルド |
| `npm run security:audit` | アプリ依存の既知脆弱性監査 |
| `npm run security:audit:packaging` | 配布用依存の既知脆弱性監査 |

mainへのpushとPull Requestでは、GitHub Actionsが同じ検査をWindows上で実行します。

## Windowsポータブル版

ローカルでポータブルEXEを作成します。

```powershell
npm run dist:win
```

生成物はGit管理対象外の `release/` に出力されます。配布用ツールの依存は `packaging/` に隔離され、通常のアプリ依存には含まれません。

`v*`タグをGitHubへpushすると、GitHub Actionsが監査、テスト、ポータブル版ビルド、成果物証明を実行し、EXEとSHA-256ファイルをGitHub Releasesへ公開します。タグはリリース内容とバージョンを確認してから作成してください。

## Pull Request

1. 変更の目的ごとにブランチを作成します。
2. 関係のないファイルや個人の蔵書データをコミットへ含めません。
3. 仕様変更では、必要に応じて `docs/` とテストも更新します。
4. `npm run check` が成功した状態でPull Requestを作成します。
5. Pull Request本文へ変更理由、利用者への影響、検証方法を記載します。

`data/`、`release/`、アップロード画像、表紙キャッシュ、QA用一時ファイルはコミットしないでください。
