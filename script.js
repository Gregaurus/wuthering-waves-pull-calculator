// ── DOM References ────────────────────────────────────────────────────────────
const astritesInput         = document.getElementById('astrites');
const rTideInput            = document.getElementById('rTide');
const rollsResult           = document.getElementById('rolls-result');
const astritesResult        = document.getElementById('remaining-astrites');
const afterglowResult       = document.getElementById('bonus-afterglow');
const pullTable             = document.getElementById('pull-table');
const simPullsInput         = document.getElementById('sim-pulls');
const simResults            = document.getElementById('sim-results');
const targetLimitedInput    = document.getElementById('target-limited');
const targetConfidenceInput = document.getElementById('target-confidence');
const estimateBtn           = document.getElementById('estimate-astrites');
const estimateResult        = document.getElementById('estimate-result');

// ── Pull Table ────────────────────────────────────────────────────────────────
const NUM_ROWS      = 4;
const LOSE_PER_COPY = 160;
const WIN_PER_COPY  = 80;
const AVG_PER_COPY  = 112.5;

function generatePullRows(numRows) {
    const rows = [];
    for (let i = 1; i <= numRows; i++) {
        rows.push({
            copies:      i,
            losePity:    LOSE_PER_COPY * i,
            partialPity: WIN_PER_COPY * Math.floor(i * 1.5),
            winPity:     WIN_PER_COPY * i,
            avg:         AVG_PER_COPY * i,
        });
    }
    return rows;
}

function renderPullTable() {
    const tbody = document.getElementById('pull-table-body');
    if (!tbody) return;
    tbody.innerHTML = generatePullRows(NUM_ROWS).map(r => `
        <tr>
            <td>${r.copies}</td>
            <td class="pull-amount">${r.losePity}</td>
            <td class="pull-amount">${r.partialPity}</td>
            <td class="pull-amount">${r.winPity}</td>
            <td class="pull-amount">${r.avg}</td>
        </tr>
    `).join('');
}

// ── Roll Calculation ──────────────────────────────────────────────────────────
const PRESET_KEY = 'rw_preset_v1';

function updateTableHighlight(rolls) {
    const cells = document.querySelectorAll('td.pull-amount');
    const amounts = Array.from(cells).map(c => parseInt(c.textContent.trim(), 10) || 0);
    const maxAmount = amounts.length ? Math.max(...amounts) : 0;

    cells.forEach((cell, i) => {
        cell.classList.toggle('highlight', amounts[i] > 0 && rolls >= amounts[i]);
    });

    if (pullTable) {
        pullTable.classList.toggle('table-highlight', maxAmount > 0 && rolls > maxAmount);
    }
}

function calculateRolls() {
    const astrites = parseFloat(astritesInput.value) || 0;
    const rTide    = parseFloat(rTideInput.value)    || 0;

    const rolls    = Math.floor(astrites / 160) + rTide;
    const remaining = astrites % 160;
    const afterglow = Math.floor(rolls * 0.6);

    rollsResult.textContent    = rolls;
    astritesResult.textContent = remaining;
    try {
        afterglowResult.textContent = new Intl.NumberFormat().format(afterglow);
    } catch {
        afterglowResult.textContent = String(afterglow);
    }

    updateTableHighlight(rolls);
    try {
        localStorage.setItem(PRESET_KEY, JSON.stringify({
            astrites: astritesInput.value,
            rTide:    rTideInput.value,
        }));
    } catch { }
}

function loadPreset() {
    try {
        const raw = localStorage.getItem(PRESET_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p.astrites !== undefined) astritesInput.value = p.astrites;
        if (p.rTide    !== undefined) rTideInput.value    = p.rTide;
    } catch { }
}

astritesInput.addEventListener('input', calculateRolls);
rTideInput.addEventListener('input', calculateRolls);

window.addEventListener('DOMContentLoaded', () => {
    loadPreset();
    renderPullTable();
    calculateRolls();
});

