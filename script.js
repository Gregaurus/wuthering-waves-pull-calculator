const astritesInput = document.getElementById('astrites');
const rTideInput = document.getElementById('rTide');
const rollsResult = document.getElementById('rolls-result');
const astritesResult = document.getElementById('remaining-astrites');
const afterglowResult = document.getElementById('bonus-afterglow');
const pullTable = document.getElementById('pull-table');

const PRESET_KEY = 'rw_preset_v1';
const simPullsInput = document.getElementById('sim-pulls');
const simTrialsInput = document.getElementById('sim-trials');
const runSimBtn = document.getElementById('run-sim');
const simResults = document.getElementById('sim-results');
const targetLimitedInput = document.getElementById('target-limited');
const targetConfidenceInput = document.getElementById('target-confidence');
const estimateBtn = document.getElementById('estimate-astrites');
const estimateResult = document.getElementById('estimate-result');
const simTrialsEstInput = document.getElementById('sim-trials-est');

function updateTableHighlight(rolls) {
    const cells = document.querySelectorAll('td.pull-amount');
    const pullAmounts = Array.from(cells).map(c => parseInt((c.textContent || '').trim(), 10) || 0);
    const maxPull = pullAmounts.length ? Math.max(...pullAmounts) : 0;

    // Highlight individual cells where rolls >= pull amount
    cells.forEach((cell, i) => {
        const amount = pullAmounts[i];
        if (amount > 0 && rolls >= amount) {
            cell.classList.add('highlight');
        } else {
            cell.classList.remove('highlight');
        }
    });

    // If rolls exceed the maximum pull amount, color the whole table
    if (pullTable) {
        if (maxPull > 0 && rolls > maxPull) {
            pullTable.classList.add('table-highlight');
        } else {
            pullTable.classList.remove('table-highlight');
        }
    }
}

function calculateRolls() {
    const astrites = parseFloat(astritesInput.value) || 0;
    const rTide = parseFloat(rTideInput.value) || 0;

    const rolls = Math.floor(astrites / 160) + rTide;
    const remainingAstrites = astrites % 160;

    rollsResult.textContent = rolls;
    astritesResult.textContent = remainingAstrites;
    const afterglow = Math.floor(rolls * 0.6);
    // Format number with thousands separator for cleaner display
    try {
        afterglowResult.textContent = new Intl.NumberFormat().format(afterglow);
    } catch (e) {
        afterglowResult.textContent = String(afterglow);
    }

    updateTableHighlight(rolls);
    // Autosave preset whenever values change
    try {
        const preset = { astrites: astritesInput.value || '', rTide: rTideInput.value || '' };
        localStorage.setItem(PRESET_KEY, JSON.stringify(preset));
    } catch (e) {}
}

astritesInput.addEventListener('input', calculateRolls);
rTideInput.addEventListener('input', calculateRolls);
function loadPreset() {
    try {
        const raw = localStorage.getItem(PRESET_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            if (p.astrites !== undefined) astritesInput.value = p.astrites;
            if (p.rTide !== undefined) rTideInput.value = p.rTide;
        }
    } catch (e) {}
}

// Simulator no longer uses copies select; fixed per-pull probability applied instead.

