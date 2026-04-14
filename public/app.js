// Car Flipper — Frontend App
function fmtPhone(p) {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}` : p;
}
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
    applyNavVisibility(me);
    if (canViewDealerInventory()) await loadVehicles('ga_motors'); // pre-load GA Motors (skip if no access)
    renderDashboard();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-dashboard').classList.add('active');
  } catch (e) {
    token = null; localStorage.removeItem('token');
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
  }
}

function isAdmin() { return currentUser && ['owner','admin'].includes(currentUser.role); }
function isBdcRep() { return currentUser && ['bdc_rep','member'].includes(currentUser.role); }
function canViewAllLeads() { return isAdmin() || currentUser?.can_view_all_leads; }
function canViewDealerInventory() { return isAdmin() || currentUser?.can_view_dealer_inventory; }

function applyNavVisibility(me) {
  const role = me?.role;
  const canDealer = ['owner','admin'].includes(role) || me?.can_view_dealer_inventory;
  const canStreet = ['owner','admin'].includes(role); // BDC reps never
  const canTeam = ['owner','admin'].includes(role);
  const canLeads = ['owner','admin'].includes(role) || me?.can_view_all_leads;

  const setNav = (id, show) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  };
  setNav('nav-leads', canLeads);
  setNav('nav-ga-motors', canDealer);
  setNav('nav-street-cars', canStreet);
  setNav('mnav-leads', canLeads);
  setNav('mnav-ga-motors', canDealer);
  setNav('mnav-street-cars', canStreet);
  setNav('mnav-team', canTeam);

  // Team nav — only admins/owners
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.textContent.trim() === 'Team') b.style.display = canTeam ? '' : 'none';
  });

  // Add vehicle buttons — only admins/owners
  document.querySelectorAll('[id="add-ga-btn"]').forEach(b => b.style.display = canTeam ? '' : 'none');
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
  // Signup is disabled — redirect to invite-only message
  showAuthTab('signup');
  return;
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
  document.querySelectorAll('#topbar-nav .nav-btn').forEach(b => {
    const txt = b.textContent.toLowerCase();
    if (name === 'ga_motors' && txt.includes('ga motors')) b.classList.add('active');
    else if (name === 'street_cars' && txt.includes('street')) b.classList.add('active');
    else if (name === 'lead-detail' && txt.includes('lead')) b.classList.add('active');
    else if (txt.includes(name.replace('_',' '))) b.classList.add('active');
  });
  if (name === 'ga_motors') loadAndRenderInventory('ga_motors');
  if (name === 'street_cars') loadAndRenderInventory('street_cars');
  if (name === 'inventory') loadAndRenderInventory('ga_motors'); // legacy fallback
  if (name === 'dashboard') loadVehicles('ga_motors').then(renderDashboard);
  if (name === 'team') loadTeam();
  if (name === 'leads') { loadLeads().then(() => switchLeadsView(leadsView)); }
}

// ---- Vehicles ----
let vehiclesByType = {}; // cache by inventory_type

async function loadVehicles(inventory_type) {
  try {
    const url = inventory_type ? `/api/vehicles?inventory_type=${inventory_type}` : '/api/vehicles';
    const data = await apiFetch(url);
    const list = Array.isArray(data) ? data : [];
    if (inventory_type) vehiclesByType[inventory_type] = list;
    vehicles = list; // keep backward compat
    return list;
  } catch (e) { return []; }
}

async function loadAndRenderInventory(type) {
  const list = await loadVehicles(type);
  const gridId = type === 'ga_motors' ? 'inv-ga-motors' : 'inv-street-cars';
  const el = document.getElementById(gridId);
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🚗</div><h3>No vehicles yet</h3><p>Click "+ Add Vehicle" to add one</p></div>`;
    return;
  }
  filterInventoryStatus(type, filterStatusVal);
}

