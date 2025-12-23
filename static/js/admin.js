document.addEventListener('DOMContentLoaded', function () {
    initAdmin();
});

let currentTab = 'checklist';
let currentSeason = '';
let userRole = '';
let seasonsList = [];
let manageSeasonEditing = null;

/**
 * Common confirmation dialog for delete operations
 * @param {string} itemType - Type of item being deleted (e.g., 'type', 'pokemon', 'raid boss', 'user')
 * @param {string} itemName - Name or identifier of the item (optional)
 * @returns {boolean} - True if user confirmed, false otherwise
 */
function confirmDelete(itemType, itemName = '') {
    const displayName = itemName ? ` "${itemName}"` : '';
    return confirm(`Are you sure you want to delete this ${itemType}${displayName}?\n\nThis action cannot be undone.`);
}

async function initAdmin() {
    try {
        userRole = window.USER_ROLE || '';

        const shell = document.querySelector('.admin-shell');

        // Tab switching
        document.getElementById('tab-checklist').addEventListener('click', () => switchTab('checklist'));
        document.getElementById('tab-raid-bosses').addEventListener('click', () => switchTab('raid-bosses'));
        const usersTabBtn = document.getElementById('tab-users');
        usersTabBtn.addEventListener('click', () => switchTab('users'));
        // Hide Users tab for non-admins
        if (userRole !== 'admin') {
            usersTabBtn.style.display = 'none';
        }

        const manageSeasonsBtn = document.getElementById('manage-seasons-btn');
        if (manageSeasonsBtn) {
            if (userRole !== 'admin') {
                manageSeasonsBtn.style.display = 'none';
            } else {
                manageSeasonsBtn.addEventListener('click', () => {
                    currentTab = 'manage-seasons';
                    renderManageSeasons();
                });
            }
        }

        await loadExtras();

        // Set default season button (admin only)
        const setDefaultBtn = document.getElementById('set-default-season');
        if (setDefaultBtn) {
            if (userRole !== 'admin') {
                setDefaultBtn.style.display = 'none';
            } else {
                setDefaultBtn.addEventListener('click', async () => {
                    try {
                        const res = await fetch('/api/admin/season/default', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ season: currentSeason }) });
                        if (res.ok) {
                            alert('Default season updated');
                        } else {
                            alert('Failed to set default season');
                        }
                    } catch (e) {
                        alert('Failed to set default season');
                    }
                });
            }
        }

        await refreshSeasons(shell?.dataset.initialSeason);
    } catch (err) {
        console.error(err);
        document.getElementById('admin-app').innerHTML = '<p class="error">Failed to load admin UI</p>';
    }
}

function getSeasonLabel(code) {
    const found = seasonsList.find(s => s.code === code);
    if (found) return found.label || `${found.name} ${found.year || ''}`.trim();
    const displayName = code.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return displayName;
}

function renderSeasonButtons() {
    const container = document.getElementById('season-select-sidebar');
    if (!container) return;
    container.innerHTML = '';
    seasonsList.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'season-select-btn';
        btn.dataset.season = s.code;
        btn.id = `season-${s.code}`;
        btn.textContent = s.label || s.code;
        btn.addEventListener('click', () => setSeason(s.code));
        container.appendChild(btn);
    });
}

async function refreshSeasons(preferSeason) {
    try {
        const res = await fetch('/api/admin/seasons');
        if (!res.ok) throw new Error('failed to fetch seasons');
        seasonsList = await res.json();
    } catch (e) {
        console.error('Failed to refresh seasons', e);
        seasonsList = [];
    }
    renderSeasonButtons();
    const fallback = seasonsList.length ? seasonsList[0].code : '';
    const target = preferSeason || currentSeason || fallback;
    if (target) {
        setSeason(target);
    } else {
        const container = document.getElementById('admin-app');
        if (container) {
            container.innerHTML = '<p class="error">No seasons available. Add one to get started.</p>';
        }
    }
}

function setSeason(season) {
    currentSeason = season;
    // Toggle active state on buttons
    document.querySelectorAll('.season-select-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.season === season);
    });
    // Update chip label with formatted season name
    const chip = document.getElementById('selected-season-label');
    if (chip) {
        chip.textContent = `Season: ${getSeasonLabel(season)}`;
    }
    // Reload current tab data or re-render manage view
    if (currentTab === 'manage-seasons') {
        renderManageSeasons();
    } else {
        switchTab(currentTab);
    }
}