function runMonteCarlo() {
    const trials = Math.max(1, parseInt(simTrialsInput?.value || '1000', 10));
    const pulls = Math.max(1, parseInt(simPullsInput?.value || '100', 10));
    // Progressive pity curve and base probability
    function pullProbability(pullNumber) {
        // pullNumber: 1-based (1 = first pull after last copy)
        if (pullNumber <= 65) return 0.008;
        if (pullNumber <= 70) {
            // pulls 66-70: increase by 4% (0.04) per additional pull over 65
            return 0.008 + 0.04 * (pullNumber - 65);
        }
        if (pullNumber <= 75) {
            // pulls 71-75: first add the 5 pulls of +4% then +8% per pull over 70
            return 0.008 + 0.04 * 5 + 0.08 * (pullNumber - 70);
        }
        if (pullNumber <= 79) {
            // pulls 76-79: add previous increases then +10% per pull over 75
            return 0.008 + 0.04 * 5 + 0.08 * 5 + 0.10 * (pullNumber - 75);
        }
        // pull 80: guaranteed
        return 1.0;
    }

    let trialsWithAtLeastOne = 0;
    let totalSuccesses = 0;
    let minSuccesses = Infinity;
    let maxSuccesses = -Infinity;
    const distribution = {}; // key: successes, value: count of trials
    const limitedBySuccesses = {}; // key: successes, value: total limited copies across those trials
    // track limited-character stats
    let trialsWithAtLeastOneLimited = 0;
    let totalLimited = 0;
    let minLimited = Infinity;
    let maxLimited = -Infinity;
    const limitedDistribution = {}; // key: limitedThisTrial, value: count of trials

    for (let t = 0; t < trials; t++) {
        let successes = 0;
        let failuresSinceLastSuccess = 0;
        // 50/50 mechanic: if the previous copy failed the 50/50, the next copy is guaranteed
        let mustAwardLimited = false;
        let limitedThisTrial = 0;

        for (let i = 0; i < pulls; i++) {
            const pullNumber = failuresSinceLastSuccess + 1; // 1-based
            const p = pullProbability(pullNumber);

            let success = false;
            if (pullNumber >= 80) {
                success = true;
            } else if (Math.random() < p) {
                success = true;
            }

            if (success) {
                successes++;
                // limited character check
                if (mustAwardLimited) {
                    limitedThisTrial++;
                    mustAwardLimited = false;
                } else {
                    if (Math.random() < 0.5) {
                        limitedThisTrial++;
                        mustAwardLimited = false;
                    } else {
                        mustAwardLimited = true;
                    }
                }

                failuresSinceLastSuccess = 0;
            } else {
                failuresSinceLastSuccess++;
            }
        }

        if (successes > 0) trialsWithAtLeastOne++;
        totalSuccesses += successes;
        totalLimited += limitedThisTrial;
        if (limitedThisTrial > 0) trialsWithAtLeastOneLimited++;
        if (successes < minSuccesses) minSuccesses = successes;
        if (successes > maxSuccesses) maxSuccesses = successes;
        if (limitedThisTrial < minLimited) minLimited = limitedThisTrial;
        if (limitedThisTrial > maxLimited) maxLimited = limitedThisTrial;
        distribution[successes] = (distribution[successes] || 0) + 1;
        limitedBySuccesses[successes] = (limitedBySuccesses[successes] || 0) + limitedThisTrial;
        limitedDistribution[limitedThisTrial] = (limitedDistribution[limitedThisTrial] || 0) + 1;
    }

    const probAtLeastOne = trialsWithAtLeastOne / trials;
    const avgSuccessesPerTrial = totalSuccesses / trials;

    // Build distribution table HTML (includes limited-character columns)
    let tableHtml = 
        // '<div>Estimated probability ± one copy in ' + pulls + ' pulls: <strong>' + (probAtLeastOne*100).toFixed(2) + '%</strong><br>' +
        '<div>Average copies per trial: <strong>' + avgSuccessesPerTrial.toFixed(3) + '</strong><br>' +
        // 'Lowest copies in a trial: <strong>' + (isFinite(minSuccesses) ? minSuccesses : 0) + '</strong><br>' +
        // 'Highest copies in a trial: <strong>' + (isFinite(maxSuccesses) && maxSuccesses >= 0 ? maxSuccesses : 0) + '</strong><br>' +
        // 'Estimated probability of ± 1 limited character in ' + pulls + ' pulls: <strong>' + ((trialsWithAtLeastOneLimited / trials) * 100).toFixed(2) + '%</strong><br>' +
        'Average copies of limited characters per trial: <strong>' + (totalLimited / trials).toFixed(3) + '</strong><br></div>'
        // 'Lowest limited copies in a trial: <strong>' + (isFinite(minLimited) ? minLimited : 0) + '</strong><br>' +
        // 'Highest limited copies in a trial: <strong>' + (isFinite(maxLimited) && maxLimited >= 0 ? maxLimited : 0) + '</strong></div>';

    tableHtml += '<table style="width:100%;border-collapse:collapse;margin-top:8px;">';
    tableHtml += '<thead><tr><th style="border:1px solid #ddd;padding:6px;text-align:left;">Copies</th><th style="border:1px solid #ddd;padding:6px;text-align:right;">Trial (Count)</th><th style="border:1px solid #ddd;padding:6px;text-align:right;">Percentage</th><th style="border:1px solid #ddd;padding:6px;text-align:right;">Limited (total)</th><th style="border:1px solid #ddd;padding:6px;text-align:right;">Limited (avg)</th></tr></thead>';
    tableHtml += '<tbody>';
    const maxKey = Math.max(0, maxSuccesses === -Infinity ? 0 : maxSuccesses);
    for (let c = 0; c <= maxKey; c++) {
        const cnt = distribution[c] || 0;
        const pct = trials > 0 ? (cnt / trials * 100) : 0;
        const limitedTotalForC = limitedBySuccesses[c] || 0;
        const limitedAvgForC = cnt > 0 ? (limitedTotalForC / cnt) : 0;
        tableHtml += '<tr>' +
            '<td style="border:1px solid #ddd;padding:6px;">' + c + '</td>' +
            '<td style="border:1px solid #ddd;padding:6px;text-align:right;">' + cnt + '</td>' +
            '<td style="border:1px solid #ddd;padding:6px;text-align:right;">' + pct.toFixed(2) + '%</td>' +
            '<td style="border:1px solid #ddd;padding:6px;text-align:right;">' + limitedTotalForC + '</td>' +
            '<td style="border:1px solid #ddd;padding:6px;text-align:right;">' + limitedAvgForC.toFixed(3) + '</td>' +
            '</tr>';
    }
    tableHtml += '</tbody></table>';

    simResults.innerHTML = tableHtml;
    try {
        drawHistogramTotal(distribution, 'sim-histogram');
        drawHistogramLimitedDistribution(limitedDistribution, 'sim-histogram-limited');
    } catch (e) {}
}

