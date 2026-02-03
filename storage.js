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

// Сохранить результат игры на сервер
async function saveRun(res) {
    const totalCorrect = res.reduce((s, r) => s + r.ans.filter(a => a.ok).length, 0);
    const totalSteps = res.reduce((s, r) => s + r.tot, 0);
    const totalPct = Math.round(totalCorrect / totalSteps * 100);
    const crits = res.reduce((s, r) => s + r.ans.filter(a => a.cr).length, 0);
    const timeouts = res.reduce((s, r) => s + r.ans.filter(a => a.to).length, 0);

    try {
        const resp = await fetch('/api/results', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ totalPct, totalCorrect, totalSteps, crits, timeouts })
        });

        if (resp.ok) {
            // Показать уведомление в Telegram
            if (tg?.showAlert) {
                const g = gr(totalPct);
                tg.showAlert(`${g.e} Результат сохранён!\n${totalPct}% точность`);
            }
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

        // Преобразуем в формат, аналогичный старому localStorage
        return data.runs.map(r => ({
            ts: r.created_at,
            totalPct: r.total_pct,
            scenarios: [{
                pct: r.total_pct,
                crits: r.crits,
                timeouts: r.timeouts
            }]
        }));
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