function switchTab(tab) {
    currentTab = tab;

    // Update button styles
    document.getElementById('tab-checklist').classList.toggle('active', tab === 'checklist');
    document.getElementById('tab-raid-bosses').classList.toggle('active', tab === 'raid-bosses');
    document.getElementById('tab-users').classList.toggle('active', tab === 'users');

    if (tab === 'checklist') {
        loadTypes();
    } else if (tab === 'raid-bosses') {
        loadRaidBosses();
    } else if (tab === 'users') {
        if (userRole === 'admin') {
            loadUsers();
        } else {
            const container = document.getElementById('admin-app');
            container.innerHTML = '<div class="access-denied"><h2>Access Denied</h2><p>Only administrators can manage users.</p></div>';
        }
    }
}

// ============= MANAGE SEASONS =============

function normalizeSeasonCode(name, year) {
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
    const yr = parseInt(year, 10);
    if (!slug || !yr) return '';
    return `${slug}_${yr}`;
}

function renderManageSeasons() {
    const container = document.getElementById('admin-app');
    const editing = manageSeasonEditing ? seasonsList.find(s => s.code === manageSeasonEditing) : null;

    container.innerHTML = `
        <div class="season-header">
            <div>
                <h2>Manage Seasons</h2>
                <p>Codes auto-format to lowercase <strong>name_year</strong>. These seasons drive raid bosses and checklists.</p>
            </div>
            <div class="season-actions">
                <button id="refresh-seasons" class="button btn-secondary">Refresh</button>
                <button id="back-from-manage" class="button btn-secondary">Back</button>
            </div>
        </div>

        <div class="season-form">
            <h3>${editing ? 'Edit Season' : 'Add Season'}</h3>
            <form id="season-form">
                <label>
                    <span>Season Name</span>
                    <input id="season-name" type="text" value="${editing ? editing.name : ''}" placeholder="e.g., Christmas" required />
                </label>
                <label>
                    <span>Year</span>
                    <input id="season-year" type="number" value="${editing ? editing.year : ''}" placeholder="2024" min="1" required />
                </label>
                <label>
                    <span>Code Preview</span>
                    <div id="season-code-preview" class="season-code-preview">${editing ? editing.code : 'name_year'}</div>
                </label>
                <div class="season-form-actions">
                    <button type="submit" class="button">${editing ? 'Save Changes' : 'Add Season'}</button>
                    ${editing ? '<button type="button" id="cancel-edit-season" class="button btn-secondary">Cancel</button>' : ''}
                </div>
            </form>
        </div>

        <div class="season-list">
            ${seasonsList.map(s => `
                <div class="season-row">
                    <div class="season-row-info">
                        <div class="season-row-name">${s.label || s.code}</div>
                        <div class="season-row-code">Code: ${s.code}</div>
                    </div>
                    <div class="season-row-actions">
                        <button class="button btn-secondary edit-season" data-code="${s.code}">Edit</button>
                        <button class="button raid-boss-delete delete-season" data-code="${s.code}" data-label="${s.label || s.code}">Delete</button>
                    </div>
                </div>
            `).join('') || '<p class="admin-empty">No seasons found.</p>'}
        </div>
    `;

    const nameInput = document.getElementById('season-name');
    const yearInput = document.getElementById('season-year');
    const codePreview = document.getElementById('season-code-preview');

    const updatePreview = () => {
        codePreview.textContent = normalizeSeasonCode(nameInput.value, yearInput.value) || 'name_year';
    };

    nameInput.addEventListener('input', updatePreview);
    yearInput.addEventListener('input', updatePreview);

    const form = document.getElementById('season-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        const year = parseInt(yearInput.value, 10);
        if (!name || !year) {
            alert('Name and year are required');
            return;
        }
        const payload = { name, year };
        const codeTarget = normalizeSeasonCode(name, year);
        let method = 'POST';
        if (manageSeasonEditing) {
            payload.original_code = manageSeasonEditing;
            method = 'PUT';
        }
        const res = await fetch('/api/admin/seasons', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) {
            const txt = await res.text();
            alert(`Failed to save season: ${txt || res.status}`);
            return;
        }
        manageSeasonEditing = null;
        await refreshSeasons(codeTarget);
        currentTab = 'manage-seasons';
        renderManageSeasons();
    });

    const refreshBtn = document.getElementById('refresh-seasons');
    refreshBtn.addEventListener('click', async () => {
        await refreshSeasons(currentSeason);
        currentTab = 'manage-seasons';
        renderManageSeasons();
    });

    const backBtn = document.getElementById('back-from-manage');
    backBtn.addEventListener('click', () => {
        currentTab = 'checklist';
        switchTab('checklist');
    });

    const cancelEdit = document.getElementById('cancel-edit-season');
    if (cancelEdit) {
        cancelEdit.addEventListener('click', () => {
            manageSeasonEditing = null;
            renderManageSeasons();
        });
    }

    document.querySelectorAll('.edit-season').forEach(btn => {
        btn.addEventListener('click', () => {
            manageSeasonEditing = btn.dataset.code;
            renderManageSeasons();
        });
    });

    document.querySelectorAll('.delete-season').forEach(btn => {
        btn.addEventListener('click', async () => {
            const code = btn.dataset.code;
            const label = btn.dataset.label;
            if (!confirmDelete('season', label)) return;
            const res = await fetch(`/api/admin/seasons?code=${encodeURIComponent(code)}`, { method: 'DELETE' });
            if (!res.ok) {
                const txt = await res.text();
                alert(`Failed to delete season: ${txt || res.status}`);
                return;
            }
            // If we deleted the currently selected season, pick the first after refresh
            if (currentSeason === code) {
                currentSeason = '';
            }
            manageSeasonEditing = null;
            await refreshSeasons();
            currentTab = 'manage-seasons';
            renderManageSeasons();
        });
    });

    updatePreview();
}

