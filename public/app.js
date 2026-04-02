// Car Flipper — Frontend App
let token = localStorage.getItem('token');
let currentUser = null;
let vehicles = [];
let currentVehicleId = null;
let currentVehicle = null;
let filterStatusVal = 'all';
let editingVehicle = null;
let inviteToken = null;

// ---- Init ----
window.addEventListener('DOMContentLoaded', () => {
  // Register SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }
  // Upload drag/drop
  const zone = document.getElementById('upload-zone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); uploadPhotosFromFiles(e.dataTransfer.files); });
  }
  // Check for invite token in URL
  const params = new URLSearchParams(window.location.search);
  inviteToken = params.get('invite');
  if (inviteToken) {
    showAuthTab('invite');
  } else if (token) {
    initApp();
  }
});

async function initApp() {
  try {
    const me = await apiFetch('/api/auth/me');
    currentUser = me;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';
    document.getElementById('user-org').textContent = me.orgName || '';
    const initials = ((me.firstName || '')[0] || '').toUpperCase() + ((me.lastName || '')[0] || '').toUpperCase();
    document.getElementById('user-avatar').textContent = initials || '?';
    // Show/hide invite button based on role
    const inviteBtn = document.querySelector('#page-team .page-header button');
    if (inviteBtn) inviteBtn.style.display = me.role === 'owner' ? '' : 'none';
    await loadVehicles();
    renderDashboard();
    // Show dashboard page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-dashboard').classList.add('active');
  } catch (e) {
    token = null; localStorage.removeItem('token');
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
  }
}

// ---- API ----
async function apiFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json();
  if (res.status === 401) { doLogout(); return null; }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---- Auth ----
function showAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('signup-form').style.display = 'none';
  document.getElementById('invite-form').style.display = 'none';
  if (tab === 'login') {
    document.querySelectorAll('.auth-tab')[0].classList.add('active');
    document.getElementById('login-form').style.display = 'block';
  } else if (tab === 'signup') {
    document.querySelectorAll('.auth-tab')[1].classList.add('active');
    document.getElementById('signup-form').style.display = 'block';
  } else if (tab === 'invite') {
    // Hide tabs for invite flow
    document.querySelectorAll('.auth-tab').forEach(t => t.style.display = 'none');
    document.getElementById('invite-form').style.display = 'block';
  }
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  document.getElementById('login-error').textContent = '';
  if (!email || !pass) { document.getElementById('login-error').textContent = 'Please fill in all fields'; return; }
  try {
    const res = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: pass }) });
    if (!res) return;
    token = res.token; localStorage.setItem('token', token);
    currentUser = res.user;
    initApp();
  } catch (e) { document.getElementById('login-error').textContent = e.message; }
}

async function doSignup() {
  const orgName = document.getElementById('su-org').value.trim();
  const firstName = document.getElementById('su-first').value.trim();
  const lastName = document.getElementById('su-last').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-pass').value;
  document.getElementById('signup-error').textContent = '';
  if (!orgName || !firstName || !lastName || !email || !password) {
    document.getElementById('signup-error').textContent = 'All fields are required'; return;
  }
  try {
    const res = await apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ orgName, firstName, lastName, email, password }) });
    if (!res) return;
    token = res.token; localStorage.setItem('token', token);
    currentUser = res.user;
    initApp();
  } catch (e) { document.getElementById('signup-error').textContent = e.message; }
}

