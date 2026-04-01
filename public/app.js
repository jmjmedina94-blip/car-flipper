// Car Flipper — Frontend App
const API = '';
let token = localStorage.getItem('cf_token');
let currentUser = null;
let vehicles = [];
let currentVehicleId = null;
let filterStatusVal = 'all';
let editingVehicle = null;
let inviteToken = null;

// ---- Init ----
window.addEventListener('DOMContentLoaded', () => {
  // Check for invite token in URL
  const params = new URLSearchParams(window.location.search);
  inviteToken = params.get('invite');
  if (inviteToken) {
    showAuthTab('invite');
  } else if (token) {
    initApp();
  }
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
});

async function initApp() {
  try {
    const me = await apiFetch('/api/auth/me');
    currentUser = me;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';
    document.getElementById('user-org').textContent = me.orgName;
    document.getElementById('user-avatar').textContent = me.firstName[0].toUpperCase();
    await loadVehicles();
    renderDashboard();
  } catch (e) {
    token = null; localStorage.removeItem('cf_token');
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
  }
}

// ---- API ----
async function apiFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + url, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---- Auth ----
function showAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('signup-form').style.display = 'none';
  document.getElementById('invite-form').style.display = 'none';
  if (tab === 'login') { document.querySelectorAll('.auth-tab')[0].classList.add('active'); document.getElementById('login-form').style.display = 'block'; }
  else if (tab === 'signup') { document.querySelectorAll('.auth-tab')[1].classList.add('active'); document.getElementById('signup-form').style.display = 'block'; }
  else if (tab === 'invite') { document.getElementById('invite-form').style.display = 'block'; }
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  document.getElementById('login-error').textContent = '';
  try {
    const res = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: pass }) });
    token = res.token; localStorage.setItem('cf_token', token);
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
  try {
    const res = await apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ orgName, firstName, lastName, email, password }) });
    token = res.token; localStorage.setItem('cf_token', token);
    currentUser = res.user;
    initApp();
  } catch (e) { document.getElementById('signup-error').textContent = e.message; }
}

async function doAcceptInvite() {
  const firstName = document.getElementById('inv-first').value.trim();
  const lastName = document.getElementById('inv-last').value.trim();
  const password = document.getElementById('inv-pass').value;
  document.getElementById('invite-error').textContent = '';
  try {
    const res = await apiFetch('/api/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token: inviteToken, firstName, lastName, password }) });
    token = res.token; localStorage.setItem('cf_token', token);
    window.history.replaceState({}, '', '/');
    initApp();
  } catch (e) { document.getElementById('invite-error').textContent = e.message; }
}

function doLogout() {
  token = null; currentUser = null; vehicles = [];
  localStorage.removeItem('cf_token');
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

// ---- Navigation ----
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => { if (b.textContent.toLowerCase().includes(name)) b.classList.add('active'); });
  if (name === 'inventory') renderInventory();
  if (name === 'dashboard') renderDashboard();
  if (name === 'team') loadTeam();
}

// ---- Vehicles ----
async function loadVehicles() {
  vehicles = await apiFetch('/api/vehicles');
}

function renderDashboard() {
  const active = vehicles.filter(v => v.status !== 'sold');
  const sold = vehicles.filter(v => v.status === 'sold');
  const totalInvested = active.reduce((s, v) => s + (v.purchase_price || 0) + (v.total_expenses || 0), 0);
  const portfolio = active.reduce((s, v) => s + (v.kbb_value || 0), 0);
  let totalProfit = 0;
  sold.forEach(v => { totalProfit += (v.sell_price || 0) - (v.purchase_price || 0) - (v.total_expenses || 0); });
  document.getElementById('stat-active').textContent = active.length;
  document.getElementById('stat-invested').textContent = '$' + totalInvested.toLocaleString();
  document.getElementById('stat-portfolio').textContent = portfolio ? '$' + portfolio.toLocaleString() : '—';
  document.getElementById('stat-profit').textContent = '$' + totalProfit.toLocaleString();
  document.getElementById('stat-profit').className = 'stat-value ' + (totalProfit >= 0 ? 'green' : 'red');
  document.getElementById('dash-vehicles').innerHTML = renderVehicleCards(vehicles.slice(0, 6));
}

function renderInventory() {
  const filtered = filterStatusVal === 'all' ? vehicles : vehicles.filter(v => v.status === filterStatusVal);
  document.getElementById('inv-vehicles').innerHTML = filtered.length ? renderVehicleCards(filtered) : `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🚗</div><h3>No vehicles yet</h3><p>Add your first vehicle to get started</p></div>`;
}

