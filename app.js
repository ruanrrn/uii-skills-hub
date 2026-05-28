/* ================================================================
   Skill Hub — Models-style data + renderer
   ================================================================ */

const REPO_URL = 'https://github.com/ruanrrn/uii-agents-hub';

const SKILLS = [
  {
    id: 'vitallens',
    type: 'skill', // 'skill' | 'plugin'
    name: 'vitallens-rppg',
    icon: '❤️',
    badges: [], // free | beta
    category: 'health',
    categoryLabel: '健康',
    platform: 'Cross-platform',
    inputs: ['video'],
    outputs: ['data'],
    description:
      '用摄像头无接触采集约 12 秒视频，返回心率与呼吸率（仅用于研究）。',
    folder: 'vitallens',
    capabilityFlow: [
      { type: 'video', label: '摄像头' },
      { type: 'data', label: 'HR + RR' },
    ],
    meta: [
      { key: '平台', value: 'Windows · macOS · Linux' },
      { key: '依赖', value: 'Node 18+ · Chromium · API Key · 摄像头' },
    ],
    stats: [
      { num: '12', unit: 's', label: '单次测量' },
      { num: '2', unit: '项', label: '输出指标' },
    ],
    provider: { name: 'UII Agent Hub', avatar: 'U' },
    quickstart: [
      '请帮我安装 vitallens-rppg 这个 skill：',
      '',
      '源码：https://github.com/ruanrrn/uii-agents-hub/tree/main/vitallens',
      '请把它放到本地 skill 目录。',
      '',
      '依赖（任一缺失先告诉我怎么补）：',
      '  • Node.js 18+',
      '  • Chromium 系浏览器（Edge / Chrome / Chromium 均可）',
      '  • VITALLENS_API_KEY 环境变量（在 https://www.rouast.com/api 免费申请）',
      '  • 一个可用的摄像头',
      '',
      '安装完成后，对 AI 助手说「我要测试呼吸心率」即可触发测量。',
    ].join('\n'),
  },
];

/* ---------- Helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const colorize = (line) => {
  const esc = escapeHtml(line);
  return esc.trim().startsWith('#') ? `<span class="comment">${esc}</span>` : esc;
};

const renderQuickstart = (text) => text.split('\n').map(colorize).join('\n');

/* Natural-language renderer: escape HTML, then linkify URLs and wrap
   `inline code` segments. Preserves whitespace via pre-wrap on the
   container. */