async function doAcceptInvite() {
  const password = document.getElementById('inv-pass').value;
  document.getElementById('invite-error').textContent = '';
  if (!password) { document.getElementById('invite-error').textContent = 'Password required'; return; }
  try {
    const res = await apiFetch('/api/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token: inviteToken, password }) });
    if (!res) return;
    token = res.token; localStorage.setItem('token', token);
    window.history.replaceState({}, '', '/');
    inviteToken = null;
    initApp();
  } catch (e) { document.getElementById('invite-error').textContent = e.message; }
}

function doLogout() {
  token = null; currentUser = null; vehicles = []; currentVehicle = null; currentVehicleId = null;
  localStorage.removeItem('token');
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  showAuthTab('login');
}

// ---- Mobile Menu ----
function toggleMobileMenu() {
  const nav = document.getElementById('mobile-nav');
  nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
}

function closeMobileMenu() {
  const nav = document.getElementById('mobile-nav');
  if (nav) nav.style.display = 'none';
}

// ---- Navigation ----
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const pageEl = document.getElementById('page-' + name);
  if (pageEl) pageEl.classList.add('active');
  // Highlight matching nav button
  document.querySelectorAll('#topbar-nav .nav-btn').forEach(b => {
    if (b.textContent.toLowerCase().includes(name === 'detail' ? 'inventory' : name)) b.classList.add('active');
  });
  if (name === 'inventory') renderInventory();
  if (name === 'dashboard') renderDashboard();
  if (name === 'team') loadTeam();
}

// ---- Vehicles ----
async function loadVehicles() {
  try {
    vehicles = await apiFetch('/api/vehicles');
    if (!vehicles) vehicles = [];
  } catch (e) { vehicles = []; }
}

function renderDashboard() {
  const active = vehicles.filter(v => v.status !== 'sold');
  const sold = vehicles.filter(v => v.status === 'sold');
  const totalInvested = active.reduce((s, v) => s + (v.purchase_price || 0), 0);
  const portfolio = active.reduce((s, v) => s + (v.kbb_value || 0), 0);
  let totalProfit = 0;
  sold.forEach(v => { if (v.sell_price) totalProfit += (v.sell_price || 0) - (v.purchase_price || 0) - (v.total_expenses || 0); });
  document.getElementById('stat-active').textContent = active.length;
  document.getElementById('stat-invested').textContent = '$' + totalInvested.toLocaleString();
  document.getElementById('stat-portfolio').textContent = portfolio ? '$' + portfolio.toLocaleString() : '—';
  const profEl = document.getElementById('stat-profit');
  profEl.textContent = (totalProfit >= 0 ? '+' : '') + '$' + Math.abs(totalProfit).toLocaleString();
  profEl.className = 'stat-value ' + (totalProfit >= 0 ? 'green' : 'red');
  document.getElementById('dash-vehicles').innerHTML = renderVehicleCards(vehicles.slice(0, 6));
}

function renderInventory() {
  const filtered = filterStatusVal === 'all' ? vehicles : vehicles.filter(v => v.status === filterStatusVal);
  document.getElementById('inv-vehicles').innerHTML = filtered.length
    ? renderVehicleCards(filtered)
    : `<div class="empty-state" style="grid-column:1/-1"><div class="icon">&#128663;</div><h3>No vehicles</h3><p>${filterStatusVal !== 'all' ? 'No ' + filterStatusVal + ' vehicles' : 'Add your first vehicle'}</p></div>`;
}

function filterStatus(s) { filterStatusVal = s; renderInventory(); }