function filterInventoryStatus(type, status) {
  filterStatusVal = status;
  const list = vehiclesByType[type] || [];
  const filtered = status === 'all' ? list : list.filter(v => v.status === status);
  const gridId = type === 'ga_motors' ? 'inv-ga-motors' : 'inv-street-cars';
  const el = document.getElementById(gridId);
  if (el) el.innerHTML = filtered.length ? renderVehicleCards(filtered) : `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🚗</div><h3>No ${status !== 'all' ? status : ''} vehicles</h3></div>`;
}

function renderDashboard() {
  const active = vehicles.filter(v => v.status !== 'sold');
  const sold = vehicles.filter(v => v.status === 'sold');
  // Hide financial metrics from BDC reps
  const financialCards = ['stat-invested', 'stat-portfolio', 'stat-profit'];
  financialCards.forEach(id => {
    const card = document.getElementById(id)?.closest('.stat-card');
    if (card) card.style.display = isBdcRep() ? 'none' : '';
  });
  document.getElementById('stat-active').textContent = active.length;
  if (!isBdcRep()) {
    const totalInvested = active.reduce((s, v) => s + (v.purchase_price || 0), 0);
    const portfolio = active.reduce((s, v) => s + (v.kbb_value || 0), 0);
    let totalProfit = 0;
    sold.forEach(v => { if (v.sell_price) totalProfit += (v.sell_price || 0) - (v.purchase_price || 0) - (v.total_expenses || 0); });
    document.getElementById('stat-invested').textContent = '$' + totalInvested.toLocaleString();
    document.getElementById('stat-portfolio').textContent = portfolio ? '$' + portfolio.toLocaleString() : '—';
    const profEl = document.getElementById('stat-profit');
    profEl.textContent = (totalProfit >= 0 ? '+' : '') + '$' + Math.abs(totalProfit).toLocaleString();
    profEl.className = 'stat-value ' + (totalProfit >= 0 ? 'green' : 'red');
  }
  if (isBdcRep() && !canViewDealerInventory()) {
    document.getElementById('dash-vehicles').innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon">🔒</div><h3>Inventory access not enabled</h3><p>Contact your admin to enable GA Motors inventory access.</p></div>';
  } else {
    document.getElementById('dash-vehicles').innerHTML = renderVehicleCards(vehicles.slice(0, 6));
  }
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
        ${v.inventory_type ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${v.inventory_type === 'ga_motors' ? '🏪 GA Motors' : '🚗 Street Cars'}</div>` : ''}
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
function openAddModal(inventory_type) {
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
  const invType = document.getElementById('v-inventory-type');
  if (invType) invType.value = inventory_type || 'ga_motors';
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
    inventory_type: document.getElementById('v-inventory-type')?.value || 'ga_motors',
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
      const invType = body.inventory_type || 'ga_motors';
      await loadVehicles(invType);
      filterInventoryStatus(invType, 'all');
      showToast('Vehicle added!');
    }
  } catch (e) { showToast('Error saving vehicle'); }
}

async function deleteVehicle() {
  if (!confirm('Delete this vehicle? This cannot be undone.')) return;
  try {
    const invType = currentVehicle?.inventory_type || 'ga_motors';
    await apiFetch('/api/vehicles/' + currentVehicleId, { method: 'DELETE' });
    currentVehicle = null; currentVehicleId = null;
    await loadVehicles(invType);
    showPage(invType);
    showToast('Vehicle deleted');
  } catch (e) { showToast('Error deleting vehicle'); }
}

// ---- Team ----
let editingUserId = null;

async function loadTeam() {
  try {
    const members = await apiFetch('/api/team');
    if (!members) return;
    const canManage = currentUser && ['owner','admin'].includes(currentUser.role);
    const ROLE_LABELS = { owner: '👑 Owner', admin: '👤 Admin', bdc_rep: '🎯 BDC Rep', member: '🎯 BDC Rep' };
    const html = members.map(m => {
      const isSelf = currentUser && m.id === currentUser.id;
      const canEdit = canManage && !isSelf && m.role !== 'owner';
      const isBdc = m.role === 'bdc_rep' || m.role === 'member';
      const perms = isBdc ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">${m.can_view_all_leads ? '✅ All Leads' : '🔒 Assigned Only'} &nbsp; ${m.can_view_dealer_inventory ? '✅ GA Motors' : '🔒 No Inventory'}</div>` : '';
      return `<div class="team-member" style="${canEdit ? 'cursor:pointer' : ''}" ${canEdit ? `onclick="openPermModal('${m.id}','${esc(m.first_name+' '+m.last_name)}',${m.can_view_all_leads?1:0},${m.can_view_dealer_inventory?1:0},'${m.role}')"` : ''}>
        <div class="avatar">${((m.first_name||'')[0]||'').toUpperCase()}${((m.last_name||'')[0]||'').toUpperCase()}</div>
        <div class="member-info">
          <div class="member-name">${esc(m.first_name)} ${esc(m.last_name)}${isSelf?' <span style="color:var(--muted);font-size:11px">(you)</span>':''}</div>
          <div class="member-email">${esc(m.email)}</div>
          ${perms}
        </div>
        <div style="text-align:right">
          <span class="role-badge">${ROLE_LABELS[m.role]||m.role}</span>
          ${canEdit ? '<div style="font-size:11px;color:var(--muted);margin-top:4px">Tap to edit</div>' : ''}
        </div>
      </div>`;
    }).join('');
    document.getElementById('team-list').innerHTML = html || '<div style="color:var(--muted)">No team members</div>';
  } catch (e) { showToast('Error loading team'); }
}

