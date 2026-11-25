const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const db = new sqlite3.Database('./database.db');
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, balance REAL DEFAULT 0, last_watch TEXT DEFAULT '', last_bonus TEXT DEFAULT '', referrer TEXT, videos_watched INTEGER DEFAULT 0)");
    db.run("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount REAL, date TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, amount REAL, method TEXT, details TEXT, status TEXT DEFAULT 'pending', date TEXT)");
});

app.post('/api/register', (req, res) => {
    const { username, password, referrer } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Remplis tous les champs." });
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (row) return res.status(400).json({ error: "Ce nom est déjà pris." });
        db.run("INSERT INTO users (username, password, balance, referrer) VALUES (?, ?, 5, ?)", [username, password, referrer || null], function(err) {
            if (err) return res.status(500).json({ error: "Erreur serveur." });
            if (referrer) { db.run("UPDATE users SET balance = balance + 1 WHERE username = ?", [referrer]); }
            res.json({ success: true, message: "Compte créé avec 5$ de bienvenue !" });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, user) => {
        if (!user) return res.status(400).json({ error: "Nom ou mot de passe incorrect." });
        res.json({ success: true, username: user.username });
    });
});

app.get('/api/videos', (req, res) => {
    try {
        const data = fs.readFileSync('videos.json', 'utf8');
        res.json(JSON.parse(data));
    } catch (e) { res.json([]); }
});

app.get('/api/profile/:username', (req, res) => {
    const username = req.params.username;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err || !user) return res.status(404).json({ error: "Utilisateur non trouvé" });
        const today = new Date().toISOString().split('T')[0]; 
        db.all("SELECT * FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 15", [user.id], (err, history) => {
            db.get("SELECT COUNT(*) as count FROM users WHERE referrer = ?", [username], (err, team) => {
                res.json({ user, history, today, teamCount: team.count });
            });
        });
    });
});

app.post('/api/earn', (req, res) => {
    const { amount, username } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err || !user) return res.status(400).json({ error: "Utilisateur non trouvé." });
        
        const today = new Date().toISOString().split('T')[0];
        if (user.last_watch === today) return res.status(400).json({ error: "Déjà regardé aujourd'hui !" });

        let multiplier = 1;
        if (user.videos_watched >= 5 && user.videos_watched < 10) multiplier = 1.2;
        if (user.videos_watched >= 10) multiplier = 1.5;
        
        const finalReward = amount * multiplier;
        const newBalance = user.balance + finalReward;
        const newWatchCount = user.videos_watched + 1;
        
        db.run("UPDATE users SET balance = ?, videos_watched = ?, last_watch = ? WHERE id = ?", [newBalance, newWatchCount, today, user.id]);
        
        const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).toUpperCase();
        db.run("INSERT INTO history (user_id, type, amount, date) VALUES (?, 'gain', ?, ?)", [user.id, finalReward, dateStr]);
        
        if (user.referrer) { db.run("UPDATE users SET balance = balance + 1 WHERE username = ?", [user.referrer]); }
        
        res.json({ success: true, newBalance: newBalance, newWatchCount: newWatchCount });
    });
});

app.post('/api/withdraw', (req, res) => {
    const { amount, method, username, details } = req.body;
    if (amount < 10) return res.status(400).json({ error: "Minimum 10$." });
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        const currentBalance = Math.round(user.balance * 100) / 100;
        const requestedAmount = Math.round(amount * 100) / 100;
        if (currentBalance < requestedAmount) return res.status(400).json({ error: "Solde insuffisant." });
        const newBalance = currentBalance - requestedAmount;
        db.run("UPDATE users SET balance = ? WHERE id = ?", [newBalance, user.id]);
        const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).toUpperCase();
        db.run("INSERT INTO history (user_id, type, amount, date) VALUES (?, 'retrait', ?, ?)", [user.id, -requestedAmount, dateStr]);
        db.run("INSERT INTO withdrawals (user_id, username, amount, method, details, date) VALUES (?, ?, ?, ?, ?, ?)", [user.id, username, requestedAmount, method, details, dateStr]);
        res.json({ success: true, newBalance: newBalance, message: "Demande de retrait envoyée !" });
    });
});

app.get('/api/admin/withdrawals', (req, res) => {
    db.all("SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY id DESC", (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/admin/pay', (req, res) => {
    const { id } = req.body;
    db.run("UPDATE withdrawals SET status = 'paid' WHERE id = ?", [id], (err) => {
        res.json({ success: true });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log("✅ Serveur lancé sur le port " + PORT); });