function renderVehicleCards(list) {
  if (!list.length) return `<div class="empty-state" style="grid-column:1/-1"><div class="icon">&#128663;</div><h3>No vehicles yet</h3><p>Click "+ Add Vehicle" to add your first car</p></div>`;
  return list.map(v => {
    const totalExp = v.total_expenses || 0;
    const estProfit = v.kbb_value != null ? v.kbb_value - v.purchase_price - totalExp : null;
    const actProfit = v.sell_price != null ? v.sell_price - v.purchase_price - totalExp : null;
    const profitVal = actProfit !== null ? actProfit : estProfit;
    const profitLabel = actProfit !== null ? 'Profit' : 'Est.';
    const profitStr = profitVal !== null
      ? `<span class="${profitVal >= 0 ? 'profit-positive' : 'profit-negative'}">${profitLabel} ${profitVal >= 0 ? '+' : ''}$${Math.round(profitVal).toLocaleString()}</span>`
      : '';
    const thumb = v.thumb_filename
      ? `<img src="/uploads/vehicles/${v.id}/${v.thumb_filename}" alt="" style="width:100%;height:100%;object-fit:cover">`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px">&#128663;</div>`;
    return `<div class="vehicle-card" onclick="openVehicle('${v.id}')">
      <div class="vehicle-thumb">${thumb}</div>
      <div class="vehicle-info">
        <div class="vehicle-title">${esc(v.year || '')} ${esc(v.make || '')} ${esc(v.model || '')}</div>
        <div class="vehicle-sub">${esc(v.trim || '')} ${v.color ? '&bull; ' + esc(v.color) : ''}</div>
        <div class="vehicle-stats">
          <span class="vehicle-price">$${(v.purchase_price || 0).toLocaleString()}</span>
          <span class="status-badge status-${v.status}">${v.status}</span>
        </div>
        <div style="margin-top:8px">${profitStr}</div>
      </div>
    </div>`;
  }).join('');
}

// ---- Vehicle Detail ----
async function openVehicle(id) {
  currentVehicleId = id;
  showPage('detail');
  await loadVehicleDetail(id);
}

async function loadVehicleDetail(id) {
  try {
    currentVehicle = await apiFetch('/api/vehicles/' + id);
    if (!currentVehicle) return;
    const v = currentVehicle;
    document.getElementById('det-title').textContent = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown';
    document.getElementById('det-sub').textContent = [v.trim, v.color].filter(Boolean).join(' \u2022 ');
    const badge = document.getElementById('det-status-badge');
    badge.textContent = v.status; badge.className = 'status-badge status-' + v.status;
    // Status select
    const sel = document.getElementById('ov-status-select');
    if (sel) sel.value = v.status;
    // Overview
    document.getElementById('ov-buy').textContent = '$' + (v.purchase_price || 0).toLocaleString();
    document.getElementById('ov-exp').textContent = '-$' + ((v.summary && v.summary.total_expenses) || 0).toLocaleString();
    document.getElementById('ov-kbb').textContent = v.kbb_value ? '$' + v.kbb_value.toLocaleString() : '—';
    // Estimated profit
    const ep = document.getElementById('ov-est');
    const estP = v.summary ? v.summary.estimated_profit : null;
    ep.textContent = estP !== null ? (estP >= 0 ? '+' : '') + '$' + Math.round(estP).toLocaleString() : '—';
    ep.style.color = estP !== null ? (estP >= 0 ? 'var(--green)' : 'var(--red)') : '';
    // Sell + actual profit
    document.getElementById('ov-sell').textContent = v.sell_price ? '$' + v.sell_price.toLocaleString() : '—';
    const ap = document.getElementById('ov-profit');
    const actP = v.summary ? v.summary.actual_profit : null;
    if (actP !== null && actP !== undefined) {
      ap.textContent = (actP >= 0 ? '+' : '') + '$' + Math.round(actP).toLocaleString();
      ap.style.color = actP >= 0 ? 'var(--green)' : 'var(--red)';
    } else { ap.textContent = '—'; ap.style.color = ''; }
    document.getElementById('ov-vin').textContent = v.vin || '—';
    document.getElementById('ov-color').textContent = v.color || '—';
    document.getElementById('ov-pdate').textContent = v.purchase_date || '—';
    document.getElementById('ov-sdate').textContent = v.sell_date || '—';
    // Set active tab to overview
    showDetailTab('overview');
    // Populate all panels
    renderChecklist(v.checklist);
    renderExpenses(v.expenses);
    renderPhotos(v.photos, id);
    document.getElementById('notes-area').value = v.notes || '';
  } catch (e) { showToast('Error loading vehicle'); }
}

function showDetailTab(name) {
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.detail-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  // Find and activate the right tab button
  const tabNames = ['overview','checklist','expenses','photos','notes'];
  const tabs = document.querySelectorAll('.detail-tab');
  const idx = tabNames.indexOf(name);
  if (idx !== -1 && tabs[idx]) tabs[idx].classList.add('active');
}

