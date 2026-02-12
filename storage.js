// Работа с Telegram WebApp и серверным API

const tg = window.Telegram?.WebApp;
let TG_USER = null;
const AUTH_STATE = { failed: false, code: null };

function setAuthFailed(code = null) {
    AUTH_STATE.failed = !!code;
    AUTH_STATE.code = code;
}

function getAuthState() {
    return { ...AUTH_STATE };
}

function readInitDataFromLocation() {
    const fromHash = new URLSearchParams((window.location.hash || '').replace(/^#/, '')).get('tgWebAppData');
    if (fromHash) return fromHash;
    const fromSearch = new URLSearchParams(window.location.search || '').get('tgWebAppData');
    return fromSearch || '';
}

function getInitData() {
    return tg?.initData || readInitDataFromLocation() || '';
}

function hasTelegramAuthData() {
    return !!getInitData();
}

function authUrl(url) {
    const initData = getInitData();
    if (!initData) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}initData=${encodeURIComponent(initData)}`;
}

function initTelegram() {
    if (!tg) {
        console.warn('Telegram WebApp SDK не доступен — запущено вне Telegram');
        return;
    }
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#0c1222');
    tg.setBackgroundColor('#0c1222');
    tg.setBottomBarColor('#0c1222');

    // Убираем кнопку закрытия, чтобы случайно не вылететь
    tg.enableClosingConfirmation();

    TG_USER = tg.initDataUnsafe?.user || null;

    if (getInitData()) {
        setAuthFailed(null);
    }
}

// Заголовок с initData для авторизации
function authHeaders() {
    const initData = getInitData();
    return {
        'Content-Type': 'application/json',
        'X-Telegram-InitData': initData
    };
}

// Сохранить результат одного сценария на сервер
async function saveRun(res) {
    const totalCorrect = res.ans.filter(a => a.ok).length;
    const totalSteps = res.tot;
    const totalPct = Math.round(totalCorrect / totalSteps * 100);
    const crits = res.ans.filter(a => a.cr).length;
    const timeouts = res.ans.filter(a => a.to).length;
    const scenarioId = SC[res.oi]?.id || null;
    const initData = getInitData();

    try {
        const resp = await fetch(authUrl('/api/results'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ totalPct, totalCorrect, totalSteps, crits, timeouts, scenarioId, initData })
        });
        if (resp.status === 401) {
            setAuthFailed('TG_AUTH_FAILED');
        } else if (resp.ok) {
            setAuthFailed(null);
        }
        if (!resp.ok) {
            const err = await resp.text();
            console.error('saveRun HTTP ' + resp.status + ':', err);
        }
    } catch (e) {
        console.error('Не удалось сохранить результат:', e);
    }
}

// Загрузить мои результаты с сервера
async function loadHistory() {
    try {
        const resp = await fetch(authUrl('/api/my-results'), { headers: authHeaders() });
        if (resp.status === 401) {
            setAuthFailed('TG_AUTH_FAILED');
            return [];
        }
        if (!resp.ok) return [];
        setAuthFailed(null);
        const data = await resp.json();

        return data.runs.map(r => {
            const scIdx = SC.findIndex(s => s.id === r.scenario_id);
            return {
                ts: r.created_at,
                totalPct: r.total_pct,
                scenarios: [{
                    oi: scIdx >= 0 ? scIdx : -1,
                    pct: r.total_pct,
                    crits: r.crits,
                    timeouts: r.timeouts
                }]
            };
        });
    } catch {
        return [];
    }
}

// Загрузить лидерборд
async function loadLeaderboard() {
    const empty = {
        leaderboard: [],
        my_id: null,
        my_rank: null,
        totals: { participants: 0, total_runs: 0, active_week: 0 },
        generated_at: null
    };

    try {
        const resp = await fetch(authUrl('/api/leaderboard'), { headers: authHeaders() });
        if (resp.status === 401) {
            setAuthFailed('TG_AUTH_FAILED');
            return empty;
        }
        if (!resp.ok) return empty;
        setAuthFailed(null);

        const data = await resp.json();
        return {
            ...empty,
            ...data,
            leaderboard: Array.isArray(data?.leaderboard) ? data.leaderboard : [],
            totals: { ...empty.totals, ...(data?.totals || {}) }
        };
    } catch {
        return empty;
    }
}