function openPermModal(userId, name, canLeads, canInventory, role) {
  editingUserId = userId;
  document.getElementById('perm-user-name').textContent = name;
  document.getElementById('perm-view-all-leads').checked = !!canLeads;
  document.getElementById('perm-view-dealer-inv').checked = !!canInventory;
  const roleSection = document.getElementById('perm-role-section');
  if (currentUser?.role === 'owner') {
    roleSection.innerHTML = `<div style="font-size:13px;color:var(--muted);margin-bottom:8px">Role</div>
      <select id="perm-role" onchange="updatePermission('role',this.value)" style="width:100%">
        <option value="bdc_rep" ${(role==='bdc_rep'||role==='member')?'selected':''}>BDC Rep</option>
        <option value="admin" ${role==='admin'?'selected':''}>Admin</option>
      </select>`;
  } else { roleSection.innerHTML = ''; }
  openModal('perm-modal');
}

async function updatePermission(field, value) {
  if (!editingUserId) return;
  try {
    await apiFetch(`/api/auth/users/${editingUserId}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
    showToast('Updated');
    loadTeam();
  } catch (e) { showToast(e.message || 'Update failed'); }
}

async function removeUser() {
  if (!editingUserId) return;
  const name = document.getElementById('perm-user-name').textContent;
  if (!confirm(`Remove ${name}? This cannot be undone.`)) return;
  try {
    await apiFetch(`/api/auth/users/${editingUserId}`, { method: 'DELETE' });
    closeModal('perm-modal'); showToast('User removed'); loadTeam();
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
    const role = document.getElementById('invite-role')?.value || 'bdc_rep';
    const res = await apiFetch('/api/auth/invite', { method: 'POST', body: JSON.stringify({ email, firstName, lastName, role }) });
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

// ============================================================
// ---- LEADS MODULE ----
// ============================================================

let leadsData = [];
let leadsPage = 1;
let leadsPageSize = 25;
let leadsSort = 'lead_date_desc';
let currentLeadId = null;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let leadsView = 'calendar'; // 'calendar' | 'list'
let selectedCalDay = null;

const STATUS_ICONS = { call:'📞', text:'💬', email:'📧', note:'📝', status_change:'🔄', assignment:'👤' };

// ---- Load & Render Leads ----

async function loadLeads() {
  try {
    const status = document.getElementById('leads-filter-status')?.value || '';
    const search = document.getElementById('leads-search')?.value || '';
    let url = '/api/leads?';
    if (status) url += `status=${encodeURIComponent(status)}&`;
    if (search) url += `search=${encodeURIComponent(search)}&`;
    const result = await apiFetch(url);
    leadsData = Array.isArray(result) ? result : [];
    if (!Array.isArray(leadsData)) leadsData = [];
  } catch (e) { leadsData = []; }
}

async function refreshLeads() {
  leadsPage = 1;
  await loadLeads();
  if (leadsView === 'calendar') renderCalendar();
  else renderLeadsList();
}

function changeLeadsPageSize(val) {
  leadsPageSize = parseInt(val, 10);
  leadsPage = 1;
  renderLeadsList();
}

function goLeadsPage(p) {
  leadsPage = p;
  renderLeadsList();
}

function switchLeadsView(view) {
  leadsView = view;
  document.getElementById('leads-calendar-view').style.display = view === 'calendar' ? '' : 'none';
  document.getElementById('leads-list-view').style.display = view === 'list' ? '' : 'none';
  document.getElementById('leads-cal-btn').className = view === 'calendar' ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('leads-list-btn').className = view === 'list' ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm';
  if (view === 'calendar') renderCalendar();
  else renderLeadsList();
}

// ---- Calendar ----

function calNav(dir) { calMonth += dir; if (calMonth < 0) { calMonth = 11; calYear--; } if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); }
function calToday() { calYear = new Date().getFullYear(); calMonth = new Date().getMonth(); selectedCalDay = null; renderCalendar(); }

function renderCalendar() {
  const label = document.getElementById('cal-month-label');
  const grid = document.getElementById('cal-grid');
  const dayLeads = document.getElementById('cal-day-leads');
  if (!label || !grid) return;

  label.textContent = new Date(calYear, calMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = DAYS.map(d => `<div class="cal-header">${d}</div>`).join('');

  const first = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  // Build date → leads map
  const byDate = {};
  for (const lead of leadsData) {
    const d = lead.lead_date || lead.created_at?.substring(0,10);
    if (d) { if (!byDate[d]) byDate[d] = []; byDate[d].push(lead); }
  }

  // Empty cells before month starts
  for (let i = 0; i < first; i++) html += `<div class="cal-day other-month"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = today.getFullYear()===calYear && today.getMonth()===calMonth && today.getDate()===day;
    const isSelected = selectedCalDay === dateStr;
    const dayLeadList = byDate[dateStr] || [];
    const dots = dayLeadList.slice(0,8).map(l => `<div class="cal-dot ${l.status}"></div>`).join('');
    html += `<div class="cal-day ${isToday?'today':''} ${isSelected?'selected':''}" onclick="selectCalDay('${dateStr}')">
      <div class="cal-day-num">${day}</div>
      <div class="cal-dots">${dots}</div>
    </div>`;
  }

  grid.innerHTML = html;

  if (selectedCalDay && byDate[selectedCalDay]) {
    renderCalDayLeads(selectedCalDay, byDate[selectedCalDay]);
  } else if (selectedCalDay) {
    dayLeads.innerHTML = `<div style="color:var(--muted);font-size:14px;padding:8px 0">No leads on this date</div>`;
  } else {
    dayLeads.innerHTML = '';
  }
}

function selectCalDay(dateStr) {
  selectedCalDay = selectedCalDay === dateStr ? null : dateStr;
  renderCalendar();
}

function renderCalDayLeads(dateStr, leads) {
  const el = document.getElementById('cal-day-leads');
  const d = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  let html = `<div style="font-size:15px;font-weight:600;margin-bottom:10px">${d} — ${leads.length} lead${leads.length!==1?'s':''}</div>`;
  html += leads.map(l => leadRowHTML(l)).join('');
  el.innerHTML = html;
}

function sortLeads(data) {
  const sorted = [...data];
  if (leadsSort === 'lead_date_desc') {
    sorted.sort((a, b) => (b.lead_date || b.created_at || '').localeCompare(a.lead_date || a.created_at || ''));
  } else if (leadsSort === 'lead_date_asc') {
    sorted.sort((a, b) => (a.lead_date || a.created_at || '').localeCompare(b.lead_date || b.created_at || ''));
  } else if (leadsSort === 'contacted_desc') {
    sorted.sort((a, b) => (b.last_contacted_at || '').localeCompare(a.last_contacted_at || ''));
  } else if (leadsSort === 'contacted_asc') {
    sorted.sort((a, b) => (a.last_contacted_at || '').localeCompare(b.last_contacted_at || ''));
  }
  return sorted;
}

function changeLeadsSort(val) {
  leadsSort = val;
  leadsPage = 1;
  renderLeadsList();
}

function renderLeadsList() {
  const el = document.getElementById('leads-list-container');
  const pagEl = document.getElementById('leads-pagination');
  if (!el) return;
  if (!leadsData.length) {
    el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon">📋</div><h3>No leads yet</h3><p>Click "+ Add Lead" to add your first lead</p></div>';
    if (pagEl) pagEl.innerHTML = '';
    return;
  }
  const sorted = sortLeads(leadsData);
  const total = sorted.length;
  const totalPages = Math.ceil(total / leadsPageSize);
  if (leadsPage > totalPages) leadsPage = totalPages;
  const start = (leadsPage - 1) * leadsPageSize;
  const page = sorted.slice(start, start + leadsPageSize);
  el.innerHTML = page.map(l => leadRowHTML(l)).join('');
  if (pagEl) pagEl.innerHTML = buildPagination(leadsPage, totalPages, total);
}

function buildPagination(current, totalPages, totalItems) {
  if (totalPages <= 1) return `<span style="font-size:13px;color:var(--muted)">${totalItems} lead${totalItems!==1?'s':''}</span>`;
  const start = (current - 1) * leadsPageSize + 1;
  const end = Math.min(current * leadsPageSize, totalItems);
  let html = `<span style="font-size:13px;color:var(--muted)">${start}–${end} of ${totalItems}</span><div style="display:flex;gap:4px;align-items:center">`;
  html += `<button class="btn btn-ghost btn-sm" onclick="goLeadsPage(${current - 1})" ${current===1?'disabled':''}>‹ Prev</button>`;
  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= current - 1 && p <= current + 1)) pages.push(p);
    else if (pages[pages.length - 1] !== '...') pages.push('...');
  }
  for (const p of pages) {
    if (p === '...') { html += `<span style="color:var(--muted);font-size:13px">…</span>`; continue; }
    html += `<button class="btn ${p===current?'btn-secondary':'btn-ghost'} btn-sm" onclick="goLeadsPage(${p})" style="min-width:32px">${p}</button>`;
  }
  html += `<button class="btn btn-ghost btn-sm" onclick="goLeadsPage(${current + 1})" ${current===totalPages?'disabled':''}>Next ›</button></div>`;
  return html;
}

