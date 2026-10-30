# DB の更新（自宅サーバー）

自宅サーバーの DB は、ここに置いた `.sql` を、サーバーで `bash ~/kz/server/update.sh` を打って入れます（`y` を押したときだけ入る）。

- ファイル名は `YYYYMMDD-NN_なまえ.sql`。名前の順に入れる
- 1ファイル＝1トランザクション。`begin` / `commit` は書かない（update.sh が足す）
- 入れたファイルは `kz_ops.migrations` に名前と sha256 が残る。**入れたあとのファイルは書きかえない**（直すときは新しいファイル）
- いちばん上の `--` の行は、入れる前に画面に出る説明。何が変わるかを短く書く
- `create or replace function` すると、関数の `statement_timeout` の設定が消える。schema.sql の「20秒まで待つ」の一覧にある関数は、ファイルの中で `alter function … set statement_timeout = '20s'` をつけなおす
- 新しい関数は `revoke all … from public, anon` と、必要なら `grant execute … to authenticated`
- schema.sql（いまの形の正本）も、同じように直しておく
- 鍵・パスワード・メールアドレスは書かない（このリポジトリは公開されている）
- 画面（JS）が新しい関数を使うときは、DB の更新を入れたあとに画面を出す（それまでは別のブランチ）