// ============= CHECKLIST TAB =============

let pokemons = [];
let selectedPokemonData = null;

async function loadTypes() {
    await loadAllPokemons();
}

async function loadAllPokemons() {
    try {
        const res = await fetch(`/api/admin/pokemon?season=${encodeURIComponent(currentSeason)}`);
        if (!res.ok) {
            console.error(`Failed to load pokemon: ${res.status} ${res.statusText}`);
            const errorText = await res.text();
            console.error(`Error response: ${errorText}`);
            pokemons = [];
            renderPokemons();
            return;
        }
        pokemons = await res.json();
        renderPokemons();
    } catch (error) {
        console.error('Error loading pokemon:', error);
        pokemons = [];
        renderPokemons();
    }
}

function renderPokemons() {
    const container = document.getElementById('admin-app');
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-section-header';

    const title = document.createElement('h2');
    title.textContent = `Checklist Pokemon (${pokemons.length})`;
    header.appendChild(title);

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Pokemon';
    addBtn.className = 'button btn-primary';
    addBtn.addEventListener('click', () => showAddPokemonForm());
    header.appendChild(addBtn);

    container.appendChild(header);

    const list = document.createElement('div');
    list.className = 'pokemon-card-list';

    if (pokemons.length === 0) {
        list.innerHTML = '<p class="admin-empty">No Pokemon in checklist.</p>';
    } else {
        pokemons.forEach(p => {
            const card = document.createElement('div');
            card.className = 'pokemon-card';

            const info = document.createElement('div');

            const nameDiv = document.createElement('div');
            nameDiv.className = 'pokemon-card-name-row';
            const nameEl = document.createElement('strong');
            nameEl.textContent = p.name;
            nameEl.className = 'pokemon-card-name';
            nameDiv.appendChild(nameEl);

            const usageBadge = document.createElement('span');
            usageBadge.textContent = p.usage || 'N/A';
            usageBadge.className = 'pokemon-usage-badge';
            nameDiv.appendChild(usageBadge);
            info.appendChild(nameDiv);

            const typesDiv = document.createElement('div');
            typesDiv.className = 'pokemon-card-types';
            typesDiv.innerHTML = `<strong>Types:</strong> ${p.types ? p.types.join(', ') : 'N/A'}`;
            info.appendChild(typesDiv);

            if (p.ability) {
                const abilityDiv = document.createElement('div');
                abilityDiv.className = 'pokemon-card-ability';
                abilityDiv.innerHTML = `<strong>Ability:</strong> ${p.ability}`;
                info.appendChild(abilityDiv);
            }

            if (p.held_item) {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'pokemon-card-item';
                itemDiv.innerHTML = `<strong>Item:</strong> ${p.held_item}`;
                info.appendChild(itemDiv);
            }

            if (p.moves) {
                const movesDiv = document.createElement('div');
                movesDiv.className = 'pokemon-card-moves';
                movesDiv.innerHTML = `<strong>Moves:</strong> ${p.moves}`;
                info.appendChild(movesDiv);
            }

            if (p.notes) {
                const notesDiv = document.createElement('div');
                notesDiv.className = 'pokemon-card-notes';
                notesDiv.innerHTML = `<strong>Notes:</strong> ${p.notes}`;
                info.appendChild(notesDiv);
            }

            card.appendChild(info);

            const buttonGroup = document.createElement('div');
            buttonGroup.className = 'pokemon-card-actions';

            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.className = 'pokemon-card-btn pokemon-card-btn-edit';
            editBtn.addEventListener('click', () => showEditPokemonForm(p));
            buttonGroup.appendChild(editBtn);

            if (userRole === 'admin') {
                const delBtn = document.createElement('button');
                delBtn.textContent = 'Delete';
                delBtn.className = 'pokemon-card-btn pokemon-card-btn-delete';
                delBtn.addEventListener('click', async () => {
                    if (confirmDelete('pokemon', p.name)) {
                        await fetch(`/api/admin/pokemon?season=${encodeURIComponent(currentSeason)}&name=${encodeURIComponent(p.name)}&usage=${encodeURIComponent(p.usage)}`, { method: 'DELETE' });
                        await loadAllPokemons();
                    }
                });
                buttonGroup.appendChild(delBtn);
            }

            card.appendChild(buttonGroup);
            list.appendChild(card);
        });
    }

    container.appendChild(list);
}