// ── Pity System ───────────────────────────────────────────────────────────────
// Soft pity starts at pull 66, hard pity at 80.
function pullProbability(pullNumber) {
    if (pullNumber <= 65) return 0.008;
    if (pullNumber <= 70) return 0.008 + 0.04  * (pullNumber - 65);
    if (pullNumber <= 75) return 0.008 + 0.20  + 0.08 * (pullNumber - 70);
    if (pullNumber <= 79) return 0.008 + 0.20  + 0.40 + 0.10 * (pullNumber - 75);
    return 1.0;
}

// ── Monte Carlo Simulation ────────────────────────────────────────────────────
// Runs trials and returns per-copy distributions.
function simulateTrials(pulls, trials) {
    const distribution        = {};
    const limitedBySuccesses  = {};
    const limitedDistribution = {};
    let trialsWithAtLeastOne  = 0;
    let totalSuccesses        = 0;

    for (let t = 0; t < trials; t++) {
        let successes                = 0;
        let failuresSinceLastSuccess = 0;
        let mustAwardLimited         = false;
        let limitedThisTrial         = 0;

        for (let i = 0; i < pulls; i++) {
            const p       = pullProbability(failuresSinceLastSuccess + 1);
            const success = (failuresSinceLastSuccess + 1 >= 80) || Math.random() < p;

            if (success) {
                successes++;
                if (mustAwardLimited) {
                    limitedThisTrial++;
                    mustAwardLimited = false;
                } else if (Math.random() < 0.5) {
                    limitedThisTrial++;
                } else {
                    mustAwardLimited = true;
                }
                failuresSinceLastSuccess = 0;
            } else {
                failuresSinceLastSuccess++;
            }
        }

        if (successes > 0) trialsWithAtLeastOne++;
        totalSuccesses += successes;
        distribution[successes]               = (distribution[successes]               || 0) + 1;
        limitedBySuccesses[successes]         = (limitedBySuccesses[successes]         || 0) + limitedThisTrial;
        limitedDistribution[limitedThisTrial] = (limitedDistribution[limitedThisTrial] || 0) + 1;
    }

    return { distribution, limitedBySuccesses, limitedDistribution, trials, totalSuccesses, trialsWithAtLeastOne };
}

// Counts trials where limitedDistribution reached at least targetLimited copies.
function countSuccessfulTrials(limitedDistribution, targetLimited) {
    return Object.keys(limitedDistribution).reduce((acc, k) => {
        const num = parseInt(k, 10);
        return (!isNaN(num) && num >= targetLimited)
            ? acc + (limitedDistribution[k] || 0)
            : acc;
    }, 0);
}

// Wilson score confidence interval for a proportion (two-sided, default 95%).
function wilsonInterval(k, n) {
    if (n <= 0) return { lo: 0, hi: 0 };
    const z      = 1.96; // z* for 95% CI
    const phat   = k / n;
    const denom  = 1 + (z * z) / n;
    const center = phat + (z * z) / (2 * n);
    const adj    = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
    return {
        lo: Math.max(0, (center - adj) / denom),
        hi: Math.min(1, (center + adj) / denom),
    };
}

// ── Pull Estimation ───────────────────────────────────────────────────────────
// Uses doubling search to find an upper bound, then binary search to narrow down.
async function findMinimalPulls(targetLimited, desiredProb, trialsPerEval) {
    const MAX_PULLS = 5000;
    if (targetLimited <= 0) return 0;

    let lo = 1, hi = 1;
    while (hi <= MAX_PULLS) {
        const sim = simulateTrials(hi, trialsPerEval);
        const p   = countSuccessfulTrials(sim.limitedDistribution, targetLimited) / sim.trials;
        if (p >= desiredProb) break;
        lo = hi + 1;
        hi = Math.min(hi * 2, MAX_PULLS);
        if (lo > MAX_PULLS) return null;
        await new Promise(r => setTimeout(r, 10));
    }

    let result = null;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const sim = simulateTrials(mid, trialsPerEval);
        const p   = countSuccessfulTrials(sim.limitedDistribution, targetLimited) / sim.trials;
        if (p >= desiredProb) { result = mid; hi = mid - 1; }
        else lo = mid + 1;
        await new Promise(r => setTimeout(r, 10));
    }
    return result;
}

