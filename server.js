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
            const k = key.trim();
            if (typeof process.env[k] === 'undefined') {
                process.env[k] = val.join('=').trim();
            }
        }
    });
}

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не задан. Скопируйте .env.example в .env и укажите токен бота.');
    process.exit(1);
}

const DEFAULT_WEBAPP_URL = 'https://firstaid.kishoianrs.ru';
const WEBAPP_URL = (process.env.WEBAPP_URL || DEFAULT_WEBAPP_URL).trim();
const WEBAPP_FALLBACK_URL = (process.env.WEBAPP_FALLBACK_URL || '').trim();

function collectWebAppUrls() {
    const urls = [WEBAPP_URL];
    if (WEBAPP_FALLBACK_URL) urls.push(WEBAPP_FALLBACK_URL);

    const uniq = [];
    for (const raw of urls) {
        if (!raw) continue;
        try {
            const parsed = new URL(raw);
            if (parsed.protocol !== 'https:') continue;
            if (!uniq.includes(parsed.toString())) {
                uniq.push(parsed.toString());
            }
        } catch {
            // игнорируем невалидные URL
        }
    }
    return uniq;
}

const WEBAPP_URLS = collectWebAppUrls();
if (!WEBAPP_URLS.length) {
    console.error('❌ WEBAPP_URL не задан или невалиден. Укажите https URL в .env');
    process.exit(1);
}

const { Telegraf } = require('telegraf');
const bot = new Telegraf(BOT_TOKEN);

function miniAppKeyboard() {
    const rows = [
        [{ text: 'Открыть тренажёр', web_app: { url: WEBAPP_URLS[0] } }]
    ];
    if (WEBAPP_URLS[1]) {
        rows.push([{ text: 'Открыть резервный вход', web_app: { url: WEBAPP_URLS[1] } }]);
    }
    return rows;
}

function miniAppReplyText() {
    if (WEBAPP_URLS[1]) {
        return 'Добро пожаловать в тренажёр первой помощи!\n\nЕсли основная кнопка не открывается, используйте резервный вход.';
    }
    return 'Добро пожаловать в тренажёр первой помощи!\n\nНажми кнопку ниже, чтобы начать.';
}

bot.start((ctx) => {
    ctx.reply(miniAppReplyText(), {
        reply_markup: {
            inline_keyboard: miniAppKeyboard()
        }
    });
});