// ---- Change Vehicle Status ----
async function changeVehicleStatus(newStatus) {
  if (!currentVehicleId) return;
  try {
    const data = await apiFetch('/api/vehicles/' + currentVehicleId, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    if (!data) return;
    currentVehicle = { ...currentVehicle, ...data };
    const badge = document.getElementById('det-status-badge');
    badge.textContent = newStatus; badge.className = 'status-badge status-' + newStatus;
    await loadVehicles();
    showToast('Status updated to ' + newStatus);
  } catch (e) { showToast('Failed to update status'); }
}

// ---- Checklist ----
function renderChecklist(items) {
  const el = document.getElementById('checklist-list');
  if (!el) return;
  if (!items || !items.length) { el.innerHTML = '<div style="color:var(--muted);font-size:14px;padding:8px 0">No checklist items yet</div>'; return; }
  const catLabel = { mechanical: 'Mechanical', bodywork: 'Bodywork', other: 'Other' };
  el.innerHTML = items.map(i => `
    <div class="checklist-item ${i.completed ? 'completed' : ''}" data-id="${i.id}">
      <div class="check-box ${i.completed ? 'checked' : ''}" onclick="toggleChecklist('${i.id}', ${!i.completed})">${i.completed ? '&#10003;' : ''}</div>
      <div class="item-desc">${esc(i.description)}</div>
      <span class="item-cat">${catLabel[i.category] || i.category}</span>
      <button class="item-delete" onclick="deleteChecklistItem('${i.id}')">&#10005;</button>
    </div>`).join('');
}

async function addChecklistItem() {
  const desc = document.getElementById('cl-desc').value.trim();
  const cat = document.getElementById('cl-cat').value;
  if (!desc) { showToast('Description required'); return; }
  try {
    const item = await apiFetch(`/api/vehicles/${currentVehicleId}/checklist`, { method: 'POST', body: JSON.stringify({ description: desc, category: cat }) });
    if (currentVehicle && item) currentVehicle.checklist.push(item);
    document.getElementById('cl-desc').value = '';
    renderChecklist(currentVehicle ? currentVehicle.checklist : []);
    showToast('Item added');
  } catch (e) { showToast('Error adding item'); }
}

async function toggleChecklist(itemId, completed) {
  try {
    const updated = await apiFetch(`/api/vehicles/${currentVehicleId}/checklist/${itemId}`, { method: 'PATCH', body: JSON.stringify({ completed }) });
    if (currentVehicle && updated) {
      const idx = currentVehicle.checklist.findIndex(i => i.id === itemId);
      if (idx !== -1) currentVehicle.checklist[idx] = updated;
    }
    renderChecklist(currentVehicle ? currentVehicle.checklist : []);
  } catch (e) {}
}

async function deleteChecklistItem(itemId) {
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}/checklist/${itemId}`, { method: 'DELETE' });
    if (currentVehicle) currentVehicle.checklist = currentVehicle.checklist.filter(i => i.id !== itemId);
    renderChecklist(currentVehicle ? currentVehicle.checklist : []);
  } catch (e) {}
}

// ---- Expenses ----
function renderExpenses(items) {
  const el = document.getElementById('expenses-list');
  const tot = document.getElementById('exp-total');
  if (!el) return;
  if (!items || !items.length) { el.innerHTML = '<div style="color:var(--muted);font-size:14px;padding:8px 0">No expenses yet</div>'; if(tot) tot.textContent = ''; return; }
  const catLabel = { parts: 'Parts', labor: 'Labor', fees: 'Fees', other: 'Other' };
  el.innerHTML = items.map(i => `
    <div class="expense-item">
      <div style="flex:1">
        <div class="expense-desc">${esc(i.description || i.category)}</div>
        <div class="expense-meta">${catLabel[i.category] || i.category}${i.date ? ' &bull; ' + i.date : ''}</div>
      </div>
      <div class="expense-amount">-$${parseFloat(i.amount || 0).toLocaleString()}</div>
      <button class="expense-delete" onclick="deleteExpense('${i.id}')">&#10005;</button>
    </div>`).join('');
  const total = items.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
  if (tot) tot.innerHTML = `Total Expenses: <span>-$${total.toLocaleString()}</span>`;
}

async function addExpense() {
  const cat = document.getElementById('exp-cat').value;
  const desc = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value);
  const date = document.getElementById('exp-date').value;
  if (!amount || isNaN(amount)) { showToast('Valid amount required'); return; }
  try {
    const exp = await apiFetch(`/api/vehicles/${currentVehicleId}/expenses`, {
      method: 'POST', body: JSON.stringify({ category: cat, description: desc, amount, date: date || null })
    });
    if (currentVehicle && exp) {
      currentVehicle.expenses.unshift(exp);
      const total = currentVehicle.expenses.reduce((s, e) => s + (e.amount || 0), 0);
      if (currentVehicle.summary) {
        currentVehicle.summary.total_expenses = total;
        currentVehicle.summary.estimated_profit = currentVehicle.kbb_value != null ? currentVehicle.kbb_value - currentVehicle.purchase_price - total : null;
        currentVehicle.summary.actual_profit = currentVehicle.sell_price != null ? currentVehicle.sell_price - currentVehicle.purchase_price - total : null;
      }
    }
    document.getElementById('exp-desc').value = '';
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-date').value = '';
    renderExpenses(currentVehicle ? currentVehicle.expenses : []);
    // Update overview totals
    if (currentVehicle && currentVehicle.summary) {
      document.getElementById('ov-exp').textContent = '-$' + (currentVehicle.summary.total_expenses || 0).toLocaleString();
    }
    showToast('Expense added');
  } catch (e) { showToast('Error adding expense'); }
}

async function deleteExpense(expId) {
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}/expenses/${expId}`, { method: 'DELETE' });
    if (currentVehicle) {
      currentVehicle.expenses = currentVehicle.expenses.filter(e => e.id !== expId);
      const total = currentVehicle.expenses.reduce((s, e) => s + (e.amount || 0), 0);
      if (currentVehicle.summary) currentVehicle.summary.total_expenses = total;
    }
    renderExpenses(currentVehicle ? currentVehicle.expenses : []);
  } catch (e) {}
}

