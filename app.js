(() => {
  'use strict';

  const CATEGORIES = [
    { id: 'duplication', label: 'Duplication' },
    { id: 'switches', label: 'Switches & nesting' },
    { id: 'coupling', label: 'Coupling' },
    { id: 'size', label: 'Size & cohesion' },
    { id: 'errors', label: 'Error handling' },
    { id: 'clarity', label: 'Clarity & dead code' },
  ];
  const OTHER = { id: 'other', label: 'Uncategorized' };
  const SEVERITIES = ['high', 'medium', 'low'];
  const SEV_WEIGHT = { high: 3, medium: 2, low: 1 };
  const VIEWS = ['triage', 'remedies', 'heatmap'];

  const $ = (sel) => document.querySelector(sel);

  const state = {
    projectsMeta: [],
    loaded: new Map(),
    rules: {},
    project: null,
    view: 'triage',
    sort: { key: 'severity', dir: -1 },
    expanded: new Set(),
    hideClean: false,
    filters: { source: 'all', minConf: 0, bugsOnly: false, q: '', cats: new Set(), sevs: new Set() },
  };

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
  };

  // Formatting

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const rich = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

  function loc(file, start, end) {
    if (start == null) return file;
    return end != null && end !== start ? `${file}:${start}-${end}` : `${file}:${start}`;
  }

  function splitPath(file) {
    const i = file.lastIndexOf('/', file.length - 2);
    return i < 0 ? ['', file] : [file.slice(0, i + 1), file.slice(i + 1)];
  }

  const catInfo = (id) => CATEGORIES.find((c) => c.id === id) || OTHER;
  const catVar = (id) => `var(--cat-${catInfo(id).id})`;
  const sevLabel = (s) => s[0].toUpperCase() + s.slice(1);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function countBy(items, key) {
    const out = {};
    for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1;
    return out;
  }

  const weight = (items) => items.reduce((sum, x) => sum + SEV_WEIGHT[x.severity] + (x.bug ? 2 : 0), 0);

  // Data

  async function getJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  function normalize(raw, id, label) {
    const rules = { ...state.rules, ...(raw.rules || {}) };
    const remedies = new Map((raw.remedies || []).map((r) => [r.id, r]));
    const filters = raw.filters || [];
    const findings = [];

    filters.forEach((filter) => {
      (filter.findings || []).forEach((x, i) => {
        const rule = rules[x.rule] || {};
        const category = x.category || rule.category;
        findings.push({
          ...x,
          id: `${filter.source}-${i}`,
          source: x.source || filter.source,
          category: CATEGORIES.some((c) => c.id === category) ? category : 'other',
          severity: SEVERITIES.includes(x.severity) ? x.severity : (rule.severity || 'low'),
          remedyObj: (x.remedy && remedies.get(x.remedy)) || null,
          remedyText: rule.remedy_text || `Address "${x.rule}"`,
          related: x.related || [],
          bug: Boolean(x.bug),
        });
      });
    });

    return {
      id,
      label,
      name: raw.project || label,
      findings,
      byId: new Map(findings.map((x) => [x.id, x])),
      sources: filters.map((f) => ({
        source: f.source,
        checked: f.checked || [],
        notes: f.notes || [],
      })),
    };
  }

  function categoriesFor(project) {
    return project.findings.some((x) => x.category === 'other') ? [...CATEGORIES, OTHER] : CATEGORIES;
  }

  function selectedSources() {
    const all = state.project.sources;
    return state.filters.source === 'all' ? all : all.filter((s) => s.source === state.filters.source);
  }

  function filtered({ ignoreCats = false, ignoreSevs = false } = {}) {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    return state.project.findings.filter((x) =>
      (f.source === 'all' || x.source === f.source) &&
      (x.probability == null || x.probability >= f.minConf) &&
      (!f.bugsOnly || x.bug) &&
      (ignoreSevs || f.sevs.size === 0 || f.sevs.has(x.severity)) &&
      (ignoreCats || f.cats.size === 0 || f.cats.has(x.category)) &&
      (!q || [x.file, x.rule, x.message, x.detail, x.source].join(' ').toLowerCase().includes(q)));
  }

  const anyFilter = () => {
    const f = state.filters;
    return f.source !== 'all' || f.minConf > 0 || f.bugsOnly || f.q || f.cats.size || f.sevs.size;
  };

  // Summary

  function renderSummary() {
    const shown = filtered();
    const forCats = filtered({ ignoreCats: true });
    const forSevs = filtered({ ignoreSevs: true });
    const sevCounts = countBy(forSevs, 'severity');
    const catCounts = countBy(forCats, 'category');
    const bugs = shown.filter((x) => x.bug).length;

    const checked = new Set(selectedSources().flatMap((s) => s.checked));
    const flagged = new Set(state.project.findings
      .filter((x) => state.filters.source === 'all' || x.source === state.filters.source)
      .map((x) => x.file));
    const clean = [...checked].filter((file) => !flagged.has(file)).length;

    const sevTotal = forSevs.length || 1;
    const sevBar = SEVERITIES.map((s) =>
      `<span class="sev-${s}" style="width:${((sevCounts[s] || 0) / sevTotal) * 100}%;background:var(--c)"></span>`).join('');

    const sevChips = SEVERITIES.map((s) => `
      <button class="chip sev-${s}" data-sev="${s}" aria-pressed="${state.filters.sevs.has(s)}">
        <span class="dot"></span>${sevLabel(s)} <span class="n">${sevCounts[s] || 0}</span>
      </button>`).join('');

    const catChips = categoriesFor(state.project).map((c) => `
      <button class="chip" data-cat="${c.id}" style="--c:${catVar(c.id)}" aria-pressed="${state.filters.cats.has(c.id)}">
        <span class="dot"></span>${c.label} <span class="n">${catCounts[c.id] || 0}</span>
      </button>`).join('');

    $('#summary').innerHTML = `
      <div class="stat"><span class="num">${shown.length}</span><span class="lab">findings shown</span></div>
      <div class="stat bug"><span class="num">${bugs}</span><span class="lab">${bugs === 1 ? 'bug' : 'bugs'}</span></div>
      <div class="summary-right">
        <div class="sevbar" aria-hidden="true">${sevBar}</div>
        <div class="chips">${sevChips}</div>
        <div class="chips">${catChips}</div>
        <div class="files-line">
          ${plural(checked.size, 'file')} checked | ${clean} clean
          ${anyFilter() ? ' | <button class="link-btn" id="clearFilters">Clear filters</button>' : ''}
        </div>
      </div>`;
  }

  // Triage view

  function sortRows(rows) {
    const { key, dir } = state.sort;
    const conf = (x) => (x.probability == null ? 1 : x.probability);
    const cmp = {
      severity: (a, b) => (SEV_WEIGHT[a.severity] - SEV_WEIGHT[b.severity]) || (a.bug - b.bug) || (conf(a) - conf(b)),
      rule: (a, b) => b.rule.localeCompare(a.rule),
      location: (a, b) => b.file.localeCompare(a.file) || ((b.start_line || 0) - (a.start_line || 0)),
      confidence: (a, b) => conf(a) - conf(b),
    }[key];
    return [...rows].sort((a, b) => dir * cmp(a, b) || a.file.localeCompare(b.file));
  }

  function confCell(p) {
    if (p == null) return '<span class="conf none" title="No probability given">n/a</span>';
    return `<span class="conf"><span class="track"><span style="width:${p * 100}%"></span></span>${Math.round(p * 100)}%</span>`;
  }

  function renderTriage() {
    const rows = sortRows(filtered());
    const head = (key, label) =>
      `<th><button data-sort="${key}" data-active="${state.sort.key === key}">${label}${state.sort.key === key ? (state.sort.dir < 0 ? ' v' : ' ^') : ''}</button></th>`;

    const body = rows.map((x) => `
      <tr data-id="${esc(x.id)}" tabindex="0" class="sev-${x.severity}">
        <td><span class="pill sev-${x.severity}">${sevLabel(x.severity)}</span></td>
        <td>
          <div class="msg">${x.bug ? '<span class="bug-badge">Bug</span>' : ''}${rich(x.message)}</div>
          <div class="rule">${esc(x.rule)} | ${esc(x.source)}</div>
        </td>
        <td><span class="cat" style="--c:${catVar(x.category)}">${catInfo(x.category).label}</span></td>
        <td class="loc">${esc(loc(x.file, x.start_line, x.end_line))}${x.related.length ? ` <span class="more">+${x.related.length}</span>` : ''}</td>
        <td>${confCell(x.probability)}</td>
      </tr>`).join('');

    $('#view-triage').innerHTML = `
      <p class="view-intro">One row per finding, worst first. Click a row for detail and the suggested fix.</p>
      ${rows.length ? `
      <div class="table-wrap">
        <table class="triage">
          <colgroup><col class="c-sev"><col><col class="c-cat"><col class="c-loc"><col class="c-conf"></colgroup>
          <thead><tr>${head('severity', 'Severity')}${head('rule', 'Finding')}<th>Category</th>${head('location', 'Location')}${head('confidence', 'Confidence')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>` : '<p class="empty">No findings match these filters.</p>'}`;
  }

  // Remedy view

  function remedyGroups(rows) {
    const groups = new Map();
    for (const x of rows) {
      const key = x.remedyObj ? `r:${x.remedyObj.id}` : `t:${x.remedyText}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title: x.remedyObj ? x.remedyObj.title : x.remedyText,
          effort: x.remedyObj ? x.remedyObj.effort : null,
          explicit: Boolean(x.remedyObj),
          items: [],
        });
      }
      groups.get(key).items.push(x);
    }
    return [...groups.values()].sort((a, b) => weight(b.items) - weight(a.items) || b.items.length - a.items.length);
  }

  const LIST_LIMIT = 5;

  function findingButton(x) {
    return `
      <li><button data-id="${esc(x.id)}" class="sev-${x.severity}">
        <span class="sevdot"></span>
        <span class="t">${x.bug ? '<span class="bug-badge">Bug</span>' : ''}${rich(x.message)}</span>
        <span class="l">${esc(loc(x.file, x.start_line, x.end_line))}</span>
      </button></li>`;
  }

  function renderRemedies() {
    const groups = remedyGroups(filtered());

    const cards = groups.map((g) => {
      const items = sortRows(g.items);
      const open = state.expanded.has(g.key);
      const visible = open ? items : items.slice(0, LIST_LIMIT);
      const sev = countBy(items, 'severity');
      const bar = SEVERITIES.map((s) =>
        `<span class="sev-${s}" style="width:${((sev[s] || 0) / items.length) * 100}%;background:var(--c)"></span>`).join('');
      const cats = [...new Set(items.map((x) => x.category))].map((c) =>
        `<span class="cat" style="--c:${catVar(c)}">${catInfo(c).label}</span>`).join('');

      return `
        <article class="card ${g.explicit ? '' : 'default'}">
          <h3>${esc(g.title)}</h3>
          <div class="card-meta">
            <span class="count">${items.length}</span>
            <span>${items.length === 1 ? 'finding' : 'findings'}</span>
            ${g.effort ? `<span class="effort" title="Effort">effort ${esc(g.effort)}</span>` : ''}
            <span>${g.explicit ? 'project-specific fix' : 'rule default'}</span>
          </div>
          <div class="sevbar" aria-hidden="true">${bar}</div>
          <div class="chips">${cats}</div>
          <ul>${visible.map(findingButton).join('')}</ul>
          ${items.length > LIST_LIMIT ? `<button class="link-btn" data-expand="${esc(g.key)}">${open ? 'Show fewer' : `Show all ${items.length}`}</button>` : ''}
        </article>`;
    }).join('');

    $('#view-remedies').innerHTML = `
      <p class="view-intro">Findings grouped by the fix that removes them, biggest payoff first. Dashed cards use the rule's generic fix because the source named no project-specific one.</p>
      ${groups.length ? `<div class="cards">${cards}</div>` : '<p class="empty">No findings match these filters.</p>'}`;
  }

  // Heatmap view

  function renderHeatmap() {
    const cats = categoriesFor(state.project);
    const checked = new Set(selectedSources().flatMap((s) => s.checked));
    const byFile = new Map();
    for (const x of filtered()) {
      if (!byFile.has(x.file)) byFile.set(x.file, {});
      const cells = byFile.get(x.file);
      (cells[x.category] ||= []).push(x);
    }

    let files = [...new Set([...checked, ...byFile.keys()])].map((file) => {
      const cells = byFile.get(file) || {};
      const all = Object.values(cells).flat();
      return { file, cells, total: all.length, weight: weight(all), checked: checked.has(file) || all.length > 0 };
    });
    if (state.hideClean) files = files.filter((f) => f.total > 0);
    files.sort((a, b) => b.weight - a.weight || b.total - a.total || a.file.localeCompare(b.file));

    const max = Math.max(1, ...files.flatMap((f) => cats.map((c) => (f.cells[c.id] || []).length)));
    const colTotals = cats.map((c) => files.reduce((n, f) => n + (f.cells[c.id] || []).length, 0));

    const rows = files.map((f) => {
      const [dir, base] = splitPath(f.file);
      const tds = cats.map((c) => {
        const n = (f.cells[c.id] || []).length;
        if (!f.checked) return '<td><span class="cell na">-</span></td>';
        if (!n) return '<td><span class="cell zero">.</span></td>';
        const pct = Math.round(18 + (n / max) * 82);
        const fg = pct > 55 ? 'var(--on-heat)' : 'var(--ink)';
        return `<td><button class="cell" data-file="${esc(f.file)}" data-cat="${c.id}"
          style="background:color-mix(in oklab, var(--heat) ${pct}%, var(--surface));color:${fg}"
          aria-label="${n} ${c.label} findings in ${esc(f.file)}">${n}</button></td>`;
      }).join('');
      return `
        <tr class="${f.checked ? '' : 'unchecked'}">
          <th class="file" scope="row" title="${esc(f.file)}"><span class="dir">${esc(dir)}</span>${esc(base)}</th>
          ${tds}
          <td class="total">${f.checked ? f.total : ''}</td>
        </tr>`;
    }).join('');

    $('#view-heatmap').innerHTML = `
      <p class="view-intro">Files down the side, smell categories across the top. Darker cells hold more findings. Click a cell to list them.</p>
      <div class="heat-tools">
        <div class="legend">
          <span>fewer</span><span class="ramp"></span><span>more</span>
          <span class="na-swatch" style="margin-left:12px"></span><span>not checked by this source</span>
        </div>
        <label class="toggle"><input type="checkbox" id="hideClean" ${state.hideClean ? 'checked' : ''}><span>Hide clean files</span></label>
      </div>
      ${files.length ? `
      <div class="table-wrap" style="background:transparent;border:0">
        <table class="heat">
          <colgroup><col class="c-file">${cats.map(() => '<col>').join('')}<col></colgroup>
          <thead><tr><th class="file" style="text-transform:uppercase;font-family:var(--font-body);font-size:11px;color:var(--muted)">File</th>
            ${cats.map((c) => `<th><span class="cat" style="--c:${catVar(c.id)}">${c.label}</span></th>`).join('')}<th>Total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th>Total</th>${colTotals.map((n) => `<th>${n}</th>`).join('')}<th>${colTotals.reduce((a, b) => a + b, 0)}</th></tr></tfoot>
        </table>
      </div>` : '<p class="empty">No files match these filters.</p>'}`;
  }

  // Drawer

  let drawerList = null;

  function openDrawer(html, fromList) {
    $('#drawerBody').innerHTML = html;
    $('#drawerBack').hidden = !fromList;
    $('#drawer').hidden = false;
    $('#scrim').hidden = false;
    $('#drawerClose').focus();
  }

  function closeDrawer() {
    $('#drawer').hidden = true;
    $('#scrim').hidden = true;
    drawerList = null;
  }

  function openDetail(x, fromList = false) {
    const locs = [
      `<li class="primary">${esc(loc(x.file, x.start_line, x.end_line))}</li>`,
      ...x.related.map((r) => `<li>${esc(loc(r.file, r.start_line, r.end_line))}</li>`),
    ].join('');
    const fix = x.remedyObj
      ? `${esc(x.remedyObj.title)}${x.remedyObj.effort ? ` <span class="effort">effort ${esc(x.remedyObj.effort)}</span>` : ''}`
      : `${esc(x.remedyText)} <span style="color:var(--muted)">(rule default)</span>`;

    openDrawer(`
      <div class="marks">
        <span class="pill sev-${x.severity}">${sevLabel(x.severity)}</span>
        ${x.bug ? '<span class="bug-badge">Bug</span>' : ''}
        <span class="cat" style="--c:${catVar(x.category)}">${catInfo(x.category).label}</span>
      </div>
      <h2>${rich(x.message)}</h2>
      ${x.detail ? `<p class="detail">${rich(x.detail)}</p>` : ''}
      <dl class="kv">
        <dt>Rule</dt><dd>${esc(x.rule)}</dd>
        <dt>Source</dt><dd>${esc(x.source)}</dd>
        <dt>Confidence</dt><dd>${x.probability == null ? 'Not given' : `${Math.round(x.probability * 100)}%`}</dd>
        <dt>Fix</dt><dd>${fix}</dd>
        <dt>Where</dt><dd><ul class="locs">${locs}</ul></dd>
      </dl>`, fromList);
  }

  function openList(title, items) {
    drawerList = { title, items };
    openDrawer(`
      <h2>${esc(title)}</h2>
      <ul class="list-items card" style="border:0;padding:0;background:transparent">${sortRows(items).map(findingButton).join('')}</ul>`, false);
  }

  // Rendering and events

  function renderView() {
    VIEWS.forEach((v) => {
      $(`#view-${v}`).hidden = v !== state.view;
      $(`#tab-${v}`).setAttribute('aria-selected', String(v === state.view));
    });
    ({ triage: renderTriage, remedies: renderRemedies, heatmap: renderHeatmap })[state.view]();
  }

  function render() {
    if (!state.project) return;
    renderSummary();
    renderView();
  }

  function setView(view) {
    if (!VIEWS.includes(view)) return;
    state.view = view;
    store.set('sp.view', view);
    if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
    renderView();
  }

  function fillSourceSelect() {
    const counts = countBy(state.project.findings, 'source');
    $('#sourceSelect').innerHTML = [
      `<option value="all">All sources (${state.project.findings.length})</option>`,
      ...state.project.sources.map((s) => `<option value="${esc(s.source)}">${esc(s.source)} (${counts[s.source] || 0})</option>`),
    ].join('');
    $('#sourceSelect').value = state.filters.source;
  }

  function resetFilters() {
    Object.assign(state.filters, { source: 'all', minConf: 0, bugsOnly: false, q: '' });
    state.filters.cats.clear();
    state.filters.sevs.clear();
    $('#confRange').value = 0;
    $('#confOut').textContent = 'any';
    $('#bugsOnly').checked = false;
    $('#searchBox').value = '';
    $('#sourceSelect').value = 'all';
  }

  function useProject(project) {
    state.project = project;
    state.expanded.clear();
    resetFilters();
    fillSourceSelect();
    const notes = project.sources.flatMap((s) => s.notes);
    $('#projectMeta').textContent =
      `${project.label} | ${project.group} | ${plural(project.findings.length, 'finding')} from ${plural(project.sources.length, 'source')}` +
      (notes.length ? ` | ${notes[0]}` : '');
    render();
  }

  async function loadProject(id) {
    if (state.loaded.has(id)) return useProject(state.loaded.get(id));
    const meta = state.projectsMeta.find((p) => p.id === id);
    const project = normalize(await getJSON(meta.file), meta.id, meta.label);
    project.group = meta.group || 'data';
    state.loaded.set(id, project);
    store.set('sp.project', id);
    useProject(project);
  }

  // Options sit in one <optgroup> per review method.

  function addProjectOption(id, label, group) {
    const select = $('#projectSelect');
    let optgroup = [...select.children].find((el) => el.label === group);
    if (!optgroup) {
      optgroup = document.createElement('optgroup');
      optgroup.label = group;
      select.append(optgroup);
    }
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    optgroup.append(opt);
  }

  // Dropped and picked files live in memory for this tab only.

  async function loadFromFile(file) {
    try {
      const raw = JSON.parse(await file.text());
      if (!Array.isArray(raw.filters)) throw new Error('It has no "filters" list.');
      const id = `upload/${file.name}`;
      const label = file.name.replace(/\.json$/i, '');
      const project = normalize(raw, id, label);
      project.group = 'dropped this session';
      if (!state.loaded.has(id)) addProjectOption(id, label, project.group);
      state.loaded.set(id, project);
      $('#projectSelect').value = id;
      $('#notice').hidden = true;
      useProject(project);
    } catch (err) {
      showNotice(`${esc(file.name)} isn't a findings JSON this page can read. ${esc(err.message)}`);
    }
  }

  function wireDropZone() {
    const overlay = $('#dropOverlay');
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

    document.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth += 1;
      overlay.hidden = false;
    });
    document.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.hidden = true;
    });
    document.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    document.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      for (const file of e.dataTransfer.files) await loadFromFile(file);
    });
  }

  function showNotice(html) {
    $('#notice').innerHTML = html;
    $('#notice').hidden = false;
  }

  function wire() {
    $('#projectSelect').addEventListener('change', (e) => {
      loadProject(e.target.value).catch((err) => showNotice(`Couldn't load that project. ${esc(err.message)}`));
    });
    $('#sourceSelect').addEventListener('change', (e) => { state.filters.source = e.target.value; render(); });
    $('#confRange').addEventListener('input', (e) => {
      state.filters.minConf = Number(e.target.value);
      $('#confOut').textContent = state.filters.minConf ? `>= ${Math.round(state.filters.minConf * 100)}%` : 'any';
      render();
    });
    $('#bugsOnly').addEventListener('change', (e) => { state.filters.bugsOnly = e.target.checked; render(); });
    $('#searchBox').addEventListener('input', (e) => { state.filters.q = e.target.value; render(); });

    $('#fileInput').addEventListener('change', async (e) => {
      for (const file of e.target.files) await loadFromFile(file);
      e.target.value = '';
    });
    wireDropZone();

    document.querySelector('.tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (btn) setView(btn.dataset.view);
    });

    $('#summary').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-cat], [data-sev]');
      if (e.target.closest('#clearFilters')) { resetFilters(); render(); return; }
      if (!chip) return;
      const [set, value] = chip.dataset.cat ? [state.filters.cats, chip.dataset.cat] : [state.filters.sevs, chip.dataset.sev];
      set.has(value) ? set.delete(value) : set.add(value);
      render();
    });

    document.querySelector('main').addEventListener('click', (e) => {
      const sortBtn = e.target.closest('[data-sort]');
      if (sortBtn) {
        const key = sortBtn.dataset.sort;
        state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : -1 };
        renderTriage();
        return;
      }
      const expand = e.target.closest('[data-expand]');
      if (expand) {
        const key = expand.dataset.expand;
        state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
        renderRemedies();
        return;
      }
      const cell = e.target.closest('button.cell[data-file]');
      if (cell) {
        const items = filtered().filter((x) => x.file === cell.dataset.file && x.category === cell.dataset.cat);
        openList(`${catInfo(cell.dataset.cat).label} in ${cell.dataset.file}`, items);
        return;
      }
      const row = e.target.closest('[data-id]');
      if (row) {
        drawerList = null;
        openDetail(state.project.byId.get(row.dataset.id));
      }
    });

    document.querySelector('main').addEventListener('keydown', (e) => {
      const row = e.target.closest('tr[data-id]');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openDetail(state.project.byId.get(row.dataset.id));
      }
    });

    document.querySelector('main').addEventListener('change', (e) => {
      if (e.target.id === 'hideClean') { state.hideClean = e.target.checked; renderHeatmap(); }
    });

    $('#drawerBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-id]');
      if (btn && drawerList) {
        const list = drawerList;
        openDetail(state.project.byId.get(btn.dataset.id), true);
        drawerList = list;
      }
    });
    $('#drawerBack').addEventListener('click', () => { if (drawerList) openList(drawerList.title, drawerList.items); });
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });
    window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
  }

  async function init() {
    wire();
    const hashView = location.hash.slice(1);
    state.view = VIEWS.includes(hashView) ? hashView : (VIEWS.includes(store.get('sp.view')) ? store.get('sp.view') : 'triage');

    try {
      const [projects, rules] = await Promise.all([getJSON('data/projects.json'), getJSON('data/rules.json')]);
      state.projectsMeta = projects;
      state.rules = rules;
      projects.forEach((p) => addProjectOption(p.id, p.label, p.group || 'data'));
      if (!projects.length) {
        showNotice('No findings files are listed. Put one in <code>data/&lt;method&gt;/</code> and run <code>python build_manifest.py</code>, or drop a file on this page.');
        return;
      }
      const saved = store.get('sp.project');
      const first = projects.some((p) => p.id === saved) ? saved : projects[0].id;
      $('#projectSelect').value = first;
      await loadProject(first);
    } catch (err) {
      showNotice(
        'The sample data didn\'t load. Browsers block <code>fetch</code> on pages opened from disk, ' +
        'so run <code>python -m http.server</code> in this folder and open <code>http://localhost:8000</code>. ' +
        `You can still load a findings file with the button above. (${esc(err.message)})`);
    }
  }

  init();
})();