if (runSimBtn) runSimBtn.addEventListener('click', () => { runMonteCarlo(); });

if (estimateBtn) estimateBtn.addEventListener('click', async () => {
    // read inputs
    const targetLimited = Math.max(0, parseInt(targetLimitedInput?.value || '1', 10));
    const desiredPct = Math.min(99, Math.max(1, parseFloat(targetConfidenceInput?.value || '90')));
    const desiredProb = desiredPct / 100;
    const trialsPerEval = Math.max(100, Math.min(20000, parseInt(simTrialsEstInput?.value || '2000', 10)));

    estimateResult.textContent = 'Estimating... (this may take a moment)';
    try {
        const pullsNeeded = await findMinimalPulls(targetLimited, desiredProb, trialsPerEval);
        if (pullsNeeded === null) {
            estimateResult.innerHTML = 'Could not find required pulls up to limit.';
            return;
        }
        const rTide = parseInt(rTideInput?.value || '0', 10) || 0;
        const extraRollsNeeded = Math.max(0, pullsNeeded - rTide);
        const astritesNeeded = extraRollsNeeded * 160;

        // Final validation run to get probability and CI
        const finalSim = simulateTrials(pullsNeeded, trialsPerEval);
        const successfulTrials = Object.keys(finalSim.limitedDistribution).reduce((acc, k) => {
            const num = parseInt(k, 10);
            if (isNaN(num)) return acc;
            if (num >= targetLimited) return acc + (finalSim.limitedDistribution[k] || 0);
            return acc;
        }, 0);
        const pEst = successfulTrials / finalSim.trials;
        const ci = wilsonInterval(successfulTrials, finalSim.trials, 0.05);

        estimateResult.innerHTML = 'Pulls needed: <strong>' + pullsNeeded + '</strong><br>' +
            'Astrites needed (approx): <strong>' + astritesNeeded + '</strong><br>' +
            'Estimated probability at ' + pullsNeeded + ' pulls: <strong>' + (pEst*100).toFixed(2) + '%</strong><br>' +
            '95% CI: <strong>' + (ci.lo*100).toFixed(2) + '%</strong> – <strong>' + (ci.hi*100).toFixed(2) + '%</strong>';
    } catch (e) {
        estimateResult.textContent = 'Estimation failed: ' + (e && e.message ? e.message : String(e));
    }
});

window.addEventListener('DOMContentLoaded', () => { loadPreset(); calculateRolls(); });

function _setupCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 600;
    const cssHeight = parseInt(getComputedStyle(canvas).height, 10) || 160;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas, ctx, cssWidth, cssHeight };
}

