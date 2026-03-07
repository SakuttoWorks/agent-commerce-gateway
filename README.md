# 🏴‍☠️ Ghost Ship Proxy (Edge Layer)

Project GHOST SHIP の「玄関（Edge Gateway）」を担当する Cloudflare Worker です。
Python で記述されており、AI Agent からのリクエストを高速に処理・ルーティングします。

## 役割 (Layer A)

1. **MCP Protocol Handling**: Agent との接続維持 (SSE)。
2. **Auth Gateway**: RapidAPI / Polar.sh の認証チェック。
3. **Routing**: 重い処理を Google Cloud Run (Layer B) へ転送。

## クイックスタート

### 1. 依存関係のインストール

```bash
npm install
```

### 2. ローカル開発サーバー起動

```bash
npm run dev
# または
npx wrangler dev
```

### 3. デプロイ

```bash
npm run deploy
# または
npx wrangler deploy
```

## ディレクトリ構成

* **src/entry.py**: メインロジック（ここを編集する）
* **llms.txt**: Agent 用の説明書
* **mcp.json**: Agent 用のツール定義

---

### .gitignore 追加分

```text
# Python bytecode
__pycache__/
*.pyc
```