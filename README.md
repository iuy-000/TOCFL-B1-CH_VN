# 雲端版班級網站（Google 登入＋35 份練習）

這版已把 35 份練習、翻卡與四選一小遊戲接進學生端的「練習區」。

## Render 環境變數
- FLASK_SECRET_KEY
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET

## Google OAuth 回呼網址
- 本機：`http://127.0.0.1:5000/teacher/auth/callback`
- Render：`https://你的網域/teacher/auth/callback`

## 啟動
```bash
python -m venv .venv
source .venv/bin/activate   # Windows 請改用 Scripts\activate
pip install -r requirements.txt
export FLASK_SECRET_KEY=your-secret
export GOOGLE_CLIENT_ID=your-client-id
export GOOGLE_CLIENT_SECRET=your-client-secret
python app.py
```
