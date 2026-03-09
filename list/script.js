const STORAGE_KEY = 'list_v1_items';

// =========================================================
//  DATA
// =========================================================
let items = [];

function loadItems() {
  try {
    items = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    items = [];
  }
  renderList();
}

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function addItem(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  items.unshift({ id: Date.now(), text: trimmed });
  saveItems();
  renderList(/* animateFirst= */ true);
  renderMeta();
  return true;
}

function removeItem(id) {
  items = items.filter(item => item.id !== id);
  saveItems();
  renderMeta();
}

// =========================================================
//  RENDER
// =========================================================
function renderList(animateFirst = false) {
  const list  = document.getElementById('list');
  const empty = document.getElementById('empty-state');

  list.innerHTML = '';

  if (items.length === 0) {
    empty.classList.add('visible');
    return;
  }

  empty.classList.remove('visible');

  items.forEach((item, i) => {
    const li = createListItem(item, animateFirst && i === 0);
    list.appendChild(li);
  });
}

// =========================================================
//  DRAG AND DROP
// =========================================================
let dragSrcId = null;

function addDragListeners(li, id) {
  li.draggable = true;

  li.addEventListener('dragstart', (e) => {
    if (li.classList.contains('completing') || li.classList.contains('removing')) {
      e.preventDefault();
      return;
    }
    dragSrcId = id;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => li.classList.add('dragging'), 0);
  });

  li.addEventListener('dragend', () => {
    dragSrcId = null;
    document.querySelectorAll('.list-item').forEach(el =>
      el.classList.remove('dragging', 'drag-above', 'drag-below')
    );
  });

  li.addEventListener('dragover', (e) => {
    if (dragSrcId === null || dragSrcId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const mid = li.getBoundingClientRect().top + li.getBoundingClientRect().height / 2;
    li.classList.toggle('drag-above', e.clientY < mid);
    li.classList.toggle('drag-below', e.clientY >= mid);
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('drag-above', 'drag-below');
  });

  li.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragSrcId === null || dragSrcId === id) return;

    const mid = li.getBoundingClientRect().top + li.getBoundingClientRect().height / 2;
    const insertBefore = e.clientY < mid;

    const srcIdx = items.findIndex(i => i.id === dragSrcId);
    const [moved] = items.splice(srcIdx, 1);
    const dstIdx = items.findIndex(i => i.id === id);
    items.splice(insertBefore ? dstIdx : dstIdx + 1, 0, moved);

    saveItems();
    renderList();
  });
}

function createListItem(item, animate) {
  const li = document.createElement('li');
  li.className = 'list-item' + (animate ? ' fresh' : '');
  li.dataset.id = item.id;

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.setAttribute('aria-hidden', 'true');

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'item-check';
  check.setAttribute('aria-label', 'Complete item');

  const span = document.createElement('span');
  span.className = 'item-text';
  span.textContent = item.text;

  check.addEventListener('change', () => completeItem(item.id, li));
  addDragListeners(li, item.id);

  li.appendChild(handle);
  li.appendChild(check);
  li.appendChild(span);
  return li;
}

function completeItem(id, el) {
  // Phase 1: draw strikethrough
  el.classList.add('completing');

  // Phase 2: collapse and remove after strikethrough finishes
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => {
      el.remove();
      removeItem(id);
      if (items.length === 0) {
        document.getElementById('empty-state').classList.add('visible');
      }
    }, 500);
  }, 1500);
}

// =========================================================
//  META (date + count)
// =========================================================
function renderMeta() {
  const countEl = document.getElementById('count-display');

  const n = items.length;
  countEl.textContent = n === 0
    ? 'empty'
    : n === 1 ? '1 item' : `${n} items`;
}

// =========================================================
//  ADD FORM
// =========================================================
document.getElementById('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('add-input');
  if (addItem(input.value)) {
    input.value = '';
  }
  input.focus();
});

loadItems();
renderMeta();
