(() => {
  'use strict';

  const STORAGE_KEY = 'euless-target-shelves-v3';
  const BASE_STAGE_WIDTH = 1250;
  const $ = id => document.getElementById(id);

  const stage = $('mapStage');
  const viewport = $('mapViewport');
  const dialog = $('editor');

  let svg = null;
  let shapes = [];
  let labelsLayer = null;
  let mode = 'browse';
  let zoom = 1;
  let selectedIndex = null;
  let pinch = null;
  let suppressClickUntil = 0;
  let items = loadItems();

  function loadItems() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => item && Number.isInteger(item.shapeIndex)) : [];
    } catch {
      return [];
    }
  }

  function saveItems() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    render();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getItem(shapeIndex) {
    return items.find(item => item.shapeIndex === shapeIndex) || null;
  }

  function getPathGeometry(path) {
    const bbox = path.getBBox();
    let angle = bbox.width >= bbox.height ? 0 : 90;

    try {
      const length = path.getTotalLength();
      const samples = [];
      const count = 28;
      for (let i = 0; i < count; i++) {
        const p = path.getPointAtLength(length * i / (count - 1));
        samples.push({ x: p.x, y: p.y });
      }

      const cx = samples.reduce((sum, p) => sum + p.x, 0) / samples.length;
      const cy = samples.reduce((sum, p) => sum + p.y, 0) / samples.length;
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

      if (Math.abs(angle) < 12) angle = 0;
      if (Math.abs(angle) > 78) angle = 90;
    } catch {
      // Keep bbox fallback.
    }

    const offset = 0.65;
    let x;
    let y;
    let anchor = 'start';

    if (angle === 0) {
      x = bbox.x + bbox.width + offset;
      y = bbox.y + bbox.height / 2;
    } else if (angle === 90) {
      x = bbox.x + bbox.width / 2;
      y = bbox.y + bbox.height + offset;
    } else if (angle > 0) {
      x = bbox.x + bbox.width + offset * 0.7;
      y = bbox.y + bbox.height + offset * 0.25;
    } else {
      x = bbox.x + bbox.width + offset * 0.7;
      y = bbox.y - offset * 0.25;
    }

    return { x, y, angle, anchor };
  }

  function fontPxToSvgUnits(px) {
    const viewBoxWidth = svg?.viewBox?.baseVal?.width || 163.73395825254545;
    return px * viewBoxWidth / BASE_STAGE_WIDTH;
  }

  function ensureLabelsLayer() {
    if (!svg) return;
    labelsLayer = svg.querySelector('#Aisle-Labels');
    if (!labelsLayer) {
      labelsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      labelsLayer.id = 'Aisle-Labels';
      labelsLayer.setAttribute('aria-hidden', 'true');
      svg.appendChild(labelsLayer);
    }
  }

  function renderLabels() {
    if (!svg || !labelsLayer) return;
    labelsLayer.replaceChildren();

    for (const item of items) {
      const path = shapes[item.shapeIndex];
      if (!path || !item.name) continue;

      const g = getPathGeometry(path);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.textContent = item.name;
      text.setAttribute('x', g.x);
      text.setAttribute('y', g.y);
      text.setAttribute('text-anchor', g.anchor);
      text.setAttribute('font-size', fontPxToSvgUnits(Number(item.fontSize) || 16));
      text.setAttribute('transform', `rotate(${g.angle} ${g.x} ${g.y})`);
      labelsLayer.appendChild(text);
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
      ? '编辑模式：点选任意灰色货架，设置号码、层数、步数和字体大小。'
      : '查看模式：拖动或双指缩放地图。进入“编辑货架”后点选任意灰色货架。';
  }

  function openEditor(shapeIndex) {
    const item = getItem(shapeIndex);
    selectedIndex = shapeIndex;
    render();

    $('dialogTitle').textContent = item ? '编辑这个货架' : '设置这个货架';
    $('shelfName').value = item?.name || '';
    $('shelfLevels').value = item?.levels || 5;
    $('shelfSteps').value = item?.steps || 20;
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
    const steps = Number($('shelfSteps').value);
    const fontSize = Number($('fontSize').value);

    if (!name || !Number.isInteger(levels) || levels < 1 || levels > 30 ||
        !Number.isInteger(steps) || steps < 1 || steps > 500 ||
        !Number.isFinite(fontSize) || fontSize < 8 || fontSize > 40) return;

    const existing = getItem(shapeIndex);
    if (existing) {
      existing.name = name;
      existing.levels = levels;
      existing.steps = steps;
      existing.fontSize = fontSize;
    } else {
      items.push({
        id: crypto.randomUUID(),
        shapeIndex,
        name,
        levels,
        steps,
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
      version: 3,
      shelves: items
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Euless_Target_货架设置备份.json';
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

      ensureLabelsLayer();
      render();
    } catch {
      $('hint').textContent = '地图加载失败，请刷新页面重试。';
    }
  }

  setMode('browse');
  setZoom(1);
  loadMap();
})();
