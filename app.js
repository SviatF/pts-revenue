(() => {
  "use strict";

  const STORAGE_KEY = "pts_finance_v1";
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
  const shortMonthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const now = new Date();
  const currentMonth = monthKey(now);
  let selectedMonth = currentMonth;
  let currentView = "overview";
  let selectedEmployeeId = "";
  let confirmAction = null;
  let pendingAssignmentRole = "";

  let state = loadState();

  function defaultState() {
    return { version: 2, projects: [], team: [], snapshots: [], monthlySettings: [], closedMonths: [], createdAt: new Date().toISOString() };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function monthKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
  }

  function dateFromMonth(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }

  function shiftMonth(key, delta) {
    const d = dateFromMonth(key);
    d.setMonth(d.getMonth() + delta);
    return monthKey(d);
  }

  function monthLabel(key) {
    return monthFmt.format(dateFromMonth(key));
  }

  function pct(v) {
    return (Number.isFinite(v) ? v : 0).toFixed(1).replace(".0", "") + "%";
  }

  function n(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  }

  function roleLabel(role) {
    return ({ targetologist: "Targetologist", performance: "Performance marketer", lead: "Lead manager" })[role] || role;
  }

  function computeEconomics(revenue, targetSalary, performancePct, leadPct) {
    revenue = Math.max(0, n(revenue));
    targetSalary = Math.max(0, n(targetSalary));
    performancePct = Math.max(0, n(performancePct));
    leadPct = Math.max(0, n(leadPct));
    const performanceBase = Math.max(0, revenue - targetSalary);
    const performanceSalary = performanceBase * performancePct / 100;
    const leadSalary = revenue * leadPct / 100;
    const totalPayroll = targetSalary + performanceSalary + leadSalary;
    const agencyNet = revenue - totalPayroll;
    const margin = revenue > 0 ? agencyNet / revenue * 100 : 0;
    return { revenue, targetSalary, performancePct, performanceBase, performanceSalary, leadPct, leadSalary, totalPayroll, agencyNet, margin };
  }

  function normalizeTargetologists(source = {}) {
    const raw = Array.isArray(source.targetologists) ? source.targetologists : [];
    let result = raw.map(item => ({
      memberId: item?.memberId || item?.targetologistId || "",
      salary: Math.max(0, n(item?.salary ?? item?.targetSalary))
    })).filter(item => item.memberId || item.salary > 0);

    if (!result.length && (source.targetologistId || n(source.targetSalary) > 0)) {
      result = [{
        memberId: source.targetologistId || "",
        salary: Math.max(0, n(source.targetSalary))
      }];
    }
    return result;
  }

  function totalTargetSalary(source = {}) {
    return normalizeTargetologists(source).reduce((sum, item) => sum + n(item.salary), 0);
  }

  function financeFields(source = {}) {
    const targetologists = normalizeTargetologists(source);
    const targetSalary = targetologists.reduce((sum, item) => sum + n(item.salary), 0);
    return {
      monthlyFee: n(source.monthlyFee),
      targetologists,
      targetSalary,
      targetologistId: targetologists[0]?.memberId || "",
      performancePct: n(source.performancePct),
      leadPct: n(source.leadPct),
      performanceId: source.performanceId || "",
      leadManagerId: source.leadManagerId || ""
    };
  }

  function ensureProjectBaseline(project) {
    if (!project || state.monthlySettings.some(s => s.projectId === project.id)) return;
    state.monthlySettings.push({
      id: uid("terms"),
      projectId: project.id,
      effectiveMonth: project.startMonth || currentMonth,
      ...financeFields(project),
      createdAt: project.createdAt || new Date().toISOString()
    });
  }

  function settingsForProjectMonth(project, month) {
    const history = state.monthlySettings
      .filter(s => s.projectId === project.id && s.effectiveMonth <= month)
      .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
    const effective = history.length ? history[history.length - 1] : null;
    return effective ? { ...project, ...effective } : { ...project };
  }

  function upsertProjectSettings(projectId, effectiveMonth, values) {
    const idx = state.monthlySettings.findIndex(s => s.projectId === projectId && s.effectiveMonth === effectiveMonth);
    const record = {
      id: idx >= 0 ? state.monthlySettings[idx].id : uid("terms"),
      projectId,
      effectiveMonth,
      ...financeFields(values),
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) state.monthlySettings[idx] = { ...state.monthlySettings[idx], ...record };
    else state.monthlySettings.push(record);
    return record;
  }

  function projectToRow(project, paymentStatus = "paid", month = selectedMonth) {
    const terms = settingsForProjectMonth(project, month);
    const targetologists = normalizeTargetologists(terms);
    const targetSalary = targetologists.reduce((sum, item) => sum + n(item.salary), 0);
    const e = computeEconomics(terms.monthlyFee, targetSalary, terms.performancePct, terms.leadPct);
    return {
      id: "live_" + project.id,
      projectId: project.id,
      projectName: project.name,
      month,
      paymentStatus,
      targetologists,
      targetologistId: targetologists[0]?.memberId || "",
      performanceId: terms.performanceId || "",
      leadManagerId: terms.leadManagerId || "",
      effectiveMonth: terms.effectiveMonth || project.startMonth || month,
      ...e
    };
  }

  function activeForMonth(project, month) {
    if (project.startMonth && project.startMonth > month) return false;
    if (project.inactiveFrom && month >= project.inactiveFrom) return false;

    if (project.status === "churned") {
      if (project.inactiveFrom) return month < project.inactiveFrom;
      return state.snapshots.some(s => s.projectId === project.id && s.month === month);
    }

    return project.status === "active";
  }

  function rowsForMonth(month) {
    const snaps = state.snapshots.filter(s => s.month === month);
    if (state.closedMonths.includes(month)) return snaps;

    const snapshotByProject = new Map(snaps.map(s => [s.projectId, s]));
    return state.projects
      .filter(p => activeForMonth(p, month))
      .map(p => {
        const saved = snapshotByProject.get(p.id);
        if (saved?.manualOverride) return saved;
        return projectToRow(p, saved?.paymentStatus || "paid", month);
      });
  }

  function metrics(rows) {
    const revenue = rows.reduce((a, r) => a + n(r.revenue), 0);
    const target = rows.reduce((a, r) => a + n(r.targetSalary), 0);
    const performance = rows.reduce((a, r) => a + n(r.performanceSalary), 0);
    const lead = rows.reduce((a, r) => a + n(r.leadSalary), 0);
    const payroll = rows.reduce((a, r) => a + n(r.totalPayroll), 0);
    const net = rows.reduce((a, r) => a + n(r.agencyNet), 0);
    const collected = rows.filter(r => r.paymentStatus === "paid").reduce((a, r) => a + n(r.revenue), 0);
    return {
      revenue, target, performance, lead, payroll, net, collected,
      margin: revenue ? net / revenue * 100 : 0,
      avg: rows.length ? revenue / rows.length : 0,
      count: rows.length
    };
  }

  function change(curr, prev) {
    if (!prev) return null;
    return (curr - prev) / Math.abs(prev) * 100;
  }

  function changeHtml(value, suffix = " vs previous month") {
    if (value === null || !Number.isFinite(value)) return "No previous month data";
    const cls = value >= 0 ? "positive" : "negative";
    const sign = value >= 0 ? "+" : "";
    return '<span class="' + cls + '">' + sign + pct(value) + "</span>" + suffix;
  }

  function getMember(id) {
    return state.team.find(x => x.id === id);
  }

  function salaryForMemberRow(row, memberId) {
    let salary = 0;
    const roles = [];

    const targets = normalizeTargetologists(row);
    const targetSalaryForMember = targets
      .filter(item => item.memberId === memberId)
      .reduce((sum, item) => sum + n(item.salary), 0);
    if (targets.some(item => item.memberId === memberId)) {
      salary += targetSalaryForMember;
      roles.push("Targetologist");
    }

    if (row.performanceId === memberId) {
      salary += n(row.performanceSalary);
      roles.push("Performance");
    }
    if (row.leadManagerId === memberId) {
      salary += n(row.leadSalary);
      roles.push("Lead manager");
    }
    return { salary, roles };
  }

  function memberMonthStats(memberId, month) {
    const rows = rowsForMonth(month);
    const assigned = rows.map(row => ({ row, ...salaryForMemberRow(row, memberId) })).filter(x => x.salary > 0 || x.roles.length);
    const salary = assigned.reduce((a, x) => a + x.salary, 0);
    const revenue = assigned.reduce((a, x) => a + n(x.row.revenue), 0);
    return { salary, revenue, count: assigned.length, assigned };
  }

  function snapshotMonth(month) {
    const existing = state.snapshots.filter(s => s.month !== month);
    const liveRows = state.projects.filter(p => activeForMonth(p, month)).map(p => {
      const old = state.snapshots.find(s => s.month === month && s.projectId === p.id);
      if (old?.manualOverride) return { ...old };
      const row = projectToRow(p, old?.paymentStatus || "paid", month);
      return {
        ...row,
        id: old?.id || uid("snap"),
        manualOverride: false
      };
    });
    state.snapshots = [...existing, ...liveRows];
    if (!state.closedMonths.includes(month)) state.closedMonths.push(month);
    saveState();
  }

  function ensureSnapshot(month, projectId) {
    let snap = state.snapshots.find(s => s.month === month && s.projectId === projectId);
    if (snap) return snap;
    const p = state.projects.find(x => x.id === projectId);
    if (!p) return null;
    snap = {
      ...projectToRow(p, "paid", month),
      id: uid("snap")
    };
    state.snapshots.push(snap);
    return snap;
  }

  function showToast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function showConfirm(title, text, action, okLabel = "Confirm") {
    $("#confirmTitle").textContent = title;
    $("#confirmText").textContent = text;
    $("#confirmOk").textContent = okLabel;
    confirmAction = action;
    $("#confirmDialog").hidden = false;
  }

  function hideConfirm() {
    $("#confirmDialog").hidden = true;
    confirmAction = null;
  }

  function setView(view) {
    currentView = view;
    $$(".view").forEach(x => x.classList.toggle("active", x.id === "view-" + view));
    $$(".nav-item[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === view));
    const titles = { overview: "Overview", projects: "Projects", team: "Team", compensation: "Compensation", analytics: "Analytics" };
    $("#pageTitle").textContent = titles[view] || "PTS Finance";
    $("#sidebar").classList.remove("open");
    render();
  }

  function miniSparkline(container, values, color = "#ff2f92") {
    const el = typeof container === "string" ? $(container) : container;
    if (!el) return;
    const vals = values.map(n);
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const range = Math.max(1, max - min);
    const pts = vals.map((v, i) => {
      const x = 3 + (i / Math.max(1, vals.length - 1)) * 54;
      const y = 25 - ((v - min) / range) * 19;
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    el.innerHTML = '<svg viewBox="0 0 60 30" aria-hidden="true"><defs><filter id="sparkGlow"><feGaussianBlur stdDeviation="1.6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#sparkGlow)"/><circle cx="57" cy="' + (pts.split(" ").pop()?.split(",")[1] || 10) + '" r="1.8" fill="' + color + '"/></svg>';
  }

  function lineChart(container, series, options = {}) {
    const el = typeof container === "string" ? $(container) : container;
    if (!el) return;
    const hasData = series.some(s => s.values.some(v => n(v) !== 0));
    if (!hasData) {
      el.innerHTML = '<div class="chart-empty">Close at least one month to build historical analytics.</div>';
      return;
    }
    const width = 900, height = options.height || 280;
    const pad = { l: 30, r: 12, t: 20, b: 32 };
    const values = series.flatMap(s => s.values.map(n));
    const min = options.min ?? Math.min(0, ...values);
    const maxRaw = Math.max(...values, options.max ?? 0);
    const max = maxRaw === min ? min + 1 : maxRaw;
    const x = i => pad.l + (i / Math.max(1, (series[0].labels.length - 1))) * (width - pad.l - pad.r);
    const y = v => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
    const grid = [0, .25, .5, .75, 1].map(t => {
      const gy = pad.t + t * (height - pad.t - pad.b);
      return '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (width - pad.r) + '" y2="' + gy + '" stroke="rgba(255,255,255,.06)" stroke-width="1"/>';
    }).join("");
    const labels = series[0].labels.map((lab, i) => '<text x="' + x(i) + '" y="' + (height - 7) + '" fill="#555" font-size="9" text-anchor="middle">' + esc(lab) + "</text>").join("");
    const paths = series.map((s, si) => {
      const d = s.values.map((v, i) => (i ? "L" : "M") + x(i).toFixed(2) + " " + y(n(v)).toFixed(2)).join(" ");
      const stroke = s.stroke || (si === 0 ? "#ff2f92" : "#b5beca");
      const glow = si === 0 ? ' filter="url(#pinkGlow)"' : "";
      const dots = s.values.map((v, i) => '<circle cx="' + x(i) + '" cy="' + y(n(v)) + '" r="' + (si === 0 ? 2.8 : 2.2) + '" fill="' + stroke + '"' + glow + '><title>' + esc(s.name) + ": " + esc(options.percent ? pct(n(v)) : money.format(n(v))) + "</title></circle>").join("");
      return '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + (si === 0 ? 2.1 : 1.6) + '" stroke-linecap="round" stroke-linejoin="round"' + glow + '/>' + dots;
    }).join("");
    el.innerHTML = '<svg viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none" role="img"><defs><filter id="pinkGlow"><feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' + grid + labels + paths + "</svg>";
  }

  function renderOverview() {
    const rows = rowsForMonth(selectedMonth);
    const m = metrics(rows);
    const prev = metrics(rowsForMonth(shiftMonth(selectedMonth, -1)));
    $("#overviewMonthName").textContent = monthLabel(selectedMonth);
    const locked = state.closedMonths.includes(selectedMonth);
    $("#monthStateBadge").textContent = locked ? "CLOSED" : "LIVE";
    $("#monthStateBadge").classList.toggle("locked", locked);
    $("#monthStatusText").textContent = locked ? "Frozen monthly snapshot" : "Live calculation from active projects";
    $("#closeMonthBtn").textContent = locked ? "Month closed" : "Close month";
    $("#closeMonthBtn").disabled = locked;

    $("#kpiRevenue").textContent = money.format(m.revenue);
    $("#kpiNet").textContent = money.format(m.net);
    $("#kpiPayroll").textContent = money.format(m.payroll);
    $("#kpiMargin").textContent = pct(m.margin);
    $("#kpiProjects").textContent = m.count;
    $("#kpiAvg").textContent = money.format(m.avg);
    $("#kpiRevenueChange").innerHTML = changeHtml(change(m.revenue, prev.revenue));
    $("#kpiNetChange").innerHTML = changeHtml(change(m.net, prev.net));
    $("#kpiPayrollRatio").textContent = pct(m.revenue ? m.payroll / m.revenue * 100 : 0) + " of revenue";
    const marginDelta = prev.revenue ? m.margin - prev.margin : null;
    $("#kpiMarginChange").innerHTML = marginDelta === null
      ? "No previous month data"
      : '<span class="' + (marginDelta >= 0 ? "positive" : "negative") + '">' + (marginDelta >= 0 ? "+" : "") + marginDelta.toFixed(1) + ' pts</span> vs previous month';
    $("#collectedRevenue").textContent = money.format(m.collected);

    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(selectedMonth, i - 11));
    const history = months.map(k => metrics(rowsForMonth(k)));
    lineChart("#revenueChart", [
      { name: "Revenue", labels: months.map(k => shortMonthFmt.format(dateFromMonth(k))), values: history.map(x => x.revenue), stroke: "#ff2f92" },
      { name: "Net profit", labels: months.map(k => shortMonthFmt.format(dateFromMonth(k))), values: history.map(x => x.net), stroke: "#b8c0cc" }
    ]);

    miniSparkline("#sparkRevenue", history.slice(-7).map(x => x.revenue), "#18f28d");
    miniSparkline("#sparkNet", history.slice(-7).map(x => x.net), "#18f28d");
    miniSparkline("#sparkPayroll", history.slice(-7).map(x => x.payroll), "#ff2f92");
    miniSparkline("#sparkMargin", history.slice(-7).map(x => x.margin), "#18f28d");
    miniSparkline("#sparkProjects", months.slice(-7).map(k => rowsForMonth(k).length), "#ff2f92");
    miniSparkline("#sparkAvg", history.slice(-7).map(x => x.avg), "#18f28d");

    const parts = [
      { key: "target", name: "Targetologists", value: m.target, cls: "target", dot: "#ff2f92" },
      { key: "performance", name: "Performance", value: m.performance, cls: "performance", dot: "#9357ff" },
      { key: "lead", name: "Lead managers", value: m.lead, cls: "lead", dot: "#37b9ff" },
      { key: "net", name: "Agency net", value: m.net, cls: "net", dot: "#17e78a" }
    ];
    const rawPcts = parts.map(p => Math.max(0, m.revenue ? p.value / m.revenue * 100 : 0));
    const a = rawPcts[0], b = a + rawPcts[1], d = b + rawPcts[2], e = Math.min(100, d + rawPcts[3]);
    $("#costStack").style.background = 'conic-gradient(#ff2f92 0 ' + a + '%, #9357ff ' + a + '% ' + b + '%, #37b9ff ' + b + '% ' + d + '%, #17e78a ' + d + '% ' + e + '%, #1a1e25 ' + e + '% 100%)';
    $("#costStack").innerHTML = '<div class="donut-center"><strong>' + money.format(m.revenue).replace(".00","") + '</strong><span>Total revenue</span></div>';
    $("#costBreakdown").innerHTML = parts.map(p => '<div class="breakdown-row"><i class="breakdown-dot" style="background:' + p.dot + ';box-shadow:0 0 12px ' + p.dot + '55"></i><span class="breakdown-name">' + p.name + '</span><strong class="breakdown-value">' + money.format(p.value) + '</strong><span class="breakdown-pct">' + pct(m.revenue ? p.value / m.revenue * 100 : 0) + "</span></div>").join("");
    $("#costMonthChip").textContent = monthLabel(selectedMonth);

    const top = [...rows].sort((a,b) => b.agencyNet - a.agencyNet).slice(0,5);
    $("#topProjects").innerHTML = top.length ? top.map((r,i) => '<div class="rank-row"><span class="rank-index">0' + (i+1) + '</span><div class="rank-name"><strong>' + esc(r.projectName) + '</strong><span>' + pct(r.margin) + ' margin</span></div><strong class="rank-value">' + money.format(r.agencyNet) + "</strong></div>").join("") : '<div class="empty-inline">No projects yet.</div>';

    $("#overviewProjectsTable").innerHTML = rows.length ? rows.map(r => '<tr><td><div class="project-name-cell"><span class="project-initial">' + esc(initials(r.projectName)) + '</span><strong>' + esc(r.projectName) + '</strong></div></td><td>' + money.format(r.revenue) + '</td><td>' + money.format(r.totalPayroll) + '</td><td><strong>' + money.format(r.agencyNet) + '</strong></td><td>' + pct(r.margin) + '</td><td><select class="payment-select payment-' + esc(r.paymentStatus) + '" data-payment-project="' + esc(r.projectId) + '"><option value="paid"' + (r.paymentStatus==="paid"?" selected":"") + '>Paid</option><option value="pending"' + (r.paymentStatus==="pending"?" selected":"") + '>Pending</option><option value="overdue"' + (r.paymentStatus==="overdue"?" selected":"") + ">Overdue</option></select></td></tr>").join("") : '<tr><td colspan="6" class="muted">No projects in this month.</td></tr>';

    $("#sideTeamPayroll").textContent = money.format(m.payroll);
    $("#sideTeamCount").textContent = state.team.length + " team members";
    $("#sideAvgSalary").textContent = money.format(state.team.length ? m.payroll / state.team.length : 0);
    $("#sideMargin").textContent = pct(m.margin);
    $("#sideMarginDelta").innerHTML = marginDelta === null ? "No prior month" : '<span class="' + (marginDelta >= 0 ? "positive" : "negative") + '">' + (marginDelta >= 0 ? "↑ " : "↓ ") + Math.abs(marginDelta).toFixed(1) + 'pp</span>';
    $("#sideRunRate").textContent = money.format(m.revenue * 12);
    $("#sideRunRateDelta").textContent = "Annualized current MRR";
  }

  function renderProjects() {
    const filter = $("#projectStatusFilter").value;
    let projects = [...state.projects];
    if (filter !== "all") projects = projects.filter(p => p.status === filter);
    const activeRows = rowsForMonth(selectedMonth);
    const m = metrics(activeRows);
    $("#projectMrr").textContent = money.format(m.revenue);
    $("#projectNet").textContent = money.format(m.net);
    $("#projectMargin").textContent = pct(m.margin);
    $("#projectCount").textContent = state.projects.length;

    $("#projectsEmpty").hidden = state.projects.length > 0;
    $("#projectsTable").innerHTML = projects.map(p => {
      const terms = settingsForProjectMonth(p, selectedMonth);
      const targetologists = normalizeTargetologists(terms);
      const targetSalary = targetologists.reduce((sum,item)=>sum+n(item.salary),0);
      const e = computeEconomics(terms.monthlyFee,targetSalary,terms.performancePct,terms.leadPct);
      const performance = getMember(terms.performanceId);
      const lead = getMember(terms.leadManagerId);
      const roleCell = (member, salary, detail = "") =>
        '<div class="project-role-person"><strong>' + esc(member?.name || "Unassigned") + '</strong><span>' + money.format(salary) + (detail ? ' · ' + detail : '') + '</span></div>';
      const targetCell = targetologists.length
        ? '<div class="project-target-list">' + targetologists.map(item => {
            const member = getMember(item.memberId);
            return '<div class="project-role-person"><strong>' + esc(member?.name || "Unassigned") + '</strong><span>' + money.format(item.salary) + ' · fixed</span></div>';
          }).join("") + '<div class="target-total-line">Total ' + money.format(targetSalary) + '</div></div>'
        : '<div class="project-role-person"><strong>Unassigned</strong><span>' + money.format(0) + '</span></div>';
      const ended = Boolean(p.inactiveFrom && selectedMonth >= p.inactiveFrom);
      const ending = Boolean(p.inactiveFrom && selectedMonth < p.inactiveFrom);
      const statusLabel = ended ? "ended" : (ending ? "ending" : p.status);
      const statusSub = p.inactiveFrom
        ? '<span class="project-end-note">' + (ended ? 'Ended from ' : 'Ends from ') + esc(monthLabel(p.inactiveFrom)) + '</span>'
        : '';
      return '<tr><td><div class="project-name-cell"><span class="project-initial">' + esc(initials(p.name)) + '</span><div><strong>' + esc(p.name) + '</strong><br><span class="status-pill ' + esc(statusLabel) + '">' + esc(statusLabel) + '</span>' + statusSub + '</div></div></td><td><strong>' + money.format(e.revenue) + '</strong></td><td>' + targetCell + '</td><td>' + roleCell(performance,e.performanceSalary,pct(e.performancePct)) + '</td><td>' + roleCell(lead,e.leadSalary,pct(e.leadPct)) + '</td><td>' + money.format(e.totalPayroll) + '</td><td><strong>' + money.format(e.agencyNet) + '</strong></td><td>' + pct(e.margin) + '</td><td><div class="row-actions"><button class="small-icon-btn" data-edit-project="' + p.id + '" aria-label="Edit">···</button></div></td></tr>';
    }).join("");
  }

  function teamMemberCard(member) {
    const s = memberMonthStats(member.id, selectedMonth);
    return '<article class="team-card" data-member-card="' + member.id + '"><div class="team-card-top"><span class="avatar">' + esc(initials(member.name)) + '</span><div class="team-card-name"><strong>' + esc(member.name) + '</strong><span>' + esc(roleLabel(member.role)) + '</span></div><button class="small-icon-btn" style="margin-left:auto" data-edit-member="' + member.id + '">···</button></div><div class="team-card-pay"><div><span>Salary this month</span><strong>' + money.format(s.salary) + '</strong></div><div><span>Projects</span><strong>' + s.count + '</strong></div></div></article>';
  }

  function renderTeam() {
    const groups = [
      ["targetologist","#targetologistCards"],
      ["performance","#performanceCards"],
      ["lead","#leadCards"]
    ];

    groups.forEach(([role, selector]) => {
      const members = state.team.filter(m => m.role === role);
      $(selector).innerHTML = members.length
        ? members.map(teamMemberCard).join("")
        : '<div class="role-empty">No ' + esc(roleLabel(role).toLowerCase()) + ' added yet.</div>';
    });

    $("#teamCards").innerHTML = "";

    const select = $("#employeeSelect");
    const current = selectedEmployeeId || select.value;
    select.innerHTML = '<option value="">Select member</option>' + state.team.map(m => '<option value="' + m.id + '">' + esc(m.name) + " · " + esc(roleLabel(m.role)) + "</option>").join("");
    if (state.team.some(m => m.id === current)) select.value = current;
    selectedEmployeeId = select.value;

    if (!selectedEmployeeId) {
      $("#employeeAnalyticsEmpty").hidden = false;
      $("#employeeAnalytics").hidden = true;
      $("#employeeAnalyticsTitle").textContent = "Select a team member";
      return;
    }

    const member = getMember(selectedEmployeeId);
    const stats = memberMonthStats(selectedEmployeeId, selectedMonth);
    const prev = memberMonthStats(selectedEmployeeId, shiftMonth(selectedMonth,-1));
    const ch = change(stats.salary, prev.salary);
    $("#employeeAnalyticsEmpty").hidden = true;
    $("#employeeAnalytics").hidden = false;
    $("#employeeAnalyticsTitle").textContent = member.name + " · " + roleLabel(member.role);
    $("#employeeSalary").textContent = money.format(stats.salary);
    $("#employeeProjectsCount").textContent = stats.count;
    $("#employeeRevenue").textContent = money.format(stats.revenue);
    $("#employeeChange").innerHTML = ch === null ? "—" : '<span class="' + (ch>=0?"positive":"negative") + '">' + (ch>=0?"+":"") + pct(ch) + "</span>";

    const months = Array.from({length:12},(_,i)=>shiftMonth(selectedMonth,i-11));
    const values = months.map(k => memberMonthStats(selectedEmployeeId,k).salary);
    lineChart("#employeeSalaryChart", [{ name:"Salary", labels:months.map(k=>shortMonthFmt.format(dateFromMonth(k))), values, stroke:"#ff2f92" }]);

    $("#employeeProjectRows").innerHTML = stats.assigned.length ? stats.assigned.map(x => '<tr><td><strong>' + esc(x.row.projectName) + '</strong></td><td>' + esc(x.roles.join(", ")) + '</td><td><strong>' + money.format(x.salary) + '</strong></td><td>' + money.format(x.row.revenue) + "</td></tr>").join("") : '<tr><td colspan="4" class="muted">No assigned projects in this month.</td></tr>';
  }

  function renderCompensation() {
    const rows = rowsForMonth(selectedMonth);
    const m = metrics(rows);
    $("#compensationMonthTitle").textContent = monthLabel(selectedMonth);
    $("#compPayroll").textContent = money.format(m.payroll);
    $("#compTarget").textContent = money.format(m.target);
    $("#compPerformance").textContent = money.format(m.performance);
    $("#compLead").textContent = money.format(m.lead);

    $("#compensationTable").innerHTML = rows.length ? rows.map(r => {
      const project = state.projects.find(p => p.id === r.projectId);
      const saved = state.snapshots.find(s => s.month === selectedMonth && s.projectId === r.projectId);
      const source = saved?.manualOverride ? "Monthly override" : (state.closedMonths.includes(selectedMonth) ? "Closed snapshot" : "Default rates");
      const sourceClass = saved?.manualOverride ? "positive" : "muted";
      return '<tr><td><strong>' + esc(r.projectName) + '</strong></td><td>' + money.format(r.revenue) + '</td><td>' + money.format(r.targetSalary) + ' <span class="muted">· ' + normalizeTargetologists(r).length + ' ppl</span></td><td>' + pct(r.performancePct) + ' <span class="muted">(' + money.format(r.performanceSalary) + ')</span></td><td>' + pct(r.leadPct) + ' <span class="muted">(' + money.format(r.leadSalary) + ')</span></td><td><strong>' + money.format(r.totalPayroll) + '</strong></td><td>' + money.format(r.agencyNet) + '</td><td><span class="' + sourceClass + '">' + source + '</span></td><td><div class="row-actions">' + (project ? '<button class="small-icon-btn rate-action" data-edit-default="' + esc(r.projectId) + '" title="Edit default project rates">Default</button>' : '') + '<button class="small-icon-btn rate-action" data-adjust-project="' + esc(r.projectId) + '" title="Correct selected month">Month</button></div></td></tr>';
    }).join("") : '<tr><td colspan="9" class="muted">No project data in this month.</td></tr>';
  }

  function renderAnalytics() {
    const rows = rowsForMonth(selectedMonth);
    const m = metrics(rows);
    const months = Array.from({length:12},(_,i)=>shiftMonth(selectedMonth,i-11));
    const hist = months.map(k=>metrics(rowsForMonth(k)));
    lineChart("#marginChart", [{ name:"Margin", labels:months.map(k=>shortMonthFmt.format(dateFromMonth(k))), values:hist.map(x=>x.margin), stroke:"#f4f4f4" }], {percent:true, min:0, max:100});

    $("#ratioPayroll").textContent = pct(m.revenue ? m.payroll/m.revenue*100 : 0);
    $("#ratioNet").textContent = pct(m.margin);
    $("#ratioRevenuePerson").textContent = money.format(state.team.length ? m.revenue/state.team.length : 0);
    const top5Revenue = [...rows].sort((a,b)=>b.revenue-a.revenue).slice(0,5).reduce((a,r)=>a+r.revenue,0);
    $("#ratioConcentration").textContent = pct(m.revenue ? top5Revenue/m.revenue*100 : 0);

    const maxRole = Math.max(m.target,m.performance,m.lead,1);
    const roleItems = [["Targetologists",m.target],["Performance",m.performance],["Lead managers",m.lead]];
    $("#rolePayroll").innerHTML = roleItems.map(([name,val]) => '<div class="bar-row"><div class="bar-row-head"><span>' + name + '</span><strong>' + money.format(val) + '</strong></div><div class="bar-track"><div class="bar-fill" style="width:' + (val/maxRole*100) + '%"></div></div></div>').join("");

    const low = [...rows].sort((a,b)=>a.margin-b.margin).slice(0,5);
    $("#lowMarginProjects").innerHTML = low.length ? low.map((r,i)=>'<div class="rank-row"><span class="rank-index">0'+(i+1)+'</span><div class="rank-name"><strong>'+esc(r.projectName)+'</strong><span>'+money.format(r.agencyNet)+' net</span></div><strong class="rank-value">'+pct(r.margin)+'</strong></div>').join("") : '<div class="empty-inline">No project data.</div>';

    $("#forecastMrr").textContent = money.format(m.revenue);
    $("#forecastRevenue").textContent = money.format(m.revenue*12);
    $("#forecastNet").textContent = money.format(m.net*12);
    $("#forecastMargin").textContent = pct(m.margin);
  }

  function render() {
    $("#monthPicker").value = selectedMonth;
    if (currentView === "overview") renderOverview();
    if (currentView === "projects") renderProjects();
    if (currentView === "team") renderTeam();
    if (currentView === "compensation") renderCompensation();
    if (currentView === "analytics") renderAnalytics();
  }

  function targetologistOptions(selectedId = "") {
    const members = state.team.filter(m => m.role === "targetologist" || m.id === selectedId);
    return '<option value="">Unassigned</option>' + members.map(m =>
      '<option value="' + m.id + '"' + (m.id === selectedId ? ' selected' : '') + '>' + esc(m.name) + '</option>'
    ).join("");
  }

  function renderTargetologistRows(containerSelector, targetologists = [], scope = "project") {
    const container = $(containerSelector);
    if (!container) return;
    const rows = targetologists.length ? targetologists : [{ memberId:"", salary:0 }];
    container.innerHTML = rows.map((item,index) =>
      '<div class="targetologist-assignment-row" data-target-scope="' + scope + '" data-target-index="' + index + '">' +
        '<label><span>Person</span><select class="target-person-select">' + targetologistOptions(item.memberId) + '</select></label>' +
        '<label><span>Fixed salary, $</span><input class="target-salary-input" type="number" min="0" step="0.01" value="' + n(item.salary) + '" placeholder="250" /></label>' +
        '<button type="button" class="remove-targetologist-btn" data-remove-targetologist="' + scope + '" data-target-index="' + index + '" title="Remove targetologist" aria-label="Remove targetologist">×</button>' +
      '</div>'
    ).join("");
  }

  function readTargetologistRows(containerSelector, includeEmpty = false) {
    const container = $(containerSelector);
    if (!container) return [];
    const rows = $(".targetologist-assignment-row", container).map(row => ({
      memberId: $(".target-person-select", row)?.value || "",
      salary: Math.max(0, n($(".target-salary-input", row)?.value))
    }));
    return includeEmpty ? rows : rows.filter(item => item.memberId || item.salary > 0);
  }

  function addTargetologistRow(containerSelector, scope, preset = {}) {
    const current = readTargetologistRows(containerSelector,true);
    current.push({ memberId:preset.memberId || "", salary:n(preset.salary) });
    renderTargetologistRows(containerSelector,current,scope);
  }

  function removeTargetologistRow(containerSelector, scope, index) {
    const current = readTargetologistRows(containerSelector,true);
    current.splice(Number(index),1);
    renderTargetologistRows(containerSelector,current.length ? current : [{memberId:"",salary:0}],scope);
  }

  function populateAssignmentSelects(project = {}) {
    renderTargetologistRows("#targetologistRows", normalizeTargetologists(project), "project");
    const mapping = [
      ["#performanceId","performance",project.performanceId],
      ["#leadManagerId","lead",project.leadManagerId]
    ];
    mapping.forEach(([selector,role,value])=>{
      const el=$(selector);
      const members=state.team.filter(m=>m.role===role || m.id===value);
      el.innerHTML='<option value="">Unassigned</option>'+members.map(m=>'<option value="'+m.id+'">'+esc(m.name)+'</option>').join("");
      el.value=value||"";
    });
  }

  function openProjectModal(projectId = "") {
    const p = state.projects.find(x=>x.id===projectId);
    const terms = p ? settingsForProjectMonth(p, selectedMonth) : {};
    $("#projectModal").hidden=false;
    $("#projectModalTitle").textContent=p?("Edit project · " + monthLabel(selectedMonth)):"Add project";
    $("#projectId").value=p?.id||"";
    $("#projectName").value=p?.name||"";
    $("#projectRevenue").value=p ? n(terms.monthlyFee) : "";
    $("#performancePct").value=p ? n(terms.performancePct) : "";
    $("#leadPct").value=p ? n(terms.leadPct) : "";
    $("#projectStatus").value=p?.status||"active";
    $("#endCollaborationBtn").hidden=!p;
    if(p?.inactiveFrom){
      $("#endCollaborationBtn").textContent="Collaboration ended";
      $("#endCollaborationBtn").disabled=true;
    }else{
      $("#endCollaborationBtn").textContent="End collaboration";
      $("#endCollaborationBtn").disabled=false;
    }
    $("#projectStartMonth").value=p?.startMonth||selectedMonth;
    populateAssignmentSelects(p ? terms : {});
    const effectiveMonth = p
      ? (selectedMonth < (p.startMonth || selectedMonth) ? (p.startMonth || selectedMonth) : selectedMonth)
      : ($("#projectStartMonth").value || selectedMonth);
    $("#projectEffectiveMonth").textContent = monthLabel(effectiveMonth);
    $("#projectTermsHelp").textContent = p
      ? "Changes start from this month. Earlier months keep their original revenue, rates and team."
      : "These are the starting terms for the project.";
    $("#deleteProjectBtn").hidden=!p;
    updateLiveModel();
    setTimeout(()=>$("#projectName").focus(),0);
  }

  function closeProjectModal(){ $("#projectModal").hidden=true; }

  function updateLiveModel() {
    const targetologists = readTargetologistRows("#targetologistRows");
    const targetSalary = targetologists.reduce((sum,item)=>sum+n(item.salary),0);
    const e=computeEconomics($("#projectRevenue").value,targetSalary,$("#performancePct").value,$("#leadPct").value);
    $("#modelRevenue").textContent=money2.format(e.revenue);
    $("#modelTarget").textContent="−"+money2.format(e.targetSalary);
    $("#modelPerformance").textContent="−"+money2.format(e.performanceSalary);
    $("#modelLead").textContent="−"+money2.format(e.leadSalary);
    $("#modelPayroll").textContent=money2.format(e.totalPayroll);
    $("#modelNet").textContent=money2.format(e.agencyNet);
    $("#modelMargin").textContent=pct(e.margin)+" margin";
    $("#modelFormula").textContent="Performance = ("+money2.format(e.revenue)+" − "+money2.format(e.targetSalary)+") × "+pct(e.performancePct)+" = "+money2.format(e.performanceSalary);
    $("#targetSalaryPreview").textContent = money2.format(e.targetSalary);
    $("#performanceBasePreview").textContent = "Base: " + money2.format(e.performanceBase);
    $("#performanceSalaryPreview").textContent = money2.format(e.performanceSalary);
    $("#leadSalaryPreview").textContent = money2.format(e.leadSalary);
  }

  function submitProject(ev) {
    ev.preventDefault();
    const id=$("#projectId").value;
    const targetologists=readTargetologistRows("#targetologistRows");
    if(targetologists.some(item=>!item.memberId && item.salary>0)){
      showToast("Select a person for every targetologist salary");
      return;
    }
    const targetIds=targetologists.map(item=>item.memberId).filter(Boolean);
    if(new Set(targetIds).size!==targetIds.length){
      showToast("The same targetologist cannot be added twice");
      return;
    }
    const financials=financeFields({
      monthlyFee:n($("#projectRevenue").value),
      targetologists,
      performancePct:n($("#performancePct").value),
      leadPct:n($("#leadPct").value),
      performanceId:$("#performanceId").value,
      leadManagerId:$("#leadManagerId").value
    });
    const startMonth=$("#projectStartMonth").value||selectedMonth;
    const project={
      id:id||uid("prj"),
      name:$("#projectName").value.trim(),
      ...financials,
      status:$("#projectStatus").value,
      startMonth,
      updatedAt:new Date().toISOString()
    };
    if(!project.name) return;

    if(id){
      const idx=state.projects.findIndex(x=>x.id===id);
      const previous=idx>=0?state.projects[idx]:null;
      if(previous) ensureProjectBaseline(previous);
      const effectiveMonth = selectedMonth < startMonth ? startMonth : selectedMonth;
      upsertProjectSettings(id,effectiveMonth,financials);
      if(idx>=0) state.projects[idx]={...state.projects[idx],...project};
      showToast("Terms saved from " + monthLabel(effectiveMonth) + " · earlier months preserved");
    }else{
      project.createdAt=new Date().toISOString();
      state.projects.push(project);
      upsertProjectSettings(project.id,startMonth,financials);
      showToast("Project added from " + monthLabel(startMonth));
    }
    saveState();closeProjectModal();render();
  }

  function deleteProject() {
    const id=$("#projectId").value;if(!id)return;
    const p=state.projects.find(x=>x.id===id);
    showConfirm(
      "Delete project permanently?",
      "This fully deletes the project, its monthly settings and all historical snapshots. Use End collaboration if you want to keep history.",
      ()=>{
        state.projects=state.projects.filter(x=>x.id!==id);
        state.monthlySettings=state.monthlySettings.filter(x=>x.projectId!==id);
        state.snapshots=state.snapshots.filter(x=>x.projectId!==id);
        saveState();
        closeProjectModal();
        hideConfirm();
        render();
        showToast((p?.name||"Project")+" permanently deleted");
      },
      "Delete permanently"
    );
  }

  function openEndCollaborationModal() {
    const projectId=$("#projectId").value;
    const project=state.projects.find(p=>p.id===projectId);
    if(!project)return;
    if(project.startMonth && selectedMonth < project.startMonth){
      showToast("Select a month from the project start date or later");
      return;
    }
    $("#endCollaborationProjectId").value=projectId;
    $("#endCollaborationTitle").textContent="End collaboration · "+project.name;
    $("#endCollaborationMonth").textContent=monthLabel(selectedMonth);
    $$('input[name="endCollaborationMode"]').forEach(r=>r.checked=r.value==="after");
    $$(".end-option").forEach(opt=>opt.classList.toggle("selected",$('input',opt)?.checked));
    $("#endCollaborationModal").hidden=false;
  }

  function closeEndCollaborationModal(){
    $("#endCollaborationModal").hidden=true;
  }

  function confirmEndCollaboration(){
    const projectId=$("#endCollaborationProjectId").value;
    const project=state.projects.find(p=>p.id===projectId);
    if(!project)return;
    const mode=$('input[name="endCollaborationMode"]:checked')?.value||"after";
    const inactiveFrom=mode==="from"?selectedMonth:shiftMonth(selectedMonth,1);

    project.inactiveFrom=inactiveFrom;
    project.status="churned";
    project.endedAt=new Date().toISOString();
    project.updatedAt=new Date().toISOString();

    saveState();
    closeEndCollaborationModal();
    closeProjectModal();
    render();
    showToast(
      mode==="from"
        ? project.name+" ended from "+monthLabel(selectedMonth)
        : project.name+" ends after "+monthLabel(selectedMonth)
    );
  }

  function openAdjustmentModal(projectId) {
    const row = rowsForMonth(selectedMonth).find(r => r.projectId === projectId);
    const project = state.projects.find(p => p.id === projectId);
    if (!row && !project) return;

    const source = row || projectToRow(project);
    $("#adjustmentModal").hidden = false;
    $("#adjustProjectId").value = projectId;
    $("#adjustProjectName").textContent = source.projectName || project?.name || "Project";
    $("#adjustMonthName").textContent = monthLabel(selectedMonth);
    $("#adjustRevenue").value = n(source.revenue);
    renderTargetologistRows("#adjustTargetologistRows", normalizeTargetologists(source), "adjust");
    $("#adjustPerformancePct").value = n(source.performancePct);
    $("#adjustLeadPct").value = n(source.leadPct);
    $("#adjustPaymentStatus").value = source.paymentStatus || "paid";

    const saved = state.snapshots.find(s => s.month === selectedMonth && s.projectId === projectId);
    $("#removeAdjustmentBtn").hidden = !saved?.manualOverride;
    updateAdjustmentLiveModel();
  }

  function closeAdjustmentModal() {
    $("#adjustmentModal").hidden = true;
  }

  function updateAdjustmentLiveModel() {
    const targetologists = readTargetologistRows("#adjustTargetologistRows");
    const targetSalary = targetologists.reduce((sum,item)=>sum+n(item.salary),0);
    const e = computeEconomics(
      $("#adjustRevenue").value,
      targetSalary,
      $("#adjustPerformancePct").value,
      $("#adjustLeadPct").value
    );
    $("#adjustTargetSalaryPreview").textContent = money2.format(e.targetSalary);
    $("#adjustModelRevenue").textContent = money2.format(e.revenue);
    $("#adjustModelTarget").textContent = "−" + money2.format(e.targetSalary);
    $("#adjustModelPerformance").textContent = "−" + money2.format(e.performanceSalary);
    $("#adjustModelLead").textContent = "−" + money2.format(e.leadSalary);
    $("#adjustModelPayroll").textContent = money2.format(e.totalPayroll);
    $("#adjustModelNet").textContent = money2.format(e.agencyNet);
    $("#adjustModelMargin").textContent = pct(e.margin) + " margin";
  }

  function submitAdjustment(ev) {
    ev.preventDefault();
    const projectId = $("#adjustProjectId").value;
    const project = state.projects.find(p => p.id === projectId);
    const currentRow = rowsForMonth(selectedMonth).find(r => r.projectId === projectId);
    if (!projectId || (!project && !currentRow)) return;

    const targetologists = readTargetologistRows("#adjustTargetologistRows");
    if(targetologists.some(item=>!item.memberId && item.salary>0)){
      showToast("Select a person for every targetologist salary");
      return;
    }
    const targetIds=targetologists.map(item=>item.memberId).filter(Boolean);
    if(new Set(targetIds).size!==targetIds.length){
      showToast("The same targetologist cannot be added twice");
      return;
    }
    const targetSalary = targetologists.reduce((sum,item)=>sum+n(item.salary),0);
    const e = computeEconomics(
      $("#adjustRevenue").value,
      targetSalary,
      $("#adjustPerformancePct").value,
      $("#adjustLeadPct").value
    );

    const idx = state.snapshots.findIndex(s => s.month === selectedMonth && s.projectId === projectId);
    const existing = idx >= 0 ? state.snapshots[idx] : null;

    let baseline = existing?.baseline || null;
    if (existing && !existing.manualOverride && !baseline) {
      baseline = {
        revenue: existing.revenue,
        targetologists: normalizeTargetologists(existing),
        targetSalary: existing.targetSalary,
        targetologistId: existing.targetologistId || "",
        performancePct: existing.performancePct,
        performanceBase: existing.performanceBase,
        performanceSalary: existing.performanceSalary,
        leadPct: existing.leadPct,
        leadSalary: existing.leadSalary,
        totalPayroll: existing.totalPayroll,
        agencyNet: existing.agencyNet,
        margin: existing.margin,
        paymentStatus: existing.paymentStatus
      };
    }

    const override = {
      id: existing?.id || uid("snap"),
      month: selectedMonth,
      projectId,
      projectName: currentRow?.projectName || project?.name || "Project",
      paymentStatus: $("#adjustPaymentStatus").value,
      targetologists,
      targetologistId: targetologists[0]?.memberId || "",
      performanceId: currentRow?.performanceId || project?.performanceId || "",
      leadManagerId: currentRow?.leadManagerId || project?.leadManagerId || "",
      manualOverride: true,
      baseline,
      ...e
    };

    if (idx >= 0) state.snapshots[idx] = override;
    else state.snapshots.push(override);

    saveState();
    closeAdjustmentModal();
    render();
    showToast("Monthly correction saved");
  }

  function removeAdjustment() {
    const projectId = $("#adjustProjectId").value;
    const idx = state.snapshots.findIndex(s => s.month === selectedMonth && s.projectId === projectId);
    if (idx < 0) return;
    const snap = state.snapshots[idx];

    showConfirm("Remove monthly override?", "The selected month will return to its original/default calculation.", () => {
      if (state.closedMonths.includes(selectedMonth) && snap.baseline) {
        state.snapshots[idx] = {
          ...snap,
          ...snap.baseline,
          manualOverride: false,
          baseline: null
        };
      } else {
        state.snapshots[idx].manualOverride = false;
        state.snapshots[idx].baseline = null;
      }
      saveState();
      hideConfirm();
      closeAdjustmentModal();
      render();
      showToast("Monthly override removed");
    }, "Remove");
  }

  function openMemberModal(id="", presetRole="", assignAfterCreate=false){
    const m=state.team.find(x=>x.id===id);
    pendingAssignmentRole = !m && assignAfterCreate ? presetRole : "";
    $("#memberModal").hidden=false;
    $("#memberModalTitle").textContent=m?"Edit member":("Add " + (presetRole ? roleLabel(presetRole) : "member"));
    $("#memberId").value=m?.id||"";
    $("#memberName").value=m?.name||"";
    $("#memberRole").value=m?.role||presetRole||"targetologist";
    $("#memberRole").disabled = Boolean(presetRole && !m);
    $("#deleteMemberBtn").hidden=!m;
    setTimeout(()=>$("#memberName").focus(),0);
  }
  function closeMemberModal(){
    $("#memberModal").hidden=true;
    $("#memberRole").disabled=false;
    pendingAssignmentRole="";
  }

  function submitMember(ev){
    ev.preventDefault();
    const id=$("#memberId").value;
    const role=$("#memberRole").value;
    const member={id:id||uid("tm"),name:$("#memberName").value.trim(),role,status:"active",updatedAt:new Date().toISOString()};
    if(!member.name)return;

    const assignmentRole = pendingAssignmentRole;
    if(id){
      const idx=state.team.findIndex(x=>x.id===id);
      if(idx>=0)state.team[idx]={...state.team[idx],...member};
      showToast("Member updated");
    }else{
      member.createdAt=new Date().toISOString();
      state.team.push(member);
      showToast(roleLabel(member.role) + " added");
    }

    saveState();

    if(!id && assignmentRole && !$("#projectModal").hidden){
      if(assignmentRole==="targetologist"){
        const targets=readTargetologistRows("#targetologistRows");
        const emptyIndex=targets.findIndex(item=>!item.memberId);
        if(emptyIndex>=0) targets[emptyIndex].memberId=member.id;
        else targets.push({memberId:member.id,salary:0});
        renderTargetologistRows("#targetologistRows",targets,"project");
        updateLiveModel();
      }else{
        const performanceId=$("#performanceId").value;
        const leadManagerId=$("#leadManagerId").value;
        populateAssignmentSelects({
          targetologists:readTargetologistRows("#targetologistRows"),
          performanceId:assignmentRole==="performance"?member.id:performanceId,
          leadManagerId:assignmentRole==="lead"?member.id:leadManagerId
        });
      }
      pendingAssignmentRole="";
      $("#memberModal").hidden=true;
      $("#memberRole").disabled=false;
      renderTeam();
      return;
    }

    closeMemberModal();
    render();
  }

    function deleteMember(){
    const id=$("#memberId").value;if(!id)return;
    const m=getMember(id);
    showConfirm("Delete team member?","Assignments in active projects will become unassigned. Historical snapshots remain unchanged.",()=>{
      state.team=state.team.filter(x=>x.id!==id);
      state.projects=state.projects.map(p=>{
        const targets=normalizeTargetologists(p).filter(item=>item.memberId!==id);
        return {...p,
          targetologists:targets,
          targetSalary:targets.reduce((sum,item)=>sum+n(item.salary),0),
          targetologistId:targets[0]?.memberId||"",
          performanceId:p.performanceId===id?"":p.performanceId,
          leadManagerId:p.leadManagerId===id?"":p.leadManagerId
        };
      });
      state.monthlySettings=state.monthlySettings.map(s=>{
        const targets=normalizeTargetologists(s).filter(item=>item.memberId!==id);
        return {...s,
          targetologists:targets,
          targetSalary:targets.reduce((sum,item)=>sum+n(item.salary),0),
          targetologistId:targets[0]?.memberId||"",
          performanceId:s.performanceId===id?"":s.performanceId,
          leadManagerId:s.leadManagerId===id?"":s.leadManagerId
        };
      });
      if(selectedEmployeeId===id)selectedEmployeeId="";
      saveState();closeMemberModal();hideConfirm();render();showToast((m?.name||"Member")+" deleted");
    },"Delete");
  }

  function setPayment(projectId,status){
    if(state.closedMonths.includes(selectedMonth)){
      const snap=state.snapshots.find(s=>s.month===selectedMonth&&s.projectId===projectId);
      if(snap){snap.paymentStatus=status;saveState();renderOverview();}
      return;
    }
    const snap=ensureSnapshot(selectedMonth,projectId);
    if(snap){snap.paymentStatus=status;saveState();renderOverview();}
  }

  function closeSelectedMonth(){
    if(state.closedMonths.includes(selectedMonth))return;
    showConfirm("Close "+monthLabel(selectedMonth)+"?","This freezes project revenue and salary calculations for the month. Future project changes will not rewrite this history.",()=>{
      snapshotMonth(selectedMonth);hideConfirm();render();showToast("Month closed");
    },"Close month");
  }

  function exportData(){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=url;a.download="pts-finance-backup-"+currentMonth+".json";a.click();URL.revokeObjectURL(url);
    showToast("Backup exported");
  }

  function importData(file){
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const data=JSON.parse(reader.result);
        if(!data||!Array.isArray(data.projects)||!Array.isArray(data.team)||!Array.isArray(data.snapshots))throw new Error("Invalid");
        showConfirm("Import backup?","Current local dashboard data will be replaced by the selected backup.",()=>{
          state={...defaultState(),...data};saveState();hideConfirm();render();showToast("Backup imported");
        },"Import");
      }catch{showToast("Invalid backup file");}
    };
    reader.readAsText(file);
  }

  $$(".nav-item[data-view]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
  $$("[data-jump]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.jump)));
  $("#mobileMenuBtn").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
  $("#monthPicker").addEventListener("change",e=>{selectedMonth=e.target.value||currentMonth;render();});
  $("#prevMonthBtn").addEventListener("click",()=>{selectedMonth=shiftMonth(selectedMonth,-1);render();});
  $("#nextMonthBtn").addEventListener("click",()=>{selectedMonth=shiftMonth(selectedMonth,1);render();});
  $("#closeMonthBtn").addEventListener("click",closeSelectedMonth);
  $("#quickAddProjectBtn").addEventListener("click",()=>openProjectModal());
  $("#addProjectBtn").addEventListener("click",()=>openProjectModal());
  $$("[data-open-project]").forEach(x=>x.addEventListener("click",()=>openProjectModal()));
  $$("[data-close-project]").forEach(x=>x.addEventListener("click",closeProjectModal));
  $("#projectForm").addEventListener("submit",submitProject);
  ["#projectRevenue","#performancePct","#leadPct"].forEach(s=>$(s).addEventListener("input",updateLiveModel));
  $("#targetologistRows").addEventListener("input",updateLiveModel);
  $("#targetologistRows").addEventListener("change",updateLiveModel);
  $("#addTargetologistRowBtn").addEventListener("click",()=>{addTargetologistRow("#targetologistRows","project");updateLiveModel();});
  $("#projectStartMonth").addEventListener("change",e=>{
    if(!$("#projectId").value){
      $("#projectEffectiveMonth").textContent=monthLabel(e.target.value||selectedMonth);
    }
  });
  $("#deleteProjectBtn").addEventListener("click",deleteProject);
  $("#endCollaborationBtn").addEventListener("click",openEndCollaborationModal);
  $("#confirmEndCollaborationBtn").addEventListener("click",confirmEndCollaboration);
  $("[data-close-end-collaboration]").forEach(x=>x.addEventListener("click",closeEndCollaborationModal));
  $('input[name="endCollaborationMode"]').forEach(r=>r.addEventListener("change",()=>{
    $(".end-option").forEach(opt=>opt.classList.toggle("selected",$('input',opt)?.checked));
  }));
  $("#projectStatusFilter").addEventListener("change",renderProjects);
  $("#addMemberBtn").addEventListener("click",()=>openMemberModal());
  document.querySelectorAll("[data-close-adjustment]").forEach(x=>x.addEventListener("click",closeAdjustmentModal));
  $("#adjustmentForm").addEventListener("submit",submitAdjustment);
  ["#adjustRevenue","#adjustPerformancePct","#adjustLeadPct"].forEach(s=>$(s).addEventListener("input",updateAdjustmentLiveModel));
  $("#adjustTargetologistRows").addEventListener("input",updateAdjustmentLiveModel);
  $("#adjustTargetologistRows").addEventListener("change",updateAdjustmentLiveModel);
  $("#addAdjustTargetologistRowBtn").addEventListener("click",()=>{addTargetologistRow("#adjustTargetologistRows","adjust");updateAdjustmentLiveModel();});
  $("#removeAdjustmentBtn").addEventListener("click",removeAdjustment);
  $$("[data-close-member]").forEach(x=>x.addEventListener("click",closeMemberModal));
  $("#memberForm").addEventListener("submit",submitMember);
  $("#deleteMemberBtn").addEventListener("click",deleteMember);
  $("#employeeSelect").addEventListener("change",e=>{selectedEmployeeId=e.target.value;renderTeam();});
  $("#exportDataBtn").addEventListener("click",exportData);
  $("#importDataInput").addEventListener("change",e=>{importData(e.target.files[0]);e.target.value="";});
  $("#confirmCancel").addEventListener("click",hideConfirm);
  $("#confirmOk").addEventListener("click",()=>{if(confirmAction)confirmAction();});
  $("#projectModal").addEventListener("click",e=>{if(e.target===$("#projectModal"))closeProjectModal();});
  $("#memberModal").addEventListener("click",e=>{if(e.target===$("#memberModal"))closeMemberModal();});
  $("#adjustmentModal").addEventListener("click",e=>{if(e.target===$("#adjustmentModal"))closeAdjustmentModal();});
  $("#endCollaborationModal").addEventListener("click",e=>{if(e.target===$("#endCollaborationModal"))closeEndCollaborationModal();});
  $("#confirmDialog").addEventListener("click",e=>{if(e.target===$("#confirmDialog"))hideConfirm();});

  document.addEventListener("click",e=>{
    const removeTarget=e.target.closest("[data-remove-targetologist]");
    if(removeTarget){
      const scope=removeTarget.dataset.removeTargetologist;
      const container=scope==="adjust"?"#adjustTargetologistRows":"#targetologistRows";
      removeTargetologistRow(container,scope,removeTarget.dataset.targetIndex);
      scope==="adjust"?updateAdjustmentLiveModel():updateLiveModel();
      return;
    }
    const inlineRole=e.target.closest("[data-inline-add-role]");
    if(inlineRole){openMemberModal("",inlineRole.dataset.inlineAddRole,true);return;}
    const addRole=e.target.closest("[data-add-role-member]");
    if(addRole){openMemberModal("",addRole.dataset.addRoleMember,false);return;}
    const editProject=e.target.closest("[data-edit-project]");
    if(editProject){openProjectModal(editProject.dataset.editProject);return;}
    const editDefault=e.target.closest("[data-edit-default]");
    if(editDefault){openProjectModal(editDefault.dataset.editDefault);return;}
    const adjustProject=e.target.closest("[data-adjust-project]");
    if(adjustProject){openAdjustmentModal(adjustProject.dataset.adjustProject);return;}
    const editMember=e.target.closest("[data-edit-member]");
    if(editMember){e.stopPropagation();openMemberModal(editMember.dataset.editMember);return;}
    const memberCard=e.target.closest("[data-member-card]");
    if(memberCard){selectedEmployeeId=memberCard.dataset.memberCard;setView("team");return;}
  });

  document.addEventListener("change",e=>{
    const select=e.target.closest("[data-payment-project]");
    if(select)setPayment(select.dataset.paymentProject,select.value);
  });

  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){closeProjectModal();closeAdjustmentModal();closeEndCollaborationModal();closeMemberModal();hideConfirm();$("#sidebar").classList.remove("open");}
  });

  render();

  window.PTSFinance = {
    getState:()=>structuredClone(state),
    testFormula:()=>computeEconomics(300,100,30,5)
  };
})();
