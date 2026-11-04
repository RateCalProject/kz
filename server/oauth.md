# Google・Discord でログインできるようにする

画面（ログインの画面・設定 → プロフィール の「ログインのしかた」）は、もうできています。サーバーのログインのしくみ（Supabase の auth・GoTrue）で Google と Discord をオンにすると、ボタンが出ます。

- 秘密（クライアントシークレット）は、サーバーの `.env` にだけ書きます。GitHub・チャット・スクリーンショットには出しません
- サーバーの Claude にたのむときは、このファイルを見せて「Google・Discord のログインを入れて」と送ります。秘密は本人が `.env` に入れます
- つながる先（リダイレクト URI）は、どちらも `https://api.a-ruri.com/auth/v1/callback` です

## 1. Google のアプリをつくる

1. https://console.cloud.google.com/ をひらき、プロジェクトをつくる（名前は「風の芽経済組」など）
2. 「API とサービス」→「OAuth 同意画面」：ユーザーの種類は「外部」。アプリ名・サポートのメール・承認済みのドメイン（`a-ruri.com`）を入れる
3. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」：種類は「ウェブ アプリケーション」
   - 承認済みのリダイレクト URI：`https://api.a-ruri.com/auth/v1/callback`
4. 出てきた **クライアント ID** と **クライアント シークレット** を、あとで `.env` に入れる
5. 「OAuth 同意画面」の公開ステータスを「本番環境」にする（テストのままだと、テストユーザーに入れた人しかログインできない）

## 2. Discord のアプリをつくる

1. https://discord.com/developers/applications →「New Application」（名前は「風の芽経済組」など）
2. 「OAuth2」→「Redirects」に `https://api.a-ruri.com/auth/v1/callback` を足して保存
3. 同じページの **Client ID** と **Client Secret**（「Reset Secret」で出る）を、あとで `.env` に入れる

## 3. サーバーの設定

Supabase の `docker-compose.yml` と `.env` があるフォルダで作業します。どこにあるかわからないときは：

```bash
docker inspect supabase-auth --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
```

1. 念のため、2つのファイルの写しを取る

   ```bash
   cp .env .env.bak-oauth && cp docker-compose.yml docker-compose.yml.bak-oauth
   ```

2. `.env` のおわりに足す（`…` を、1・2 でコピーしたものに）

   ```bash
   GOOGLE_ENABLED=true
   GOOGLE_CLIENT_ID=…
   GOOGLE_SECRET=…
   DISCORD_ENABLED=true
   DISCORD_CLIENT_ID=…
   DISCORD_SECRET=…
   ```

3. `docker-compose.yml` の `auth:` の `environment:` に足す（まわりの行と同じだけ字下げ）

   ```yaml
         GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${GOOGLE_ENABLED}
         GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
         GOTRUE_EXTERNAL_GOOGLE_SECRET: ${GOOGLE_SECRET}
         GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: ${API_EXTERNAL_URL}/auth/v1/callback
         GOTRUE_EXTERNAL_DISCORD_ENABLED: ${DISCORD_ENABLED}
         GOTRUE_EXTERNAL_DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
         GOTRUE_EXTERNAL_DISCORD_SECRET: ${DISCORD_SECRET}
         GOTRUE_EXTERNAL_DISCORD_REDIRECT_URI: ${API_EXTERNAL_URL}/auth/v1/callback
         GOTRUE_SECURITY_MANUAL_LINKING_ENABLED: "true"
   ```

   さいごの行は、設定 → プロフィール の「つなぐ」（いまの登録に Google・Discord をつなぐ）に いります

4. `.env` の、つぎの3つを見る（ちがっていたら直す）
   - `API_EXTERNAL_URL=https://api.a-ruri.com`
   - `SITE_URL=https://a-ruri.com`
   - `ADDITIONAL_REDIRECT_URLS` に `https://a-ruri.com/**` が入っている

5. ログインのしくみだけを作りなおす（ほかは止まらない）

   ```bash
   docker compose up -d auth
   ```

## 4. たしかめる

- サイトのログインの画面に「Google でログイン」「Discord でログイン」が出る
- 自分のアカウントで、設定 → プロフィール →「ログインのしかた」で「つなぐ」→ もどってくると「つながっています」
- 出ないとき：`docker compose logs --tail 50 auth` を見る（秘密が写っていないか たしかめてから Claude に見せる）

## うまくいかないとき・もどすとき

- 「redirect_uri_mismatch」：Google・Discord に入れたリダイレクト URI が `https://api.a-ruri.com/auth/v1/callback` と1字でもちがう
- Google で「このアプリは確認されていません」：OAuth 同意画面が「テスト」のまま（1-5）
- もどす：写しを書きもどして `docker compose up -d auth`

  ```bash
  cp .env.bak-oauth .env && cp docker-compose.yml.bak-oauth docker-compose.yml && docker compose up -d auth
  ```