function renderTypes() {
    renderPokemons();
}

let extras = { monsters: [], items: [] };

async function loadExtras() {
    const res = await fetch('/api/admin/extras');
    extras = await res.json();
}

function showAddPokemonForm() {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Add Pokemon</h2>
        <form id="add-pokemon-form" class="pokemon-form">
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Pokemon Name *</span>
                <input type="text" id="pokemon-name-search" class="pokemon-form-input" autocomplete="off" 
                    placeholder="Start typing Pokemon name..." />
                <div id="pokemon-suggestions" class="suggestions-dropdown"></div>
            </label>
            
            <div id="selected-pokemon-info" class="pokemon-info-box" hidden>
                <div><strong>Selected:</strong> <span id="selected-name" class="pokemon-selected-name"></span></div>
                <div><strong class="pokemon-info-label">Types:</strong> <span id="selected-types" class="pokemon-selected-types"></span></div>
            </div>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Usage *</span>
                <select id="usage-field" class="pokemon-form-select" required>
                    <option value="">Select usage...</option>
                    <option value="Physical">Physical</option>
                    <option value="Special">Special</option>
                    <option value="Support">Support</option>
                    <option value="Mixed">Mixed</option>
                </select>
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Ability</span>
                <input type="text" id="ability-search" class="pokemon-form-input" autocomplete="off" 
                    placeholder="Start typing ability..." disabled />
                <div id="ability-suggestions" class="suggestions-dropdown ability-suggestions-dropdown"></div>
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Held Item</span>
                <select id="held-item-field" class="pokemon-form-select">
                    <option value="">(none)</option>
                </select>
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Moves</span>
                <div id="moves-container" class="moves-container">
                    <input type="text" id="moves-field" class="moves-input" autocomplete="off" disabled
                        placeholder="Select valid Pokemon first" />
                </div>
                <div id="move-suggestions" class="suggestions-dropdown"></div>
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Notes</span>
                <textarea id="notes-field" class="pokemon-form-textarea" rows="3" 
                    placeholder="Any additional notes..."></textarea>
            </label>
            
            <div class="pokemon-form-buttons">
                <button type="submit" class="btn-primary">Add Pokemon</button>
                <button type="button" id="cancel-btn" class="btn-secondary">Cancel</button>
            </div>
        </form>
    `;

    setupPokemonFormHandlers(null);
}

// ============= RAID BOSSES TAB =============

async function loadRaidBosses() {
    const container = document.getElementById('admin-app');
    container.innerHTML = '<p class="admin-loading">Loading raid bosses…</p>';
    try {
        const res = await fetch(`/api/admin/raid-bosses?season=${encodeURIComponent(currentSeason)}`);
        if (!res.ok) {
            const txt = await res.text();
            container.innerHTML = `<p class="error">Failed to load raid bosses (${res.status}). ${txt}</p>`;
            return;
        }
        const bosses = await res.json();
        renderRaidBosses(bosses);
    } catch (err) {
        console.error('Error loading raid bosses:', err);
        container.innerHTML = '<p class="error">Failed to load raid bosses</p>';
    }
}

function renderRaidBosses(bosses) {
    const container = document.getElementById('admin-app');
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-section-header';
    const title = document.createElement('h2');
    title.textContent = `Raid Bosses (${bosses.length})`;
    header.appendChild(title);
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'raid-boss-grid';

    if (!bosses.length) {
        grid.innerHTML = '<p class="admin-empty">No raid bosses found.</p>';
    } else {
        bosses.forEach(b => {
            const card = document.createElement('div');
            card.className = 'raid-boss-card';

            const nameRow = document.createElement('div');
            nameRow.className = 'raid-boss-name-row';
            const nameEl = document.createElement('strong');
            nameEl.textContent = `${b.boss_name} ${b.stars}★`;
            nameEl.className = 'raid-boss-name';
            nameRow.appendChild(nameEl);
            card.appendChild(nameRow);

            const desc = document.createElement('div');
            desc.className = 'raid-boss-desc';
            desc.textContent = b.description || '';
            card.appendChild(desc);

            const meta = document.createElement('div');
            meta.className = 'raid-boss-meta';
            meta.innerHTML = `<strong>Ability:</strong> ${b.ability || '—'} • <strong>Item:</strong> ${b.held_item || '—'}`;
            card.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'raid-boss-actions';
            const edit = document.createElement('a');
            edit.href = `/admin/raid-boss-builder?action=edit&season=${encodeURIComponent(currentSeason)}&id=${encodeURIComponent(b.id)}`;
            edit.textContent = 'Edit';
            edit.className = 'raid-boss-link';
            actions.appendChild(edit);
            if (userRole === 'admin') {
                const delBtn = document.createElement('button');
                delBtn.textContent = 'Delete';
                delBtn.className = 'raid-boss-delete';
                delBtn.addEventListener('click', async () => {
                    if (!confirmDelete('raid boss', b.boss_name)) return;
                    await deleteRaidBoss(b.id);
                });
                actions.appendChild(delBtn);
            }
            card.appendChild(actions);

            grid.appendChild(card);
        });
    }

    container.appendChild(grid);
}

async function deleteRaidBoss(id) {
    try {
        const res = await fetch(`/api/admin/raid-bosses?season=${encodeURIComponent(currentSeason)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
            alert('Failed to delete raid boss');
            return;
        }
        await loadRaidBosses();
    } catch (e) {
        console.error('Delete raid boss failed', e);
        alert('Error deleting raid boss');
    }
}