bot.command('app', (ctx) => {
    ctx.reply(miniAppReplyText(), {
        reply_markup: {
            inline_keyboard: miniAppKeyboard()
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

function ensureRunsColumn(columnName, columnDef) {
    const runsCols = db.prepare('PRAGMA table_info(runs)').all();
    if (!runsCols.find(c => c.name === columnName)) {
        db.exec(`ALTER TABLE runs ADD COLUMN ${columnName} ${columnDef}`);
    }
}

// Миграции старых БД
ensureRunsColumn('scenario_id', 'TEXT');

function dayKey(ts) {
    const d = new Date(ts);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function calcStreak(dayKeys) {
    if (!dayKeys.length) return 0;
    const uniqDesc = [...new Set(dayKeys)].sort().reverse();
    const today = dayKey(Date.now());
    const yesterday = dayKey(Date.now() - 24 * 60 * 60 * 1000);

    // Считаем серию только если пользователь тренировался сегодня или вчера.
    if (uniqDesc[0] !== today && uniqDesc[0] !== yesterday) return 0;

    let streak = 1;
    let prev = new Date(`${uniqDesc[0]}T00:00:00Z`);
    for (let i = 1; i < uniqDesc.length; i++) {
        const cur = new Date(`${uniqDesc[i]}T00:00:00Z`);
        const diffDays = Math.round((prev - cur) / (24 * 60 * 60 * 1000));
        if (diffDays !== 1) break;
        streak++;
        prev = cur;
    }
    return streak;
}

function runPoints(run) {
    const pct = run.total_pct;
    const perfectBonus = pct === 100 ? 30 : 0;
    const strongBonus = pct >= 80 ? 10 : pct >= 60 ? 4 : 0;
    const safetyPenalty = (run.crits || 0) * 12 + (run.timeouts || 0) * 8;
    return Math.max(0, Math.round(pct + perfectBonus + strongBonus - safetyPenalty));
}

function buildLeaderboard(rows) {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const byUser = new Map();

    for (const row of rows) {
        if (!byUser.has(row.user_id)) {
            byUser.set(row.user_id, {
                id: row.user_id,
                name: row.name,
                photo_url: row.photo_url,
                games_played: 0,
                sum_pct: 0,
                best_pct: 0,
                total_points: 0,
                total_crits: 0,
                total_timeouts: 0,
                active_days: new Set(),
                weekly_games: 0,
                weekly_sum_pct: 0,
                last_played_at: 0
            });
        }

        const u = byUser.get(row.user_id);
        u.games_played++;
        u.sum_pct += row.total_pct;
        u.best_pct = Math.max(u.best_pct, row.total_pct);
        u.total_points += runPoints(row);
        u.total_crits += row.crits || 0;
        u.total_timeouts += row.timeouts || 0;
        u.active_days.add(dayKey(row.created_at));
        u.last_played_at = Math.max(u.last_played_at, row.created_at);

        if (row.created_at >= weekAgo) {
            u.weekly_games++;
            u.weekly_sum_pct += row.total_pct;
        }
    }

    const leaderboard = [...byUser.values()].map(u => {
        const avg_pct = Math.round(u.sum_pct / u.games_played);
        const weekly_avg_pct = u.weekly_games ? Math.round(u.weekly_sum_pct / u.weekly_games) : null;
        const streak_days = calcStreak([...u.active_days]);
        const consistency = Math.max(0, 100 - (u.best_pct - avg_pct));
        const volumeBonus = Math.min(u.games_played, 40) * 0.6;
        const weeklyBonus = Math.min(u.weekly_games, 14) * 1.4;
        const safetyPenalty = u.total_crits * 1.5 + u.total_timeouts * 1.0;
        const rating = Math.max(
            0,
            Math.round(avg_pct * 0.65 + u.best_pct * 0.2 + consistency * 0.1 + volumeBonus + weeklyBonus - safetyPenalty)
        );

        return {
            id: u.id,
            name: u.name,
            photo_url: u.photo_url,
            rating,
            avg_pct,
            best_pct: u.best_pct,
            games_played: u.games_played,
            total_points: u.total_points,
            total_crits: u.total_crits,
            total_timeouts: u.total_timeouts,
            active_days: u.active_days.size,
            streak_days,
            weekly_games: u.weekly_games,
            weekly_avg_pct,
            last_played_at: u.last_played_at
        };
    });

    leaderboard.sort((a, b) =>
        b.rating - a.rating ||
        b.avg_pct - a.avg_pct ||
        b.total_points - a.total_points ||
        b.games_played - a.games_played ||
        b.last_played_at - a.last_played_at
    );

    leaderboard.forEach((u, i) => {
        u.rank = i + 1;
    });

    return leaderboard;
}

// ─── Верификация initData от Telegram ───────────────────────
function buildDataCheckString(params, opts = {}) {
    const excludeSignature = !!opts.excludeSignature;
    const entries = [];

    for (const [k, v] of params.entries()) {
        if (k === 'hash') continue;
        if (excludeSignature && k === 'signature') continue;
        entries.push([k, v]);
    }

    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.map(([k, v]) => `${k}=${v}`).join('\n');
}

function verifyInitData(initData) {
    if (!initData) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    // secret_key = HMAC-SHA256(BOT_TOKEN, "WebAppData")
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
        .update(BOT_TOKEN)
        .digest();

    const expectedWithAll = crypto.createHmac('sha256', secretKey)
        .update(buildDataCheckString(params))
        .digest('hex');

    const expectedNoSignature = crypto.createHmac('sha256', secretKey)
        .update(buildDataCheckString(params, { excludeSignature: true }))
        .digest('hex');

    if (hash !== expectedWithAll && hash !== expectedNoSignature) {
        return null;
    }

    // Парсим user из параметров
    try {
        const rawUser = params.get('user');
        if (!rawUser) return null;
        const user = JSON.parse(rawUser);
        return user;
    } catch {
        return null;
    }
}

// ─── Middleware: авторизация ─────────────────────────────────
function authMiddleware(req, res, next) {
    const initDataHeader = req.headers['x-telegram-initdata'];
    const initDataBody = req.body?.initData;
    const initDataQuery = req.query?.initData;
    const initData = initDataHeader || initDataBody || initDataQuery;
    const user = verifyInitData(initData);

    if (!user) {
        return res.status(401).json({ error: 'Авторизация не прошла', code: 'TG_AUTH_FAILED' });
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
    const safeCrits = Number.isFinite(crits) ? Math.max(0, Math.round(crits)) : 0;
    const safeTimeouts = Number.isFinite(timeouts) ? Math.max(0, Math.round(timeouts)) : 0;
    const safeScenarioId = typeof scenarioId === 'string' && scenarioId.trim() ? scenarioId.trim() : null;

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
            safeCrits,
            safeTimeouts,
            Date.now(),
            safeScenarioId
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
        LIMIT 200
    `).all(req.user.id);

    res.json({ runs });
});

// GET /api/leaderboard — общий рейтинг всех участников с тренировками
app.get('/api/leaderboard', authMiddleware, (req, res) => {
    const rows = db.prepare(`
        SELECT
            r.user_id,
            u.name,
            u.photo_url,
            r.total_pct,
            r.crits,
            r.timeouts,
            r.created_at
        FROM runs r
        JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC
    `).all();

    const leaderboard = buildLeaderboard(rows);
    const myRow = leaderboard.find(u => u.id === req.user.id) || null;
    const totals = {
        participants: leaderboard.length,
        total_runs: leaderboard.reduce((sum, u) => sum + u.games_played, 0),
        active_week: leaderboard.filter(u => u.weekly_games > 0).length
    };

    res.json({
        leaderboard,
        my_id: req.user.id,
        my_rank: myRow?.rank || null,
        totals,
        generated_at: Date.now()
    });
});

// ─── Раздача статических файлов (Mini App) ──────────────────
app.use(express.static(path.join(__dirname)));

// ─── Старт сервера ──────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`🌐 Mini App URL: ${WEBAPP_URLS[0]}`);
    if (WEBAPP_URLS[1]) {
        console.log(`🌐 Mini App резерв: ${WEBAPP_URLS[1]}`);
    }
});

bot.launch();
console.log('✅ Бот запущен');

function stopBot(signal) {
    try {
        bot.stop(signal);
    } catch (e) {
        if (!String(e?.message || '').includes('Bot is not running')) {
            console.error('Ошибка остановки бота:', e.message);
        }
    }
}

process.once('SIGINT', () => stopBot('SIGINT'));
process.once('SIGTERM', () => stopBot('SIGTERM'));
