// Работа с Telegram WebApp и серверным API

const tg = window.Telegram?.WebApp;
let TG_USER = null;

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
}

// Заголовок с initData для авторизации
function authHeaders() {
    const initData = tg?.initData || '';
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

    try {
        const resp = await fetch('/api/results', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ totalPct, totalCorrect, totalSteps, crits, timeouts, scenarioId })
        });
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
        const resp = await fetch('/api/my-results', { headers: authHeaders() });
        if (!resp.ok) return [];
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
    try {
        const resp = await fetch('/api/leaderboard', { headers: authHeaders() });
        if (!resp.ok) return { leaderboard: [], my_id: null };
        return await resp.json();
    } catch {
        return { leaderboard: [], my_id: null };
    }
}