// Backwards-compat alias for potential case-typo
const loadRaidbosses = loadRaidBosses;

// ============= USERS TAB =============

async function loadUsers() {
    const container = document.getElementById('admin-app');
    if (userRole !== 'admin') {
        container.innerHTML = '<div class="access-denied"><h2>Access Denied</h2><p>Only administrators can manage users.</p></div>';
        return;
    }
    container.innerHTML = '<p class="admin-loading">Loading users…</p>';
    try {
        const res = await fetch('/api/admin/users');
        if (!res.ok) {
            const txt = await res.text();
            container.innerHTML = `<p class="error">Failed to load users (${res.status}). ${txt}</p>`;
            return;
        }
        const users = await res.json();
        renderUsers(users);
    } catch (err) {
        console.error('Error loading users:', err);
        container.innerHTML = '<p class="error">Failed to load users</p>';
    }
}

function renderUsers(users) {
    const container = document.getElementById('admin-app');
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-section-header';
    const title = document.createElement('h2');
    title.textContent = `Users (${users.length})`;
    header.appendChild(title);

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add User';
    addBtn.className = 'button btn-primary';
    addBtn.addEventListener('click', showAddUserForm);
    header.appendChild(addBtn);
    container.appendChild(header);

    const list = document.createElement('div');
    list.className = 'admin-user-list';
    users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'admin-user-row admin-row';

        const nameEl = document.createElement('strong');
        nameEl.textContent = u.username;
        row.appendChild(nameEl);

        const roleEl = document.createElement('span');
        roleEl.className = 'role';
        roleEl.textContent = u.role;
        row.appendChild(roleEl);

        const editBtn = document.createElement('button');
        editBtn.className = 'edit';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => showEditUser(u));
        row.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'del';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', async () => {
            if (confirmDelete('user', u.username)) {
                await fetch('/api/admin/users?id=' + u.id, { method: 'DELETE' });
                await loadUsers();
            }
        });
        row.appendChild(delBtn);

        list.appendChild(row);
    });
    container.appendChild(list);
}