function drawHistogramTotal(distribution, canvasId) {
    const info = _setupCanvas(canvasId);
    if (!info) return;
    const { ctx, cssWidth, cssHeight } = info;
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const keys = Object.keys(distribution).map(k => parseInt(k, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
    const maxKey = keys.length ? Math.max(...keys) : 0;
    const counts = [];
    let maxCount = 1;
    for (let i = 0; i <= maxKey; i++) { const c = distribution[i] || 0; counts.push(c); if (c > maxCount) maxCount = c; }

    const padding = 10; const axisHeight = 20; const drawHeight = cssHeight - padding - axisHeight; const availableWidth = Math.max(20, cssWidth - padding * 2); const barCount = counts.length || 1; const barWidth = availableWidth / barCount;

    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cssWidth, cssHeight);

    for (let i = 0; i < barCount; i++) {
        const cnt = counts[i];
        const h = (cnt / maxCount) * drawHeight;
        const x = padding + i * barWidth;
        const y = padding + (drawHeight - h);
        ctx.fillStyle = '#0477a6'; ctx.fillRect(x + 1, y, Math.max(2, barWidth - 2), h);
        ctx.fillStyle = '#333'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(i), x + barWidth / 2, cssHeight - 6);
    }
    ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(String(maxCount), cssWidth - 6, padding + 10);
}

function drawHistogramAvgLimited(limitedBySuccesses, distribution, canvasId) {
    const info = _setupCanvas(canvasId);
    if (!info) return;
    const { ctx, cssWidth, cssHeight } = info;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    // Build totals per success-count bucket
    const keys = Object.keys(distribution).map(k => parseInt(k, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
    const maxKey = keys.length ? Math.max(...keys) : 0;
    const totals = [];
    let maxTotal = 1;
    for (let i = 0; i <= maxKey; i++) {
        const totalLimited = limitedBySuccesses[i] || 0;
        totals.push(totalLimited);
        if (totalLimited > maxTotal) maxTotal = totalLimited;
    }

    const padding = 10; const axisHeight = 20; const drawHeight = cssHeight - padding - axisHeight; const availableWidth = Math.max(20, cssWidth - padding * 2); const barCount = totals.length || 1; const barWidth = availableWidth / barCount;

    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cssWidth, cssHeight);
    for (let i = 0; i < barCount; i++) {
        const val = totals[i];
        const h = (val / maxTotal) * drawHeight;
        const x = padding + i * barWidth;
        const y = padding + (drawHeight - h);
        ctx.fillStyle = '#a647a6'; ctx.fillRect(x + 1, y, Math.max(2, barWidth - 2), h);
        ctx.fillStyle = '#333'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(i), x + barWidth / 2, cssHeight - 6);
    }
    ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(String(maxTotal), cssWidth - 6, padding + 10);
}

function drawHistogramLimitedDistribution(limitedDistribution, canvasId) {
    const info = _setupCanvas(canvasId);
    if (!info) return;
    const { ctx, cssWidth, cssHeight } = info;
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const keys = Object.keys(limitedDistribution).map(k => parseInt(k, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
    const maxKey = keys.length ? Math.max(...keys) : 0;
    const counts = [];
    let maxCount = 1;
    for (let i = 0; i <= maxKey; i++) {
        const c = limitedDistribution[i] || 0;
        counts.push(c);
        if (c > maxCount) maxCount = c;
    }

    const padding = 10; const axisHeight = 20; const drawHeight = cssHeight - padding - axisHeight; const availableWidth = Math.max(20, cssWidth - padding * 2); const barCount = counts.length || 1; const barWidth = availableWidth / barCount;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cssWidth, cssHeight);

    for (let i = 0; i < barCount; i++) {
        const cnt = counts[i];
        const h = (cnt / maxCount) * drawHeight;
        const x = padding + i * barWidth;
        const y = padding + (drawHeight - h);
        ctx.fillStyle = '#a647a6'; ctx.fillRect(x + 1, y, Math.max(2, barWidth - 2), h);
        ctx.fillStyle = '#333'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(i), x + barWidth / 2, cssHeight - 6);
    }
    ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(String(maxCount), cssWidth - 6, padding + 10);
}

