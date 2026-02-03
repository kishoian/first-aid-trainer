// Логика тренажёра первой помощи

// Вспомогательные функции
function gr(p) {
    if (p === 100) return { l: "Безупречно", e: "🏆", c: "#2ec4b6" };
    if (p >= 80) return { l: "Отлично", e: "✅", c: "#2ec4b6" };
    if (p >= 60) return { l: "Неплохо", e: "📘", c: "#f77f00" };
    if (p >= 40) return { l: "Нужно повторить", e: "⚠️", c: "#f77f00" };
    return { l: "Опасный уровень", e: "🚨", c: "#e63946" };
}

function fmt(s) {
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function shuf(a) {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
}

// Константы и состояние
const DT = 20; // Decision Timer (секунды на ответ)

let S = {
    sc: 'intro',      // текущий экран
    ord: [],          // порядок сценариев
    pos: 0,           // текущая позиция в сценариях
    si: 0,            // текущий шаг в сценарии
    sel: null,        // выбранный ответ
    fb: false,        // показан ли фидбек
    to: false,        // был ли таймаут
    cp: [],           // перемешанные варианты ответов
    ans: [],          // ответы на текущий сценарий
    el: 0,            // прошедшее время
    dt: DT,           // оставшееся время на решение
    t1: null,         // интервал общего таймера
    t2: null,         // интервал таймера решения
    res: []           // результаты всех сценариев
};

// Функции работы со сценариями
function csc() { return SC[S.ord[S.pos]]; }
function cst() { return csc().steps[S.si]; }

// Таймеры
function startT() {
    stopT();
    S.dt = DT;
    S.t1 = setInterval(() => {
        S.el++;
        const e = document.getElementById('tmr');
        if (e) e.textContent = '⏱ ' + fmt(S.el);
    }, 1000);
    S.t2 = setInterval(() => {
        S.dt = Math.max(0, S.dt - 0.1);
        uDT();
        if (S.dt <= 0) {
            stopT();
            onTO();
        }
    }, 100);
}

function stopT() {
    if (S.t1) { clearInterval(S.t1); S.t1 = null; }
    if (S.t2) { clearInterval(S.t2); S.t2 = null; }
}

function uDT() {
    const b = document.getElementById('dtb');
    const n = document.getElementById('dtn');
    if (!b || !n) return;
    const p = S.dt / DT * 100;
    b.style.width = p + '%';
    n.textContent = Math.ceil(S.dt) + 'с';
    if (p > 50) {
        b.style.background = '#2ec4b6';
        n.style.color = '#6b7280';
    } else if (p > 25) {
        b.style.background = '#f77f00';
        n.style.color = '#f77f00';
    } else {
        b.style.background = '#e63946';
        n.style.color = '#e63946';
    }
}

function onTO() {
    S.to = true;
    S.fb = true;
    S.ans.push({ si: S.si, ci: -1, ok: false, cr: false, to: true });
    R();
}

// Управление игрой
function begin() {
    S.sc = 'playing';
    S.ord = shuf([...Array(SC.length).keys()]);
    S.pos = 0;
    S.si = 0;
    S.sel = null;
    S.fb = false;
    S.to = false;
    S.ans = [];
    S.el = 0;
    S.res = [];
    S.cp = shuf([0, 1, 2]);
    R();
    startT();
}

function hc(pi) {
    if (S.fb) return;
    const oi = S.cp[pi];
    const ch = cst().ch[oi];
    S.sel = pi;
    S.fb = true;
    S.to = false;
    S.ans.push({ si: S.si, ci: oi, pi: pi, ok: !!ch.ok, cr: !!ch.cr, to: false });
    stopT();
    R();
}

function ns() {
    const sc = csc();
    if (S.si < sc.steps.length - 1) {
        S.si++;
        S.sel = null;
        S.fb = false;
        S.to = false;
        S.cp = shuf([0, 1, 2]);
        R();
        startT();
    } else {
        S.res.push({
            ans: [...S.ans],
            el: S.el,
            tot: sc.steps.length,
            oi: S.ord[S.pos]
        });
        S.sc = 'sc_result';
        stopT();
        R();
    }
}

function nsc() {
    if (S.pos < S.ord.length - 1) {
        S.pos++;
        S.si = 0;
        S.sel = null;
        S.fb = false;
        S.to = false;
        S.ans = [];
        S.el = 0;
        S.cp = shuf([0, 1, 2]);
        S.sc = 'playing';
        R();
        startT();
    } else {
        saveRun(S.res);
        S.sc = 'final';
        R();
    }
}

function rst() {
    stopT();
    S.sc = 'intro';
    R();
}

function showStats() {
    S.sc = 'stats';
    R();
}

function showLeaderboard() {
    S.sc = 'leaderboard';
    R();
}

// Рендеринг
function R() {
    const a = document.getElementById('app');
    if (S.sc === 'intro') renderIntro();
    else if (S.sc === 'playing') a.innerHTML = rP();
    else if (S.sc === 'sc_result') a.innerHTML = rSR();
    else if (S.sc === 'final') renderFinal();
    else if (S.sc === 'stats') renderStats();
    else if (S.sc === 'leaderboard') renderLeaderboard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Async-обёртки для экранов с данными с сервера
async function renderIntro() {
    const a = document.getElementById('app');
    a.innerHTML = '<div style="text-align:center;padding:60px 0"><div style="font-size:36px">⏳</div></div>';
    const history = await loadHistory();
    a.innerHTML = rI(history);
}

async function renderFinal() {
    saveRun(S.res);
    document.getElementById('app').innerHTML = rF();
}

async function renderStats() {
    const a = document.getElementById('app');
    a.innerHTML = '<div style="text-align:center;padding:60px 0"><div style="font-size:36px">⏳</div></div>';
    const history = await loadHistory();
    a.innerHTML = rStats(history);
}

async function renderLeaderboard() {
    const a = document.getElementById('app');
    a.innerHTML = '<div style="text-align:center;padding:60px 0"><div style="font-size:36px">⏳</div></div>';
    const data = await loadLeaderboard();
    a.innerHTML = rLeaderboard(data);
}

function rI(history) {
    let teaser = '';
    if (history.length > 0) {
        const best = Math.max(...history.map(r => r.totalPct));
        const n = history.length;
        const gw = n === 1 ? 'игра' : n < 5 ? 'игры' : 'игр';
        teaser = `
            <div class="intro-teaser">
                <span>Лучший: <b style="color:${gr(best).c}">${best}%</b> · ${n} ${gw}</span>
                <button class="stats-btn" onclick="showStats()">📊 Статистика</button>
            </div>
        `;
    }

    // Профиль пользователя из Telegram
    let profile = '';
    if (TG_USER) {
        profile = `
            <div class="tg-profile">
                ${TG_USER.photo_url ? `<img src="${TG_USER.photo_url}" class="tg-avatar" alt="">` : '<div class="tg-avatar-placeholder">👤</div>'}
                <span class="tg-name">${TG_USER.first_name || ''}</span>
            </div>
        `;
    }

    return `
        <div class="intro">
            ${profile}
            <div class="intro-icon-wrap">
                <div class="intro-icon">🩺</div>
                <div class="intro-ring"></div>
            </div>
            <h1>Тренажёр<br><span>первой помощи</span></h1>
            <p class="sub">12 экстренных ситуаций в случайном порядке. Вы не знаете заранее, что вас ждёт. 20 секунд на решение — как в жизни. Будет сложно.</p>
            <button class="btn-primary" onclick="begin()">Начать</button>
            <p class="meta">12 ситуаций · ~15 мин · варианты перемешаны</p>
            ${teaser}
            <button class="stats-btn leaderboard-btn" onclick="showLeaderboard()">🏆 Лидерборд</button>
        </div>
    `;
}

function rP() {
    const sc = csc();
    const st = cst();
    const cn = S.ans.filter(a => a.ok).length;
    const tn = SC.length;

    // Глобальный прогресс
    let gp = '';
    for (let i = 0; i < tn; i++) {
        const sl = SC[S.ord[i]] ? SC[S.ord[i]].steps.length : 4;
        const p = i < S.pos ? 100 : i === S.pos ? Math.round(S.si / sl * 100) : 0;
        const c = i < S.pos ? '#2ec4b6' : i === S.pos ? sc.color : 'transparent';
        gp += `<div class="gp-seg"><div class="gp-fill" style="width:${p}%;background:${c}"></div></div>`;
    }

    // Локация (только на первом шаге)
    const sl = S.si === 0 && !S.fb ? `<div class="scene-location" style="color:${sc.color}">📍 ${sc.loc}</div>` : '';

    // Варианты ответов
    const lt = 'ABCDE';
    let ch = '';
    S.cp.forEach((oi, pi) => {
        const c = st.ch[oi];
        let cls = 'ch', lc = 'ch-l', lx = lt[pi];

        if (S.fb) {
            cls += ' dis';
            if (S.to) {
                if (c.ok) { cls += ' was-ok'; lc += ' g'; lx = '✓'; }
                else cls += ' dim';
            } else {
                if (pi === S.sel && c.ok) { cls += ' ok'; lc += ' g'; lx = '✓'; }
                else if (pi === S.sel && !c.ok) { cls += ' bad'; lc += ' r'; lx = '✗'; }
                else if (c.ok) { cls += ' was-ok'; lc += ' g'; lx = '✓'; }
                else cls += ' dim';
            }
        }

        const dl = S.fb ? '' : `animation:slide-up .4s ease ${0.05 + pi * 0.07}s both;`;
        ch += `<button class="${cls}" onclick="hc(${pi})" style="${dl}"><div class="${lc}">${lx}</div><span>${c.t}</span></button>`;
    });

    // Фидбек
    let fb = '';
    if (S.fb) {
        if (S.to) {
            const r = st.ch.find(c => c.ok);
            fb = `
                <div class="fb fb-timeout">
                    <div class="timeout-label">⏱ Время вышло</div>
                    <div class="fb-text">В реальности промедление стоит жизни.</div>
                    <div class="fb-right"><b>Правильный ответ:</b> ${r.fb}</div>
                </div>
            `;
        } else {
            const oi = S.cp[S.sel];
            const c = st.ch[oi];
            const cls = c.ok ? 'fb-ok' : c.cr ? 'fb-crit' : 'fb-wrong';
            const cl = c.cr ? '<div class="crit-label">⚠ Критическая ошибка</div>' : '';
            let ra = '';
            if (!c.ok) {
                const r = st.ch.find(x => x.ok);
                ra = `<div class="fb-right"><b>Правильный ответ:</b> ${r.fb}</div>`;
            }
            fb = `<div class="fb ${cls}">${cl}<div class="fb-text">${c.fb}</div>${ra}</div>`;
        }
    }

    // Кнопка "Далее"
    const il = S.si === sc.steps.length - 1;
    const nl = il ? 'Результаты →' : 'Далее →';
    const nc = il ? 'pri' : 'sec';
    const nb = S.fb ? `<button class="next-btn ${nc}" onclick="ns()">${nl}</button>` : '';

    // Таймер решения
    const dtH = S.fb ? '' : `
        <div class="dtimer-num" id="dtn">${Math.ceil(S.dt)}с</div>
        <div class="dtimer-wrap"><div class="dtimer-bar" id="dtb" style="width:${S.dt / DT * 100}%;background:#2ec4b6"></div></div>
    `;

    return `
        <div style="animation:fade-in .4s ease;padding-top:16px">
            <div class="hdr">
                <div class="hdr-left">
                    <div class="live-dot"></div>
                    <div class="hdr-num">Ситуация ${S.pos + 1}/${tn}</div>
                </div>
                <div class="hdr-right">
                    <div class="badge badge-time" id="tmr">⏱ ${fmt(S.el)}</div>
                    <div class="badge badge-score">${cn}/${S.ans.length}</div>
                </div>
            </div>
            <div class="global-progress">${gp}</div>
            <div class="step-label">Шаг ${S.si + 1} из ${sc.steps.length}</div>
            ${dtH}
            <div class="scene-card">
                ${sl}
                <p class="scene-text">${st.n}</p>
                <p class="scene-q">${st.q}</p>
            </div>
            <div class="choices">${ch}</div>
            ${fb}
            ${nb}
        </div>
    `;
}

function rSR() {
    const r = S.res[S.res.length - 1];
    const sc = SC[r.oi];
    const c = r.ans.filter(a => a.ok).length;
    const p = Math.round(c / r.tot * 100);
    const cr = r.ans.filter(a => a.cr).length;
    const to = r.ans.filter(a => a.to).length;
    const g = gr(p);

    const ft2 = sc.fl ? '<div class="false-tag">⚡ Ситуация-ловушка</div>' : '';

    // Разбор ответов
    let rv = '';
    r.ans.forEach((a, i) => {
        const s = sc.steps[a.si];
        let mc, mt;
        if (a.to) { mc = 't'; mt = '⏱'; }
        else if (a.ok) { mc = 'g'; mt = '✓'; }
        else if (a.cr) { mc = 'r'; mt = '✗'; }
        else { mc = 'w'; mt = '✗'; }

        const ct = a.to ? '<i>Время вышло</i>' : s.ch[a.ci].t;
        const co = a.ok ? '' : `<div class="rev-ans">→ ${s.ch.find(x => x.ok).t}</div>`;
        rv += `
            <div class="rev-item">
                <div class="rev-mark ${mc}">${mt}</div>
                <div>
                    <div class="rev-text">${ct}</div>
                    ${co}
                </div>
            </div>
        `;
    });

    const il = S.pos >= S.ord.length - 1;
    const bl = il ? 'Общие итоги' : 'Следующая ситуация →';

    return `
        <div class="sc-result">
            <div class="sc-result-hdr">
                <div class="emoji">${g.e}</div>
                <h2 style="color:${g.c}">${g.l}</h2>
                <p>${sc.icon} ${sc.title} · ${fmt(r.el)}</p>
                ${ft2}
            </div>
            <div class="stats-row">
                <div class="stat-card">
                    <div class="v" style="color:#2ec4b6">${c}/${r.tot}</div>
                    <div class="l">Верных</div>
                </div>
                <div class="stat-card">
                    <div class="v" style="color:${g.c}">${p}%</div>
                    <div class="l">Точность</div>
                </div>
                <div class="stat-card">
                    <div class="v" style="color:${(cr + to) > 0 ? '#e63946' : '#2ec4b6'}">${cr}/${to}</div>
                    <div class="l">Крит/Таймаут</div>
                </div>
            </div>
            <div class="review-title">Разбор</div>
            ${rv}
            <div class="sum-box">
                <div class="sum-label" style="color:${sc.color}">📋 Запомните</div>
                <p class="sum-text">${sc.sum}</p>
            </div>
            <button class="next-btn pri" onclick="nsc()">${bl}</button>
        </div>
    `;
}

function rF() {
    let tc = 0, tq = 0, tcr = 0, tto = 0, tt = 0, sr = '';

    S.res.forEach(r => {
        const sc = SC[r.oi];
        const c = r.ans.filter(a => a.ok).length;
        const p = Math.round(c / r.tot * 100);
        const g = gr(p);

        tc += c;
        tq += r.tot;
        tt += r.el;
        tcr += r.ans.filter(a => a.cr).length;
        tto += r.ans.filter(a => a.to).length;

        const fl = sc.fl ? ' <span style="font-size:10px;color:#818cf8">ловушка</span>' : '';
        sr += `
            <div class="sc-row">
                <div class="ic">${sc.icon}</div>
                <div class="info">
                    <div class="nm">${sc.title}${fl}</div>
                    <div class="det">${c}/${r.tot} · ${fmt(r.el)}</div>
                </div>
                <div class="pct" style="color:${g.c}">${p}%</div>
            </div>
        `;
    });

    const tp = Math.round(tc / tq * 100);
    const g = gr(tp);

    return `
        <div class="final">
            <div style="font-size:56px;animation:scale-in .5s ease">${g.e}</div>
            <h2 style="color:${g.c}">${g.l}</h2>
            <div class="sub">12 ситуаций · ${fmt(tt)}</div>
            <div class="final-stats">
                <div class="final-stat">
                    <div class="v" style="color:${g.c}">${tp}%</div>
                    <div class="l">Точность</div>
                </div>
                <div class="final-stat">
                    <div class="v" style="color:#2ec4b6">${tc}/${tq}</div>
                    <div class="l">Верных</div>
                </div>
                <div class="final-stat">
                    <div class="v" style="color:${tcr > 0 ? '#e63946' : '#2ec4b6'}">${tcr}</div>
                    <div class="l">Критических</div>
                </div>
                <div class="final-stat">
                    <div class="v" style="color:${tto > 0 ? '#e63946' : '#6b7280'}">${tto}</div>
                    <div class="l">Таймаутов</div>
                </div>
            </div>
            <div style="text-align:left;margin-bottom:20px">${sr}</div>
            <button class="btn-primary" style="width:100%" onclick="rst()">Пройти заново</button>
            <button class="next-btn sec" onclick="showStats()" style="margin-top:10px">📊 Посмотреть статистику</button>
            <p style="color:#4b5563;font-size:12px;margin-top:16px">Порядок и варианты будут перемешаны</p>
        </div>
    `;
}

function rStats(history) {

    if (history.length === 0) {
        return `
            <div style="animation:fade-in .4s ease;padding-top:24px">
                <button class="next-btn sec" style="width:auto;padding:10px 20px;margin-bottom:32px" onclick="rst()">← Назад</button>
                <div style="text-align:center;padding:60px 0">
                    <div style="font-size:48px;margin-bottom:16px">📊</div>
                    <p style="color:#6b7280;font-size:15px;line-height:1.6">Пока нет данных.<br>Пройдите тренажер хотя бы раз.</p>
                </div>
            </div>
        `;
    }

    // Итоговые метрики
    const totalRuns = history.length;
    const bestScore = Math.max(...history.map(r => r.totalPct));
    const avgScore = Math.round(history.reduce((s, r) => s + r.totalPct, 0) / totalRuns);
    const totalCrits = history.reduce((s, r) => s + r.scenarios.reduce((ss, sc) => ss + sc.crits, 0), 0);

    const metrics = `
        <div class="stats-grid">
            <div class="stat-card"><div class="v" style="color:#2ec4b6">${totalRuns}</div><div class="l">Игр</div></div>
            <div class="stat-card"><div class="v" style="color:${gr(bestScore).c}">${bestScore}%</div><div class="l">Лучшее</div></div>
            <div class="stat-card"><div class="v" style="color:${gr(avgScore).c}">${avgScore}%</div><div class="l">Среднее</div></div>
            <div class="stat-card"><div class="v" style="color:${totalCrits > 0 ? '#e63946' : '#2ec4b6'}">${totalCrits}</div><div class="l">Критических</div></div>
        </div>
    `;

    // Динамика — последние 10 игр (только если 2+)
    let trend = '';
    if (history.length >= 2) {
        const runs = history.slice(-10);
        let bars = '', labels = '';
        runs.forEach(r => {
            const h = Math.max(3, r.totalPct / 100 * 48);
            bars += `<div class="trend-bar" style="height:${h}px;background:${gr(r.totalPct).c}"></div>`;
            labels += `<div class="trend-label">${r.totalPct}%</div>`;
        });
        trend = `
            <div class="review-title">Динамика</div>
            <div class="trend-wrap">
                <div class="trend-row">${bars}</div>
                <div class="trend-labels">${labels}</div>
            </div>
        `;
    }

    // По сценариям
    const scData = SC.map((sc, i) => {
        const runs = history.filter(r => r.scenarios.some(s => s.oi === i));
        if (!runs.length) return { icon: sc.icon, title: sc.title, fl: sc.fl, played: false };
        const scores = runs.map(r => r.scenarios.find(s => s.oi === i).pct);
        return {
            icon: sc.icon, title: sc.title, fl: sc.fl, played: true,
            best: Math.max(...scores), times: runs.length
        };
    });

    const played = scData.filter(s => s.played).sort((a, b) => a.best - b.best);
    const unplayed = scData.filter(s => !s.played);
    let scList = '';
    [...played, ...unplayed].forEach(s => {
        if (!s.played) {
            scList += `
                <div class="sc-stat-row unplayed">
                    <div class="sc-stat-icon">${s.icon}</div>
                    <div class="sc-stat-info">
                        <div class="sc-stat-name">${s.title}</div>
                        <div class="sc-stat-detail">не пройден</div>
                    </div>
                </div>
            `;
        } else {
            const g = gr(s.best);
            const fl = s.fl ? ` <span class="false-tag" style="vertical-align:middle;font-size:9px">ловушка</span>` : '';
            scList += `
                <div class="sc-stat-row">
                    <div class="sc-stat-icon">${s.icon}</div>
                    <div class="sc-stat-info">
                        <div class="sc-stat-name">${s.title}${fl}</div>
                        <div class="sc-stat-bar-wrap"><div class="sc-stat-bar" style="width:${s.best}%;background:${g.c}"></div></div>
                    </div>
                    <div class="sc-stat-meta">
                        <div class="sc-stat-pct" style="color:${g.c}">${s.best}%</div>
                        <div class="sc-stat-times">×${s.times}</div>
                    </div>
                </div>
            `;
        }
    });

    // Слабые зоны (лучший результат < 60%)
    const weak = played.filter(s => s.best < 60);
    let weakHTML = '';
    if (weak.length > 0) {
        weakHTML = `
            <div class="review-title" style="margin-top:24px;color:#e63946">⚠ Слабые зоны</div>
            <div style="margin-bottom:8px">
                ${weak.map(s => `<div style="font-size:13px;color:#9ca3af;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">${s.icon} ${s.title} — лучшее ${s.best}%</div>`).join('')}
            </div>
        `;
    }

    return `
        <div style="animation:fade-in .4s ease;padding-top:24px">
            <button class="next-btn sec" style="width:auto;padding:10px 20px;margin-bottom:24px" onclick="rst()">← Назад</button>
            <h2 style="font-family:'Outfit';font-size:22px;font-weight:800;margin-bottom:20px">Статистика</h2>
            ${metrics}
            ${trend}
            <div class="review-title">По сценариям</div>
            ${scList}
            ${weakHTML}
            <div style="margin-top:24px">
                <button class="next-btn sec" onclick="showLeaderboard()" style="margin-bottom:10px">🏆 Лидерборд</button>
            </div>
        </div>
    `;
}

function rLeaderboard(data) {
    const { leaderboard, my_id } = data;

    if (leaderboard.length === 0) {
        return `
            <div style="animation:fade-in .4s ease;padding-top:24px">
                <button class="next-btn sec" style="width:auto;padding:10px 20px;margin-bottom:32px" onclick="rst()">← Назад</button>
                <div style="text-align:center;padding:60px 0">
                    <div style="font-size:48px;margin-bottom:16px">🏆</div>
                    <p style="color:#6b7280;font-size:15px;line-height:1.6">Лидерборд пуст.<br>Пройдите тренажер — появится первый результат.</p>
                </div>
            </div>
        `;
    }

    let rows = '';
    leaderboard.forEach((u, i) => {
        const isMe = u.id === my_id;
        const g = gr(u.best_pct);
        let medal = '';
        if (i === 0) medal = '🥇';
        else if (i === 1) medal = '🥈';
        else if (i === 2) medal = '🥉';

        rows += `
            <div class="lb-row ${isMe ? 'lb-me' : ''}">
                <div class="lb-rank">${medal || (i + 1)}</div>
                <div class="lb-avatar">
                    ${u.photo_url ? `<img src="${u.photo_url}" class="lb-img" alt="">` : '<div class="lb-img-ph">👤</div>'}
                </div>
                <div class="lb-info">
                    <div class="lb-name">${u.name}${isMe ? ' (вы)' : ''}</div>
                    <div class="lb-detail">${u.games_played} ${u.games_played === 1 ? 'игра' : u.games_played < 5 ? 'игры' : 'игр'}</div>
                </div>
                <div class="lb-score" style="color:${g.c}">${u.best_pct}%</div>
            </div>
        `;
    });

    return `
        <div style="animation:fade-in .4s ease;padding-top:24px">
            <button class="next-btn sec" style="width:auto;padding:10px 20px;margin-bottom:24px" onclick="rst()">← Назад</button>
            <h2 style="font-family:'Outfit';font-size:22px;font-weight:800;margin-bottom:4px">🏆 Лидерборд</h2>
            <p style="color:#6b7280;font-size:13px;margin-bottom:20px">Лучший результат каждого игрока</p>
            <div class="lb-list">${rows}</div>
        </div>
    `;
}

// Инициализация
initTelegram();
R();