function showAddUserForm() {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Create User</h2>
        <form id="create-user">
            <label>Username
                <input name="username" required />
            </label>
            <label>Password <span class="admin-message info">Leave blank for random</span>
                <input name="password" type="password" />
            </label>
            <label>Role
                <select name="role"><option value="author">author</option><option value="mod">mod</option><option value="admin">admin</option></select>
            </label>
            <div class="admin-button-group">
                <button type="submit">Create</button>
                <button type="button" id="cancel">Cancel</button>
            </div>
        </form>
        <div id="generated-password" class="generated-password-display" hidden></div>
    `;
    document.getElementById('cancel').addEventListener('click', loadUsers);
    document.getElementById('create-user').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const payload = { username: f.username.value, password: f.password.value, role: f.role.value };
        const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) {
            const data = await res.json();
            if (data.generated_password) {
                const pwdDiv = document.getElementById('generated-password');
                pwdDiv.textContent = 'Generated password: ' + data.generated_password;
                pwdDiv.style.display = 'block';
            } else {
                await loadUsers();
            }
        } else {
            alert('Failed to create user');
        }
    });
}

function showEditUser(u) {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Edit User: ${u.username}</h2>
        <form id="edit-user">
            <input type="hidden" name="id" value="${u.id}" />
            <label>Role
                <select name="role">
                    <option value="author" ${u.role === 'author' ? 'selected' : ''}>author</option>
                    <option value="mod" ${u.role === 'mod' ? 'selected' : ''}>mod</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
                </select>
            </label>
            <label>New Password <span class="admin-message info">Leave blank to keep current</span>
                <input name="password" type="password" />
            </label>
            <div class="admin-button-group">
                <button type="submit">Save</button>
                <button type="button" id="cancel">Cancel</button>
            </div>
        </form>
    `;
    document.getElementById('cancel').addEventListener('click', loadUsers);
    document.getElementById('edit-user').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const payload = { id: parseInt(f.id.value), role: f.role.value };
        if (f.password.value) payload.password = f.password.value;
        const res = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) {
            await loadUsers();
        } else {
            alert('Failed to save user');
        }
    });
}