if (estimateBtn) estimateBtn.addEventListener('click', async () => {
    const targetLimited = Math.max(0, parseInt(targetLimitedInput?.value  || '1',  10));
    const desiredPct    = Math.min(99, Math.max(1, parseFloat(targetConfidenceInput?.value || '90')));
    const desiredProb   = desiredPct / 100;
    const trialsPerEval = 20000;

    estimateResult.textContent = 'Estimating… (this may take a moment)';
    try {
        const pullsNeeded = await findMinimalPulls(targetLimited, desiredProb, trialsPerEval);
        if (pullsNeeded === null) {
            estimateResult.innerHTML = 'Could not find required pulls up to limit.';
            return;
        }

        const rTide          = parseInt(rTideInput?.value || '0', 10) || 0;
        const extraRolls     = Math.max(0, pullsNeeded - rTide);
        const astritesNeeded = extraRolls * 160;

        const finalSim    = simulateTrials(pullsNeeded, trialsPerEval);
        const successCount = countSuccessfulTrials(finalSim.limitedDistribution, targetLimited);
        const pEst        = successCount / finalSim.trials;
        const ci          = wilsonInterval(successCount, finalSim.trials);

        estimateResult.innerHTML =
            `Pulls needed: <strong>${pullsNeeded}</strong><br>` +
            `Astrites needed (approx): <strong>${astritesNeeded}</strong><br>` +
            `Estimated probability at ${pullsNeeded} pulls: <strong>${(pEst * 100).toFixed(2)}%</strong><br>` +
            `95% CI: <strong>${(ci.lo * 100).toFixed(2)}%</strong> – <strong>${(ci.hi * 100).toFixed(2)}%</strong>`;
    } catch (e) {
        estimateResult.textContent = 'Estimation failed: ' + (e?.message ?? String(e));
    }
});

// ── Probability Curves ────────────────────────────────────────────────────────
// Returns P(>= k limited copies) per pull, for k = 1..maxLimited.
function simulateCumulative(pullsMax, trials, maxLimited) {
    const countsPerK = Array.from({ length: maxLimited }, () => new Array(pullsMax).fill(0));

    for (let t = 0; t < trials; t++) {
        let failuresSinceLastSuccess = 0;
        let mustAwardLimited         = false;
        let limitedCount             = 0;

        for (let i = 0; i < pullsMax; i++) {
            const p       = pullProbability(failuresSinceLastSuccess + 1);
            const success = (failuresSinceLastSuccess + 1 >= 80) || Math.random() < p;

            if (success) {
                if (mustAwardLimited) {
                    limitedCount++;
                    mustAwardLimited = false;
                } else if (Math.random() < 0.5) {
                    limitedCount++;
                } else {
                    mustAwardLimited = true;
                }
                failuresSinceLastSuccess = 0;
            } else {
                failuresSinceLastSuccess++;
            }

            for (let k = 1; k <= maxLimited; k++) {
                if (limitedCount >= k) countsPerK[k - 1][i]++;
            }
        }
    }

    return countsPerK.map(arr => arr.map(c => c / trials));
}

// ── Canvas Drawing ────────────────────────────────────────────────────────────
function setupCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx       = canvas.getContext('2d');
    const dpr       = window.devicePixelRatio || 1;
    const cssWidth  = canvas.clientWidth || 600;
    const cssHeight = parseInt(getComputedStyle(canvas).height, 10) || 160;
    canvas.width  = Math.floor(cssWidth  * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas, ctx, cssWidth, cssHeight };
}

