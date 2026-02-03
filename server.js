const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

// Загрузка переменных окружения из .env
const fs = require('fs');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const [key, ...val] = line.split('=');
        if (key && !key.startsWith('#') && val.length) {
            process.env[key.trim()] = val.join('=').trim();
        }
    });
}

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не задан. Скопируйте .env.example в .env и укажите токен бота.');
    process.exit(1);
}

const { Telegraf } = require('telegraf');
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
    ctx.reply('Добро пожаловать в тренажёр первой помощи!\n\nНажми кнопку ниже, чтобы начать.', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Открыть тренажёр', web_app: { url: 'https://firstaid.kishoianrs.ru' } }]
            ]
        }
    });
});

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

// ─── База данных ─────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        photo_url TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        total_pct INTEGER NOT NULL,
        total_correct INTEGER NOT NULL,
        total_steps INTEGER NOT NULL,
        crits INTEGER NOT NULL DEFAULT 0,
        timeouts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        scenario_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);
    CREATE INDEX IF NOT EXISTS idx_runs_pct ON runs(total_pct DESC);
`);

// Миграция: добавить scenario_id если его нет
const runsCols = db.prepare('PRAGMA table_info(runs)').all();
if (!runsCols.find(c => c.name === 'scenario_id')) {
    db.exec('ALTER TABLE runs ADD COLUMN scenario_id TEXT');
}

// ─── Верификация initData от Telegram ───────────────────────
function verifyInitData(initData) {
    if (!initData) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');

    // Сортируем параметры по имени и собираем строку
    const sorted = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');

    // secret_key = HMAC-SHA256(BOT_TOKEN, "WebAppData")
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
        .update(BOT_TOKEN)
        .digest();

    // Проверяем хеш
    const expectedHash = crypto.createHmac('sha256', secretKey)
        .update(sorted)
        .digest('hex');

    if (hash !== expectedHash) return null;

    // Парсим user из параметров
    try {
        const user = JSON.parse(params.get('user'));
        return user;
    } catch {
        return null;
    }
}

// ─── Middleware: авторизация ─────────────────────────────────
function authMiddleware(req, res, next) {
    const initData = req.headers['x-telegram-initdata'] || req.body?.initData;
    const user = verifyInitData(initData);

    if (!user) {
        return res.status(401).json({ error: 'Авторизация не прошла' });
    }

    // Сохраняем/обновляем пользователя в БД
    const upsert = db.prepare(`
        INSERT INTO users (id, name, photo_url)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            photo_url = excluded.photo_url
    `);
    upsert.run(user.id, user.first_name + (user.last_name ? ' ' + user.last_name : ''), user.photo_url || null);

    req.user = user;
    next();
}

// ─── API маршруты ────────────────────────────────────────────

// POST /api/results — сохранить результат игры
app.post('/api/results', authMiddleware, (req, res) => {
    const { totalPct, totalCorrect, totalSteps, crits, timeouts, scenarioId } = req.body;

    if (
        typeof totalPct !== 'number' ||
        typeof totalCorrect !== 'number' ||
        typeof totalSteps !== 'number' ||
        totalSteps <= 0 ||
        totalCorrect < 0 ||
        totalCorrect > totalSteps
    ) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    try {
        const insert = db.prepare(`
            INSERT INTO runs (user_id, total_pct, total_correct, total_steps, crits, timeouts, created_at, scenario_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insert.run(
            req.user.id,
            totalPct,
            totalCorrect,
            totalSteps,
            crits || 0,
            timeouts || 0,
            Date.now(),
            scenarioId || null
        );
        res.json({ ok: true });
    } catch (e) {
        console.error('INSERT runs failed:', e.message);
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

// GET /api/my-results — мои результаты
app.get('/api/my-results', authMiddleware, (req, res) => {
    const runs = db.prepare(`
        SELECT total_pct, total_correct, total_steps, crits, timeouts, created_at, scenario_id
        FROM runs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 50
    `).all(req.user.id);

    res.json({ runs });
});

// GET /api/leaderboard — топ-50 по лучшему результату
app.get('/api/leaderboard', authMiddleware, (req, res) => {
    const leaderboard = db.prepare(`
        SELECT
            u.id,
            u.name,
            u.photo_url,
            ROUND(AVG(r.total_pct)) AS avg_pct,
            COUNT(r.id) AS games_played
        FROM users u
        JOIN runs r ON r.user_id = u.id
        GROUP BY u.id
        ORDER BY avg_pct DESC, games_played DESC
        LIMIT 50
    `).all();

    const myAvg = db.prepare(`
        SELECT ROUND(AVG(total_pct)) AS avg_pct
        FROM runs WHERE user_id = ?
    `).get(req.user.id);

    res.json({
        leaderboard,
        my_id: req.user.id,
        my_avg: myAvg?.avg_pct || null
    });
});

// ─── Раздача статических файлов (Mini App) ──────────────────
app.use(express.static(path.join(__dirname)));

// ─── Старт сервера ──────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
});

bot.launch();
console.log('✅ Бот запущен');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
