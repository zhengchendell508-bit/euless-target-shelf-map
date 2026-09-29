(() => {
  'use strict';

  const STORAGE_KEY = 'euless-target-shelves-v4';
  const PREVIOUS_KEY = 'euless-target-shelves-v3';
  const BASE_STAGE_WIDTH = 1250;
  const $ = id => document.getElementById(id);

  const stage = $('mapStage');
  const viewport = $('mapViewport');
  const dialog = $('editor');

  let svg = null;
  let shapes = [];
  let labelsLayer = null;
  let highlightsLayer = null;
  let mode = 'browse';
  let zoom = 1;
  let selectedIndex = null;
  let pinch = null;
  let suppressClickUntil = 0;
  let items = loadItems();

  function loadItems() {
    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(current)) return current.filter(x => x && Number.isInteger(x.shapeIndex));

      const old = JSON.parse(localStorage.getItem(PREVIOUS_KEY) || '[]');
      if (Array.isArray(old)) {
        const migrated = old
          .filter(x => x && Number.isInteger(x.shapeIndex))
          .map(x => ({
            id: x.id || crypto.randomUUID(),
            shapeIndex: x.shapeIndex,
            name: x.name || '',
            levels: Number.isInteger(x.levels) ? x.levels : 5,
            slots: Number.isInteger(x.slots) ? x.slots : (Number.isInteger(x.steps) ? x.steps : 20),
            fontSize: Number(x.fontSize) || 16
          }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch {}
    return [];
  }

  function saveItems() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    render();
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const getItem = shapeIndex => items.find(item => item.shapeIndex === shapeIndex) || null;

  function analyzeShelf(path) {
    const bbox = path.getBBox();
    let angle = bbox.width >= bbox.height ? 0 : 90;

    try {
      const length = path.getTotalLength();
      const samples = [];
      for (let i = 0; i < 28; i++) {
        samples.push(path.getPointAtLength(length * i / 27));
      }

      const cx = samples.reduce((s, p) => s + p.x, 0) / samples.length;
      const cy = samples.reduce((s, p) => s + p.y, 0) / samples.length;
      let xx = 0, yy = 0, xy = 0;

      for (const p of samples) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        xx += dx * dx;
        yy += dy * dy;
        xy += dx * dy;
      }

      angle = 0.5 * Math.atan2(2 * xy, xx - yy) * 180 / Math.PI;
      while (angle <= -90) angle += 180;
      while (angle > 90) angle -= 180;
    } catch {}

    const vertical = Math.abs(angle) >= 65;
    const diagonal = !vertical && Math.abs(angle) >= 15;

    return { bbox, angle, vertical, diagonal };
  }

  function fontPxToSvgUnits(px) {
    const viewBoxWidth = svg?.viewBox?.baseVal?.width || 1600;
    return px * viewBoxWidth / BASE_STAGE_WIDTH;
  }

  function tokenizeVerticalLabel(name) {
    const tokens = String(name).match(/[A-Za-z]+|\d+|[-–—/]+|[^A-Za-z0-9\s]+/g);
    return tokens && tokens.length ? tokens : [String(name)];
  }

  function ensureOverlayLayers() {
    if (!svg) return;

    labelsLayer = svg.querySelector('#Aisle-Labels');
    if (!labelsLayer) {
      labelsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      labelsLayer.id = 'Aisle-Labels';
      labelsLayer.setAttribute('aria-hidden', 'true');
      svg.appendChild(labelsLayer);
    }

    highlightsLayer = svg.querySelector('#Product-Highlights');
    if (!highlightsLayer) {
      highlightsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      highlightsLayer.id = 'Product-Highlights';
      svg.appendChild(highlightsLayer);
    }
  }

  function makeLabel(item, path) {
    const { bbox, vertical, diagonal, angle } = analyzeShelf(path);
    const fontSize = fontPxToSvgUnits(Number(item.fontSize) || 16);
    const gap = fontSize * 1.14;
    const offset = Math.max(fontSize * 0.7, 8);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('font-size', fontSize);

    if (vertical) {
      // Vertical shelf: upright text stacked top-to-bottom, e.g. C / 12 / - / 13.
      const x = bbox.x + bbox.width / 2;
      const y = bbox.y + bbox.height + offset;
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('text-anchor', 'middle');

      tokenizeVerticalLabel(item.name).forEach((token, index) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.textContent = token;
        tspan.setAttribute('x', x);
        tspan.setAttribute('dy', index === 0 ? '0' : gap);
        text.appendChild(tspan);
      });
    } else {
      // Horizontal and diagonal shelves: keep text itself upright and horizontal.
      let x = bbox.x + bbox.width + offset * 0.55;
      let y = bbox.y + bbox.height / 2;

      if (diagonal) {
        x = bbox.x + bbox.width + offset * 0.35;
        y = angle > 0 ? bbox.y + bbox.height + offset * 0.2 : bbox.y - offset * 0.15;
      }

      text.textContent = item.name;
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('text-anchor', 'start');
    }

    return text;
  }

  function renderLabels() {
    if (!labelsLayer) return;
    labelsLayer.replaceChildren();

    // Important: shelf numbers are visible only while editing.
    if (mode !== 'edit') return;

    for (const item of items) {
      const path = shapes[item.shapeIndex];
      if (!path || !item.name) continue;
      labelsLayer.appendChild(makeLabel(item, path));
    }
  }

  function render() {
    shapes.forEach((path, index) => {
      path.classList.toggle('assigned', Boolean(getItem(index)));
      path.classList.toggle('selected', selectedIndex === index);
    });

    $('count').textContent = `${items.length} 个货架已设置`;
    renderLabels();
  }

  function setMode(next) {
    mode = next;
    const isEdit = next === 'edit';

    $('browseMode').classList.toggle('active', !isEdit);
    $('browseMode').setAttribute('aria-pressed', String(!isEdit));
    $('editMode').classList.toggle('active', isEdit);
    $('editMode').setAttribute('aria-pressed', String(isEdit));
    stage.classList.toggle('editing', isEdit);

    $('hint').textContent = isEdit
      ? '编辑模式：显示全部已设置号码。点任意货架可修改号码、层数、格子总数和字体大小。'
      : '购物查看：所有通道号码隐藏，保持地图干净。以后商品高亮点会在这个模式显示。';

    render();
  }

  function openEditor(shapeIndex) {
    const item = getItem(shapeIndex);
    selectedIndex = shapeIndex;
    render();

    $('dialogTitle').textContent = item ? '编辑这个货架' : '设置这个货架';
    $('shelfName').value = item?.name || '';
    $('shelfLevels').value = item?.levels || 5;
    $('shelfSlots').value = item?.slots || 20;
    $('fontSize').value = item?.fontSize || 16;
    $('fontSizeValue').value = item?.fontSize || 16;
    $('deleteBtn').hidden = !item;

    dialog.dataset.shapeIndex = String(shapeIndex);
    dialog.showModal();
    $('shelfName').focus();
  }

  $('fontSize').addEventListener('input', () => {
    $('fontSizeValue').value = $('fontSize').value;
  });

  $('svgMount').addEventListener('click', event => {
    if (mode !== 'edit' || Date.now() < suppressClickUntil || !svg) return;
    const path = event.target.closest?.('#Aisle-Shapes > path');
    if (!path) return;
    openEditor(Number(path.dataset.index));
  });

  $('editorForm').addEventListener('submit', event => {
    event.preventDefault();

    const shapeIndex = Number(dialog.dataset.shapeIndex);
    if (!Number.isInteger(shapeIndex) || !shapes[shapeIndex]) return;

    const name = $('shelfName').value.trim();
    const levels = Number($('shelfLevels').value);
    const slots = Number($('shelfSlots').value);
    const fontSize = Number($('fontSize').value);

    if (!name ||
        !Number.isInteger(levels) || levels < 1 || levels > 30 ||
        !Number.isInteger(slots) || slots < 1 || slots > 200 ||
        !Number.isFinite(fontSize) || fontSize < 8 || fontSize > 40) return;

    const existing = getItem(shapeIndex);
    if (existing) {
      existing.name = name;
      existing.levels = levels;
      existing.slots = slots;
      existing.fontSize = fontSize;
    } else {
      items.push({
        id: crypto.randomUUID(),
        shapeIndex,
        name,
        levels,
        slots,
        fontSize
      });
    }

    saveItems();
    dialog.close();
  });

  $('deleteBtn').addEventListener('click', () => {
    const shapeIndex = Number(dialog.dataset.shapeIndex);
    items = items.filter(item => item.shapeIndex !== shapeIndex);
    saveItems();
    dialog.close();
  });

  $('closeBtn').addEventListener('click', () => dialog.close());

  dialog.addEventListener('close', () => {
    selectedIndex = null;
    render();
  });

  $('browseMode').addEventListener('click', () => setMode('browse'));
  $('editMode').addEventListener('click', () => setMode('edit'));

  function setZoom(value) {
    zoom = clamp(value, 0.65, 3.5);
    stage.style.width = `${Math.round(BASE_STAGE_WIDTH * zoom)}px`;
    $('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
  }

  $('zoomIn').addEventListener('click', () => setZoom(zoom * 1.25));
  $('zoomOut').addEventListener('click', () => setZoom(zoom / 1.25));

  const touchMidpoint = touches => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2
  });

  const touchDistance = touches => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );

  viewport.addEventListener('touchstart', event => {
    if (event.touches.length !== 2) return;
    const center = touchMidpoint(event.touches);
    const rect = viewport.getBoundingClientRect();

    pinch = {
      distance: touchDistance(event.touches),
      zoom,
      contentX: viewport.scrollLeft + center.x - rect.left,
      contentY: viewport.scrollTop + center.y - rect.top
    };

    suppressClickUntil = Date.now() + 700;
  }, { passive: true });

  viewport.addEventListener('touchmove', event => {
    if (event.touches.length !== 2 || !pinch) return;
    event.preventDefault();

    const center = touchMidpoint(event.touches);
    const rect = viewport.getBoundingClientRect();
    setZoom(pinch.zoom * touchDistance(event.touches) / pinch.distance);

    const ratio = zoom / pinch.zoom;
    viewport.scrollLeft = pinch.contentX * ratio - (center.x - rect.left);
    viewport.scrollTop = pinch.contentY * ratio - (center.y - rect.top);
    suppressClickUntil = Date.now() + 700;
  }, { passive: false });

  viewport.addEventListener('touchend', event => {
    if (event.touches.length < 2 && pinch) {
      pinch = null;
      suppressClickUntil = Date.now() + 700;
    }
  }, { passive: true });

  viewport.addEventListener('touchcancel', () => {
    pinch = null;
    suppressClickUntil = Date.now() + 700;
  }, { passive: true });

  $('exportBtn').addEventListener('click', () => {
    const payload = {
      store: 'Euless Target',
      version: 4,
      shelves: items
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = 'Euless_Target_货架设置备份_v4.json';
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  async function loadMap() {
    try {
      const response = await fetch('map.svg');
      if (!response.ok) throw new Error('map');

      const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
      svg = doc.documentElement;
      if (svg.tagName.toLowerCase() === 'parsererror') throw new Error('svg');

      svg.removeAttribute('width');
      svg.removeAttribute('height');
      $('svgMount').append(svg);

      shapes = [...svg.querySelectorAll('#Aisle-Shapes > path')];
      shapes.forEach((path, index) => {
        path.dataset.index = index;
        path.setAttribute('tabindex', '-1');
      });

      ensureOverlayLayers();
      render();
    } catch {
      $('hint').textContent = '地图加载失败，请确认 index.html、styles.css、app.js、map.svg 四个文件在同一目录。';
    }
  }

  setMode('browse');
  setZoom(1);
  loadMap();
})();