function filterStatus(s) { filterStatusVal = s; renderInventory(); }

function renderVehicleCards(list) {
  if (!list.length) return `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🚗</div><h3>No vehicles yet</h3><p>Click "+ Add Vehicle" to add your first car</p></div>`;
  return list.map(v => {
    const totalExp = v.total_expenses || 0;
    const estProfit = v.kbb_value ? v.kbb_value - v.purchase_price - totalExp : null;
    const actProfit = v.sell_price ? v.sell_price - v.purchase_price - totalExp : null;
    const profitVal = actProfit !== null ? actProfit : estProfit;
    const profitLabel = actProfit !== null ? 'Profit' : estProfit !== null ? 'Est.' : '';
    const profitStr = profitVal !== null ? `<span class="${profitVal >= 0 ? 'profit-positive' : 'profit-negative'}">${profitLabel} ${profitVal >= 0 ? '+' : ''}$${profitVal.toLocaleString()}</span>` : '';
    const thumb = v.thumb_filename ? `<img src="/uploads/vehicles/${v.id}/${v.thumb_filename}" alt="">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px">🚗</div>`;
    return `<div class="vehicle-card" onclick="openVehicle('${v.id}')">
      <div class="vehicle-thumb">${thumb}</div>
      <div class="vehicle-info">
        <div class="vehicle-title">${v.year || ''} ${v.make || ''} ${v.model || ''}</div>
        <div class="vehicle-sub">${v.trim || ''} ${v.color ? '• ' + v.color : ''}</div>
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
    const v = await apiFetch('/api/vehicles/' + id);
    document.getElementById('det-title').textContent = `${v.year || ''} ${v.make || ''} ${v.model || ''}`;
    document.getElementById('det-sub').textContent = [v.trim, v.color].filter(Boolean).join(' • ');
    const badge = document.getElementById('det-status-badge');
    badge.textContent = v.status; badge.className = 'status-badge status-' + v.status;
    // Overview
    document.getElementById('ov-buy').textContent = '$' + (v.purchase_price || 0).toLocaleString();
    document.getElementById('ov-exp').textContent = '-$' + (v.summary.total_expenses || 0).toLocaleString();
    document.getElementById('ov-kbb').textContent = v.kbb_value ? '$' + v.kbb_value.toLocaleString() : '—';
    const ep = document.getElementById('ov-est');
    ep.textContent = v.summary.estimated_profit !== null ? (v.summary.estimated_profit >= 0 ? '+' : '') + '$' + v.summary.estimated_profit.toLocaleString() : '—';
    ep.style.color = v.summary.estimated_profit >= 0 ? 'var(--green)' : 'var(--red)';
    document.getElementById('ov-sell').textContent = v.sell_price ? '$' + v.sell_price.toLocaleString() : '—';
    const ap = document.getElementById('ov-profit');
    if (v.summary.actual_profit !== null) { ap.textContent = (v.summary.actual_profit >= 0 ? '+' : '') + '$' + v.summary.actual_profit.toLocaleString(); ap.style.color = v.summary.actual_profit >= 0 ? 'var(--green)' : 'var(--red)'; }
    else { ap.textContent = '—'; ap.style.color = ''; }
    document.getElementById('ov-vin').textContent = v.vin || '—';
    document.getElementById('ov-color').textContent = v.color || '—';
    document.getElementById('ov-pdate').textContent = v.purchase_date || '—';
    document.getElementById('ov-sdate').textContent = v.sell_date || '—';
    // Checklist
    renderChecklist(v.checklist);
    // Expenses
    renderExpenses(v.expenses);
    // Photos
    renderPhotos(v.photos, id);
    // Notes
    document.getElementById('notes-area').value = v.notes || '';
  } catch (e) { showToast('Error loading vehicle'); }
}

function showDetailTab(name) {
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.detail-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  event.target.classList.add('active');
}

// ---- Checklist ----
function renderChecklist(items) {
  const el = document.getElementById('checklist-list');
  if (!items || !items.length) { el.innerHTML = '<div style="color:var(--muted);font-size:14px;padding:8px 0">No checklist items yet</div>'; return; }
  const catIcon = { mechanical: '🔧', bodywork: '🎨', other: '📋' };
  el.innerHTML = items.map(i => `
    <div class="checklist-item ${i.completed ? 'completed' : ''}" data-id="${i.id}">
      <div class="check-box ${i.completed ? 'checked' : ''}" onclick="toggleChecklist('${i.id}', ${!i.completed})">${i.completed ? '✓' : ''}</div>
      <div class="item-desc">${i.description}</div>
      <span class="item-cat">${catIcon[i.category] || '📋'} ${i.category}</span>
      <button class="item-delete" onclick="deleteChecklistItem('${i.id}')">✕</button>
    </div>`).join('');
}

async function addChecklistItem() {
  const desc = document.getElementById('cl-desc').value.trim();
  const cat = document.getElementById('cl-cat').value;
  if (!desc) return;
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}/checklist`, { method: 'POST', body: JSON.stringify({ description: desc, category: cat }) });
    document.getElementById('cl-desc').value = '';
    const v = await apiFetch('/api/vehicles/' + currentVehicleId);
    renderChecklist(v.checklist);
  } catch (e) { showToast('Error adding item'); }
}