// ---- Photos ----
function renderPhotos(photos, vehicleId) {
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  const vid = vehicleId || currentVehicleId;
  if (!photos || !photos.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = photos.map(p => `
    <div class="photo-item" id="photo-${p.id}">
      <img src="${p.url || '/uploads/vehicles/' + vid + '/' + p.filename}" onclick="openLightbox(this.src)" alt="">
      <button class="photo-delete" onclick="deletePhoto('${p.id}', event)">&#10005;</button>
    </div>`).join('');
}

// Compress image to max 1600px wide, quality 0.85, max ~1.5MB
function compressImage(file) {
  return new Promise(resolve => {
    if (!file.type.startsWith('image/')) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1600;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      else if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', 0.85);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

async function uploadPhotos(input) {
  await uploadPhotosFromFiles(input.files);
  input.value = '';
}

async function uploadPhotosFromFiles(files) {
  if (!files || !files.length) return;
  showToast('Compressing photos...');
  const form = new FormData();
  for (const f of files) {
    const compressed = await compressImage(f);
    form.append('photos', compressed);
  }
  try {
    const res = await fetch(`/api/vehicles/${currentVehicleId}/photos`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // Reload full vehicle to get updated photo list with URLs
    currentVehicle = await apiFetch('/api/vehicles/' + currentVehicleId);
    renderPhotos(currentVehicle ? currentVehicle.photos : [], currentVehicleId);
    await loadVehicles();
    showToast(data.length + ' photo' + (data.length > 1 ? 's' : '') + ' uploaded');
  } catch (e) { showToast('Error uploading photos'); }
}

async function deletePhoto(photoId, e) {
  e.stopPropagation();
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}/photos/${photoId}`, { method: 'DELETE' });
    document.getElementById('photo-' + photoId)?.remove();
    if (currentVehicle) currentVehicle.photos = currentVehicle.photos.filter(p => p.id !== photoId);
    await loadVehicles();
  } catch (e) { showToast('Error deleting photo'); }
}

function openLightbox(src) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }

// ---- Notes ----
async function saveNotes() {
  const notes = document.getElementById('notes-area').value;
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}`, { method: 'PATCH', body: JSON.stringify({ notes }) });
    if (currentVehicle) currentVehicle.notes = notes;
    showToast('Notes saved');
    await loadVehicles();
  } catch (e) { showToast('Error saving notes'); }
}

// ---- Add/Edit Vehicle Modal ----
function openAddModal() {
  editingVehicle = null;
  document.getElementById('vehicle-modal-title').textContent = 'Add Vehicle';
  document.getElementById('vehicle-modal-save').textContent = 'Add Vehicle';
  ['v-year','v-make','v-model','v-trim','v-vin','v-color','v-buy','v-kbb','v-sell'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('v-pdate').value = '';
  document.getElementById('v-sdate').value = '';
  document.getElementById('v-status').value = 'active';
  openModal('vehicle-modal');
}

function openEditModal() {
  const v = currentVehicle || vehicles.find(x => x.id === currentVehicleId);
  if (!v) return;
  editingVehicle = v;
  document.getElementById('vehicle-modal-title').textContent = 'Edit Vehicle';
  document.getElementById('vehicle-modal-save').textContent = 'Save Changes';
  document.getElementById('v-year').value = v.year || '';
  document.getElementById('v-make').value = v.make || '';
  document.getElementById('v-model').value = v.model || '';
  document.getElementById('v-trim').value = v.trim || '';
  document.getElementById('v-vin').value = v.vin || '';
  document.getElementById('v-color').value = v.color || '';
  document.getElementById('v-buy').value = v.purchase_price || '';
  document.getElementById('v-pdate').value = v.purchase_date || '';
  document.getElementById('v-kbb').value = v.kbb_value || '';
  document.getElementById('v-status').value = v.status || 'active';
  document.getElementById('v-sell').value = v.sell_price || '';
  document.getElementById('v-sdate').value = v.sell_date || '';
  openModal('vehicle-modal');
}

async function saveVehicle() {
  const body = {
    year: parseInt(document.getElementById('v-year').value) || null,
    make: document.getElementById('v-make').value.trim(),
    model: document.getElementById('v-model').value.trim(),
    trim: document.getElementById('v-trim').value.trim(),
    vin: document.getElementById('v-vin').value.trim(),
    color: document.getElementById('v-color').value.trim(),
    purchase_price: parseFloat(document.getElementById('v-buy').value) || 0,
    purchase_date: document.getElementById('v-pdate').value || null,
    kbb_value: parseFloat(document.getElementById('v-kbb').value) || null,
    status: document.getElementById('v-status').value,
    sell_price: parseFloat(document.getElementById('v-sell').value) || null,
    sell_date: document.getElementById('v-sdate').value || null,
  };
  try {
    if (editingVehicle) {
      await apiFetch('/api/vehicles/' + editingVehicle.id, { method: 'PATCH', body: JSON.stringify(body) });
      closeModal('vehicle-modal');
      await loadVehicles();
      await loadVehicleDetail(editingVehicle.id);
      showToast('Vehicle updated');
    } else {
      const newV = await apiFetch('/api/vehicles', { method: 'POST', body: JSON.stringify(body) });
      closeModal('vehicle-modal');
      await loadVehicles();
      renderDashboard();
      showToast('Vehicle added!');
    }
  } catch (e) { showToast('Error saving vehicle'); }
}

async function deleteVehicle() {
  if (!confirm('Delete this vehicle? This cannot be undone.')) return;
  try {
    await apiFetch('/api/vehicles/' + currentVehicleId, { method: 'DELETE' });
    currentVehicle = null; currentVehicleId = null;
    await loadVehicles();
    showPage('inventory');
    showToast('Vehicle deleted');
  } catch (e) { showToast('Error deleting vehicle'); }
}

// ---- Team ----
async function loadTeam() {
  try {
    const members = await apiFetch('/api/team');
    if (!members) return;
    const isOwner = currentUser && currentUser.role === 'owner';
    let html = members.map(m => `
      <div class="team-member">
        <div class="avatar">${((m.first_name || '')[0] || '').toUpperCase() + ((m.last_name || '')[0] || '').toUpperCase()}</div>
        <div class="member-info">
          <div class="member-name">${esc(m.first_name)} ${esc(m.last_name)}</div>
          <div class="member-email">${esc(m.email)}${!m.invite_accepted ? ' <span style="color:var(--yellow);font-size:11px">(pending invite)</span>' : ''}</div>
        </div>
        <span class="role-badge">${m.role}</span>
        ${isOwner && currentUser && m.id !== currentUser.id
          ? `<button class="btn btn-danger btn-sm" onclick="removeMember('${m.id}','${esc(m.first_name)} ${esc(m.last_name)}')">Remove</button>`
          : ''}
      </div>`).join('');
    document.getElementById('team-list').innerHTML = html || '<div style="color:var(--muted)">No team members</div>';
    // Show/hide invite button
    const inviteBtn = document.querySelector('#page-team .page-header button');
    if (inviteBtn) inviteBtn.style.display = isOwner ? '' : 'none';
  } catch (e) { showToast('Error loading team'); }
}

async function removeMember(userId, name) {
  if (!confirm('Remove ' + name + ' from the team?')) return;
  try {
    await apiFetch('/api/team/' + userId, { method: 'DELETE' });
    showToast('Member removed');
    loadTeam();
  } catch (e) { showToast(e.message || 'Remove failed'); }
}

function openInviteModal() {
  const firstEl = document.getElementById('invite-first');
  const lastEl = document.getElementById('invite-last');
  const emailEl = document.getElementById('invite-email');
  if (firstEl) firstEl.value = '';
  if (lastEl) lastEl.value = '';
  if (emailEl) emailEl.value = '';
  document.getElementById('invite-result').innerHTML = '';
  openModal('invite-modal');
}

async function sendInvite() {
  const firstName = (document.getElementById('invite-first')?.value || '').trim();
  const lastName = (document.getElementById('invite-last')?.value || '').trim();
  const email = document.getElementById('invite-email').value.trim();
  if (!firstName || !lastName || !email) {
    document.getElementById('invite-result').innerHTML = '<p style="color:var(--red);font-size:13px">All fields required</p>';
    return;
  }
  try {
    const res = await apiFetch('/api/auth/invite', { method: 'POST', body: JSON.stringify({ email, firstName, lastName }) });
    if (!res) return;
    const link = `${window.location.origin}/?invite=${res.inviteToken}`;
    document.getElementById('invite-result').innerHTML = `
      <div style="font-size:13px;color:var(--green);margin-top:12px">&#10003; Invite created for ${esc(email)}</div>
      <div style="font-size:13px;color:var(--muted);margin-top:8px">Share this link:</div>
      <div class="invite-token-box">${link}</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="navigator.clipboard.writeText('${link}').then(()=>showToast('Link copied!'))">Copy Link</button>`;
    loadTeam();
  } catch (e) { showToast(e.message || 'Invite failed'); }
}

// ---- Modal helpers ----
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Close modal on backdrop click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

// ---- Toast ----
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ---- HTML Escape ----
function esc(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Enter key handlers
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.activeElement.id === 'login-pass' || document.activeElement.id === 'login-email') doLogin();
    if (document.activeElement.id === 'cl-desc') addChecklistItem();
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    closeLightbox();
  }
});
