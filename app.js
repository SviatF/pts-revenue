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

  let state = loadState();

  function defaultState() {
    return { version: 1, projects: [], team: [], snapshots: [], closedMonths: [], createdAt: new Date().toISOString() };
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

  function projectToRow(project, paymentStatus = "paid") {
    const e = computeEconomics(project.monthlyFee, project.targetSalary, project.performancePct, project.leadPct);
    return {
      id: "live_" + project.id,
      projectId: project.id,
      projectName: project.name,
      month: selectedMonth,
      paymentStatus,
      targetologistId: project.targetologistId || "",
      performanceId: project.performanceId || "",
      leadManagerId: project.leadManagerId || "",
      ...e
    };
  }

  function activeForMonth(project, month) {
    if (project.startMonth && project.startMonth > month) return false;
    if (project.status === "churned") {
      return state.snapshots.some(s => s.projectId === project.id && s.month === month);
    }
    return project.status === "active" || project.status === "paused";
  }

  function rowsForMonth(month) {
    const snaps = state.snapshots.filter(s => s.month === month);
    if (state.closedMonths.includes(month)) return snaps;

    const snapshotByProject = new Map(snaps.map(s => [s.projectId, s]));
    return state.projects
      .filter(p => activeForMonth(p, month) && p.status === "active")
      .map(p => {
        const saved = snapshotByProject.get(p.id);
        if (saved?.manualOverride) return saved;
        const row = projectToRow(p, saved?.paymentStatus || "paid");
        row.month = month;
        return row;
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
    if (row.targetologistId === memberId) { salary += n(row.targetSalary); roles.push("Targetologist"); }
    if (row.performanceId === memberId) { salary += n(row.performanceSalary); roles.push("Performance"); }
    if (row.leadManagerId === memberId) { salary += n(row.leadSalary); roles.push("Lead manager"); }
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
    const liveRows = state.projects.filter(p => p.status === "active" && (!p.startMonth || p.startMonth <= month)).map(p => {
      const old = state.snapshots.find(s => s.month === month && s.projectId === p.id);
      if (old?.manualOverride) return { ...old };
      const e = computeEconomics(p.monthlyFee, p.targetSalary, p.performancePct, p.leadPct);
      return {
        id: old?.id || uid("snap"), month, projectId: p.id, projectName: p.name,
        paymentStatus: old?.paymentStatus || "paid",
        targetologistId: p.targetologistId || "", performanceId: p.performanceId || "", leadManagerId: p.leadManagerId || "",
        manualOverride: false,
        ...e
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
    const e = computeEconomics(p.monthlyFee, p.targetSalary, p.performancePct, p.leadPct);
    snap = {
      id: uid("snap"), month, projectId: p.id, projectName: p.name, paymentStatus: "paid",
      targetologistId: p.targetologistId || "", performanceId: p.performanceId || "", leadManagerId: p.leadManagerId || "", ...e
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
      const stroke = s.stroke || (si === 0 ? "#f3f3f3" : "#676767");
      const dots = s.values.map((v, i) => '<circle cx="' + x(i) + '" cy="' + y(n(v)) + '" r="2.2" fill="' + stroke + '"><title>' + esc(s.name) + ": " + esc(options.percent ? pct(n(v)) : money.format(n(v))) + "</title></circle>").join("");
      return '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + (si === 0 ? 2 : 1.6) + '" stroke-linecap="round" stroke-linejoin="round"/>' + dots;
    }).join("");
    el.innerHTML = '<svg viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none" role="img">' + grid + labels + paths + "</svg>";
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
      { name: "Revenue", labels: months.map(k => shortMonthFmt.format(dateFromMonth(k))), values: history.map(x => x.revenue), stroke: "#f4f4f4" },
      { name: "Agency net", labels: months.map(k => shortMonthFmt.format(dateFromMonth(k))), values: history.map(x => x.net), stroke: "#666" }
    ]);

    const parts = [
      { key: "target", name: "Targetologists", value: m.target, cls: "target", dot: "#e8e8e8" },
      { key: "performance", name: "Performance", value: m.performance, cls: "performance", dot: "#a8a8a8" },
      { key: "lead", name: "Lead managers", value: m.lead, cls: "lead", dot: "#696969" },
      { key: "net", name: "Agency net", value: m.net, cls: "net", dot: "#303030" }
    ];
    $("#costStack").innerHTML = parts.map(p => '<div class="cost-segment ' + p.cls + '" style="width:' + Math.max(0, m.revenue ? p.value / m.revenue * 100 : 0) + '%"></div>').join("");
    $("#costBreakdown").innerHTML = parts.map(p => '<div class="breakdown-row"><i class="breakdown-dot" style="background:' + p.dot + '"></i><span class="breakdown-name">' + p.name + '</span><strong class="breakdown-value">' + money.format(p.value) + '</strong><span class="breakdown-pct">' + pct(m.revenue ? p.value / m.revenue * 100 : 0) + "</span></div>").join("");

    const top = [...rows].sort((a,b) => b.agencyNet - a.agencyNet).slice(0,5);
    $("#topProjects").innerHTML = top.length ? top.map((r,i) => '<div class="rank-row"><span class="rank-index">0' + (i+1) + '</span><div class="rank-name"><strong>' + esc(r.projectName) + '</strong><span>' + pct(r.margin) + ' margin</span></div><strong class="rank-value">' + money.format(r.agencyNet) + "</strong></div>").join("") : '<div class="empty-inline">No projects yet.</div>';

    $("#overviewProjectsTable").innerHTML = rows.length ? rows.map(r => '<tr><td><strong>' + esc(r.projectName) + '</strong></td><td>' + money.format(r.revenue) + '</td><td>' + money.format(r.totalPayroll) + '</td><td><strong>' + money.format(r.agencyNet) + '</strong></td><td>' + pct(r.margin) + '</td><td><select class="payment-select" data-payment-project="' + esc(r.projectId) + '"><option value="paid"' + (r.paymentStatus==="paid"?" selected":"") + '>Paid</option><option value="pending"' + (r.paymentStatus==="pending"?" selected":"") + '>Pending</option><option value="overdue"' + (r.paymentStatus==="overdue"?" selected":"") + ">Overdue</option></select></td></tr>").join("") : '<tr><td colspan="6" class="muted">No projects in this month.</td></tr>';
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
      const e = computeEconomics(p.monthlyFee,p.targetSalary,p.performancePct,p.leadPct);
      return '<tr><td><div class="project-name-cell"><span class="project-initial">' + esc(initials(p.name)) + '</span><div><strong>' + esc(p.name) + '</strong><br><span class="status-pill ' + esc(p.status) + '">' + esc(p.status) + '</span></div></div></td><td><strong>' + money.format(e.revenue) + '</strong></td><td>' + money.format(e.targetSalary) + '</td><td>' + money.format(e.performanceSalary) + ' <span class="muted">(' + pct(e.performancePct) + ')</span></td><td>' + money.format(e.leadSalary) + ' <span class="muted">(' + pct(e.leadPct) + ')</span></td><td>' + money.format(e.totalPayroll) + '</td><td><strong>' + money.format(e.agencyNet) + '</strong></td><td>' + pct(e.margin) + '</td><td><div class="row-actions"><button class="small-icon-btn" data-edit-project="' + p.id + '" aria-label="Edit">···</button></div></td></tr>';
    }).join("");
  }

  function renderTeam() {
    const monthRows = rowsForMonth(selectedMonth);
    $("#teamCards").innerHTML = state.team.length ? state.team.map(member => {
      const s = memberMonthStats(member.id, selectedMonth);
      return '<article class="team-card" data-member-card="' + member.id + '"><div class="team-card-top"><span class="avatar">' + esc(initials(member.name)) + '</span><div class="team-card-name"><strong>' + esc(member.name) + '</strong><span>' + esc(roleLabel(member.role)) + '</span></div><button class="small-icon-btn" style="margin-left:auto" data-edit-member="' + member.id + '">···</button></div><div class="team-card-pay"><div><span>Salary</span><strong>' + money.format(s.salary) + '</strong></div><div><span>Projects</span><strong>' + s.count + "</strong></div></div></article>";
    }).join("") : '<div class="empty-inline">No team members yet. Add people and assign them to projects.</div>';

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
    lineChart("#employeeSalaryChart", [{ name:"Salary", labels:months.map(k=>shortMonthFmt.format(dateFromMonth(k))), values, stroke:"#f4f4f4" }]);

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
      return '<tr><td><strong>' + esc(r.projectName) + '</strong></td><td>' + money.format(r.revenue) + '</td><td>' + money.format(r.targetSalary) + '</td><td>' + pct(r.performancePct) + ' <span class="muted">(' + money.format(r.performanceSalary) + ')</span></td><td>' + pct(r.leadPct) + ' <span class="muted">(' + money.format(r.leadSalary) + ')</span></td><td><strong>' + money.format(r.totalPayroll) + '</strong></td><td>' + money.format(r.agencyNet) + '</td><td><span class="' + sourceClass + '">' + source + '</span></td><td><div class="row-actions">' + (project ? '<button class="small-icon-btn rate-action" data-edit-default="' + esc(r.projectId) + '" title="Edit default project rates">Default</button>' : '') + '<button class="small-icon-btn rate-action" data-adjust-project="' + esc(r.projectId) + '" title="Correct selected month">Month</button></div></td></tr>';
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

  function populateAssignmentSelects(project = {}) {
    const mapping = [
      ["#targetologistId","targetologist",project.targetologistId],
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
    $("#projectModal").hidden=false;
    $("#projectModalTitle").textContent=p?"Edit project":"Add project";
    $("#projectId").value=p?.id||"";
    $("#projectName").value=p?.name||"";
    $("#projectRevenue").value=p?.monthlyFee??"";
    $("#targetSalary").value=p?.targetSalary??"";
    $("#performancePct").value=p?.performancePct??"";
    $("#leadPct").value=p?.leadPct??"";
    $("#projectStatus").value=p?.status||"active";
    $("#projectStartMonth").value=p?.startMonth||selectedMonth;
    populateAssignmentSelects(p||{});
    $("#deleteProjectBtn").hidden=!p;
    updateLiveModel();
    setTimeout(()=>$("#projectName").focus(),0);
  }

  function closeProjectModal(){ $("#projectModal").hidden=true; }

  function updateLiveModel() {
    const e=computeEconomics($("#projectRevenue").value,$("#targetSalary").value,$("#performancePct").value,$("#leadPct").value);
    $("#modelRevenue").textContent=money2.format(e.revenue);
    $("#modelTarget").textContent="−"+money2.format(e.targetSalary);
    $("#modelPerformance").textContent="−"+money2.format(e.performanceSalary);
    $("#modelLead").textContent="−"+money2.format(e.leadSalary);
    $("#modelPayroll").textContent=money2.format(e.totalPayroll);
    $("#modelNet").textContent=money2.format(e.agencyNet);
    $("#modelMargin").textContent=pct(e.margin)+" margin";
    $("#modelFormula").textContent="Performance = ("+money2.format(e.revenue)+" − "+money2.format(e.targetSalary)+") × "+pct(e.performancePct)+" = "+money2.format(e.performanceSalary);
  }

  function submitProject(ev) {
    ev.preventDefault();
    const id=$("#projectId").value;
    const project={
      id:id||uid("prj"),
      name:$("#projectName").value.trim(),
      monthlyFee:n($("#projectRevenue").value),
      targetSalary:n($("#targetSalary").value),
      performancePct:n($("#performancePct").value),
      leadPct:n($("#leadPct").value),
      targetologistId:$("#targetologistId").value,
      performanceId:$("#performanceId").value,
      leadManagerId:$("#leadManagerId").value,
      status:$("#projectStatus").value,
      startMonth:$("#projectStartMonth").value||selectedMonth,
      updatedAt:new Date().toISOString()
    };
    if(!project.name) return;
    if(id){
      const idx=state.projects.findIndex(x=>x.id===id);
      if(idx>=0) state.projects[idx]={...state.projects[idx],...project};
      showToast("Project updated");
    }else{
      project.createdAt=new Date().toISOString();
      state.projects.push(project);
      showToast("Project added");
    }
    saveState();closeProjectModal();render();
  }

  function deleteProject() {
    const id=$("#projectId").value;if(!id)return;
    const p=state.projects.find(x=>x.id===id);
    showConfirm("Delete project?","Historical closed-month snapshots will stay intact, but the active project will be removed.",()=>{
      state.projects=state.projects.filter(x=>x.id!==id);
      saveState();closeProjectModal();hideConfirm();render();showToast((p?.name||"Project")+" deleted");
    },"Delete");
  }

  function openMemberModal(id=""){
    const m=state.team.find(x=>x.id===id);
    $("#memberModal").hidden=false;
    $("#memberModalTitle").textContent=m?"Edit member":"Add member";
    $("#memberId").value=m?.id||"";
    $("#memberName").value=m?.name||"";
    $("#memberRole").value=m?.role||"targetologist";
    $("#deleteMemberBtn").hidden=!m;
    setTimeout(()=>$("#memberName").focus(),0);
  }
  function closeMemberModal(){ $("#memberModal").hidden=true; }

  function submitMember(ev){
    ev.preventDefault();
    const id=$("#memberId").value;
    const member={id:id||uid("tm"),name:$("#memberName").value.trim(),role:$("#memberRole").value,status:"active",updatedAt:new Date().toISOString()};
    if(!member.name)return;
    if(id){
      const idx=state.team.findIndex(x=>x.id===id);
      if(idx>=0)state.team[idx]={...state.team[idx],...member};
      showToast("Member updated");
    }else{
      member.createdAt=new Date().toISOString();state.team.push(member);showToast("Member added");
    }
    saveState();closeMemberModal();render();
  }

  function deleteMember(){
    const id=$("#memberId").value;if(!id)return;
    const m=getMember(id);
    showConfirm("Delete team member?","Assignments in active projects will become unassigned. Historical snapshots remain unchanged.",()=>{
      state.team=state.team.filter(x=>x.id!==id);
      state.projects=state.projects.map(p=>({...p,
        targetologistId:p.targetologistId===id?"":p.targetologistId,
        performanceId:p.performanceId===id?"":p.performanceId,
        leadManagerId:p.leadManagerId===id?"":p.leadManagerId
      }));
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
  ["#projectRevenue","#targetSalary","#performancePct","#leadPct"].forEach(s=>$(s).addEventListener("input",updateLiveModel));
  $("#deleteProjectBtn").addEventListener("click",deleteProject);
  $("#projectStatusFilter").addEventListener("change",renderProjects);
  $("#addMemberBtn").addEventListener("click",()=>openMemberModal());
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
  $("#confirmDialog").addEventListener("click",e=>{if(e.target===$("#confirmDialog"))hideConfirm();});

  document.addEventListener("click",e=>{
    const editProject=e.target.closest("[data-edit-project]");
    if(editProject){openProjectModal(editProject.dataset.editProject);return;}
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
    if(e.key==="Escape"){closeProjectModal();closeMemberModal();hideConfirm();$("#sidebar").classList.remove("open");}
  });

  render();

  window.PTSFinance = {
    getState:()=>structuredClone(state),
    testFormula:()=>computeEconomics(300,100,30,5)
  };
})();