function showEditPokemonForm(pokemon) {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Edit Pokemon: ${pokemon.name}</h2>
        <form id="edit-pokemon-form" class="pokemon-form">
            <input type="hidden" id="old-name" value="${pokemon.name}" />
            <input type="hidden" id="old-usage" value="${pokemon.usage}" />
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Pokemon Name (read-only)</span>
                <input type="text" class="pokemon-form-input" value="${pokemon.name}" readonly />
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Types (auto-filled)</span>
                <input type="text" class="pokemon-form-input" value="${pokemon.types ? pokemon.types.join(', ') : ''}" readonly />
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Usage *</span>
                <select id="usage-field" class="pokemon-form-select" required>
                    <option value="Physical" ${pokemon.usage === 'Physical' ? 'selected' : ''}>Physical</option>
                    <option value="Special" ${pokemon.usage === 'Special' ? 'selected' : ''}>Special</option>
                    <option value="Support" ${pokemon.usage === 'Support' ? 'selected' : ''}>Support</option>
                    <option value="Mixed" ${pokemon.usage === 'Mixed' ? 'selected' : ''}>Mixed</option>
                </select>
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Ability</span>
                <input type="text" id="ability-field" class="pokemon-form-input" value="${pokemon.ability || ''}" />
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Held Item</span>
                <select id="held-item-field" class="pokemon-form-select">
                    <option value="">(none)</option>
                </select>
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Moves</span>
                <div id="moves-container" class="moves-container">
                    <input type="text" id="moves-field" class="moves-input" autocomplete="off"
                        placeholder="Add move" />
                </div>
                <div id="move-suggestions" class="suggestions-dropdown"></div>
            </label>
            
            <label class="pokemon-form-label">
                <span class="pokemon-form-label-text">Notes</span>
                <textarea id="notes-field" class="pokemon-form-textarea" rows="3">${pokemon.notes || ''}</textarea>
            </label>
            
            <div class="pokemon-form-buttons">
                <button type="submit" class="btn-primary">Save Changes</button>
                <button type="button" id="cancel-btn" class="btn-secondary">Cancel</button>
            </div>
        </form>
    `;

    setupPokemonFormHandlers(pokemon);
}

// Helper function to create move tag element
function createMoveTag(moveName, container) {
    const tag = document.createElement('span');
    tag.className = 'move-tag';

    const span = document.createElement('span');
    span.textContent = moveName;
    tag.appendChild(span);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Remove move';
    deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        tag.remove();

        // Re-enable move input if less than 4 moves
        const moveInput = container.querySelector('#moves-field');
        const tags = container.querySelectorAll('.move-tag');
        if (tags.length < 4 && moveInput) {
            moveInput.style.display = 'block';
            moveInput.disabled = false;
            // Autofocus after deleting a move
            setTimeout(() => moveInput.focus(), 50);
        }
    });
    tag.appendChild(deleteBtn);

    return tag;
}

// Helper function to setup move autocomplete
function setupMoveAutocomplete(moveInput, container, pokemonName) {
    const suggestions = document.getElementById('move-suggestions');

    moveInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (query.length < 1) {
            suggestions.style.display = 'none';
            return;
        }

        // Find pokemon moves
        let pokemonMoves = [];
        if (pokemonName) {
            const pokemon = extras.monsters.find(m => m.name === pokemonName);
            if (pokemon && pokemon.moves) {
                pokemonMoves = pokemon.moves.map(m => typeof m === 'string' ? m : (m.name || m)).filter(Boolean);
            }
        }

        // Filter moves based on query
        const matches = pokemonMoves.filter(m => m.toLowerCase().includes(query)).slice(0, 10);

        if (matches.length > 0) {
            suggestions.innerHTML = matches.map(m =>
                `<div class="suggestion-item" data-move="${m}">${m}</div>`
            ).join('');
            suggestions.style.display = 'block';

            // Use mousedown instead of click to fire before blur event
            suggestions.querySelectorAll('.suggestion-item').forEach(div => {
                div.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // Prevent input blur
                    const moveName = div.dataset.move;
                    addMoveTag(moveName, moveInput, container);
                    suggestions.style.display = 'none';
                    moveInput.focus(); // Return focus to input
                });
            });
        } else {
            suggestions.style.display = 'none';
        }
    });

    moveInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const moveName = moveInput.value.trim();
            if (moveName) {
                addMoveTag(moveName, moveInput, container);
            }
        }
    });

    moveInput.addEventListener('blur', () => {
        setTimeout(() => {
            suggestions.style.display = 'none';
        }, 200);
    });
}

// Helper function to add a move tag
function addMoveTag(moveName, moveInput, container) {
    const tags = container.querySelectorAll('.move-tag');
    if (tags.length >= 4) {
        return;
    }

    // Check if move already exists
    const existingMoves = Array.from(tags).map(tag => tag.querySelector('span').textContent);
    if (existingMoves.includes(moveName)) {
        moveInput.value = '';
        return;
    }

    const tag = createMoveTag(moveName, container);
    container.insertBefore(tag, moveInput);
    moveInput.value = '';

    // Hide input if 4 moves reached
    if (tags.length + 1 >= 4) {
        moveInput.style.display = 'none';
    }
}

function setupPokemonFormHandlers(editingPokemon) {
    const isEditing = editingPokemon !== null;
    const form = document.getElementById(isEditing ? 'edit-pokemon-form' : 'add-pokemon-form');
    const movesContainer = document.getElementById('moves-container');
    const moveInput = document.getElementById('moves-field');

    // Populate held items dropdown
    const itemSelect = document.getElementById('held-item-field');
    if (extras.items) {
        extras.items.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = item;
            if (isEditing && editingPokemon.held_item === item) {
                option.selected = true;
            }
            itemSelect.appendChild(option);
        });
    }

    // Initialize move tags for editing
    if (isEditing && editingPokemon.moves) {
        const movesArray = editingPokemon.moves.split(',').map(m => m.trim()).filter(m => m);
        movesArray.forEach((move, index) => {
            if (index < 4) {
                const tag = createMoveTag(move, movesContainer);
                movesContainer.insertBefore(tag, moveInput);
            }
        });

        if (movesArray.length >= 4) {
            moveInput.style.display = 'none';
        }

        // Setup move autocomplete for edit
        setupMoveAutocomplete(moveInput, movesContainer, editingPokemon.name);
    }

    // Add click handler to moves container for autofocus
    if (movesContainer) {
        movesContainer.addEventListener('click', (e) => {
            // Only focus if clicking the container itself or the input
            if (e.target === movesContainer || e.target === moveInput) {
                if (moveInput && !moveInput.disabled && moveInput.style.display !== 'none') {
                    moveInput.focus();
                }
            }
        });
    }

    // Cancel button
    document.getElementById('cancel-btn').addEventListener('click', () => renderPokemons());

    if (!isEditing) {
        // Pokemon name autocomplete (only for add)
        const nameInput = document.getElementById('pokemon-name-search');
        const suggestions = document.getElementById('pokemon-suggestions');
        const abilityInput = document.getElementById('ability-search');

        nameInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            if (query.length < 2) {
                suggestions.style.display = 'none';
                return;
            }

            const matches = extras.monsters.filter(m =>
                m.name.toLowerCase().includes(query)
            ).slice(0, 10);

            if (matches.length > 0) {
                suggestions.innerHTML = matches.map(m =>
                    `<div class="suggestion-item" data-name="${m.name}">${m.name}</div>`
                ).join('');
                suggestions.style.display = 'block';

                // Use mousedown instead of click to fire before blur event
                suggestions.querySelectorAll('.suggestion-item').forEach(div => {
                    div.addEventListener('mousedown', (e) => {
                        e.preventDefault(); // Prevent input blur
                        const pokemonName = div.dataset.name;
                        const pokemonData = extras.monsters.find(m => m.name === pokemonName);
                        selectPokemon(pokemonData);
                        suggestions.style.display = 'none';
                    });
                });
            } else {
                suggestions.style.display = 'none';
            }
        });
    }

    // Form submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const usage = document.getElementById('usage-field').value;
        const ability = isEditing ? document.getElementById('ability-field').value : document.getElementById('ability-search').value;
        const heldItem = document.getElementById('held-item-field').value;
        const notes = document.getElementById('notes-field').value;

        // Collect moves from tags
        const moveTags = movesContainer.querySelectorAll('.move-tag span:first-child');
        const movesArray = Array.from(moveTags).map(tag => tag.textContent.trim());
        const moves = movesArray.join(', ');

        if (!isEditing && !selectedPokemonData) {
            alert('Please select a Pokemon');
            return;
        }

        const payload = {
            name: isEditing ? editingPokemon.name : selectedPokemonData.name,
            usage: usage,
            types: isEditing ? editingPokemon.types : selectedPokemonData.types,
            ability: ability,
            held_item: heldItem,
            moves: moves,
            notes: notes,
            completed: isEditing ? editingPokemon.completed : false
        };

        if (isEditing) {
            const response = await fetch(`/api/admin/pokemon?season=${encodeURIComponent(currentSeason)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    old_name: document.getElementById('old-name').value,
                    old_usage: document.getElementById('old-usage').value,
                    pokemon: payload
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                alert(`Failed to update Pokemon: ${errorText}`);
                return;
            }
        } else {
            const response = await fetch(`/api/admin/pokemon?season=${encodeURIComponent(currentSeason)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                alert(`Failed to add Pokemon: ${errorText}`);
                return;
            }
        }

        await loadAllPokemons();
    });
}

function selectPokemon(pokemonData) {
    selectedPokemonData = pokemonData;

    // Update UI
    document.getElementById('pokemon-name-search').value = pokemonData.name;
    document.getElementById('selected-name').textContent = pokemonData.name;
    document.getElementById('selected-types').textContent = pokemonData.types.join(', ');
    document.getElementById('selected-pokemon-info').style.display = 'block';

    // Enable ability search
    const abilityInput = document.getElementById('ability-search');
    abilityInput.disabled = false;
    abilityInput.placeholder = 'Start typing ability...';

    // Enable move input
    const moveInput = document.getElementById('moves-field');
    const movesContainer = document.getElementById('moves-container');
    moveInput.disabled = false;
    moveInput.placeholder = 'Add move';

    // Setup move autocomplete
    setupMoveAutocomplete(moveInput, movesContainer, pokemonData.name);

    // Setup ability autocomplete
    const abilitySuggestions = document.getElementById('ability-suggestions');
    abilityInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        if (query.length < 1) {
            abilitySuggestions.style.display = 'none';
            return;
        }

        const matches = pokemonData.abilities.filter(a =>
            a.name.toLowerCase().includes(query) && a.name !== '--'
        );

        if (matches.length > 0) {
            abilitySuggestions.innerHTML = matches.map(a =>
                `<div class="suggestion-item" data-name="${a.name}">${a.name}</div>`
            ).join('');
            abilitySuggestions.style.display = 'block';

            abilitySuggestions.querySelectorAll('.suggestion-item').forEach(div => {
                div.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // Prevent input blur
                    abilityInput.value = div.dataset.name;
                    abilitySuggestions.style.display = 'none';
                    abilityInput.focus(); // Return focus to input
                });
            });
        } else {
            abilitySuggestions.style.display = 'none';
        }
    });

    // Autofocus on move input
    setTimeout(() => moveInput.focus(), 100);
}
