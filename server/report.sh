#!/usr/bin/env bash
# 風の芽経済組：自宅サーバーのようすを短くまとめる（Claude に貼る用）
#   bash ~/kz/server/report.sh
# メールアドレス・鍵は伏せる。所持金・国庫の数は出さない。DB は変えない
set -uo pipefail
export LC_ALL=C.UTF-8
DB="${KZ_DB:-supabase-db}"
if [ -n "${KZ_PSQL:-}" ]; then read -r -a PSQL <<< "$KZ_PSQL"; else PSQL=(docker exec -i "$DB" psql -U postgres -d postgres); fi
PSQL+=(-X -q -At)
mask() { sed -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<mail>/g; s/(eyJ|sb_secret_|sb_publishable_|re_)[A-Za-z0-9._-]{8,}/<key>/g'; }

echo "== $(TZ=Asia/Tokyo date '+%F %T') $(hostname)"
echo "== 機械"
uptime | sed 's/^ *//'
df -h / | awk 'NR == 2 { print "ディスク " $3 " / " $2 "（" $5 "）" }'
free -h | awk '/^Mem/ { print "メモリ " $3 " / " $2 }'
echo "== ネット"
nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev 2>/dev/null | grep -vE '^(lo|p2p)' | head -5
echo "外から（Cloudflare 経由の API）：$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://api.a-ruri.com/auth/v1/health)（401 ならつながっている）"
echo "== コンテナ"
docker ps -a --format '{{.Names}}  {{.Status}}' 2>/dev/null | sort
echo "== DB"
"${PSQL[@]}" <<'SQL' 2>&1 | mask
select 'DB ' || pg_size_pretty(pg_database_size(current_database())) || '・つながり ' || (select count(*) from pg_stat_activity) || '・読むだけ ' || current_setting('default_transaction_read_only');
select 'cron ' || j.jobname || (case when j.active then '' else '（止まっている）' end) || '：最後 '
       || coalesce(to_char(max(d.end_time) at time zone 'Asia/Tokyo', 'MM-DD HH24:MI'), 'なし')
       || '・24時間の失敗 ' || count(d.*) filter (where d.status = 'failed' and d.start_time > now() - interval '24 hours')
  from cron.job j left join cron.job_run_details d on d.jobid = j.jobid group by j.jobname, j.active order by j.jobname;
select 'cronのエラー ' || j.jobname || ' ' || to_char(d.start_time at time zone 'Asia/Tokyo', 'MM-DD HH24:MI') || ' '
       || left(regexp_replace(coalesce(d.return_message, ''), '\s+', ' ', 'g'), 200)
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
 where d.status = 'failed' and d.start_time > now() - interval '24 hours' order by d.start_time desc limit 5;
select 'ログインした人（24時間） ' || count(*) || '人' from auth.users where last_sign_in_at > now() - interval '24 hours';
select '系統 ' || r.id || ' ' || r.name || '：列車 ' || count(t.*) || '・重なり ' || count(*) filter (where t.warn ~ 'とかさなります')
       || '・走れない ' || count(*) filter (where t.bad) || '・注意 ' || count(*) filter (where t.warn is not null)
  from mp_routes r join mp_trains t on t.route = r.id
 group by r.id, r.name having count(*) filter (where t.warn is not null or t.bad) > 0 order by r.id limit 40;
SQL
"${PSQL[@]}" -c "select '更新 ' || name || '（' || to_char(applied_at at time zone 'Asia/Tokyo', 'MM-DD HH24:MI') || '）' from kz_ops.migrations order by name" 2>/dev/null \
  || echo "更新 まだ一度も update.sh で入れていません"
echo "== ログイン（auth）のエラー・メール（24時間・最後の10行）"
docker logs --since 24h supabase-auth 2>&1 | grep -iE '"level":"(error|warn)|smtp|mail' | tail -n 10 | mask | cut -c1-300
echo "== Tunnel（最後の5行）"
c=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i cloudflared | head -1)
if [ -n "$c" ]; then docker logs --since 6h "$c" 2>&1 | tail -n 5 | mask | cut -c1-200; else echo "cloudflared のコンテナが見つかりません"; fi