// Simulation helper used by estimator: returns limitedDistribution and trials
function simulateTrials(pulls, trials) {
    const distribution = {};
    const limitedBySuccesses = {};
    const limitedDistribution = {};
    let trialsWithAtLeastOne = 0;
    let totalSuccesses = 0;

    function pullProbability(pullNumber) {
        if (pullNumber <= 65) return 0.008;
        if (pullNumber <= 70) return 0.008 + 0.04 * (pullNumber - 65);
        if (pullNumber <= 75) return 0.008 + 0.04 * 5 + 0.08 * (pullNumber - 70);
        if (pullNumber <= 79) return 0.008 + 0.04 * 5 + 0.08 * 5 + 0.10 * (pullNumber - 75);
        return 1.0;
    }

    for (let t = 0; t < trials; t++) {
        let successes = 0;
        let failuresSinceLastSuccess = 0;
        let mustAwardLimited = false;
        let limitedThisTrial = 0;

        for (let i = 0; i < pulls; i++) {
            const pullNumber = failuresSinceLastSuccess + 1;
            const p = pullProbability(pullNumber);
            let success = false;
            if (pullNumber >= 80) success = true;
            else if (Math.random() < p) success = true;
            if (success) {
                successes++;
                if (mustAwardLimited) { limitedThisTrial++; mustAwardLimited = false; }
                else { if (Math.random() < 0.5) { limitedThisTrial++; mustAwardLimited = false; } else { mustAwardLimited = true; } }
                failuresSinceLastSuccess = 0;
            } else failuresSinceLastSuccess++;
        }

        if (successes > 0) trialsWithAtLeastOne++;
        totalSuccesses += successes;
        distribution[successes] = (distribution[successes] || 0) + 1;
        limitedBySuccesses[successes] = (limitedBySuccesses[successes] || 0) + limitedThisTrial;
        limitedDistribution[limitedThisTrial] = (limitedDistribution[limitedThisTrial] || 0) + 1;
    }

    return { distribution, limitedBySuccesses, limitedDistribution, trials, totalSuccesses, trialsWithAtLeastOne };
}

// Wilson score interval for proportion (two-sided)
function wilsonInterval(k, n, alpha = 0.05) {
    if (n <= 0) return { lo: 0, hi: 0 };
    const z = 1.96; // for 95% by default when alpha = 0.05
    const phat = k / n;
    const denom = 1 + (z*z)/n;
    const center = phat + (z*z)/(2*n);
    const adj = z * Math.sqrt((phat*(1-phat) + (z*z)/(4*n)) / n);
    const lo = Math.max(0, (center - adj) / denom);
    const hi = Math.min(1, (center + adj) / denom);
    return { lo, hi };
}

// Find minimal pulls such that probability of at least `targetLimited` limited copies >= desiredProb
async function findMinimalPulls(targetLimited, desiredProb, trialsPerEval) {
    const MAX_PULLS = 5000;
    if (targetLimited <= 0) return 0;

    // doubling search to find an upper bound
    let lo = 1; let hi = 1;
    while (hi <= MAX_PULLS) {
        const sim = simulateTrials(hi, trialsPerEval);
        // compute prob of at least targetLimited
        const successCount = Object.keys(sim.limitedDistribution).reduce((acc, k) => {
            const num = parseInt(k, 10);
            if (isNaN(num)) return acc;
            if (num >= targetLimited) return acc + (sim.limitedDistribution[k] || 0);
            return acc;
        }, 0);
        const p = successCount / sim.trials;
        if (p >= desiredProb) break;
        lo = hi + 1;
        hi = hi * 2;
        if (hi > MAX_PULLS) hi = MAX_PULLS;
        if (lo > MAX_PULLS) return null;
        // small await to keep UI responsive
        await new Promise(r => setTimeout(r, 10));
    }

    // binary search between lo and hi
    let result = null;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const sim = simulateTrials(mid, trialsPerEval);
        const successCount = Object.keys(sim.limitedDistribution).reduce((acc, k) => {
            const num = parseInt(k, 10);
            if (isNaN(num)) return acc;
            if (num >= targetLimited) return acc + (sim.limitedDistribution[k] || 0);
            return acc;
        }, 0);
        const p = successCount / sim.trials;
        if (p >= desiredProb) { result = mid; hi = mid - 1; }
        else lo = mid + 1;
        await new Promise(r => setTimeout(r, 10));
    }
    return result;
}