function renderNaturalText(text) {
  const esc = escapeHtml(text);
  // Inline code first (so URL inside code isn't linkified)
  const coded = esc.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // URLs (only those not already inside a tag)
  return coded.replace(
    /(https?:\/\/[^\s<)]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

/* SVG icons for capability flow */
const CAP_ICONS = {
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V5h16v2M9 5v14m6-14v14M7 19h10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 15-5-5L5 19" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke-linecap="round"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 9 4-2v10l-4-2z"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
};

const BADGE_MAP = {
  free:  { cls: 'free', label: '开源免费' },
  beta:  { cls: 'beta', label: 'β Beta' },
};

/* ---------- Card render ---------- */
function renderCard(skill) {
  const badges = (skill.badges || [])
    .map((b) => BADGE_MAP[b] ? `<span class="card-badge ${BADGE_MAP[b].cls}">${BADGE_MAP[b].label}</span>` : '')
    .join('');

  const capabilityFlow = (skill.capabilityFlow || [])
    .map((c, i) => `
      <span class="cap">${CAP_ICONS[c.type] || ''}${escapeHtml(c.label || '')}</span>
      ${i < skill.capabilityFlow.length - 1 ? '<span class="arrow">→</span>' : ''}
    `)
    .join('');

  const metaLines = (skill.meta || [])
    .map((m) => `<div class="meta-line"><span class="meta-key">${escapeHtml(m.key)}:</span><span class="meta-val">${escapeHtml(m.value)}</span></div>`)
    .join('');

  const stats = (skill.stats || [])
    .slice(0, 2)
    .map((s) => `
      <div>
        <div class="card-stat-num">${escapeHtml(s.num)}${s.unit ? `<span class="unit">${escapeHtml(s.unit)}</span>` : ''}</div>
        <div class="card-stat-label">${escapeHtml(s.label)}</div>
      </div>
    `)
    .join('');

  return `
    <article class="skill-card" data-skill-id="${escapeHtml(skill.id)}" tabindex="0">
      <div class="card-top">
        <div class="card-icon-badge">
          <div class="card-icon" aria-hidden="true">${skill.icon}</div>
          ${badges}
        </div>
        <button class="card-action-btn" data-action="open-detail" data-skill-id="${escapeHtml(skill.id)}" aria-label="查看详情">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <h3 class="card-name">${escapeHtml(skill.name)}</h3>
      <div class="card-id-row">
        <span class="card-id">${escapeHtml(skill.id)}</span>
        <button class="id-copy-btn" data-copy-id="${escapeHtml(skill.id)}" aria-label="复制 skill ID">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </div>

      <p class="card-desc">${escapeHtml(skill.description)}</p>

      <div class="capability-flow">${capabilityFlow}</div>

      <div class="card-meta-row">${metaLines}</div>

      <div class="card-stats">${stats}</div>

      <div class="card-footer">
        <div class="meta-block">
          <span class="meta-block-label">供应商:</span>
          <span class="meta-chip"><span class="meta-chip-icon">${escapeHtml(skill.provider.avatar)}</span>${escapeHtml(skill.provider.name)}</span>
        </div>
      </div>
    </article>
  `;
}

/* ---------- Grid + count ---------- */
function renderGrid(skills) {
  const grid = $('#skillGrid');
  const empty = $('#emptyState');
  if (skills.length === 0) {
    grid.innerHTML = '';
    empty.hidden = false;
  } else {
    empty.hidden = true;
    grid.innerHTML = skills.map(renderCard).join('');
  }
}

function updateCount(filtered, total) {
  $('#skillCount').textContent =
    filtered === total
      ? `共 ${total} 个技能 · 持续更新中`
      : `匹配 ${filtered} / ${total} 个技能`;
}

/* ---------- Filter state ---------- */
const filterState = {
  search: '',
  type: 'skill', // 'skill' | 'plugin' | null (null = all)
};

const TYPE_LABEL = { skill: 'Skills', plugin: 'Plugins' };

function syncSectionTitle() {
  const t = $('#sectionTitle');
  if (t) t.textContent = TYPE_LABEL[filterState.type] || 'Skills';
}

function applyFilter() {
  syncSectionTitle();
  const q = filterState.search.toLowerCase();
  const filtered = SKILLS.filter((s) => {
    if (q) {
      const hay = `${s.name} ${s.id} ${s.description} ${s.categoryLabel || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filterState.type && s.type !== filterState.type) return false;
    return true;
  });
  renderGrid(filtered);
  updateCount(filtered.length, SKILLS.length);
}

function updateTypeCounts() {
  const counts = SKILLS.reduce(
    (acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    },
    { skill: 0, plugin: 0 }
  );
  document.querySelectorAll('.type-nav-count').forEach((el) => {
    const k = el.getAttribute('data-count');
    el.textContent = counts[k] ?? 0;
  });
}

/* ---------- Clipboard ---------- */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    return true;
  } catch (err) {
    console.error('Copy failed:', err);
    return false;
  }
}

async function flashCopy(btn, originalLabel, doneLabel = 'Copied ✓') {
  const labelEl = btn.querySelector('.copy-label');
  btn.classList.add('copied');
  if (labelEl) labelEl.textContent = doneLabel;
  setTimeout(() => {
    btn.classList.remove('copied');
    if (labelEl) labelEl.textContent = originalLabel;
  }, 1500);
}

/* ---------- Modal ---------- */
function openModal(skill) {
  $('#modalIcon').textContent = skill.icon;
  $('#modalTitle').textContent = skill.name;
  $('#modalSub').textContent = `${skill.id} · ${skill.categoryLabel || skill.category}`;
  $('#modalDesc').textContent = skill.description;

  // meta grid: skill.meta + 分类 (dedupe by label)
  const seen = new Set();
  const metaItems = [
    ...skill.meta.map((m) => ({ label: m.key, value: m.value })),
    { label: '分类', value: skill.categoryLabel || skill.category },
  ].filter((m) => (seen.has(m.label) ? false : (seen.add(m.label), true)));
  $('#modalMetaGrid').innerHTML = metaItems
    .map(
      (m) => `
      <div class="modal-meta-item">
        <div class="modal-meta-label">${escapeHtml(m.label)}</div>
        <div class="modal-meta-value">${escapeHtml(m.value)}</div>
      </div>`
    )
    .join('');

  $('#modalCommand').innerHTML = renderNaturalText(skill.quickstart);
  $('#modalCopyBtn').setAttribute('data-copy-payload', skill.quickstart);

  const folder = skill.folder;
  $('#modalLinks').innerHTML = `
    <a class="modal-link" href="${REPO_URL}/blob/main/${folder}/SKILL.md" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
      </svg>
      SKILL.md
    </a>
    <a class="modal-link" href="${REPO_URL}/tree/main/${folder}/references" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
      References
    </a>
    <a class="modal-link" href="${REPO_URL}/tree/main/${folder}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
      GitHub
    </a>
  `;

  const backdrop = $('#modalBackdrop');
  backdrop.hidden = false;
  // double rAF to allow opacity transition
  requestAnimationFrame(() => {
    requestAnimationFrame(() => backdrop.classList.add('open'));
  });
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const backdrop = $('#modalBackdrop');
  backdrop.classList.remove('open');
  setTimeout(() => {
    backdrop.hidden = true;
    document.body.style.overflow = '';
  }, 220);
}

/* ---------- Events ---------- */
function bindEvents() {
  // Open detail when clicking card or + button
  document.addEventListener('click', (e) => {
    // ID copy (don't open modal)
    const idBtn = e.target.closest('.id-copy-btn');
    if (idBtn) {
      e.stopPropagation();
      const id = idBtn.getAttribute('data-copy-id');
      copyText(id).then(() => {
        idBtn.classList.add('copied');
        setTimeout(() => idBtn.classList.remove('copied'), 1200);
      });
      return;
    }

    // Modal copy
    const modalCopy = e.target.closest('#modalCopyBtn');
    if (modalCopy) {
      const text = modalCopy.getAttribute('data-copy-payload') || '';
      copyText(text).then(() => flashCopy(modalCopy, 'Copy'));
      return;
    }

    // + button or card body
    const openTrigger = e.target.closest('.card-action-btn, .skill-card');
    if (openTrigger) {
      const skillId = openTrigger.getAttribute('data-skill-id') ||
        openTrigger.closest('.skill-card')?.getAttribute('data-skill-id');
      const skill = SKILLS.find((s) => s.id === skillId);
      if (skill) openModal(skill);
      return;
    }

    // Modal close (button or backdrop)
    if (e.target.closest('#modalClose')) {
      closeModal();
      return;
    }
    if (e.target.id === 'modalBackdrop') {
      closeModal();
      return;
    }

    // Type nav (Skill / Plugin) — mutually exclusive
    const typeBtn = e.target.closest('.type-nav-item');
    if (typeBtn) {
      const value = typeBtn.getAttribute('data-value');
      document.querySelectorAll('.type-nav-item').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      typeBtn.classList.add('active');
      typeBtn.setAttribute('aria-selected', 'true');
      filterState.type = value;
      applyFilter();
      return;
    }

    // View toggle (cosmetic - only grid implemented)
    const viewBtn = e.target.closest('.view-btn');
    if (viewBtn) {
      $$('.view-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      viewBtn.classList.add('active');
      viewBtn.setAttribute('aria-selected', 'true');
      return;
    }
  });

  // Keyboard: ESC closes modal, Enter on card opens it
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const backdrop = $('#modalBackdrop');
      if (!backdrop.hidden) closeModal();
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const card = document.activeElement.closest('.skill-card');
      if (card) {
        e.preventDefault();
        const skill = SKILLS.find((s) => s.id === card.getAttribute('data-skill-id'));
        if (skill) openModal(skill);
      }
    }
  });

  // Search
  $('#search').addEventListener('input', (e) => {
    filterState.search = e.target.value.trim();
    applyFilter();
  });
  $('#clearSearch').addEventListener('click', () => {
    filterState.search = '';
    $('#search').value = '';
    applyFilter();
    $('#search').focus();
  });

  // Header scroll
  const header = $('#siteHeader');
  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 16);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function init() {
  updateTypeCounts();
  applyFilter(); // respects default filterState.type = 'skill', also syncs title
  bindEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