async function toggleChecklist(itemId, completed) {
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}/checklist/${itemId}`, { method: 'PATCH', body: JSON.stringify({ completed }) });
    const v = await apiFetch('/api/vehicles/' + currentVehicleId);
    renderChecklist(v.checklist);
  } catch (e) {}
}

async function deleteChecklistItem(itemId) {
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}/checklist/${itemId}`, { method: 'DELETE' });
    const v = await apiFetch('/api/vehicles/' + currentVehicleId);
    renderChecklist(v.checklist);
  } catch (e) {}
}

// ---- Expenses ----
function renderExpenses(items) {
  const el = document.getElementById('expenses-list');
  const tot = document.getElementById('exp-total');
  if (!items || !items.length) { el.innerHTML = '<div style="color:var(--muted);font-size:14px;padding:8px 0">No expenses yet</div>'; tot.textContent = ''; return; }
  const catIcon = { parts: '🔩', labor: '🔨', fees: '📄', other: '📦' };
  el.innerHTML = items.map(i => `
    <div class="expense-item">
      <div>
        <div class="expense-desc">${i.description || i.category}</div>
        <div class="expense-meta">${catIcon[i.category] || '📦'} ${i.category}${i.date ? ' • ' + i.date : ''}</div>
      </div>
      <div class="expense-amount">-$${parseFloat(i.amount).toLocaleString()}</div>
      <button class="expense-delete" onclick="deleteExpense('${i.id}')">✕</button>
    </div>`).join('');
  const total = items.reduce((s, i) => s + parseFloat(i.amount), 0);
  tot.textContent = 'Total: -$' + total.toLocaleString();
}

async function addExpense() {
  const cat = document.getElementById('exp-cat').value;
  const desc = document.getElementById('exp-desc').value.trim();
  const amount = document.getElementById('exp-amount').value;
  const date = document.getElementById('exp-date').value;
  if (!amount) return;
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}/expenses`, { method: 'POST', body: JSON.stringify({ category: cat, description: desc, amount, date }) });
    document.getElementById('exp-desc').value = ''; document.getElementById('exp-amount').value = '';
    const v = await apiFetch('/api/vehicles/' + currentVehicleId);
    renderExpenses(v.expenses);
    // Update overview summary
    const ep = document.getElementById('ov-exp');
    ep.textContent = '-$' + (v.summary.total_expenses || 0).toLocaleString();
  } catch (e) { showToast('Error adding expense'); }
}

async function deleteExpense(expId) {
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}/expenses/${expId}`, { method: 'DELETE' });
    const v = await apiFetch('/api/vehicles/' + currentVehicleId);
    renderExpenses(v.expenses);
  } catch (e) {}
}