function drawCumulativeCurves(probsPerK, canvasId) {
    const info = setupCanvas(canvasId);
    if (!info) return;
    const { ctx, cssWidth, cssHeight } = info;
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const padding  = 40;
    const plotW    = cssWidth  - padding * 1.5;
    const plotH    = cssHeight - padding * 1.2;
    const originX  = padding;
    const originY  = cssHeight - padding / 2;
    const pullsMax = probsPerK[0]?.length ?? 1;
    const colors   = ['#e6194b', '#3cb44b', '#ffe119', '#0082c8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#d2f53c', '#fabebe'];

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Axes
    ctx.strokeStyle = '#333';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(originX, originY); ctx.lineTo(originX + plotW, originY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(originX, originY); ctx.lineTo(originX, originY - plotH); ctx.stroke();

    // Y-axis labels + gridlines
    ctx.fillStyle = '#333';
    ctx.font      = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const yVal = i / 5;
        const y    = originY - yVal * plotH;
        ctx.fillText((yVal * 100).toFixed(0) + '%', originX - 6, y + 4);
        ctx.strokeStyle = '#eee';
        ctx.beginPath(); ctx.moveTo(originX, y); ctx.lineTo(originX + plotW, y); ctx.stroke();
    }

    // X-axis labels
    ctx.textAlign = 'center';
    ctx.font      = '10px sans-serif';
    const step = Math.max(1, Math.floor(pullsMax / 8));
    for (let x = 0; x <= pullsMax; x += step) {
        const px = originX + (x / Math.max(1, pullsMax)) * plotW;
        ctx.fillStyle = '#333';
        ctx.fillText(String(x), px, originY + 14);
    }

    // Probability curves
    for (let k = 0; k < probsPerK.length; k++) {
        const arr = probsPerK[k];
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
            const x = originX + (i / Math.max(1, arr.length - 1)) * plotW;
            const y = originY - arr[i] * plotH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = colors[k % colors.length];
        ctx.lineWidth   = 2;
        ctx.stroke();
    }

    // Attach hover tooltip (only once per canvas)
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas._curveData = { probsPerK, originX, originY, plotW, plotH, pullsMax, colors };
    if (!canvas._hasHover) attachCurveTooltip(canvas);
}

function attachCurveTooltip(canvas) {
    canvas._hasHover = true;
    const tooltip    = document.getElementById('sim-curve-tooltip');
    if (!tooltip) return;

    canvas.addEventListener('mousemove', (ev) => {
        const data = canvas._curveData;
        if (!data) { tooltip.style.display = 'none'; return; }
        const { probsPerK, originX, plotW, pullsMax, colors } = data;

        const relX = ev.clientX - canvas.getBoundingClientRect().left - originX;
        if (relX < 0 || relX > plotW) { tooltip.style.display = 'none'; return; }

        const idx = Math.min(pullsMax - 1, Math.max(0, Math.floor((relX / plotW) * pullsMax)));

        let html = `<div style="font-weight:700;margin-bottom:6px;">Pulls: ${idx + 1}</div>`;
        for (let k = 0; k < probsPerK.length; k++) {
            const arr   = probsPerK[k] || [];
            const p     = ((arr[idx] ?? arr.at(-1) ?? 0) * 100).toFixed(2);
            const color = colors[k % colors.length];
            html +=
                `<div style="display:flex;gap:8px;align-items:center;margin:2px 0;">` +
                `<span style="width:10px;height:10px;display:inline-block;background:${color};border-radius:2px;"></span>` +
                `<span>&ge; ${k + 1}:</span>` +
                `<span style="margin-left:auto;font-weight:700;">${p}%</span>` +
                `</div>`;
        }

        tooltip.innerHTML     = html;
        tooltip.style.display = 'block';

        const parentRect = canvas.parentElement.getBoundingClientRect();
        const offsetX    = ev.clientX - parentRect.left;
        const offsetY    = ev.clientY - parentRect.top;
        tooltip.style.left = `${offsetX + 12}px`;
        tooltip.style.top  = `${offsetY + 12}px`;

        // Flip if the tooltip overflows the container edge
        const ttRect = tooltip.getBoundingClientRect();
        if (ttRect.right  > parentRect.right)  tooltip.style.left = `${offsetX - ttRect.width  - 12}px`;
        if (ttRect.bottom > parentRect.bottom) tooltip.style.top  = `${offsetY - ttRect.height - 12}px`;
    });

    canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
}

// ── Plot Button ───────────────────────────────────────────────────────────────
const plotBtn = document.getElementById('plot-curves');
if (plotBtn) plotBtn.addEventListener('click', async () => {
    const pullsMax   = Math.max(1, parseInt(simPullsInput?.value      || '100', 10));
    const maxLimited = Math.max(1, parseInt(targetLimitedInput?.value || '1',   10));

    plotBtn.textContent = 'Working…';
    await new Promise(r => setTimeout(r, 10));
    drawCumulativeCurves(simulateCumulative(pullsMax, 100000, maxLimited), 'sim-curve');
    plotBtn.textContent = 'Calculate';
});
