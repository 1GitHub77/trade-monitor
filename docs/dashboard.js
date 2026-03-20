/* ═══════════════════════════════════════════════════════════════
   Trade Monitor - Static Dashboard (GitHub Pages)
   All data fetched from GitHub Gist, computed client-side.
   ═══════════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────

let tradeData = null;       // Raw data from Gist
let currentFilter = { type: 'all' };
let growthMode = 'eur';     // 'eur' or 'pct'
let equityChart = null;
let drawdownChart = null;

const STORAGE_KEY = 'tradeMonitor';
const CACHE_MAX_AGE = 3600000; // 1 hour

const COLORS = {
    equity: '#3fb950', equityFill: 'rgba(63,185,80,0.1)',
    drawdown: '#f85149', drawdownFill: 'rgba(248,81,73,0.15)',
    grid: '#21262d', text: '#8b949e',
};

// ─── Init ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const gistId = getGistId();
    if (!gistId) {
        showSetup();
    } else {
        showDashboard();
        initCharts();
        loadData();
    }
});

// ─── Config / Setup ──────────────────────────────────────────

function getStorage() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
}

function setStorage(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getGistId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('gist') || getStorage().gistId || '';
}

function showSetup() {
    document.getElementById('setupPanel').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('setupPanel').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
}

function saveSetup() {
    const id = document.getElementById('gistIdInput').value.trim();
    if (!id) {
        document.getElementById('setupError').textContent = 'Bitte Gist ID eingeben';
        return;
    }
    const store = getStorage();
    store.gistId = id;
    setStorage(store);
    showDashboard();
    initCharts();
    loadData();
}

function showSettings() {
    document.getElementById('settingsGistId').value = getGistId();
    document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

function updateSettings() {
    const id = document.getElementById('settingsGistId').value.trim();
    if (id) {
        const store = getStorage();
        store.gistId = id;
        store.cache = null; // Clear cache on ID change
        setStorage(store);
    }
    closeSettings();
    loadData();
}

function clearAllData() {
    if (confirm('Alle lokalen Daten (Cache, Backtest-Daten) loeschen?')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }
}

// ─── Data Fetching ───────────────────────────────────────────

async function loadData() {
    const gistId = getGistId();
    if (!gistId) { showSetup(); return; }

    // Check cache
    const store = getStorage();
    if (store.cache && store.cacheTime && (Date.now() - store.cacheTime < CACHE_MAX_AGE)) {
        tradeData = store.cache;
        renderAll();
        document.getElementById('lastSync').textContent =
            'Cache: ' + fmtTime(store.cacheTime / 1000);
        return;
    }

    const btn = document.getElementById('btnRefresh');
    btn.disabled = true;
    btn.textContent = 'Lade...';

    try {
        const resp = await fetch(`https://api.github.com/gists/${gistId}`);
        if (!resp.ok) {
            if (resp.status === 404) throw new Error('Gist nicht gefunden. Prüfe die Gist ID.');
            if (resp.status === 403) throw new Error('Rate Limit erreicht. Versuche es später.');
            throw new Error(`GitHub API Fehler: HTTP ${resp.status}`);
        }

        const gist = await resp.json();
        const file = gist.files['trades.json'];
        if (!file) throw new Error('trades.json nicht im Gist gefunden');

        // Handle truncated content (large files)
        let content;
        if (file.truncated) {
            const rawResp = await fetch(file.raw_url);
            content = await rawResp.text();
        } else {
            content = file.content;
        }

        tradeData = JSON.parse(content);

        // Cache in localStorage
        store.cache = tradeData;
        store.cacheTime = Date.now();
        setStorage(store);

        renderAll();
        const exportTime = tradeData.export_time;
        document.getElementById('lastSync').textContent =
            'Export: ' + (exportTime ? fmtTime(exportTime) : '—');

    } catch (e) {
        document.getElementById('accountBar').innerHTML =
            `<span style="color:var(--red)">${esc(e.message)}</span>`;
        // Fall back to cache if available
        if (store.cache) {
            tradeData = store.cache;
            renderAll();
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Aktualisieren';
    }
}

function refreshData() {
    // Force refresh (clear cache)
    const store = getStorage();
    store.cache = null;
    store.cacheTime = null;
    setStorage(store);
    loadData();
}

// ─── Render Orchestration ────────────────────────────────────

function renderAll() {
    if (!tradeData) return;

    const { deals, positions } = getFilteredData();
    const account = tradeData.account || {};
    const isAllFilter = currentFilter.type === 'all';

    // For "Alle": equity curve (absolute balance)
    // For individual EA: growth curve (cumulative P/L starting from 0)
    const allExits = deals.filter(d => d.entry === 1);
    const totalPnl = allExits.reduce((s, d) => s + calcPnl(d), 0);
    const accountBalance = account.balance || 0;
    const initialBalance = isAllFilter ? accountBalance - totalPnl : 0;
    // For DD% calculation: always use account balance as reference
    const ddReference = accountBalance > 0 ? accountBalance : (accountBalance - totalPnl);

    const stats = calculateStats(deals, positions, initialBalance, ddReference);

    renderAccount(account);
    renderFilters();
    renderStats(stats);
    renderMainChart(deals, initialBalance, isAllFilter);
    renderDrawdownChart(deals, initialBalance, ddReference);
    renderDeals(allExits);
    renderPositions(positions);
    renderBacktest(stats);
}

function getFilteredData() {
    if (!tradeData) return { deals: [], positions: [] };

    let deals = tradeData.deals || [];
    let positions = tradeData.positions || [];

    if (currentFilter.type === 'magic') {
        deals = deals.filter(d => d.magic === currentFilter.value);
        positions = positions.filter(p => p.magic === currentFilter.value);
    } else if (currentFilter.type === 'base') {
        const base = currentFilter.value;
        deals = deals.filter(d => baseMagic(d.magic) === base);
        positions = positions.filter(p => baseMagic(p.magic) === base);
    }

    return { deals, positions };
}

function baseMagic(magic) {
    return Math.floor((magic || 0) / 1000) * 1000;
}

function getEAName(deal) {
    // Prefer order_comment (original EA name) over comment (often broker-modified with SL/TP)
    return deal.order_comment || deal.comment || '';
}

// ─── Filters ─────────────────────────────────────────────────

function renderFilters() {
    if (!tradeData) return;
    const list = document.getElementById('filterList');
    list.innerHTML = '';

    const allDeals = tradeData.deals || [];
    const exits = allDeals.filter(d => d.entry === 1);
    const groups = {};

    // Build groups — prefer order_comment (original EA name) over comment (broker-modified)
    allDeals.forEach(d => {
        const base = baseMagic(d.magic);
        if (!groups[base]) groups[base] = { base, strategies: {}, comment: '' };

        const name = getEAName(d);
        if (!groups[base].strategies[d.magic] && exits.some(e => e.magic === d.magic)) {
            groups[base].strategies[d.magic] = name;
        }
        if (name && !groups[base].comment) {
            groups[base].comment = name;
        }
    });

    Object.values(groups).sort((a, b) => a.base - b.base).forEach(group => {
        const displayName = group.comment || `EA ${group.base}`;
        const btn = el('button', 'filter-btn' + (currentFilter.type === 'base' && currentFilter.value === group.base ? ' active' : ''));
        btn.dataset.filter = `base:${group.base}`;
        btn.innerHTML = `${esc(displayName)} <span class="magic-label">${group.base}</span>`;
        btn.onclick = () => setFilter('base', group.base);
        list.appendChild(btn);

        Object.entries(group.strategies).sort(([a],[b]) => a - b).forEach(([magic, cmt]) => {
            magic = Number(magic);
            if (magic === group.base) return;
            const subDisplay = cmt || `Strategie ${magic % 1000}`;
            const sub = el('button', 'filter-btn sub' + (currentFilter.type === 'magic' && currentFilter.value === magic ? ' active' : ''));
            sub.dataset.filter = `magic:${magic}`;
            sub.innerHTML = `${esc(subDisplay)} <span class="magic-label">${magic}</span>`;
            sub.onclick = () => setFilter('magic', magic);
            list.appendChild(sub);
        });
    });
}

function setFilter(type, value) {
    currentFilter = type === 'all' ? { type: 'all' } : { type, value };

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (type === 'all' && btn.dataset.filter === 'all') btn.classList.add('active');
        if (type === 'base' && btn.dataset.filter === `base:${value}`) btn.classList.add('active');
        if (type === 'magic' && btn.dataset.filter === `magic:${value}`) btn.classList.add('active');
    });

    renderAll();
}

// ─── Statistics Calculation ──────────────────────────────────

function calcPnl(d) {
    return (d.profit || 0) + (d.commission || 0) + (d.swap || 0);
}

function calculateStats(deals, positions, initialBalance, ddReference) {
    const exits = deals.filter(d => d.entry === 1).sort((a, b) => a.time - b.time);
    const entries = {};
    deals.filter(d => d.entry === 0).forEach(d => { entries[d.position_id] = d; });

    if (exits.length === 0) return emptyStats();

    const pnls = exits.map(calcPnl);
    const netProfit = pnls.reduce((s, p) => s + p, 0);
    const grossProfit = pnls.filter(p => p > 0).reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(pnls.filter(p => p < 0).reduce((s, p) => s + p, 0));

    const winners = pnls.filter(p => p > 0);
    const losers = pnls.filter(p => p < 0);
    const total = exits.length;

    // Profit Factor
    const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

    // Win Rate
    const winRate = winners.length / total * 100;

    // Equity Curve & Drawdown
    const eqCurve = [];
    let running = initialBalance;
    for (const pnl of pnls) { running += pnl; eqCurve.push(running); }

    // DD% uses account balance as reference (not EA peak profit)
    const ddRef = ddReference || (eqCurve[0] || initialBalance);
    let maxDD = 0, maxDDPct = 0, peak = eqCurve[0] || initialBalance;
    for (const eq of eqCurve) {
        if (eq > peak) peak = eq;
        const dd = peak - eq;
        const ddPct = ddRef > 0 ? dd / ddRef * 100 : 0;
        if (dd > maxDD) maxDD = dd;
        if (ddPct > maxDDPct) maxDDPct = ddPct;
    }

    // Recovery Factor
    const rf = maxDD > 0 ? netProfit / maxDD : (netProfit > 0 ? Infinity : 0);

    // Sharpe Ratio
    let sharpe = 0;
    if (pnls.length > 1) {
        const mean = netProfit / pnls.length;
        const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (pnls.length - 1);
        const std = Math.sqrt(variance);
        if (std > 0) sharpe = mean / std * Math.sqrt(252);
    }

    // Consecutive
    let maxCW = 0, maxCL = 0, cw = 0, cl = 0;
    for (const p of pnls) {
        if (p > 0) { cw++; cl = 0; } else if (p < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; }
        if (cw > maxCW) maxCW = cw;
        if (cl > maxCL) maxCL = cl;
    }

    // Trades per week
    let tpw = total;
    if (exits.length >= 2) {
        const spanDays = (exits[exits.length - 1].time - exits[0].time) / 86400;
        if (spanDays > 0) tpw = total / (spanDays / 7);
    }

    // Avg duration
    let avgDur = 0;
    const durations = [];
    for (const d of exits) {
        const entry = entries[d.position_id];
        if (entry) {
            const dur = d.time - entry.time;
            if (dur > 0) durations.push(dur);
        }
    }
    if (durations.length > 0) avgDur = durations.reduce((s, d) => s + d, 0) / durations.length;

    // Open PnL
    const openPnl = positions.reduce((s, p) => s + calcPnl(p), 0);

    // Current DD
    const curEquity = eqCurve.length > 0 ? eqCurve[eqCurve.length - 1] : initialBalance;
    const curPeak = eqCurve.length > 0 ? Math.max(...eqCurve) : initialBalance;
    const curDD = curPeak - curEquity;
    const curDDPct = ddRef > 0 ? curDD / ddRef * 100 : 0;

    return {
        net_profit: r2(netProfit), gross_profit: r2(grossProfit), gross_loss: r2(grossLoss),
        profit_factor: pf === Infinity ? '∞' : r2(pf),
        recovery_factor: rf === Infinity ? '∞' : r2(rf),
        win_rate: r1(winRate), total_trades: total, trades_per_week: r1(tpw),
        max_drawdown: r2(maxDD), max_drawdown_pct: r1(maxDDPct),
        current_drawdown: r2(curDD), current_drawdown_pct: r1(curDDPct),
        sharpe_ratio: r2(sharpe),
        largest_profit: r2(pnls.length ? Math.max(...pnls) : 0),
        largest_loss: r2(pnls.length ? Math.min(...pnls) : 0),
        avg_profit: r2(winners.length ? winners.reduce((s, p) => s + p, 0) / winners.length : 0),
        avg_loss: r2(losers.length ? losers.reduce((s, p) => s + p, 0) / losers.length : 0),
        max_consecutive_wins: maxCW, max_consecutive_losses: maxCL,
        avg_duration_hours: r1(avgDur / 3600),
        open_pnl: r2(openPnl), open_positions: positions.length,
    };
}

function emptyStats() {
    return {
        net_profit: 0, gross_profit: 0, gross_loss: 0,
        profit_factor: 0, recovery_factor: 0, win_rate: 0,
        total_trades: 0, trades_per_week: 0,
        max_drawdown: 0, max_drawdown_pct: 0,
        current_drawdown: 0, current_drawdown_pct: 0,
        sharpe_ratio: 0, largest_profit: 0, largest_loss: 0,
        avg_profit: 0, avg_loss: 0,
        max_consecutive_wins: 0, max_consecutive_losses: 0,
        avg_duration_hours: 0, open_pnl: 0, open_positions: 0,
    };
}

// ─── Render: Account ─────────────────────────────────────────

function renderAccount(account) {
    const bar = document.getElementById('accountBar');
    if (!account || !account.login) {
        bar.innerHTML = '<span class="text-muted">Keine Kontodaten</span>';
        return;
    }
    bar.innerHTML = `
        <div class="item"><span class="label">Konto:</span> ${account.login}</div>
        <div class="item"><span class="label">Server:</span> ${esc(account.server || '')}</div>
        <div class="item"><span class="label">Balance:</span> ${fmt$(account.balance)}</div>
        <div class="item"><span class="label">Equity:</span> ${fmt$(account.equity)}</div>
        <div class="item"><span class="label">Waehrung:</span> ${account.currency || ''}</div>
    `;
}

// ─── Render: Stats ───────────────────────────────────────────

function renderStats(s) {
    setStat('statNetProfit', fmt$(s.net_profit), s.net_profit);
    setStat('statPF', s.profit_factor);
    setStat('statRF', s.recovery_factor);
    setStat('statWinRate', s.win_rate + '%');
    setStat('statTrades', s.total_trades);
    setStat('statTPW', s.trades_per_week);
    setStat('statMaxDD', `${fmt$(s.max_drawdown)} (${s.max_drawdown_pct}%)`, -1);
    setStat('statCurDD', `${fmt$(s.current_drawdown)} (${s.current_drawdown_pct}%)`, -1);
    setStat('statSharpe', s.sharpe_ratio);
    setStat('statLargestWin', fmt$(s.largest_profit), s.largest_profit);
    setStat('statLargestLoss', fmt$(s.largest_loss), s.largest_loss);
    setStat('statAvgWin', fmt$(s.avg_profit), s.avg_profit);
    setStat('statAvgLoss', fmt$(s.avg_loss), s.avg_loss);
    setStat('statConsecWins', s.max_consecutive_wins);
    setStat('statConsecLosses', s.max_consecutive_losses);
    setStat('statAvgDuration', fmtDuration(s.avg_duration_hours));
    setStat('statOpenPnL', fmt$(s.open_pnl), s.open_pnl);
    setStat('statOpenPos', s.open_positions);
}

function setStat(id, value, colorValue) {
    const el = document.querySelector(`#${id} .stat-value`);
    if (!el) return;
    el.textContent = value;
    el.className = 'stat-value';
    if (colorValue !== undefined && typeof colorValue === 'number') {
        if (colorValue > 0) el.classList.add('positive');
        else if (colorValue < 0) el.classList.add('negative');
    }
}

// ─── Render: Backtest Comparison ─────────────────────────────

function renderBacktest(stats) {
    const section = document.getElementById('backtestSection');
    const tbody = document.querySelector('#backtestTable tbody');
    const store = getStorage();
    const btData = store.backtest || {};

    // Find backtest data for current filter
    let btKey = null;
    if (currentFilter.type === 'magic') btKey = String(currentFilter.value);
    else if (currentFilter.type === 'base') btKey = String(currentFilter.value);

    const bt = btKey ? btData[btKey] : null;
    if (!bt || Object.keys(bt).length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    tbody.innerHTML = '';

    const compareKeys = [
        ['net_profit', 'Net Profit'], ['profit_factor', 'Profit Factor'],
        ['recovery_factor', 'Recovery Factor'], ['win_rate', 'Win Rate'],
        ['max_drawdown', 'Max Drawdown'], ['sharpe_ratio', 'Sharpe Ratio'],
        ['largest_profit', 'Largest Win'], ['largest_loss', 'Largest Loss'],
        ['avg_profit', 'Avg Win'], ['avg_loss', 'Avg Loss'],
    ];

    for (const [key, label] of compareKeys) {
        const live = stats[key];
        const btVal = bt[key];
        if (btVal === undefined) continue;

        const diff = (typeof live === 'number' && typeof btVal === 'number') ? live - btVal : null;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${label}</td>
            <td>${fmtNum(live)}</td>
            <td>${fmtNum(btVal)}</td>
            <td class="${diff > 0 ? 'profit-positive' : diff < 0 ? 'profit-negative' : ''}">${diff !== null ? fmtNum(diff, true) : '—'}</td>
        `;
        tbody.appendChild(tr);
    }
}

// ─── Render: Charts ──────────────────────────────────────────

function initCharts() {
    const defaultOpts = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#1c2128', borderColor: '#30363d', borderWidth: 1,
                titleColor: '#e6edf3', bodyColor: '#8b949e', padding: 10,
            },
        },
        scales: {
            x: {
                type: 'time',
                time: { tooltipFormat: 'dd.MM.yyyy HH:mm' },
                grid: { color: COLORS.grid },
                ticks: { color: COLORS.text, maxTicksLimit: 10 },
            },
            y: {
                grid: { color: COLORS.grid },
                ticks: { color: COLORS.text },
            },
        },
    };

    equityChart = new Chart(document.getElementById('equityChart'), {
        type: 'line', data: { datasets: [] },
        options: {
            ...defaultOpts,
            plugins: {
                ...defaultOpts.plugins,
                tooltip: {
                    ...defaultOpts.plugins.tooltip,
                    callbacks: {
                        label: ctx => {
                            const p = ctx.raw;
                            let l = `Equity: ${fmt$(p.y)}`;
                            if (p.profit) l += ` | Trade: ${fmt$(p.profit)}`;
                            if (p.comment) l += ` | ${p.comment}`;
                            return l;
                        }
                    }
                }
            }
        },
    });

    drawdownChart = new Chart(document.getElementById('drawdownChart'), {
        type: 'line', data: { datasets: [] },
        options: {
            ...defaultOpts,
            scales: {
                ...defaultOpts.scales,
                y: { ...defaultOpts.scales.y, reverse: true,
                    ticks: { color: COLORS.text, callback: v => v.toFixed(1) + '%' } },
            },
        },
    });
}

function setGrowthMode(mode) {
    growthMode = mode;
    document.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    renderAll();
}

function renderMainChart(deals, initialBalance, isAllFilter) {
    const exits = deals.filter(d => d.entry === 1).sort((a, b) => a.time - b.time);
    if (exits.length === 0) { equityChart.data.datasets = []; equityChart.update(); return; }

    // Show/hide toggle (only for individual EAs)
    const toggle = document.getElementById('growthToggle');
    if (toggle) toggle.style.display = isAllFilter ? 'none' : 'flex';

    const titleEl = document.getElementById('mainChartTitle');
    const isPct = !isAllFilter && growthMode === 'pct';

    if (isAllFilter) {
        if (titleEl) titleEl.textContent = 'Equity Curve';
    } else {
        if (titleEl) titleEl.textContent = isPct ? 'Growth Curve (%)' : 'Growth Curve (EUR)';
    }

    // Get account balance for % calculation
    const account = tradeData.account || {};
    const accountBalance = account.balance || 10000;
    const balanceForPct = isAllFilter ? accountBalance : accountBalance;

    const points = [];
    let running = initialBalance;
    for (const d of exits) {
        const pnl = calcPnl(d);
        running += pnl;
        const yValue = isPct ? r2((running / balanceForPct) * 100) : r2(running);
        points.push({ x: d.time * 1000, y: yValue, profit: r2(pnl), comment: getEAName(d), eurValue: r2(running) });
    }

    // Tooltip
    equityChart.options.plugins.tooltip.callbacks.label = ctx => {
        const p = ctx.raw;
        let l;
        if (isAllFilter) {
            l = `Equity: ${fmt$(p.y)}`;
        } else if (isPct) {
            l = `Growth: ${p.y}% (${fmt$(p.eurValue)})`;
        } else {
            l = `P/L: ${fmt$(p.y)}`;
        }
        if (p.profit) l += ` | Trade: ${fmt$(p.profit)}`;
        if (p.comment) l += ` | ${p.comment}`;
        return l;
    };

    // Y-axis format
    equityChart.options.scales.y.ticks.callback = isPct ? (v => v.toFixed(1) + '%') : (v => fmt$(v));

    equityChart.data.datasets = [{
        data: points,
        borderColor: COLORS.equity, backgroundColor: COLORS.equityFill,
        fill: true, borderWidth: 1.5, pointRadius: 0, pointHitRadius: 6, tension: 0.1,
    }];
    equityChart.update();
}

function renderDrawdownChart(deals, initialBalance, ddReference) {
    const exits = deals.filter(d => d.entry === 1).sort((a, b) => a.time - b.time);
    if (exits.length === 0) { drawdownChart.data.datasets = []; drawdownChart.update(); return; }

    const isAllFilter = currentFilter.type === 'all';
    const showEur = !isAllFilter && growthMode === 'eur';
    const ddRef = ddReference || initialBalance;

    // Update DD chart title
    const titleEl = document.getElementById('ddChartTitle');
    if (titleEl) titleEl.textContent = showEur ? 'Drawdown (EUR)' : 'Drawdown (%)';

    const points = [];
    let running = initialBalance, peak = initialBalance;
    for (const d of exits) {
        running += calcPnl(d);
        if (running > peak) peak = running;
        const dd = peak - running;
        const ddPct = ddRef > 0 ? dd / ddRef * 100 : 0;
        points.push({ x: d.time * 1000, y: showEur ? r2(dd) : r2(ddPct), eur: r2(dd), pct: r2(ddPct) });
    }

    // Y-axis format
    drawdownChart.options.scales.y.ticks.callback = showEur ? (v => fmt$(v)) : (v => v.toFixed(1) + '%');

    // Tooltip
    drawdownChart.options.plugins.tooltip.callbacks = {
        label: ctx => {
            const p = ctx.raw;
            return showEur ? `DD: ${fmt$(p.eur)} (${p.pct}%)` : `DD: ${p.pct}% (${fmt$(p.eur)})`;
        }
    };

    drawdownChart.data.datasets = [{
        data: points,
        borderColor: COLORS.drawdown, backgroundColor: COLORS.drawdownFill,
        fill: true, borderWidth: 1.5, pointRadius: 0, pointHitRadius: 6, tension: 0.1,
    }];
    drawdownChart.update();
}

// ─── Render: Tables ──────────────────────────────────────────

function renderDeals(exits) {
    const tbody = document.querySelector('#tradesTable tbody');
    tbody.innerHTML = '';

    exits.slice().reverse().slice(0, 200).forEach(d => {
        const pnl = calcPnl(d);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fmtTime(d.time)}</td>
            <td>${esc(d.symbol || '')}</td>
            <td>${d.type === 0 ? 'Buy' : 'Sell'}</td>
            <td>${d.volume}</td>
            <td>${d.magic}</td>
            <td>${esc(getEAName(d))}</td>
            <td class="${pnl >= 0 ? 'profit-positive' : 'profit-negative'}">${fmt$(pnl)}</td>
        `;
        tbody.appendChild(tr);
    });

    if (exits.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center">Keine Trades</td></tr>';
    }
}

function renderPositions(positions) {
    const tbody = document.querySelector('#positionsTable tbody');
    tbody.innerHTML = '';

    if (positions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="text-align:center">Keine offenen Positionen</td></tr>';
        return;
    }

    positions.forEach(p => {
        const pnl = calcPnl(p);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${esc(p.symbol || '')}</td>
            <td>${p.type === 0 ? 'Buy' : 'Sell'}</td>
            <td>${p.volume}</td>
            <td>${p.price_open}</td>
            <td>${p.price_current}</td>
            <td>${p.magic}</td>
            <td>${esc(p.comment || '')}</td>
            <td class="${pnl >= 0 ? 'profit-positive' : 'profit-negative'}">${fmt$(pnl)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ─── Backtest Report Parser (Client-Side) ────────────────────

const BT_STAT_MAP = {
    'Total Net Profit': 'net_profit',
    'Gross Profit': 'gross_profit',
    'Gross Loss': 'gross_loss',
    'Profit Factor': 'profit_factor',
    'Recovery Factor': 'recovery_factor',
    'Sharpe Ratio': 'sharpe_ratio',
    'Balance Drawdown Maximal': 'max_drawdown',
    'Equity Drawdown Maximal': 'max_drawdown_equity',
    'Balance Drawdown Relative': 'max_drawdown_pct',
    'Total Trades': 'total_trades',
    'Profit Trades (% of total)': 'win_rate',
    'Largest profit trade': 'largest_profit',
    'Largest loss trade': 'largest_loss',
    'Average profit trade': 'avg_profit',
    'Average loss trade': 'avg_loss',
    'Maximum consecutive wins ($)': 'max_consecutive_wins',
    'Maximum consecutive losses ($)': 'max_consecutive_losses',
    // German labels
    'Gesamtnettogewinn': 'net_profit',
    'Bruttogewinn': 'gross_profit',
    'Bruttoverlust': 'gross_loss',
    'Gewinnfaktor': 'profit_factor',
    'Erholungsfaktor': 'recovery_factor',
    'Saldo Drawdown Maximal': 'max_drawdown',
    'Abschlüsse insgesamt': 'total_trades',
    'Gewinn-Trades (% von Gesamt)': 'win_rate',
    'Größter Gewinn-Trade': 'largest_profit',
    'Größter Verlust-Trade': 'largest_loss',
    'Durchschnitt Gewinn-Trade': 'avg_profit',
    'Durchschnitt Verlust-Trade': 'avg_loss',
    'Maximale aufeinanderfolgende Gewinne ($)': 'max_consecutive_wins',
    'Maximale aufeinanderfolgende Verluste ($)': 'max_consecutive_losses',
};

function parseMT5Report(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const stats = {};

    doc.querySelectorAll('tr').forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.textContent.trim());
        for (let i = 0; i < cells.length - 1; i += 2) {
            const label = cells[i];
            const valueText = cells[i + 1] || '';
            if (BT_STAT_MAP[label]) {
                const num = parseReportNumber(valueText);
                if (num !== null) stats[BT_STAT_MAP[label]] = num;
            }
        }
    });

    return stats;
}

function extractMagicFromReport(html) {
    const patterns = [/Magic\s*(?:Number)?\s*[:=]\s*(\d+)/i, /MagicNumber\s*[:=]\s*(\d+)/i];
    for (const p of patterns) {
        const m = html.match(p);
        if (m) return parseInt(m[1]);
    }
    return null;
}

function parseReportNumber(text) {
    if (!text) return null;
    const cleaned = text.replace(/%/g, '').replace(/\s/g, '').replace(/\u00a0/g, '');
    const match = cleaned.match(/^(-?[\d.]+)/);
    return match ? parseFloat(match[1]) : null;
}

function uploadBacktest(event) {
    event.preventDefault();
    const fileInput = document.getElementById('btFile');
    const magicInput = document.getElementById('btMagic');
    const status = document.getElementById('uploadStatus');

    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const html = e.target.result;
        const parsed = parseMT5Report(html);

        if (Object.keys(parsed).length === 0) {
            status.textContent = 'Fehler: Keine Statistiken im Report gefunden';
            status.style.color = 'var(--red)';
            return;
        }

        let magic = magicInput.value ? parseInt(magicInput.value) : extractMagicFromReport(html);
        if (!magic) {
            status.textContent = 'Fehler: Magic Number nicht gefunden. Bitte manuell eingeben.';
            status.style.color = 'var(--red)';
            return;
        }

        // Store in localStorage
        const store = getStorage();
        if (!store.backtest) store.backtest = {};
        store.backtest[String(magic)] = parsed;
        setStorage(store);

        status.textContent = `Importiert: ${Object.keys(parsed).length} Statistiken fuer Magic ${magic}`;
        status.style.color = 'var(--green)';
        fileInput.value = '';
        magicInput.value = '';

        renderAll();
    };
    reader.readAsText(file);
}

// ─── Formatting Helpers ──────────────────────────────────────

function fmt$(v) {
    if (v === undefined || v === null) return '—';
    return Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(v, showSign) {
    if (v === undefined || v === null || v === '∞') return String(v ?? '—');
    const n = Number(v);
    const s = n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return showSign && n > 0 ? '+' + s : s;
}

function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(hours) {
    if (!hours) return '—';
    if (hours < 1) return Math.round(hours * 60) + ' min';
    if (hours < 24) return hours.toFixed(1) + ' h';
    return (hours / 24).toFixed(1) + ' d';
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
}

function r1(n) { return Math.round(n * 10) / 10; }
function r2(n) { return Math.round(n * 100) / 100; }
