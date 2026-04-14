
from flask import Flask, render_template, request, redirect, url_for, session, flash, send_file, jsonify
from authlib.integrations.flask_client import OAuth
import sqlite3
from pathlib import Path
from functools import wraps
from datetime import datetime
import csv, io, json, os

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "change-this-secret-key")
DB_PATH = Path(__file__).with_name("app.db")
UNITS_PATH = Path(__file__).parent / "static" / "units.json"
UNITS = json.loads(UNITS_PATH.read_text(encoding='utf-8'))

oauth = OAuth(app)
google = oauth.register(
    name="google",
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_sub TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        class_name TEXT NOT NULL,
        class_password TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL,
        student_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(class_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER UNIQUE NOT NULL,
        weekly_points INTEGER NOT NULL DEFAULT 0,
        total_points INTEGER NOT NULL DEFAULT 0,
        completed_packs INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        sign_days INTEGER NOT NULL DEFAULT 0,
        accuracy REAL NOT NULL DEFAULT 0,
        unit_familiarity_json TEXT DEFAULT '{}',
        last_checkin TEXT
    );
    """)
    conn.commit(); conn.close()

def default_units():
    return {str(i): 0 for i in range(1, 36)}

def teacher_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if session.get("teacher_id") is None:
            flash("請先用 Google 登入老師帳號。")
            return redirect(url_for("teacher_login"))
        return f(*args, **kwargs)
    return wrapper

def student_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if session.get("student_row_id") is None:
            flash("請先輸入班級密碼進入班級。")
            return redirect(url_for("student_enter"))
        return f(*args, **kwargs)
    return wrapper

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/teacher/login")
def teacher_login():
    return render_template("teacher_login_google.html")

@app.route("/teacher/login/google")
def teacher_login_google():
    redirect_uri = url_for("teacher_auth_callback", _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route("/teacher/auth/callback")
def teacher_auth_callback():
    token = google.authorize_access_token()
    user_info = token.get("userinfo") or google.userinfo()
    google_sub = user_info.get("sub")
    email = user_info.get("email")
    display_name = user_info.get("name") or email or "老師"
    if not google_sub or not email:
        flash("Google 登入失敗。")
        return redirect(url_for("teacher_login"))
    init_db()
    conn = get_db(); cur = conn.cursor()
    cur.execute("SELECT * FROM teachers WHERE google_sub = ?", (google_sub,))
    teacher = cur.fetchone()
    if teacher is None:
        cur.execute("INSERT INTO teachers (google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?)",
                    (google_sub, email, display_name, datetime.utcnow().isoformat()))
        conn.commit()
        cur.execute("SELECT * FROM teachers WHERE google_sub = ?", (google_sub,))
        teacher = cur.fetchone()
    else:
        cur.execute("UPDATE teachers SET email = ?, display_name = ? WHERE id = ?", (email, display_name, teacher["id"]))
        conn.commit(); cur.execute("SELECT * FROM teachers WHERE id = ?", (teacher["id"],)); teacher = cur.fetchone()
    conn.close()
    session.clear(); session["teacher_id"] = teacher["id"]; session["teacher_name"] = teacher["display_name"]; session["teacher_email"] = teacher["email"]
    return redirect(url_for("teacher_dashboard"))

@app.route("/teacher/logout")
def teacher_logout():
    session.clear(); return redirect(url_for("index"))

@app.route("/teacher/dashboard")
@teacher_required
def teacher_dashboard():
    teacher_id = session["teacher_id"]
    conn = get_db(); cur = conn.cursor()
    cur.execute("SELECT * FROM classes WHERE teacher_id = ? ORDER BY id DESC", (teacher_id,))
    classes = cur.fetchall(); class_data=[]
    for c in classes:
        cur.execute("""
            SELECT s.student_name, s.student_id, p.weekly_points, p.total_points, p.completed_packs,
                   p.current_streak, p.best_streak, p.sign_days, p.accuracy
            FROM students s LEFT JOIN progress p ON p.student_id = s.id
            WHERE s.class_id = ?
            ORDER BY COALESCE(p.total_points, 0) DESC, COALESCE(p.weekly_points, 0) DESC, s.student_id ASC
        """, (c["id"],))
        class_data.append({"class": c, "students": cur.fetchall()})
    conn.close(); return render_template("teacher_dashboard.html", class_data=class_data)

@app.route("/teacher/classes/create", methods=["POST"])
@teacher_required
def create_class():
    teacher_id = session["teacher_id"]
    class_name = request.form.get("class_name", "").strip(); class_password = request.form.get("class_password", "").strip()
    if not class_name or not class_password:
        flash("請輸入班級名稱與進入密碼。"); return redirect(url_for("teacher_dashboard"))
    conn=get_db(); cur=conn.cursor()
    cur.execute("INSERT INTO classes (teacher_id, class_name, class_password, created_at) VALUES (?, ?, ?, ?)",
                (teacher_id, class_name, class_password, datetime.utcnow().isoformat()))
    conn.commit(); conn.close(); flash("班級建立完成。"); return redirect(url_for("teacher_dashboard"))

@app.route("/teacher/classes/<int:class_id>/update", methods=["POST"])
@teacher_required
def update_class(class_id):
    teacher_id = session["teacher_id"]
    class_name = request.form.get("class_name", "").strip(); class_password = request.form.get("class_password", "").strip()
    conn=get_db(); cur=conn.cursor(); cur.execute("SELECT * FROM classes WHERE id=? AND teacher_id=?", (class_id, teacher_id)); c=cur.fetchone()
    if not c: conn.close(); flash("找不到這個班級。"); return redirect(url_for("teacher_dashboard"))
    if class_name and class_password:
        cur.execute("UPDATE classes SET class_name=?, class_password=? WHERE id=?", (class_name, class_password, class_id)); conn.commit(); flash("班級設定已更新。")
    else:
        flash("請完整輸入班級名稱與進入密碼。")
    conn.close(); return redirect(url_for("teacher_dashboard"))

@app.route("/teacher/export/<int:class_id>")
@teacher_required
def export_class_csv(class_id):
    teacher_id=session["teacher_id"]; conn=get_db(); cur=conn.cursor(); cur.execute("SELECT * FROM classes WHERE id=? AND teacher_id=?", (class_id, teacher_id)); c=cur.fetchone()
    if not c: conn.close(); flash("找不到這個班級。"); return redirect(url_for("teacher_dashboard"))
    cur.execute("""
        SELECT s.student_id, s.student_name, p.weekly_points, p.total_points, p.completed_packs,
               p.current_streak, p.best_streak, p.sign_days, p.accuracy
        FROM students s LEFT JOIN progress p ON p.student_id = s.id
        WHERE s.class_id = ? ORDER BY COALESCE(p.total_points, 0) DESC, s.student_id ASC
    """, (class_id,))
    rows = cur.fetchall(); conn.close()
    output=io.StringIO(); writer=csv.writer(output)
    writer.writerow(["學號","姓名","本週積分","總積分","完成練習數","目前連續簽到","最佳連續簽到","完成簽到天數","正確率"])
    for r in rows:
        writer.writerow([r["student_id"],r["student_name"],r["weekly_points"] or 0,r["total_points"] or 0,r["completed_packs"] or 0,r["current_streak"] or 0,r["best_streak"] or 0,r["sign_days"] or 0,r["accuracy"] or 0])
    mem=io.BytesIO(output.getvalue().encode("utf-8-sig"))
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name=f"class_{class_id}_report.csv")

@app.route("/student/enter", methods=["GET","POST"])
def student_enter():
    if request.method == "POST":
        class_password=request.form.get("class_password","").strip(); student_id=request.form.get("student_id","").strip(); student_name=request.form.get("student_name","").strip()
        if not class_password or not student_id:
            flash("請輸入班級密碼與學號。"); return redirect(url_for("student_enter"))
        conn=get_db(); cur=conn.cursor(); cur.execute("SELECT * FROM classes WHERE class_password=?", (class_password,)); class_row=cur.fetchone()
        if not class_row: conn.close(); flash("班級密碼錯誤。"); return redirect(url_for("student_enter"))
        cur.execute("SELECT * FROM students WHERE class_id=? AND student_id=?", (class_row["id"], student_id)); student=cur.fetchone()
        if student is None:
            if not student_name: conn.close(); flash("第一次進入請輸入姓名。"); return redirect(url_for("student_enter"))
            cur.execute("INSERT INTO students (class_id, student_id, student_name, created_at) VALUES (?, ?, ?, ?)",
                        (class_row["id"], student_id, student_name, datetime.utcnow().isoformat()))
            student_row_id=cur.lastrowid; cur.execute("INSERT INTO progress (student_id, unit_familiarity_json) VALUES (?, ?)", (student_row_id, json.dumps(default_units(), ensure_ascii=False)))
        else:
            student_row_id=student["id"]
            if student_name: cur.execute("UPDATE students SET student_name=? WHERE id=?", (student_name, student_row_id))
        conn.commit(); cur.execute("SELECT s.id, s.student_id, s.student_name, c.id as class_id, c.class_name FROM students s JOIN classes c ON s.class_id=c.id WHERE s.id=?", (student_row_id,)); full=cur.fetchone(); conn.close()
        session.clear(); session["student_row_id"]=full["id"]; session["student_id_text"]=full["student_id"]; session["student_name"]=full["student_name"]; session["class_id"]=full["class_id"]; session["class_name"]=full["class_name"]
        return redirect(url_for("student_dashboard"))
    return render_template("student_enter.html")

@app.route("/student/logout")
def student_logout():
    session.clear(); return redirect(url_for("index"))

@app.route("/student/dashboard")
@student_required
def student_dashboard():
    class_id=session["class_id"]; student_row_id=session["student_row_id"]
    conn=get_db(); cur=conn.cursor()
    cur.execute("""
        SELECT s.student_name, s.student_id, p.weekly_points, p.total_points, p.completed_packs,
               p.current_streak, p.best_streak, p.sign_days, p.accuracy, p.unit_familiarity_json
        FROM students s LEFT JOIN progress p ON p.student_id=s.id WHERE s.id=?
    """, (student_row_id,))
    me=cur.fetchone(); unit_familiarity=json.loads(me["unit_familiarity_json"] or "{}")
    cur.execute("""
        SELECT s.student_name, s.student_id, p.weekly_points, p.total_points, p.completed_packs,
               p.current_streak, p.best_streak, p.sign_days, p.accuracy
        FROM students s LEFT JOIN progress p ON p.student_id=s.id
        WHERE s.class_id=? ORDER BY COALESCE(p.total_points,0) DESC, COALESCE(p.weekly_points,0) DESC, s.student_id ASC
    """, (class_id,))
    leaderboard=cur.fetchall(); conn.close()
    return render_template("student_dashboard_practice.html", me=me, leaderboard=leaderboard, unit_familiarity=unit_familiarity, units_count=len(UNITS))

@app.route('/api/units')
@student_required
def api_units():
    return jsonify(UNITS)

@app.route('/student/record-practice', methods=['POST'])
@student_required
def record_practice():
    data=request.get_json(silent=True) or {}
    student_row_id=session['student_row_id']
    unit_no=str(data.get('unit_no','')).strip()
    score=float(data.get('score',0) or 0)
    points=int(data.get('points', max(1, round(score/20))))
    familiarity_gain=int(data.get('familiarity_gain', round(score*0.3)))
    accuracy=round(score,1)
    conn=get_db(); cur=conn.cursor(); cur.execute('SELECT * FROM progress WHERE student_id=?', (student_row_id,)); p=cur.fetchone()
    weekly_points=(p['weekly_points'] or 0)+points
    total_points=(p['total_points'] or 0)+points
    completed_packs=(p['completed_packs'] or 0)+1
    old_acc=p['accuracy'] or 0
    new_acc=round((old_acc+accuracy)/2 if old_acc else accuracy,1)
    unit_data=json.loads(p['unit_familiarity_json'] or '{}')
    if unit_no and unit_no in unit_data:
        unit_data[unit_no]=max(0,min(100,int(unit_data[unit_no])+familiarity_gain))
    cur.execute('UPDATE progress SET weekly_points=?, total_points=?, completed_packs=?, accuracy=?, unit_familiarity_json=? WHERE student_id=?',
                (weekly_points,total_points,completed_packs,new_acc,json.dumps(unit_data, ensure_ascii=False),student_row_id))
    conn.commit(); conn.close()
    return jsonify({'ok':True,'weekly_points':weekly_points,'completed_packs':completed_packs,'accuracy':new_acc,'unit_familiarity':unit_data.get(unit_no,0)})

@app.route('/student/checkin', methods=['POST'])
@student_required
def student_checkin():
    student_row_id=session['student_row_id']; conn=get_db(); cur=conn.cursor(); cur.execute('SELECT * FROM progress WHERE student_id=?', (student_row_id,)); p=cur.fetchone()
    today=datetime.utcnow().date(); last=None
    if p['last_checkin']:
        try: last=datetime.fromisoformat(p['last_checkin']).date()
        except: last=None
    current_streak=p['current_streak'] or 0; best_streak=p['best_streak'] or 0; sign_days=p['sign_days'] or 0; weekly_points=p['weekly_points'] or 0; total_points=p['total_points'] or 0
    if last == today: conn.close(); flash('今天已經簽到過了。'); return redirect(url_for('student_dashboard'))
    current_streak = current_streak+1 if last and (today-last).days==1 else 1
    best_streak=max(best_streak,current_streak); sign_days += 1; weekly_points += 1; total_points += 1
    cur.execute('UPDATE progress SET current_streak=?, best_streak=?, sign_days=?, weekly_points=?, total_points=?, last_checkin=? WHERE student_id=?',
                (current_streak,best_streak,sign_days,weekly_points,total_points,datetime.utcnow().isoformat(),student_row_id))
    conn.commit(); conn.close(); flash('簽到完成。'); return redirect(url_for('student_dashboard'))

if __name__ == '__main__':
    init_db(); app.run(debug=True)