// ---- Photos ----
function renderPhotos(photos, vehicleId) {
  const grid = document.getElementById('photo-grid');
  if (!photos || !photos.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = photos.map(p => `
    <div class="photo-item">
      <img src="${p.url || '/uploads/vehicles/' + vehicleId + '/' + p.filename}" onclick="openLightbox(this.src)" alt="">
      <button class="photo-delete" onclick="deletePhoto('${p.id}', event)">✕</button>
    </div>`).join('');
}

async function uploadPhotos(input) {
  await uploadPhotosFromFiles(input.files);
  input.value = '';
}

async function uploadPhotosFromFiles(files) {
  if (!files.length) return;
  const form = new FormData();
  for (const f of files) form.append('photos', f);
  try {
    const res = await fetch(`/api/vehicles/${currentVehicleId}/photos`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const v = await apiFetch('/api/vehicles/' + currentVehicleId);
    renderPhotos(v.photos, currentVehicleId);
    // Refresh vehicles list to update thumbnail
    await loadVehicles();
    showToast(`${data.length} photo${data.length > 1 ? 's' : ''} uploaded`);
  } catch (e) { showToast('Error uploading photos'); }
}

async function deletePhoto(photoId, e) {
  e.stopPropagation();
  try {
    await apiFetch(`/api/vehicles/${currentVehicleId}/photos/${photoId}`, { method: 'DELETE' });
    const v = await apiFetch('/api/vehicles/' + currentVehicleId);
    renderPhotos(v.photos, currentVehicleId);
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
    showToast('Notes saved');
    await loadVehicles();
  } catch (e) { showToast('Error saving notes'); }
}

// ---- Add/Edit Vehicle Modal ----
function openAddModal() {
  editingVehicle = null;
  document.getElementById('vehicle-modal-title').textContent = 'Add Vehicle';
  document.getElementById('vehicle-modal-save').textContent = 'Add Vehicle';
  ['v-year','v-make','v-model','v-trim','v-vin','v-color','v-buy','v-kbb','v-sell'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('v-pdate').value = '';
  document.getElementById('v-sdate').value = '';
  document.getElementById('v-status').value = 'active';
  openModal('vehicle-modal');
}

function openEditModal() {
  const v = vehicles.find(x => x.id === currentVehicleId);
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
    } else {
      await apiFetch('/api/vehicles', { method: 'POST', body: JSON.stringify(body) });
    }
    closeModal('vehicle-modal');
    await loadVehicles();
    if (editingVehicle) { await loadVehicleDetail(editingVehicle.id); }
    else { renderDashboard(); }
    showToast(editingVehicle ? 'Vehicle updated' : 'Vehicle added!');
  } catch (e) { showToast('Error saving vehicle'); }
}

async function deleteVehicle() {
  if (!confirm('Delete this vehicle? This cannot be undone.')) return;
  try {
    await apiFetch('/api/vehicles/' + currentVehicleId, { method: 'DELETE' });
    await loadVehicles();
    showPage('inventory');
    showToast('Vehicle deleted');
  } catch (e) { showToast('Error deleting vehicle'); }
}

// ---- Team ----
async function loadTeam() {
  try {
    const members = await apiFetch('/api/team');
    const invites = await apiFetch('/api/team/invites');
    let html = members.map(m => `
      <div class="team-member">
        <div class="avatar">${m.first_name[0].toUpperCase()}</div>
        <div class="member-info">
          <div class="member-name">${m.first_name} ${m.last_name}</div>
          <div class="member-email">${m.email}</div>
        </div>
        <span class="role-badge">${m.role}</span>
      </div>`).join('');
    if (invites.length) {
      html += '<div style="font-size:13px;color:var(--muted);margin-top:16px;margin-bottom:8px">Pending Invites</div>';
      html += invites.map(i => `
        <div class="team-member" style="opacity:0.6">
          <div class="avatar">?</div>
          <div class="member-info">
            <div class="member-email">${i.email}</div>
            <div style="font-size:12px;color:var(--muted)">Invite pending</div>
          </div>
        </div>`).join('');
    }
    document.getElementById('team-list').innerHTML = html;
  } catch (e) {}
}

function openInviteModal() {
  document.getElementById('invite-email').value = '';
  document.getElementById('invite-result').innerHTML = '';
  openModal('invite-modal');
}

async function sendInvite() {
  const email = document.getElementById('invite-email').value.trim();
  if (!email) return;
  try {
    const res = await apiFetch('/api/auth/invite', { method: 'POST', body: JSON.stringify({ email }) });
    const link = `${window.location.origin}/?invite=${res.inviteToken}`;
    document.getElementById('invite-result').innerHTML = `
      <div style="font-size:13px;color:var(--green);margin-top:12px">✓ Invite created for ${email}</div>
      <div style="font-size:13px;color:var(--muted);margin-top:8px">Share this link with them:</div>
      <div class="invite-token-box">${link}</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="navigator.clipboard.writeText('${link}');showToast('Link copied!')">📋 Copy Link</button>`;
    loadTeam();
  } catch (e) { showToast(e.message); }
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

// Enter key handlers
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.activeElement.id === 'login-pass') doLogin();
    if (document.activeElement.id === 'cl-desc') addChecklistItem();
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    closeLightbox();
  }
});