function leadRowHTML(l) {
  const veh = [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(' ') || '—';
  return `<div class="lead-row" onclick="openLead('${l.id}')">
    <div style="flex:1">
      <div class="lead-name">${esc(l.name)}</div>
      <div class="lead-phone">${esc(fmtPhone(l.phone))} ${l.email ? '· '+esc(l.email) : ''}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:3px">${esc(veh)} · ${esc(l.source)}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
      <span class="status-badge status-${l.status}">${l.status}</span>
      ${l.assigned_name ? `<span style="font-size:12px;color:var(--muted)">${esc(l.assigned_name)}</span>` : ''}
    </div>
  </div>`;
}

// ---- Lead Detail ----

async function openLead(id) {
  currentLeadId = id;
  showPage('lead-detail');
  await loadLeadDetail(id);
}

async function loadLeadDetail(id) {
  try {
    const lead = await apiFetch('/api/leads/' + id);
    document.getElementById('ld-name').textContent = lead.name;

    // Status dropdown
    const statuses = ['new','contacted','appointment','sold','lost'];
    document.getElementById('ld-status').innerHTML = statuses.map(s =>
      `<option value="${s}" ${lead.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
    ).join('');

    // Assigned dropdown — only admins can reassign
    const assignedEl = document.getElementById('ld-assigned');
    if (isAdmin()) {
      const team = await apiFetch('/api/team');
      assignedEl.innerHTML =
        `<option value="">Unassigned</option>` +
        team.map(m => `<option value="${m.id}" ${lead.assigned_to===m.id?'selected':''}>${esc(m.first_name+' '+m.last_name)}</option>`).join('');
      assignedEl.style.display = '';
    } else {
      // BDC reps: show assigned name as read-only, hide dropdown
      assignedEl.style.display = 'none';
    }

    // Contact info
    const phoneEl = document.getElementById('ld-phone');
    phoneEl.textContent = fmtPhone(lead.phone) || '—';
    phoneEl.href = lead.phone ? `tel:${lead.phone}` : '';
    const emailEl = document.getElementById('ld-email');
    emailEl.textContent = lead.email || '—';
    emailEl.href = lead.email ? `mailto:${lead.email}` : '';
    document.getElementById('ld-source').textContent = lead.source || '—';
    document.getElementById('ld-lead-date').textContent = lead.lead_date || '—';

    // Vehicle of interest
    document.getElementById('voi-year').value = lead.vehicle_year || '';
    document.getElementById('voi-make').value = lead.vehicle_make || '';
    document.getElementById('voi-model').value = lead.vehicle_model || '';
    document.getElementById('voi-trim').value = lead.vehicle_trim || '';
    document.getElementById('voi-vin').value = lead.vehicle_vin || '';
    document.getElementById('voi-stock').value = lead.vehicle_stock_number || '';

    // Notes
    renderLeadNotes(lead.notes || []);
    // Attachments
    renderLeadAttachments(lead.attachments || []);
    // Activities
    renderLeadActivities(lead.activities || []);
  } catch (e) { showToast('Error loading lead'); }
}

async function patchLead(field, value) {
  try {
    await apiFetch('/api/leads/' + currentLeadId, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
    await loadLeadDetail(currentLeadId);
  } catch (e) { showToast('Error updating lead'); }
}

async function saveVehicleOfInterest() {
  try {
    await apiFetch('/api/leads/' + currentLeadId, {
      method: 'PATCH', body: JSON.stringify({
        vehicle_year: parseInt(document.getElementById('voi-year').value) || null,
        vehicle_make: document.getElementById('voi-make').value || null,
        vehicle_model: document.getElementById('voi-model').value || null,
        vehicle_trim: document.getElementById('voi-trim').value || null,
        vehicle_vin: document.getElementById('voi-vin').value || null,
        vehicle_stock_number: document.getElementById('voi-stock').value || null,
      })
    });
    showToast('Vehicle info saved');
  } catch (e) { showToast('Error saving'); }
}

async function deleteCurrentLead() {
  if (!confirm('Delete this lead? This cannot be undone.')) return;
  try {
    await apiFetch('/api/leads/' + currentLeadId, { method: 'DELETE' });
    await loadLeads();
    showPage('leads');
    showToast('Lead deleted');
  } catch (e) { showToast('Error deleting lead'); }
}

function showLeadTab(name, btn) {
  document.querySelectorAll('#page-lead-detail .detail-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-lead-detail .detail-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('lead-panel-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
}

// ---- Notes ----

function renderLeadNotes(notes) {
  const el = document.getElementById('lead-notes-list');
  if (!notes.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;margin-bottom:8px">No notes yet</div>'; return; }
  el.innerHTML = notes.map(n => `
    <div style="background:var(--card2);border-radius:10px;padding:12px;margin-bottom:8px;border:1px solid var(--border)">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">${esc(n.author_name||'Unknown')} · ${fmtDate(n.created_at)}</div>
      <div style="font-size:14px;line-height:1.5">${esc(n.content)}</div>
      ${isAdmin() ? `<button onclick="deleteLeadNote('${n.id}')" style="background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;margin-top:6px">Delete</button>` : ''}
    </div>`).join('');
}

async function addLeadNote() {
  const content = document.getElementById('lead-note-input').value.trim();
  if (!content) return;
  try {
    await apiFetch(`/api/leads/${currentLeadId}/notes`, { method: 'POST', body: JSON.stringify({ content }) });
    document.getElementById('lead-note-input').value = '';
    const lead = await apiFetch('/api/leads/' + currentLeadId);
    renderLeadNotes(lead.notes || []);
    renderLeadActivities(lead.activities || []);
  } catch (e) { showToast('Error adding note'); }
}

async function deleteLeadNote(noteId) {
  try {
    await apiFetch(`/api/leads/${currentLeadId}/notes/${noteId}`, { method: 'DELETE' });
    const lead = await apiFetch('/api/leads/' + currentLeadId);
    renderLeadNotes(lead.notes || []);
  } catch (e) { showToast('Error deleting note'); }
}

// ---- Attachments ----

function renderLeadAttachments(attachments) {
  const grid = document.getElementById('lead-att-grid');
  if (!attachments.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = attachments.map(a => {
    const isImg = a.mime_type?.startsWith('image/');
    const url = a.url || `/uploads/leads/${currentLeadId}/${a.filename}`;
    return `<div class="att-item" id="latt-${a.id}">
      ${isImg
        ? `<img class="att-thumb" src="${url}" onclick="openLightbox('${url}')" alt="">`
        : `<div class="att-file"><span class="att-file-icon">📄</span>${esc(a.original_name||a.filename)}</div>`}
      <button class="att-del" onclick="deleteLeadAttachment('${a.id}',event)">✕</button>
    </div>`;
  }).join('');
}

async function uploadLeadAttachments(input) {
  if (!input.files.length) return;
  const form = new FormData();
  for (const f of input.files) form.append('files', f);
  input.value = '';
  try {
    showToast('Uploading...');
    const res = await fetch(`/api/leads/${currentLeadId}/attachments`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const lead = await apiFetch('/api/leads/' + currentLeadId);
    renderLeadAttachments(lead.attachments || []);
    renderLeadActivities(lead.activities || []);
    showToast(`${data.length} file${data.length>1?'s':''} uploaded`);
  } catch (e) { showToast('Error uploading'); }
}

async function deleteLeadAttachment(attId, e) {
  e.stopPropagation();
  try {
    await apiFetch(`/api/leads/${currentLeadId}/attachments/${attId}`, { method: 'DELETE' });
    document.getElementById('latt-' + attId)?.remove();
  } catch (e) { showToast('Error deleting attachment'); }
}

// ---- Activities ----

function renderLeadActivities(activities) {
  const el = document.getElementById('lead-activity-list');
  if (!activities.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px">No activity yet</div>'; return; }
  el.innerHTML = activities.map(a => `
    <div class="activity-item">
      <div class="activity-icon">${STATUS_ICONS[a.activity_type] || '📋'}</div>
      <div class="activity-body">
        <div class="activity-desc">${esc(a.description || a.activity_type)}</div>
        <div class="activity-meta">${esc(a.user_name || 'System')} · ${fmtDate(a.created_at)}</div>
      </div>
    </div>`).join('');
}

// ---- Add Lead Modal ----

async function openAddLeadModal() {
  // Populate assigned_to dropdown
  try {
    const team = await apiFetch('/api/team');
    document.getElementById('al-assigned').innerHTML =
      `<option value="">Unassigned</option>` +
      team.map(m => `<option value="${m.id}">${esc(m.first_name+' '+m.last_name)}</option>`).join('');
  } catch(e) {}
  // Set today as default date
  document.getElementById('al-date').value = new Date().toISOString().substring(0,10);
  openModal('add-lead-modal');
}

async function submitAddLead() {
  const name = document.getElementById('al-name').value.trim();
  if (!name) { showToast('Name is required'); return; }
  try {
    await apiFetch('/api/leads', { method: 'POST', body: JSON.stringify({
      name,
      phone: document.getElementById('al-phone').value || null,
      email: document.getElementById('al-email').value || null,
      source: document.getElementById('al-source').value,
      status: document.getElementById('al-status').value,
      assigned_to: document.getElementById('al-assigned').value || null,
      lead_date: document.getElementById('al-date').value || null,
      vehicle_year: parseInt(document.getElementById('al-year').value) || null,
      vehicle_make: document.getElementById('al-make').value || null,
      vehicle_model: document.getElementById('al-model').value || null,
      vehicle_vin: document.getElementById('al-vin').value || null,
      vehicle_stock_number: document.getElementById('al-stock').value || null,
      notes_summary: document.getElementById('al-notes').value || null,
    })});
    closeModal('add-lead-modal');
    // Reset
    ['al-name','al-phone','al-email','al-year','al-make','al-model','al-vin','al-stock','al-notes'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    await refreshLeads();
    showToast('Lead added!');
  } catch (e) { showToast('Error adding lead: ' + e.message); }
}

// ---- Date Formatter ----

function fmtDate(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }); }
  catch(e) { return ts; }
}

// ============================================================
// ---- CSV IMPORT ----
// ============================================================

let csvErrors = [];

function openCsvImportModal() {
  // Reset state
  document.getElementById('csv-idle').style.display = '';
  document.getElementById('csv-progress').style.display = 'none';
  document.getElementById('csv-result').style.display = 'none';
  document.getElementById('csv-file-input').value = '';
  csvErrors = [];
  openModal('csv-import-modal');
}

function closeCsvModal() {
  closeModal('csv-import-modal');
  // Refresh leads if import happened
  loadLeads().then(() => { if (leadsView === 'calendar') renderCalendar(); else renderLeadsList(); });
}

async function startCsvImport(input) {
  const file = input.files[0];
  if (!file) return;

  document.getElementById('csv-idle').style.display = 'none';
  document.getElementById('csv-progress').style.display = '';
  document.getElementById('csv-result').style.display = 'none';

  // Simulate progress while uploading (real progress comes from response)
  let fakeProgress = 0;
  const progressInterval = setInterval(() => {
    fakeProgress = Math.min(fakeProgress + 5, 85);
    document.getElementById('csv-bar').style.width = fakeProgress + '%';
    document.getElementById('csv-status').textContent = `Uploading ${file.name}...`;
  }, 200);

  const form = new FormData();
  form.append('csv', file);

  try {
    const res = await fetch('/api/leads/import/csv', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form
    });
    clearInterval(progressInterval);
    document.getElementById('csv-bar').style.width = '100%';

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');

    csvErrors = data.errors || [];
    document.getElementById('csv-progress').style.display = 'none';
    document.getElementById('csv-result').style.display = '';

    const summary = document.getElementById('csv-summary');
    summary.innerHTML = `
      <div style="color:var(--green);font-size:18px;margin-bottom:4px">✅ Import Complete</div>
      <div style="color:var(--text)">Total rows: <strong>${data.total}</strong> &nbsp;|&nbsp;
      Imported: <strong style="color:var(--green)">${data.imported}</strong> &nbsp;|&nbsp;
      Skipped: <strong style="color:var(--yellow)">${data.skipped}</strong></div>`;

    if (csvErrors.length) {
      document.getElementById('csv-errors-section').style.display = '';
      document.getElementById('csv-errors-list').innerHTML =
        csvErrors.map(e => `Row ${e.row}: ${esc(e.reason)}`).join('<br>');
    }
    showToast(`${data.imported} leads imported!`);
  } catch (e) {
    clearInterval(progressInterval);
    document.getElementById('csv-progress').style.display = 'none';
    document.getElementById('csv-result').style.display = '';
    document.getElementById('csv-summary').innerHTML = `<div style="color:var(--red)">❌ Import failed: ${esc(e.message)}</div>`;
    showToast('Import failed: ' + e.message);
  }
}

function downloadCsvErrors() {
  if (!csvErrors.length) return;
  const lines = ['Row,Reason', ...csvErrors.map(e => `${e.row},"${e.reason.replace(/"/g,'""')}"`)];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'import-errors.csv';
  a.click();
}
