/**
 * Builders Archive — Modern Traditional Web Tech Stack Implementation
 * Clean, standard ES6+ vanilla JavaScript with zero runtime dependencies.
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const TABS = {
    chat: 'Chat',
    build: 'Build',
    projects: 'Projects',
    files: 'Files',
    history: 'History',
    about: 'About',
    settings: 'Settings'
  };
  const TAB_KEYS = Object.keys(TABS);

  const PAPER_PALETTE = [
    { color: '#1C4587', name: 'Blueprint blue' },
    { color: '#173B73', name: 'Deep blue' },
    { color: '#22529B', name: 'Bright blue' },
    { color: '#14305E', name: 'Navy' }
  ];

  const PENCIL_PALETTE = [
    { color: '#F2D16B', name: 'Yellow pencil' },
    { color: '#FFFFFF', name: 'White chalk' },
    { color: '#F4A38C', name: 'Red pencil' },
    { color: '#BFE3C0', name: 'Green pencil' }
  ];

  // Workbench model definitions: Units in px (≈ 5 mm each). y is up, floor at 0.
  const legX = 140, legZ = 60;
  const STEPS = [
    {
      title: 'Stand the legs',
      text: 'Cut four legs to 900 mm. Stand them at the corners of a 1400 × 600 mm rectangle, measured to the outside faces.',
      parts: [{ qty: '4×', name: 'Leg, 2×4', size: '900 mm' }],
      boxes: [
        [-legX, 85, -legZ, 12, 170, 12],
        [legX, 85, -legZ, 12, 170, 12],
        [-legX, 85, legZ, 12, 170, 12],
        [legX, 85, legZ, 12, 170, 12]
      ]
    },
    {
      title: 'Lower rails',
      text: 'Screw the long and short rails between the legs, 150 mm up from the floor. Measure both diagonals; when they match, it is square.',
      parts: [
        { qty: '2×', name: 'Long rail, 2×4', size: '1330 mm' },
        { qty: '2×', name: 'Short rail, 2×4', size: '530 mm' }
      ],
      boxes: [
        [0, 30, -legZ, 268, 12, 8],
        [0, 30, legZ, 268, 12, 8],
        [-legX, 30, 0, 8, 12, 108],
        [legX, 30, 0, 8, 12, 108]
      ]
    },
    {
      title: 'Upper aprons',
      text: 'Fit the aprons flush with the tops of the legs, same layout as the lower rails. Two screws per joint.',
      parts: [
        { qty: '2×', name: 'Long apron, 2×4', size: '1330 mm' },
        { qty: '2×', name: 'Short apron, 2×4', size: '530 mm' }
      ],
      boxes: [
        [0, 162, -legZ, 268, 14, 8],
        [0, 162, legZ, 268, 14, 8],
        [-legX, 162, 0, 8, 14, 108],
        [legX, 162, 0, 8, 14, 108]
      ]
    },
    {
      title: 'Lower shelf',
      text: 'Drop the shelf panel onto the lower rails and screw it down from above every 300 mm.',
      parts: [{ qty: '1×', name: 'Shelf panel, 18 mm ply', size: '1400 × 600' }],
      boxes: [[0, 38, 0, 290, 4, 132]]
    },
    {
      title: 'Worktop',
      text: 'Glue and screw the two top layers together, then fix the top to the aprons from underneath so no screw heads show.',
      parts: [{ qty: '2×', name: 'Top layer, 18 mm ply', size: '1600 × 800' }],
      boxes: [[0, 174, 0, 320, 10, 160]]
    },
    {
      title: 'Tool board',
      text: 'Mount the two uprights to the back legs, then screw the pegboard between them. Hang the tools you reach for most at eye level.',
      parts: [
        { qty: '2×', name: 'Upright, 2×4', size: '450 mm' },
        { qty: '1×', name: 'Pegboard', size: '1500 × 450' }
      ],
      boxes: [
        [-152, 224, -74, 10, 90, 10],
        [152, 224, -74, 10, 90, 10],
        [0, 224, -76, 290, 86, 4]
      ]
    }
  ];

  // --- State ---
  const state = {
    tab: 'chat',
    draft: '',
    mx: null,
    my: null,
    messages: [],
    history: [],
    projects: [],
    newOpen: false,
    newName: '',
    files: [],
    step: 0,
    rx: -24,
    ry: -38,
    dragging: false,
    dx: 0,
    dy: 0,
    glowOn: true,
    crossOn: true,
    paperSel: '#1C4587',
    pencilSel: '#F2D16B'
  };

  // Helper date formatter
  function getStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return {
      date: p(d.getMonth() + 1) + '/' + p(d.getDate()),
      time: p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    };
  }

  // --- 3D Face Math Engine ---
  function boxFaces(b, lookStyle) {
    const [x, y, z, w, h, d] = b;
    const f = (fw, fh, rot, push) => {
      const el = document.createElement('div');
      el.className = 'bv-face';
      el.style.width = fw + 'px';
      el.style.height = fh + 'px';
      el.style.marginLeft = (-fw / 2) + 'px';
      el.style.marginTop = (-fh / 2) + 'px';
      el.style.transform = `translate3d(${x}px, ${-y}px, ${z}px) ${rot} translateZ(${push}px)`;
      if (lookStyle.border) el.style.border = lookStyle.border;
      if (lookStyle.background) el.style.background = lookStyle.background;
      return el;
    };

    return [
      f(w, h, '', d / 2),
      f(w, h, 'rotateY(180deg)', d / 2),
      f(d, h, 'rotateY(90deg)', w / 2),
      f(d, h, 'rotateY(-90deg)', w / 2),
      f(w, d, 'rotateX(90deg)', h / 2),
      f(w, d, 'rotateX(-90deg)', h / 2)
    ];
  }

  function render3DFaces() {
    const rig = document.getElementById('bvRig');
    if (!rig) return;
    rig.innerHTML = '';

    // Floor grid
    const floor = document.createElement('div');
    floor.className = 'bv-face';
    floor.style.width = '400px';
    floor.style.height = '260px';
    floor.style.marginLeft = '-200px';
    floor.style.marginTop = '-130px';
    floor.style.transform = 'rotateX(90deg)';
    floor.style.border = '1px dashed rgba(232,238,247,0.55)';
    floor.style.backgroundImage = 'repeating-linear-gradient(45deg, rgba(232,238,247,0.08) 0 1px, transparent 1px 12px)';
    rig.appendChild(floor);

    const doneStyle = {
      border: '1px solid rgba(232, 238, 247, 0.85)',
      background: 'rgba(232, 238, 247, 0.06)'
    };
    const freshStyle = {
      border: `1.5px solid ${state.pencilSel}`,
      background: `${state.pencilSel}40`
    };

    const curStep = Math.min(state.step, STEPS.length - 1);
    for (let i = 0; i <= curStep; i++) {
      const look = i === curStep ? freshStyle : doneStyle;
      STEPS[i].boxes.forEach((b) => {
        boxFaces(b, look).forEach((faceEl) => rig.appendChild(faceEl));
      });
    }
  }

  function updateRigTransform() {
    const rig = document.getElementById('bvRig');
    if (!rig) return;
    rig.style.transform = `rotateX(${state.rx}deg) rotateY(${state.ry}deg)`;
    if (state.dragging) {
      rig.classList.add('dragging');
    } else {
      rig.classList.remove('dragging');
    }
  }

  // --- Rendering Modules ---

  function renderTabs() {
    const container = document.getElementById('tabsList');
    if (!container) return;
    container.innerHTML = '';

    TAB_KEYS.forEach((key, idx) => {
      const isActive = state.tab === key;
      const numStr = String(idx + 1).padStart(2, '0');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sd-tab ${isActive ? 'active' : ''}`;
      btn.setAttribute('aria-current', isActive ? 'page' : 'false');
      btn.innerHTML = `
        <span class="sd-tab-mark"></span>
        <span class="sd-tab-num">${numStr}</span>
        <span class="sd-tab-label">${TABS[key]}</span>
      `;
      btn.addEventListener('click', () => setTab(key));
      container.appendChild(btn);
    });

    // Update bottom status & Title Block DWG
    const sheetNum = String(TAB_KEYS.indexOf(state.tab) + 1);
    const dwgCode = `A-00${sheetNum}`;
    const sheetName = TABS[state.tab].toUpperCase();

    const sheetNameEl = document.getElementById('sheetNameDisplay');
    if (sheetNameEl) sheetNameEl.textContent = `SHEET ${sheetName}`;

    const dwgDisplayEl = document.getElementById('dwgDisplay');
    if (dwgDisplayEl) dwgDisplayEl.textContent = `DWG ${dwgCode}`;
  }

  function renderActiveSheet() {
    document.querySelectorAll('.sheet-container').forEach((el) => {
      el.style.display = 'none';
    });
    const activeEl = document.getElementById(`sheet-${state.tab}`);
    if (activeEl) activeEl.style.display = 'flex';

    if (state.tab === 'build') {
      renderBuildSheet();
    } else if (state.tab === 'chat') {
      renderChatMessages();
    } else if (state.tab === 'projects') {
      renderProjects();
    } else if (state.tab === 'files') {
      renderFiles();
    } else if (state.tab === 'history') {
      renderHistory();
    }
  }

  // --- Chat Sheet ---
  function renderChatMessages() {
    const list = document.getElementById('chatMessagesList');
    if (!list) return;
    list.innerHTML = '';

    if (state.messages.length === 0) {
      list.style.display = 'none';
      return;
    }
    list.style.display = 'flex';

    state.messages.forEach((m) => {
      const row = document.createElement('div');
      row.className = `chat-bubble-row ${m.from}`;

      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${m.from}`;
      bubble.innerHTML = `<span>${escapeHTML(m.text)}</span>`;

      if (m.action === 'sample') {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'sd-btn-solid';
        actionBtn.textContent = 'Open sample build';
        actionBtn.style.alignSelf = 'flex-start';
        actionBtn.addEventListener('click', () => setTab('build'));
        bubble.appendChild(actionBtn);
      }

      row.appendChild(bubble);
      list.appendChild(row);
    });

    list.scrollTop = list.scrollHeight;
  }

  function sendChatMessage(text) {
    const t = (text || '').trim();
    if (!t) return;

    state.messages.push({ from: 'user', text: t });
    state.history.push({ text: t, time: getStamp().time });
    state.draft = '';

    const input = document.getElementById('chatDraftInput');
    if (input) input.value = '';

    // Simulate Agent response
    state.messages.push({
      from: 'agent',
      text: 'In the full app this becomes a 3D model with numbered build steps. Here is how a finished set looks:',
      action: 'sample'
    });

    renderChatMessages();
    updateSendButtonState();
  }

  function updateSendButtonState() {
    const btn = document.getElementById('sendChatBtn');
    if (!btn) return;
    const hasText = state.draft.trim().length > 0;
    btn.style.opacity = hasText ? '1' : '0.5';
  }

  // --- Build Sheet ---
  function renderBuildSheet() {
    const s = Math.min(state.step, STEPS.length - 1);
    const cur = STEPS[s];
    const totalSteps = STEPS.length;
    const partCount = STEPS.reduce((sum, step) => sum + step.boxes.length, 0);

    const stepNoStr = String(s + 1).padStart(2, '0');
    const totalStepStr = String(totalSteps).padStart(2, '0');

    // Overlays
    const stepNoDisplay = document.getElementById('stepNoDisplay');
    if (stepNoDisplay) stepNoDisplay.textContent = stepNoStr;
    const totalStepsDisplay = document.getElementById('totalStepsDisplay');
    if (totalStepsDisplay) totalStepsDisplay.textContent = `/ ${totalStepStr}`;

    const buildSubheader = document.getElementById('buildSubheader');
    if (buildSubheader) {
      buildSubheader.textContent = `1600 × 800 × 900 MM · ${totalStepStr} STEPS · ${partCount} PARTS`;
    }

    // Details panel
    const badge = document.getElementById('stepBadge');
    if (badge) badge.textContent = `STEP ${stepNoStr}`;

    const titleEl = document.getElementById('stepTitle');
    if (titleEl) titleEl.textContent = cur.title;

    const descEl = document.getElementById('stepDesc');
    if (descEl) descEl.textContent = cur.text;

    // Parts table
    const partsContainer = document.getElementById('stepPartsList');
    if (partsContainer) {
      partsContainer.innerHTML = '';
      cur.parts.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'part-row';
        row.innerHTML = `
          <span class="part-qty">${escapeHTML(p.qty)}</span>
          <span class="part-name">${escapeHTML(p.name)}</span>
          <span class="part-size">${escapeHTML(p.size)}</span>
        `;
        partsContainer.appendChild(row);
      });
    }

    // Prev / Next button states
    const prevBtn = document.getElementById('prevStepBtn');
    if (prevBtn) {
      prevBtn.disabled = s === 0;
      prevBtn.style.opacity = s === 0 ? '0.4' : '1';
      prevBtn.style.cursor = s === 0 ? 'default' : 'pointer';
    }

    const nextBtn = document.getElementById('nextStepBtn');
    if (nextBtn) {
      nextBtn.textContent = s === totalSteps - 1 ? 'Done — start over' : 'Next step →';
    }

    // Step list drawer
    const drawer = document.getElementById('stepDrawerList');
    if (drawer) {
      drawer.innerHTML = '';
      STEPS.forEach((stepItem, i) => {
        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        let markText = '';
        let statusClass = '';
        if (i < s) {
          markText = 'DONE';
          statusClass = 'done';
        } else if (i === s) {
          markText = 'NOW';
          statusClass = 'active';
        }

        itemBtn.className = `step-drawer-item ${statusClass}`;
        itemBtn.innerHTML = `
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; width: 24px;">${String(i + 1).padStart(2, '0')}</span>
          <span style="flex: 1 1 auto;">${escapeHTML(stepItem.title)}</span>
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px;">${markText}</span>
        `;
        itemBtn.addEventListener('click', () => {
          state.step = i;
          renderBuildSheet();
        });
        drawer.appendChild(itemBtn);
      });
    }

    // Update 3D faces
    render3DFaces();
    updateRigTransform();
  }

  // --- Projects Sheet ---
  function renderProjects() {
    const grid = document.getElementById('userProjectsList');
    if (!grid) return;
    grid.innerHTML = '';

    state.projects.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'project-card user-created';
      card.innerHTML = `
        <div class="project-thumb placeholder">model not drawn yet</div>
        <div class="project-body">
          <span class="project-name">${escapeHTML(p.name)}</span>
          <div class="project-meta">
            <span>${escapeHTML(p.sheet)}</span>
            <span>${escapeHTML(p.date)}</span>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 6px;">
            <button type="button" class="sd-btn discuss-btn" style="flex: 1 1 auto; padding: 0 12px;">Describe in chat</button>
            <button type="button" class="sd-btn remove-btn" aria-label="Remove ${escapeHTML(p.name)}" style="width: 44px; padding: 0;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
            </button>
          </div>
        </div>
      `;

      card.querySelector('.discuss-btn').addEventListener('click', () => {
        state.draft = `I want to build ${p.name}. `;
        setTab('chat');
        const input = document.getElementById('chatDraftInput');
        if (input) {
          input.value = state.draft;
          input.focus();
        }
        updateSendButtonState();
      });

      card.querySelector('.remove-btn').addEventListener('click', () => {
        state.projects = state.projects.filter((x) => x.id !== p.id);
        renderProjects();
      });

      grid.appendChild(card);
    });

    const newBox = document.getElementById('newProjectBox');
    if (newBox) newBox.style.display = state.newOpen ? 'flex' : 'none';
  }

  function addProject() {
    const name = state.newName.trim();
    if (!name) return;

    const num = state.projects.length + 2;
    state.projects.push({
      id: Date.now(),
      name,
      sheet: 'P-' + String(num).padStart(3, '0'),
      date: getStamp().date
    });

    state.newName = '';
    state.newOpen = false;
    const input = document.getElementById('newProjInput');
    if (input) input.value = '';

    renderProjects();
  }

  // --- Files Sheet ---
  function renderFiles() {
    const list = document.getElementById('uploadedFilesList');
    if (!list) return;
    list.innerHTML = '';

    state.files.forEach((f, idx) => {
      const no = 'F-' + String(idx + 1).padStart(2, '0');
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; width: 48px;">${no}</span>
        <span style="flex: 1 1 auto; min-width: 0; font-size: 15px; color: #FFFFFF; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(f.name)}</span>
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px;">${escapeHTML(f.size)}</span>
        <button type="button" class="sd-btn remove-file-btn" aria-label="Remove ${escapeHTML(f.name)}" style="width: 44px; height: 44px; border: 0; padding: 0;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
        </button>
      `;

      row.querySelector('.remove-file-btn').addEventListener('click', () => {
        state.files = state.files.filter((x) => x.id !== f.id);
        renderFiles();
      });

      list.appendChild(row);
    });
  }

  function handleFilesSelected(fileList) {
    const picked = Array.from(fileList || []).map((f, i) => ({
      id: Date.now() + '-' + i,
      name: f.name,
      size: f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB'
    }));
    state.files = state.files.concat(picked);
    renderFiles();
  }

  // --- History Sheet ---
  function renderHistory() {
    const list = document.getElementById('historyList');
    const emptyNotice = document.getElementById('historyEmptyNotice');
    if (!list) return;
    list.innerHTML = '';

    if (state.history.length === 0) {
      if (emptyNotice) emptyNotice.style.display = 'flex';
      return;
    }
    if (emptyNotice) emptyNotice.style.display = 'none';

    // Reverse chronological order
    const rev = [...state.history].reverse();
    rev.forEach((h) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'history-item';
      item.innerHTML = `
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; width: 92px; flex: 0 0 auto;">${escapeHTML(h.time)}</span>
        <span style="flex: 1 1 auto; min-width: 0; font-size: 15px; color: #FFFFFF; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(h.text)}</span>
        <span style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.08em;">OPEN →</span>
      `;
      item.addEventListener('click', () => setTab('chat'));
      list.appendChild(item);
    });
  }

  // --- Settings Sheet ---
  function renderSettings() {
    // Switches
    const glowTrack = document.getElementById('glowSwitchTrack');
    if (glowTrack) {
      if (state.glowOn) glowTrack.classList.add('on');
      else glowTrack.classList.remove('on');
      glowTrack.setAttribute('aria-checked', state.glowOn ? 'true' : 'false');
    }

    const crossTrack = document.getElementById('crossSwitchTrack');
    if (crossTrack) {
      if (state.crossOn) crossTrack.classList.add('on');
      else crossTrack.classList.remove('on');
      crossTrack.setAttribute('aria-checked', state.crossOn ? 'true' : 'false');
    }

    // Paper swatches
    const paperContainer = document.getElementById('paperSwatches');
    if (paperContainer) {
      paperContainer.innerHTML = '';
      PAPER_PALETTE.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `sd-sw ${state.paperSel === p.color ? 'active' : ''}`;
        btn.style.background = p.color;
        btn.setAttribute('aria-label', p.name);
        btn.setAttribute('aria-pressed', state.paperSel === p.color ? 'true' : 'false');
        btn.addEventListener('click', () => setPaperColor(p.color));
        paperContainer.appendChild(btn);
      });
    }

    // Pencil swatches
    const pencilContainer = document.getElementById('pencilSwatches');
    if (pencilContainer) {
      pencilContainer.innerHTML = '';
      PENCIL_PALETTE.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `sd-sw ${state.pencilSel === p.color ? 'active' : ''}`;
        btn.style.background = p.color;
        btn.setAttribute('aria-label', p.name);
        btn.setAttribute('aria-pressed', state.pencilSel === p.color ? 'true' : 'false');
        btn.addEventListener('click', () => setPencilColor(p.color));
        pencilContainer.appendChild(btn);
      });
    }
  }

  function setPaperColor(color) {
    state.paperSel = color;
    document.documentElement.style.setProperty('--paper', color);
    document.body.style.backgroundColor = color;
    renderSettings();
  }

  function setPencilColor(color) {
    state.pencilSel = color;
    document.documentElement.style.setProperty('--pencil', color);
    renderSettings();
    renderTabs();
    if (state.tab === 'build') renderBuildSheet();
  }

  // --- Top-level Actions ---
  function setTab(tabName) {
    if (!TABS[tabName]) return;
    state.tab = tabName;
    renderTabs();
    renderActiveSheet();
  }

  // Helper escape
  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- Initialization & Event Listeners ---
  function init() {
    renderTabs();
    renderActiveSheet();
    renderSettings();

    // Horizontal Ruler Ticks (every 120px)
    const rulerH = document.getElementById('rulerHorizontal');
    if (rulerH) {
      rulerH.innerHTML = '';
      for (let i = 1; i <= 16; i++) {
        const span = document.createElement('span');
        span.className = 'ruler-tick-label';
        span.style.left = (i * 120 + 4) + 'px';
        span.textContent = String(i * 10);
        rulerH.appendChild(span);
      }
    }

    // Global Canvas Mouse Tracking (crosshairs, glow, coordinates)
    const mainCanvas = document.getElementById('mainCanvas');
    const glowEl = document.getElementById('cursorGlow');
    const crossV = document.getElementById('crosshairV');
    const crossH = document.getElementById('crosshairH');
    const coordX = document.getElementById('coordXDisplay');
    const coordY = document.getElementById('coordYDisplay');

    if (mainCanvas) {
      mainCanvas.addEventListener('mousemove', (e) => {
        const r = mainCanvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        state.mx = mx;
        state.my = my;

        // Coordinates display
        const pad = (v) => String(Math.max(0, Math.round(v))).padStart(4, '0');
        if (coordX) coordX.textContent = pad(mx);
        if (coordY) coordY.textContent = pad(my);

        // Glow
        if (glowEl) {
          if (state.glowOn) {
            glowEl.style.display = 'block';
            glowEl.style.left = mx + 'px';
            glowEl.style.top = my + 'px';
          } else {
            glowEl.style.display = 'none';
          }
        }

        // Crosshairs
        if (crossV && crossH) {
          if (state.crossOn && !state.dragging) {
            crossV.style.display = 'block';
            crossH.style.display = 'block';
            crossV.style.left = mx + 'px';
            crossH.style.top = my + 'px';
          } else {
            crossV.style.display = 'none';
            crossH.style.display = 'none';
          }
        }
      });

      mainCanvas.addEventListener('mouseleave', () => {
        state.mx = null;
        state.my = null;
        if (coordX) coordX.textContent = '----';
        if (coordY) coordY.textContent = '----';
        if (glowEl) glowEl.style.display = 'none';
        if (crossV) crossV.style.display = 'none';
        if (crossH) crossH.style.display = 'none';
      });
    }

    // 3D Scene Drag Events
    const scene = document.getElementById('bvScene');
    if (scene) {
      scene.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        state.dragging = true;
        state.dx = e.clientX;
        state.dy = e.clientY;
        scene.classList.add('dragging');
      });

      window.addEventListener('mousemove', (e) => {
        if (!state.dragging) return;
        const ddx = e.clientX - state.dx;
        const ddy = e.clientY - state.dy;
        state.ry = state.ry + ddx * 0.5;
        state.rx = Math.max(-80, Math.min(-5, state.rx - ddy * 0.4));
        state.dx = e.clientX;
        state.dy = e.clientY;
        updateRigTransform();
      });

      window.addEventListener('mouseup', () => {
        if (state.dragging) {
          state.dragging = false;
          if (scene) scene.classList.remove('dragging');
          updateRigTransform();
        }
      });
    }

    // 3D Navigation Buttons
    const turnLeftBtn = document.getElementById('turnLeftBtn');
    if (turnLeftBtn) {
      turnLeftBtn.addEventListener('click', () => {
        state.ry -= 45;
        updateRigTransform();
      });
    }

    const turnRightBtn = document.getElementById('turnRightBtn');
    if (turnRightBtn) {
      turnRightBtn.addEventListener('click', () => {
        state.ry += 45;
        updateRigTransform();
      });
    }

    const resetViewBtn = document.getElementById('resetViewBtn');
    if (resetViewBtn) {
      resetViewBtn.addEventListener('click', () => {
        state.rx = -24;
        state.ry = -38;
        updateRigTransform();
      });
    }

    // Step navigation
    const prevBtn = document.getElementById('prevStepBtn');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        state.step = Math.max(0, state.step - 1);
        renderBuildSheet();
      });
    }

    const nextBtn = document.getElementById('nextStepBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (state.step === STEPS.length - 1) {
          state.step = 0;
        } else {
          state.step += 1;
        }
        renderBuildSheet();
      });
    }

    // Chat controls
    const chatInput = document.getElementById('chatDraftInput');
    if (chatInput) {
      chatInput.addEventListener('input', (e) => {
        state.draft = e.target.value;
        updateSendButtonState();
      });

      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage(state.draft);
        }
      });
    }

    const sendBtn = document.getElementById('sendChatBtn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => sendChatMessage(state.draft));
    }

    const attachBtn = document.getElementById('chatAttachBtn');
    if (attachBtn) {
      attachBtn.addEventListener('click', () => setTab('files'));
    }

    // Quick Chips in Chat
    const chipSample = document.getElementById('chipSample');
    if (chipSample) chipSample.addEventListener('click', () => setTab('build'));

    const chipNewProj = document.getElementById('chipNewProj');
    if (chipNewProj) {
      chipNewProj.addEventListener('click', () => {
        setTab('projects');
        state.newOpen = true;
        renderProjects();
      });
    }

    const chipHow = document.getElementById('chipHow');
    if (chipHow) chipHow.addEventListener('click', () => setTab('about'));

    // Projects: Open Sample & New Project
    const openSampleBtn = document.getElementById('openSampleProjectBtn');
    if (openSampleBtn) openSampleBtn.addEventListener('click', () => setTab('build'));

    const openNewBtn = document.getElementById('openNewProjectBtn');
    if (openNewBtn) {
      openNewBtn.addEventListener('click', () => {
        state.newOpen = true;
        renderProjects();
        const input = document.getElementById('newProjInput');
        if (input) input.focus();
      });
    }

    const cancelNewBtn = document.getElementById('cancelNewProjectBtn');
    if (cancelNewBtn) {
      cancelNewBtn.addEventListener('click', () => {
        state.newOpen = false;
        state.newName = '';
        renderProjects();
      });
    }

    const addNewBtn = document.getElementById('addNewProjectBtn');
    if (addNewBtn) {
      addNewBtn.addEventListener('click', addProject);
    }

    const newProjInput = document.getElementById('newProjInput');
    if (newProjInput) {
      newProjInput.addEventListener('input', (e) => {
        state.newName = e.target.value;
      });
      newProjInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addProject();
      });
    }

    // Files: Upload & Drag and drop
    const fileInput = document.getElementById('fileUploadInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        handleFilesSelected(e.target.files);
        e.target.value = '';
      });
    }

    const dropzone = document.getElementById('fileDropzone');
    if (dropzone) {
      ['dragenter', 'dragover'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.background = 'rgba(232, 238, 247, 0.15)';
        });
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.background = '';
        });
      });

      dropzone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files) {
          handleFilesSelected(e.dataTransfer.files);
        }
      });
    }

    // About CTA
    const aboutSampleBtn = document.getElementById('aboutSampleBtn');
    if (aboutSampleBtn) aboutSampleBtn.addEventListener('click', () => setTab('build'));

    // Settings Switches
    const glowToggleBtn = document.getElementById('glowToggleBtn');
    if (glowToggleBtn) {
      glowToggleBtn.addEventListener('click', () => {
        state.glowOn = !state.glowOn;
        renderSettings();
      });
    }

    const crossToggleBtn = document.getElementById('crossToggleBtn');
    if (crossToggleBtn) {
      crossToggleBtn.addEventListener('click', () => {
        state.crossOn = !state.crossOn;
        renderSettings();
      });
    }

    const clearAllBtn = document.getElementById('clearAllBtn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        state.messages = [];
        state.history = [];
        renderChatMessages();
        renderHistory();
      });
    }
  }

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
