#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""風の芽経済組：サーバー管理のアプリ（窓・Tkinter）

はじめに1回：bash ~/kz/server/kanri_setup.sh（python3-tk を入れて、「風の芽 管理」のアイコンを置く）
ひらく    ：アイコンか、python3 ~/kz/server/kanri.py

- ひらくたびにアプリのパスワード（はじめてひらいたときに決める。~/.config/kz-kanri/pass にハッシュだけ）。15分さわらないと鍵がかかる
- サーバーの中だけで動く（ネットに何も出さない）。DB は update.sh と同じく docker exec で
- タブ：ようす・更新・バックアップ・記録（国庫・お金／人と権限／設定は つぎに）
- 更新・バックアップは、アプリをとじても止まらない（~/kz-backups/jobs/ に記録しながら動く）
- やったことは ~/kz-backups/kanri.log に（パスワード・鍵・メールアドレスは書かない）
- ためすとき：KZ_PSQL・KZ_PGDUMP・KZ_DIR・KZ_BACKUPS・KZ_KANRI_DIR で、ほかの DB・フォルダにできる（update.sh と同じ）
"""
import os, sys, re, json, time, queue, shutil, socket, hashlib, hmac, secrets, threading, subprocess, getpass, datetime, shlex, signal
import urllib.request, urllib.error
import tkinter as tk
from tkinter import ttk, messagebox, font as tkfont

APP = '風の芽 管理'
HERE = os.path.dirname(os.path.abspath(__file__))
KZ = os.environ.get('KZ_DIR') or os.path.dirname(HERE)
DBC = os.environ.get('KZ_DB', 'supabase-db')
BK = os.environ.get('KZ_BACKUPS') or os.path.expanduser('~/kz-backups')
CONF = os.environ.get('KZ_KANRI_DIR') or os.path.expanduser('~/.config/kz-kanri')
PSQL = shlex.split(os.environ.get('KZ_PSQL', '')) or ['docker', 'exec', '-i', DBC, 'psql', '-U', 'postgres', '-d', 'postgres']
PGDUMP = shlex.split(os.environ.get('KZ_PGDUMP', '')) or ['docker', 'exec', '-i', DBC, 'pg_dump', '-U', 'postgres', '-d', 'postgres']
API = 'https://api.a-ruri.com/auth/v1/health'   # Cloudflare 経由の API（401 ならつながっている）
IDLE_LOCK = 15 * 60
PASS = os.path.join(CONF, 'pass')
JOB = os.path.join(CONF, 'job.json')
JOBS = os.path.join(BK, 'jobs')
ENV = dict(os.environ, LC_ALL='C.UTF-8')
JST = datetime.timezone(datetime.timedelta(hours=9))

def now_s(): return datetime.datetime.now(JST).strftime('%Y-%m-%d %H:%M:%S')
def minute(): return datetime.datetime.now(JST).minute
def quiet_time(): m = minute(); return m >= 57 or m <= 6   # 毎時2分の国土の処理の近く（update.sh と同じ）

# 画面・記録に出す前に、メールアドレスと鍵をふせる（report.sh と同じ）
MASK = [(re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'), '<mail>'),
        (re.compile(r'(eyJ|sb_secret_|sb_publishable_|sbp_|re_)[A-Za-z0-9._-]{8,}'), '<key>')]
def mask(s):
    for r, t in MASK: s = r.sub(t, s)
    return s

def run(cmd, timeout=30, inp=None):
    """コマンドを動かす → (終わりのコード, 出力)。見つからない・時間切れは (None, ことば)"""
    try:
        p = subprocess.run(cmd, input=inp, capture_output=True, text=True, timeout=timeout, env=ENV)
        return p.returncode, (p.stdout or '') + (p.stderr or '')
    except FileNotFoundError: return None, f'{cmd[0]} が見つかりません'
    except subprocess.TimeoutExpired: return None, '時間切れ'
    except Exception as e: return None, str(e)

def sql(q, timeout=30):
    """DB に聞く（読むだけ）→ [[列, …], …]。うまくいかなければ None"""
    code, out = run(PSQL + ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', q], timeout=timeout)
    if code != 0: return None
    return [l.split('\t') for l in out.splitlines() if l != '']

def applog(action):
    try:
        os.makedirs(BK, mode=0o700, exist_ok=True)
        with open(os.path.join(BK, 'kanri.log'), 'a', encoding='utf-8') as f:
            f.write(f'{now_s()} {getpass.getuser()} {mask(action)}\n')
    except Exception: pass

# ---------- アプリのパスワード（PBKDF2・ハッシュだけをのこす） ----------
def pw_hash(pw, salt, it): return hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, it).hex()
def pw_set(pw):
    os.makedirs(CONF, mode=0o700, exist_ok=True); os.chmod(CONF, 0o700)
    salt, it = secrets.token_bytes(16), 400000
    tmp = PASS + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump({'v': 1, 'it': it, 'salt': salt.hex(), 'hash': pw_hash(pw, salt, it)}, f)
    os.replace(tmp, PASS)
def pw_ok(pw):
    try:
        with open(PASS) as f: d = json.load(f)
        return hmac.compare_digest(pw_hash(pw, bytes.fromhex(d['salt']), int(d['it'])), d['hash'])
    except Exception: return False

# ---------- 長い作業（更新・5×5・バックアップ）：アプリをとじても止まらない。出力はファイルに ----------
def job_state():
    """いま動いている作業：{title, pid, log, start} か None"""
    try:
        with open(JOB) as f: j = json.load(f)
    except Exception: return None
    try: os.kill(int(j['pid']), 0)
    except Exception: j['done'] = True
    try:
        with open(j['log'], 'rb') as f: f.seek(max(0, os.path.getsize(j['log']) - 200)); tail = f.read().decode('utf-8', 'replace')
        if '__EXIT__' in tail: j['done'] = True
    except Exception: j['done'] = True
    return j
def job_start(title, cmd):
    os.makedirs(JOBS, mode=0o700, exist_ok=True); os.makedirs(CONF, mode=0o700, exist_ok=True)
    log = os.path.join(JOBS, datetime.datetime.now(JST).strftime('%Y%m%d-%H%M%S') + '.log')
    with open(log, 'w', encoding='utf-8') as f: f.write(f'▶ {title}（{now_s()}）\n')
    # 終わりのコードもファイルに（アプリをひらきなおしても わかるように）
    sh = f'{shlex.join(cmd)}; echo "__EXIT__ $?"'
    out = open(log, 'a')
    p = subprocess.Popen(['bash', '-c', sh], stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=ENV, start_new_session=True, cwd=KZ)
    out.close()
    with open(JOB, 'w') as f: json.dump({'title': title, 'pid': p.pid, 'log': log, 'start': now_s()}, f)
    applog('はじめた：' + title)
    return p

# ---------- ようすを集める（画面とは別のスレッドで） ----------
def cpu_pct():
    def rd():
        with open('/proc/stat') as f: v = [int(x) for x in f.readline().split()[1:]]
        return sum(v), v[3] + v[4]
    try:
        t0, i0 = rd(); time.sleep(0.4); t1, i1 = rd()
        return round(100 * (1 - (i1 - i0) / max(1, t1 - t0)))
    except Exception: return None
def temp_c():
    best = None
    try:
        for z in os.listdir('/sys/class/thermal'):
            if not z.startswith('thermal_zone'): continue
            try:
                with open(f'/sys/class/thermal/{z}/temp') as f: v = int(f.read().strip()) / 1000
                best = v if best is None or v > best else best
            except Exception: pass
    except Exception: pass
    return best
def collect_status():
    r = {'at': now_s()}
    r['host'] = socket.gethostname()
    try:
        with open('/proc/uptime') as f: up = float(f.read().split()[0])
        r['up'] = f'{int(up // 86400)}日 {int(up % 86400 // 3600)}時間'
    except Exception: r['up'] = '—'
    try: r['load'] = ' / '.join(f'{x:.2f}' for x in os.getloadavg())
    except Exception: r['load'] = '—'
    c = cpu_pct(); r['cpu'] = f'{c}%' if c is not None else '—'
    try:
        mi = {}
        with open('/proc/meminfo') as f:
            for l in f: k, v = l.split(':', 1); mi[k] = int(v.split()[0])
        tot, av = mi['MemTotal'], mi['MemAvailable']
        r['mem'] = f'{(tot - av) / 1048576:.1f} / {tot / 1048576:.1f} GB（{round(100 * (tot - av) / tot)}%）'
        r['mem_pct'] = 100 * (tot - av) / tot
    except Exception: r['mem'] = '—'
    try:
        du = shutil.disk_usage('/')
        r['disk'] = f'のこり {du.free / 1e9:.0f} GB（{du.used / 1e9:.0f} / {du.total / 1e9:.0f}）'; r['disk_pct'] = 100 * du.used / du.total
    except Exception: r['disk'] = '—'
    t = temp_c(); r['temp'] = f'{t:.0f}℃' if t is not None else '—'
    # コンテナ
    code, out = run(['docker', 'ps', '-a', '--format', '{{.Names}}\t{{.Status}}'], timeout=15)
    r['ct'] = [l.split('\t', 1) for l in out.splitlines() if '\t' in l] if code == 0 else None
    r['ct_err'] = None if code == 0 else out.strip()[:200]
    # DB
    d = sql("select pg_size_pretty(pg_database_size(current_database())), (select count(*) from pg_stat_activity), current_setting('default_transaction_read_only')")
    r['db'] = d[0] if d else None
    m = sql("select count(*), coalesce(max(name), '') from kz_ops.migrations where name ~ '^[0-9]'")
    r['mig'] = m[0] if m else None
    h = sql("select to_char(v at time zone 'Asia/Tokyo', 'MM-DD HH24:MI') from mp_state where k = 'hour'")
    r['hour'] = h[0][0] if h else None
    u = sql("select count(*) from mp_unko where st <> 'done'")
    r['unko'] = u[0][0] if u else None
    r['cron'] = sql(r"""select j.jobname, j.schedule, j.active::text, coalesce(to_char(l.start_time at time zone 'Asia/Tokyo', 'MM-DD HH24:MI'), ''), coalesce(l.status, ''),
         coalesce(round(extract(epoch from (l.end_time - l.start_time))::numeric, 1)::text, ''),
         (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours')::text,
         coalesce((select left(regexp_replace(d.return_message, '\s+', ' ', 'g'), 400) from cron.job_run_details d
                    where d.jobid = j.jobid and d.status = 'failed' order by d.start_time desc limit 1), '')
    from cron.job j left join lateral (select * from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) l on true
   order by j.jobname""")
    return r
def check_api():
    """Cloudflare 経由の API（401 ならつながっている）→ (つながっているか, コード)"""
    try:
        urllib.request.urlopen(urllib.request.Request(API, headers={'User-Agent': 'kz-kanri'}), timeout=10); return (True, '200')
    except urllib.error.HTTPError as e: return (e.code in (200, 401), str(e.code))
    except Exception as e: return (False, type(e).__name__)
def collect_update():
    r = {}
    code, out = run(['git', '-C', KZ, 'log', '-1', '--format=%h %ad %s', '--date=format:%m-%d %H:%M'], timeout=10)
    r['here'] = out.strip()[:120] if code == 0 else '—（' + out.strip()[:80] + '）'
    run(['git', '-C', KZ, 'fetch', '-q', 'origin', 'main'], timeout=40)
    code, out = run(['git', '-C', KZ, 'rev-list', '--count', 'HEAD..origin/main'], timeout=10)
    r['behind'] = out.strip() if code == 0 else None
    code, out = run(['git', '-C', KZ, 'log', '-1', '--format=%h %ad %s', '--date=format:%m-%d %H:%M', 'origin/main'], timeout=10)
    r['main'] = out.strip()[:120] if code == 0 else '—'
    m = sql("select name from kz_ops.migrations order by name")
    r['done'] = [x[0] for x in m] if m is not None else None
    files = sorted(f for f in os.listdir(os.path.join(KZ, 'supabase', 'migrations')) if f.endswith('.sql')) if os.path.isdir(os.path.join(KZ, 'supabase', 'migrations')) else []
    r['pending'] = [f for f in files if r['done'] is not None and f not in r['done']]
    return r


class App:
    def __init__(self, root):
        self.root = root
        root.title(APP); root.geometry('1200x820'); root.minsize(960, 640)
        self.q = queue.Queue()
        self.locked = True; self.last = time.time(); self.proc = None; self.job = None; self.tailpos = 0
        self.style()
        self.build()
        root.withdraw()
        root.protocol('WM_DELETE_WINDOW', self.close)
        for ev in ('<Any-KeyPress>', '<Any-Button>', '<Motion>', '<MouseWheel>'): root.bind_all(ev, self.touch, add='+')
        root.after(100, self.pump); root.after(1000, self.tick); root.after(20000, self.idle_check)
        self.ask_pass()

    # ---------- 見た目 ----------
    def style(self):
        fams = set(tkfont.families())
        fam = next((f for f in ('Noto Sans CJK JP', 'Noto Sans JP', 'IPAexGothic', 'TakaoPGothic', 'VL Gothic') if f in fams), None)
        mono = next((f for f in ('Noto Sans Mono CJK JP', 'Noto Sans Mono', 'DejaVu Sans Mono') if f in fams), None)
        for n in ('TkDefaultFont', 'TkTextFont', 'TkMenuFont', 'TkHeadingFont', 'TkCaptionFont'):
            f = tkfont.nametofont(n)
            if fam: f.configure(family=fam)
            f.configure(size=11)
        fx = tkfont.nametofont('TkFixedFont')
        if mono: fx.configure(family=mono)
        fx.configure(size=10)
        self.fam = fam
        s = ttk.Style()
        try: s.theme_use('clam')
        except Exception: pass
        s.configure('H.TLabel', font=(fam, 15, 'bold')) if fam else s.configure('H.TLabel', font=('TkDefaultFont', 15, 'bold'))
        s.configure('B.TLabel', font=(fam, 11, 'bold')) if fam else None
        s.configure('OK.TLabel', foreground='#1d7a3a'); s.configure('NG.TLabel', foreground='#c0170f'); s.configure('Mu.TLabel', foreground='#6b6a64')
        s.configure('Treeview', rowheight=24); s.configure('TNotebook.Tab', padding=(14, 6))
        s.configure('Go.TButton', foreground='#ffffff', background='#1f6b4f'); s.map('Go.TButton', background=[('disabled', '#9bb8ab'), ('active', '#185a42')])
        s.configure('Big.TButton', padding=(14, 8))

    def kv(self, parent, rows):
        """「見出し：値」の表。値のラベルを返す"""
        out = {}
        for i, (k, label) in enumerate(rows):
            ttk.Label(parent, text=label, style='Mu.TLabel').grid(row=i, column=0, sticky='w', padx=(4, 10), pady=2)
            v = ttk.Label(parent, text='…'); v.grid(row=i, column=1, sticky='w', pady=2); out[k] = v
        return out

    def build(self):
        top = ttk.Frame(self.root, padding=(12, 8)); top.pack(fill='x')
        ttk.Label(top, text='⚙ ' + APP, style='H.TLabel').pack(side='left')
        self.clock = ttk.Label(top, text='', style='Mu.TLabel'); self.clock.pack(side='left', padx=14)
        ttk.Button(top, text='🔒 鍵をかける', command=self.lock).pack(side='right')
        self.jobl = ttk.Label(top, text='', style='B.TLabel'); self.jobl.pack(side='right', padx=12)
        o = self.outf = ttk.LabelFrame(self.root, text='動いているようす（更新・バックアップ）', padding=6)   # 作業のときだけ出す
        ob = ttk.Frame(o); ob.pack(side='right', fill='y', padx=(6, 0))
        ttk.Button(ob, text='コピー', command=lambda: self.copy(self.out.get('1.0', 'end'))).pack(fill='x')
        self.b_close = ttk.Button(ob, text='✕ とじる', command=self.hide_out); self.b_close.pack(fill='x', pady=(6, 0))
        self.out = tk.Text(o, height=9, wrap='char', font='TkFixedFont', state='disabled', background='#fbfaf7')
        sb = ttk.Scrollbar(o, orient='vertical', command=self.out.yview); self.out.configure(yscrollcommand=sb.set)
        self.out.pack(side='left', fill='both', expand=True); sb.pack(side='left', fill='y')
        self.out.tag_configure('ng', foreground='#c0170f'); self.out.tag_configure('ok', foreground='#1d7a3a'); self.out.tag_configure('h', font=(self.fam or 'TkDefaultFont', 11, 'bold'))
        self.nb = ttk.Notebook(self.root); self.nb.pack(fill='both', expand=True, padx=8, pady=(0, 8))
        self.tab_status(); self.tab_update(); self.tab_backup(); self.tab_log()
        for t in ('国庫・お金', '人と権限', '設定'):   # つぎに作る（Web から危ない操作を移す）
            self.nb.add(ttk.Frame(self.nb), text=t, state='disabled')

    # ---------- ようす ----------
    def tab_status(self):
        f = ttk.Frame(self.nb, padding=10); self.nb.add(f, text='ようす')
        bar = ttk.Frame(f); bar.pack(fill='x')
        ttk.Button(bar, text='↻ 新しくする', command=self.refresh_status).pack(side='left')
        ttk.Button(bar, text='📋 Claude に送るレポート', command=self.report).pack(side='left', padx=8)
        self.st_at = ttk.Label(bar, text='', style='Mu.TLabel'); self.st_at.pack(side='left', padx=8)
        up = ttk.Frame(f); up.pack(fill='x', pady=(8, 0))
        for i in range(3): up.columnconfigure(i, weight=1, uniform='u')
        a = ttk.LabelFrame(up, text='機械', padding=8); a.grid(row=0, column=0, sticky='nsew')
        self.v_mac = self.kv(a, [('host', '名前'), ('up', '動いている時間'), ('cpu', 'CPU'), ('load', 'いそがしさ'), ('mem', 'メモリ'), ('disk', 'ディスク'), ('temp', '温度')])
        b = ttk.LabelFrame(up, text='ネット・DB', padding=8); b.grid(row=0, column=1, sticky='nsew', padx=8)
        self.v_db = self.kv(b, [('api', 'API（Cloudflare 経由）'), ('db', 'DB の大きさ'), ('conn', 'DB のつながり'), ('ro', '書きこみ'), ('mig', 'DB の更新'), ('hour', '国土の時計（毎時）'), ('unko', '運行の乱れ（いま）')])
        c = ttk.LabelFrame(up, text='コンテナ（Docker）', padding=6); c.grid(row=0, column=2, sticky='nsew')
        self.ct = ttk.Treeview(c, columns=('n', 's'), show='headings', height=9)
        self.ct.heading('n', text='名前'); self.ct.heading('s', text='ようす'); self.ct.column('n', width=150, stretch=True); self.ct.column('s', width=150, stretch=True)
        self.ct.tag_configure('ok', foreground='#1d7a3a'); self.ct.tag_configure('ng', foreground='#c0170f')
        self.ct.pack(fill='both', expand=True)
        d = ttk.LabelFrame(f, text='定時の処理（pg_cron）：ダブルクリックでエラーを見る', padding=6); d.pack(fill='both', expand=True, pady=(8, 0))
        cols = [('n', '名前', 190), ('w', 'いつ', 100), ('l', '最後', 100), ('r', '結果', 80), ('s', '秒', 60), ('f', '24時間の失敗', 120), ('m', '最後のエラー', 340)]
        self.cron = ttk.Treeview(d, columns=[c[0] for c in cols], show='headings', height=8)
        for k, t, w in cols: self.cron.heading(k, text=t); self.cron.column(k, width=w, stretch=(k == 'm'))
        self.cron.tag_configure('ng', foreground='#c0170f'); self.cron.tag_configure('off', foreground='#9a9a9a')
        sb = ttk.Scrollbar(d, orient='vertical', command=self.cron.yview); self.cron.configure(yscrollcommand=sb.set)
        self.cron.pack(side='left', fill='both', expand=True); sb.pack(side='left', fill='y')
        self.cron.bind('<Double-1>', self.cron_detail)
        self.cron_msg = {}

    def refresh_status(self):
        self.st_at.config(text='読んでいます…'); self.v_db['api'].config(text='見ています…', style='TLabel')
        self.bg(collect_status, self.show_status)
        self.bg(check_api, lambda r: self.v_db['api'].config(text=('○ つながる' if r[0] else '× つながらない') + f'（{r[1]}）', style='OK.TLabel' if r[0] else 'NG.TLabel'))

    def show_status(self, r):
        self.st_at.config(text='読んだ時刻 ' + r['at'][11:])
        for k in ('host', 'up', 'cpu', 'load', 'mem', 'disk', 'temp'): self.v_mac[k].config(text=r.get(k, '—'))
        self.v_mac['mem'].config(style='NG.TLabel' if r.get('mem_pct', 0) > 90 else 'TLabel')
        self.v_mac['disk'].config(style='NG.TLabel' if r.get('disk_pct', 0) > 85 else 'TLabel')
        if r['db']:
            self.v_db['db'].config(text=r['db'][0]); self.v_db['conn'].config(text=r['db'][1] + ' こ')
            ro = r['db'][2] == 'on'; self.v_db['ro'].config(text='× 読むだけになっている' if ro else '○ できる', style='NG.TLabel' if ro else 'OK.TLabel')
        else:
            for k in ('db', 'conn', 'ro'): self.v_db[k].config(text='× DB につながりません', style='NG.TLabel')
        self.v_db['mig'].config(text=(f"{r['mig'][0]} こ（最後 {r['mig'][1].split('_')[0]}）" if r['mig'] else '—'), style='TLabel')
        self.v_db['hour'].config(text=r['hour'] or '—'); self.v_db['unko'].config(text=(r['unko'] + ' 件') if r['unko'] is not None else '—（DB の更新51 の前）')
        self.ct.delete(*self.ct.get_children())
        if r['ct'] is None: self.ct.insert('', 'end', values=('docker', '× ' + (r['ct_err'] or '見られません')), tags=('ng',))
        else:
            for n, st in sorted(r['ct']): self.ct.insert('', 'end', values=(n, st), tags=('ok' if st.startswith('Up') and 'unhealthy' not in st else 'ng',))
        self.cron.delete(*self.cron.get_children()); self.cron_msg = {}
        if r['cron'] is None: self.cron.insert('', 'end', values=('—', '', '', '', '', '', 'pg_cron の記録が読めません'))
        else:
            for n, w, act, last, st, sec, fails, msg in r['cron']:
                res = {'succeeded': '○', 'failed': '× 失敗', 'running': '動いている', '': '—'}.get(st, st)
                tag = 'off' if act != 'true' else ('ng' if st == 'failed' or fails != '0' else '')
                iid = self.cron.insert('', 'end', values=(n + ('（止めている）' if act != 'true' else ''), w, last, res, sec, fails, mask(msg)), tags=(tag,) if tag else ())
                self.cron_msg[iid] = (n, mask(msg))

    def cron_detail(self, _=None):
        sel = self.cron.selection()
        if not sel or sel[0] not in self.cron_msg: return
        n, m = self.cron_msg[sel[0]]
        self.textwin(f'定時の処理：{n}', m or '（エラーはありません）')

    def report(self):
        p = os.path.join(KZ, 'server', 'report.sh')
        self.st_at.config(text='レポートを作っています…')
        def work():
            code, out = run(['bash', p], timeout=120)
            return mask(out)
        self.bg(work, lambda out: (self.st_at.config(text=''), self.textwin('Claude に送るレポート（所持金・国庫の数・メールアドレス・鍵は出しません）', out, copy=True)))

    # ---------- 更新 ----------
    def tab_update(self):
        f = ttk.Frame(self.nb, padding=10); self.nb.add(f, text='更新')
        info = ttk.LabelFrame(f, text='GitHub とサーバー', padding=8); info.pack(fill='x')
        self.v_up = self.kv(info, [('here', 'サーバーの ~/kz'), ('main', 'GitHub の main'), ('behind', 'まだ取ってきていない'), ('pend', 'まだ入れていない DB の更新'), ('w5', '国土 5×5')])
        ttk.Button(info, text='↻ 新しくする', command=self.refresh_update).grid(row=0, column=2, sticky='e', padx=8)
        info.columnconfigure(1, weight=1)
        btn = ttk.Frame(f); btn.pack(fill='x', pady=(8, 0))
        g1 = ttk.LabelFrame(btn, text='DB の更新（update.sh）', padding=8); g1.pack(side='left', fill='x', expand=True)
        self.b_list = ttk.Button(g1, text='一覧を見る', command=lambda: self.start('DB の更新：一覧', ['bash', os.path.join(KZ, 'server', 'update.sh'), '--list']))
        self.b_check = ttk.Button(g1, text='ためす（入れない）', command=lambda: self.start('DB の更新：ためす', ['bash', os.path.join(KZ, 'server', 'update.sh'), '--check']))
        self.b_apply = ttk.Button(g1, text='▶ 入れる', style='Go.TButton', command=self.apply_update)
        for b in (self.b_list, self.b_check, self.b_apply): b.pack(side='left', padx=(0, 8))
        g2 = ttk.LabelFrame(btn, text='国土 5×5（w5.sh）', padding=8); g2.pack(side='left', fill='x', expand=True, padx=(8, 0))
        self.b_w5c = ttk.Button(g2, text='たしかめる', command=lambda: self.start('国土 5×5：たしかめる', ['bash', os.path.join(KZ, 'server', 'w5.sh'), '--check']))
        self.b_w5 = ttk.Button(g2, text='▶ 入れる', style='Go.TButton', command=self.apply_w5)
        for b in (self.b_w5c, self.b_w5): b.pack(side='left', padx=(0, 8))
        self.win = ttk.Label(f, text='', style='Mu.TLabel', wraplength=980); self.win.pack(anchor='w', pady=(8, 0))
        ttk.Label(f, text='・「入れる」を押すと、GitHub から取ってきて、バックアップを取ってから入れます（update.sh と同じ）\n・入れているあいだにアプリをとじても、止まりません（つぎにひらくと、続きのようすが見られます）',
                  style='Mu.TLabel', justify='left').pack(anchor='w', pady=(6, 0))
        self.w5_done = False

    def refresh_update(self):
        self.v_up['behind'].config(text='GitHub を見ています…')
        self.bg(collect_update, self.show_update)

    def show_update(self, r):
        self.v_up['here'].config(text=r['here']); self.v_up['main'].config(text=r['main'])
        b = r['behind']
        self.v_up['behind'].config(text='—' if b is None else ('なし（最新）' if b == '0' else f'{b} こ（「入れる」を押すと、さいしょに取ってきます）'), style='TLabel' if b in (None, '0') else 'B.TLabel')
        if r['done'] is None: self.v_up['pend'].config(text='× DB につながりません', style='NG.TLabel')
        else:
            p = r['pending']
            self.v_up['pend'].config(text=('なし' if not p else f"{len(p)} こ：" + '・'.join(x.split('_')[0] for x in p[:8]) + ('…' if len(p) > 8 else '')), style='TLabel' if not p else 'B.TLabel')
            land, build = 'w5_land' in r['done'], 'w5_build' in r['done']
            self.w5_done = land and build
            self.v_up['w5'].config(text='○ 入っています' if self.w5_done else ('土地は入っています（建物の続きがあります）' if land else 'まだ（送ったファイル2つを「ダウンロード」に置いてから）'),
                                   style='OK.TLabel' if self.w5_done else 'TLabel')
        self.buttons()

    def apply_update(self):
        if quiet_time(): messagebox.showinfo(APP, '毎時57分〜6分は、国土の処理の近くなので入れられません。7分をすぎてから押してください'); return
        if not messagebox.askyesno(APP, 'DB の更新を入れます（GitHub から取ってきて、バックアップを取ってから入れます）。よいですか？'): return
        self.start('DB の更新：入れる', ['bash', os.path.join(KZ, 'server', 'update.sh'), '--yes'])

    def apply_w5(self):
        m = minute()
        if quiet_time() or m > 54: messagebox.showinfo(APP, '毎時7分〜35分に押してください（土地が入ったあとの続きは54分まで）'); return
        if not messagebox.askyesno(APP, '国土を 5×5 に広げます（30分ぐらい。とちゅうで毎時55分になったら止まり、つぎの時間に もう一度押すと続きから）。よいですか？'): return
        self.start('国土 5×5：入れる', ['bash', os.path.join(KZ, 'server', 'w5.sh'), '--yes'])

    def buttons(self):
        busy = self.job is not None
        q = quiet_time()
        for b in (self.b_list, self.b_check, self.b_w5c): b.state(['disabled'] if busy else ['!disabled'])
        self.b_apply.state(['disabled'] if busy or q else ['!disabled'])
        self.b_w5.state(['disabled'] if busy or q or self.w5_done or minute() > 54 else ['!disabled'])
        self.b_bk.state(['disabled'] if busy else ['!disabled'])
        self.win.config(text='いまは 毎時57分〜6分（国土の処理の近く）なので、「入れる」は押せません' if q else '「入れる」は、毎時7分〜56分に押せます（国土 5×5 は 7分〜35分にはじめる）')

    # ---------- 長い作業を動かす・ようすを見る ----------
    def start(self, title, cmd):
        if self.job is not None: return
        j = job_state()
        if j and not j.get('done'): messagebox.showinfo(APP, f"いま「{j['title']}」が動いています"); return
        try: self.proc = job_start(title, cmd)
        except Exception as e: messagebox.showerror(APP, f'はじめられませんでした：{e}'); return
        self.attach(job_state())

    def attach(self, j):
        """作業のファイルを読みはじめる（アプリをひらきなおしたときも）"""
        self.job = j; self.tailpos = 0
        self.show_out(); self.out_add('\n')
        self.jobl.config(text=f"⏳ {j['title']}")
        self.b_close.state(['disabled'])
        self.buttons()

    def follow(self):
        j = self.job
        if not j: return
        try:
            with open(j['log'], encoding='utf-8', errors='replace') as f:
                f.seek(self.tailpos); s = f.read(); self.tailpos = f.tell()
        except Exception: s = ''
        if s:
            for line in s.splitlines(True):
                if line.startswith('__EXIT__'):
                    code = line.split()[1] if len(line.split()) > 1 else '?'
                    self.finish(code); return
                tag = 'ng' if line.lstrip().startswith('×') else ('ok' if line.lstrip().startswith('○') else ('h' if line.startswith('▶') or line.startswith('→') else None))
                self.out_add(mask(line), tag)
        if self.proc is not None: alive = self.proc.poll() is None
        else: j2 = job_state(); alive = bool(j2) and not j2.get('done')
        if not alive and not s:
            # ファイルの終わりに __EXIT__ がない（とちゅうで止められた）
            self.finish('?')

    def finish(self, code):
        j = self.job; self.job = None; self.proc = None
        ok = code == '0'
        self.out_add(('○ おわりました' if ok else f'× うまくいきませんでした（{code}）') + f"：{j['title']}（{now_s()[11:]}）\n", 'ok' if ok else 'ng')
        applog(('おわった：' if ok else 'うまくいかなかった：') + j['title'] + f'（{code}）')
        try: os.remove(JOB)
        except Exception: pass
        self.jobl.config(text=''); self.b_close.state(['!disabled'])
        self.buttons()
        if 'バックアップ' in j['title']: self.refresh_backup()
        else: self.refresh_update(); self.refresh_status()

    def show_out(self):
        if not self.outf.winfo_ismapped(): self.outf.pack(side='bottom', fill='x', padx=8, pady=(0, 8), before=self.nb)
    def hide_out(self):
        if self.job: return
        self.out.config(state='normal'); self.out.delete('1.0', 'end'); self.out.config(state='disabled'); self.outf.pack_forget()
    def out_add(self, s, tag=None):
        self.out.config(state='normal'); self.out.insert('end', s, tag) if tag else self.out.insert('end', s); self.out.see('end'); self.out.config(state='disabled')

    # ---------- バックアップ ----------
    def tab_backup(self):
        f = ttk.Frame(self.nb, padding=10); self.nb.add(f, text='バックアップ')
        bar = ttk.Frame(f); bar.pack(fill='x')
        self.b_bk = ttk.Button(bar, text='▶ いま取る', style='Go.TButton', command=self.backup_now); self.b_bk.pack(side='left')
        ttk.Button(bar, text='↻ 新しくする', command=self.refresh_backup).pack(side='left', padx=8)
        ttk.Button(bar, text='📂 フォルダをひらく', command=lambda: run(['xdg-open', BK], timeout=5)).pack(side='left')
        ttk.Button(bar, text='えらんだものをけす', command=self.backup_del).pack(side='right')
        ttk.Label(f, text=f'{BK}（持ち主だけ読める）。DB の更新を入れるときは、自動で取ります（新しい10こ）。もどすときは、まちがえると大変なので Claude といっしょにやります',
                  style='Mu.TLabel', wraplength=980).pack(anchor='w', pady=(6, 4))
        self.bk = ttk.Treeview(f, columns=('n', 'd', 's'), show='headings', height=16)
        for k, t, w in (('n', 'ファイル', 420), ('d', '取った時刻', 170), ('s', '大きさ', 100)): self.bk.heading(k, text=t); self.bk.column(k, width=w, stretch=(k == 'n'))
        self.bk.pack(fill='both', expand=True)

    def refresh_backup(self):
        self.bk.delete(*self.bk.get_children())
        try: L = [x for x in os.listdir(BK) if x.endswith('.dump')]
        except Exception: L = []
        L.sort(key=lambda x: os.path.getmtime(os.path.join(BK, x)), reverse=True)
        for x in L:
            p = os.path.join(BK, x)
            self.bk.insert('', 'end', iid=x, values=(x, datetime.datetime.fromtimestamp(os.path.getmtime(p), JST).strftime('%Y-%m-%d %H:%M'), f'{os.path.getsize(p) / 1e6:.0f} MB'))
        if not L: self.bk.insert('', 'end', values=('（まだありません）', '', ''))

    def backup_now(self):
        if not messagebox.askyesno(APP, 'いまの DB（public）のバックアップを取ります。よいですか？'): return
        os.makedirs(BK, mode=0o700, exist_ok=True)
        fn = os.path.join(BK, 'manual-' + datetime.datetime.now(JST).strftime('%Y%m%d-%H%M%S') + '.dump')
        # pg_dump の出力はファイルへ（持ち主だけ読める）。空なら消す
        cmd = ['bash', '-c', f'umask 077; {shlex.join(PGDUMP + ["-n", "public", "-Fc"])} > {shlex.quote(fn)} && [ -s {shlex.quote(fn)} ] && echo "○ 取りました：$(du -h {shlex.quote(fn)} | cut -f1)" || {{ rm -f {shlex.quote(fn)}; echo "× 取れませんでした"; exit 1; }}']
        self.start('バックアップ：いま取る', cmd)

    def backup_del(self):
        sel = [s for s in self.bk.selection() if s.endswith('.dump')]
        if not sel: messagebox.showinfo(APP, 'けすファイルを、えらんでください'); return
        if not messagebox.askyesno(APP, f'{len(sel)} こ のバックアップをけします（もどせません）。よいですか？'): return
        for s in sel:
            try: os.remove(os.path.join(BK, s)); applog('バックアップをけした：' + s)
            except Exception as e: messagebox.showerror(APP, f'{s}：{e}')
        self.refresh_backup()

    # ---------- 記録 ----------
    def tab_log(self):
        f = ttk.Frame(self.nb, padding=10); self.nb.add(f, text='記録')
        bar = ttk.Frame(f); bar.pack(fill='x')
        ttk.Button(bar, text='↻ 新しくする', command=self.refresh_log).pack(side='left')
        ttk.Label(bar, text='アプリでやったこと（kanri.log）と、DB の更新の記録（update.log）。新しいものが上', style='Mu.TLabel').pack(side='left', padx=10)
        pw = ttk.Panedwindow(f, orient='vertical'); pw.pack(fill='both', expand=True, pady=(6, 0))
        self.lg = {}
        for k, t in (('kanri.log', 'アプリでやったこと'), ('update.log', 'DB の更新の記録')):
            lf = ttk.LabelFrame(pw, text=t, padding=4)
            tx = tk.Text(lf, height=10, wrap='char', font='TkFixedFont', state='disabled', background='#fbfaf7')
            sb = ttk.Scrollbar(lf, orient='vertical', command=tx.yview); tx.configure(yscrollcommand=sb.set)
            tx.pack(side='left', fill='both', expand=True); sb.pack(side='left', fill='y')
            pw.add(lf, weight=1); self.lg[k] = tx

    def refresh_log(self):
        for k, tx in self.lg.items():
            try:
                with open(os.path.join(BK, k), encoding='utf-8', errors='replace') as f: L = f.read().splitlines()[-300:]
            except Exception: L = ['（まだありません）']
            tx.config(state='normal'); tx.delete('1.0', 'end'); tx.insert('end', mask('\n'.join(reversed(L)))); tx.config(state='disabled')

    # ---------- パスワード・鍵 ----------
    def ask_pass(self):
        self.locked = True
        first = not os.path.exists(PASS)
        w = tk.Toplevel(self.root); w.title(APP); w.resizable(False, False)
        w.protocol('WM_DELETE_WINDOW', self.close_now)
        fr = ttk.Frame(w, padding=20); fr.pack()
        ttk.Label(fr, text='🔒 ' + APP, style='H.TLabel').pack(anchor='w')
        msg = ('はじめに、このアプリのパスワードを決めてください（8文字以上。Ubuntu のパスワードとは、ちがうものに）' if first
               else 'アプリのパスワードを入れてください（15分さわらないと、鍵がかかります）')
        ttk.Label(fr, text=msg, wraplength=400).pack(anchor='w', pady=(8, 10))
        e1 = ttk.Entry(fr, show='•', width=34); e1.pack(anchor='w')
        e2 = None
        if first:
            ttk.Label(fr, text='もう一度', style='Mu.TLabel').pack(anchor='w', pady=(8, 2)); e2 = ttk.Entry(fr, show='•', width=34); e2.pack(anchor='w')
        err = ttk.Label(fr, text='', style='NG.TLabel', wraplength=400); err.pack(anchor='w', pady=(8, 0))
        bt = ttk.Button(fr, text='ひらく', style='Go.TButton'); bt.pack(anchor='e', pady=(10, 0))
        st = {'n': 0}
        def go(_=None):
            if 'disabled' in bt.state(): return
            p = e1.get()
            if first:
                if len(p) < 8: err.config(text='8文字以上にしてください'); return
                if p != e2.get(): err.config(text='2つが ちがいます'); return
                pw_set(p); applog('パスワードを決めた')
            elif not pw_ok(p):
                st['n'] += 1; e1.delete(0, 'end'); applog(f'パスワードがちがう（{st["n"]}回め）')
                if st['n'] >= 5: messagebox.showerror(APP, '5回 ちがったので、とじます'); self.close_now(); return
                err.config(text=f'ちがいます（{st["n"]}回め）'); bt.state(['disabled']); w.after(1500 * st['n'], lambda: bt.state(['!disabled'])); return
            w.grab_release(); w.destroy()
            self.locked = False; self.last = time.time()
            self.root.deiconify(); self.root.lift()
            applog('ひらいた')
            self.after_open()
        bt.config(command=go)
        e1.bind('<Return>', go)
        if e2: e2.bind('<Return>', go)
        w.update_idletasks(); w.geometry(f'+{max(0, (w.winfo_screenwidth() - w.winfo_width()) // 2)}+{max(0, (w.winfo_screenheight() - w.winfo_height()) // 3)}')
        e1.focus_force()
        try: w.grab_set()
        except Exception: pass
        self.pw = w

    def after_open(self):
        self.refresh_status(); self.refresh_update(); self.refresh_backup(); self.refresh_log()
        j = job_state()
        if j and self.job is None:   # とじる前の作業が、まだ動いている・おわっていた
            self.attach(j)

    def lock(self):
        if self.locked: return
        applog('鍵をかけた'); self.root.withdraw(); self.ask_pass()

    def touch(self, _=None): self.last = time.time()

    def idle_check(self):
        if not self.locked and time.time() - self.last > IDLE_LOCK:
            applog('15分さわらなかったので鍵をかけた'); self.root.withdraw(); self.ask_pass()
        self.root.after(20000, self.idle_check)

    # ---------- いろいろ ----------
    def tick(self):
        self.clock.config(text=datetime.datetime.now(JST).strftime('%m月%d日 %H:%M:%S'))
        if not self.locked and int(time.time()) % 30 == 0: self.buttons()
        if not self.locked and int(time.time()) % 60 == 0 and self.nb.index('current') == 0: self.refresh_status()
        self.root.after(1000, self.tick)

    def bg(self, fn, cb):
        """fn を別のスレッドで動かして、答えを cb に（画面のスレッドで）"""
        def work():
            try: res = fn()
            except Exception as e: res = e
            self.q.put((cb, res))
        threading.Thread(target=work, daemon=True).start()

    def pump(self):
        try:
            while True:
                cb, res = self.q.get_nowait()
                if isinstance(res, Exception): self.st_at.config(text=f'× {res}')
                else: cb(res)
        except queue.Empty: pass
        if self.job: self.follow()
        self.root.after(200, self.pump)

    def textwin(self, title, text, copy=False):
        w = tk.Toplevel(self.root); w.title(title); w.geometry('820x560')
        bar = ttk.Frame(w, padding=6); bar.pack(fill='x')
        ttk.Label(bar, text=title, style='B.TLabel').pack(side='left')
        if copy: ttk.Button(bar, text='📋 コピー', command=lambda: (self.copy(text), messagebox.showinfo(APP, 'コピーしました。Claude に貼ってください', parent=w))).pack(side='right')
        tx = tk.Text(w, wrap='char', font='TkFixedFont', background='#fbfaf7'); tx.pack(fill='both', expand=True, padx=6, pady=(0, 6))
        tx.insert('end', text); tx.config(state='disabled')

    def copy(self, s):
        self.root.clipboard_clear(); self.root.clipboard_append(s)

    def close(self):
        if self.job and not messagebox.askyesno(APP, f"「{self.job['title']}」が動いています（とじても止まりません。つぎにひらくと、続きのようすが見られます）。とじますか？"): return
        self.close_now()

    def close_now(self):
        applog('とじた'); self.root.destroy()


def main():
    if os.geteuid() == 0:
        print('root ではなく、ふだんのユーザーで動かしてください（update.sh と同じ人）'); sys.exit(1)
    root = tk.Tk()
    App(root)
    root.mainloop()

if __name__ == '__main__':
    main()
