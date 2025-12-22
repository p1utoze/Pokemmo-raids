document.addEventListener('DOMContentLoaded', function () {
    initAdmin();
});

let currentTab = 'checklist';
let currentSeason = '';
let userRole = '';

async function initAdmin() {
    try {
        userRole = window.USER_ROLE || '';
        const seasonButtons = Array.from(document.querySelectorAll('.season-select-btn'));
        const shell = document.querySelector('.admin-shell');

        if (!seasonButtons.length) {
            // Fallback to data attribute if buttons are missing
            const fallbackSeason = shell?.dataset.initialSeason;
            if (!fallbackSeason) {
                throw new Error('No seasons available');
            }
            setSeason(fallbackSeason);
        }

        // Tab switching
        document.getElementById('tab-checklist').addEventListener('click', () => switchTab('checklist'));
        document.getElementById('tab-raid-bosses').addEventListener('click', () => switchTab('raid-bosses'));
        document.getElementById('tab-users').addEventListener('click', () => switchTab('users'));

        // Season switching via sidebar buttons
        seasonButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                setSeason(btn.dataset.season);
            });
        });

        // Initialize season to first button when available
        if (seasonButtons.length) {
            const initialSeason = seasonButtons[0].dataset.season;
            setSeason(initialSeason);
        }

        await loadExtras();
    } catch (err) {
        console.error(err);
        document.getElementById('admin-app').innerHTML = '<p class="error">Failed to load admin UI</p>';
    }
}

function setSeason(season) {
    currentSeason = season;
    // Toggle active state on buttons
    document.querySelectorAll('.season-select-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.season === season);
    });
    // Update chip label
    const chip = document.getElementById('selected-season-label');
    if (chip) {
        chip.textContent = `Season: ${season}`;
    }
    // Reload current tab data
    switchTab(currentTab);
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
        loadUsers();
    }
}

// ============= CHECKLIST TAB =============

let types = [];

async function loadTypes() {
    const res = await fetch('/api/admin/types?season=' + encodeURIComponent(currentSeason));
    types = await res.json();
    renderTypes();
}

function renderTypes() {
    const container = document.getElementById('admin-app');
    container.innerHTML = '';
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add Type';
    addBtn.addEventListener('click', showAddTypeForm);
    container.appendChild(addBtn);

    const list = document.createElement('div');
    list.className = 'admin-type-list';
    types.forEach(t => {
        const card = document.createElement('div');
        card.className = 'admin-type-card';
        card.innerHTML = `<h3>${t.type_name}</h3><div>Min required: ${t.min_required || 0}</div>`;
        const edit = document.createElement('button'); edit.textContent = 'Edit';
        edit.addEventListener('click', () => showEditTypeForm(t));
        card.appendChild(edit);

        // Only admins can delete
        if (userRole === 'admin') {
            const del = document.createElement('button'); del.textContent = 'Delete';
            del.addEventListener('click', () => deleteType(t.id));
            card.appendChild(del);
        }

        const manage = document.createElement('button'); manage.textContent = 'Manage Pokemons';
        manage.addEventListener('click', () => managePokemons(t.id, t.type_name));
        card.appendChild(manage);
        list.appendChild(card);
    });
    container.appendChild(list);
}

function showAddTypeForm() {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Add Type</h2>
        <form id="add-type-form">
            <label>Name</label>
            <input name="type_name" />
            <label>Min Required</label>
            <input name="min_required" type="number" min="0" />
            <button type="submit">Create</button>
            <button type="button" id="cancel">Cancel</button>
        </form>
    `;
    document.getElementById('cancel').addEventListener('click', () => renderTypes());
    document.getElementById('add-type-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const payload = { type_name: form.type_name.value, min_required: parseInt(form.min_required.value || '0') };
        await fetch('/api/admin/types', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        await loadTypes();
    });
}

function showEditTypeForm(t) {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Edit Type</h2>
        <form id="edit-type-form">
            <input type="hidden" name="id" value="${t.id}" />
            <label>Name</label>
            <input name="type_name" value="${t.type_name}" />
            <label>Min Required</label>
            <input name="min_required" type="number" min="0" value="${t.min_required || 0}" />
            <button type="submit">Save</button>
            <button type="button" id="cancel">Cancel</button>
        </form>
    `;
    document.getElementById('cancel').addEventListener('click', () => renderTypes());
    document.getElementById('edit-type-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const payload = { id: parseInt(form.id.value), type_name: form.type_name.value, min_required: parseInt(form.min_required.value || '0') };
        await fetch('/api/admin/types', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        await loadTypes();
    });
}

async function deleteType(id) {
    if (!confirm('Delete this type?')) return;
    await fetch('/api/admin/types?id=' + id, { method: 'DELETE' });
    await loadTypes();
}

let extras = { monsters: [], items: [] };
async function loadExtras() {
    const res = await fetch('/api/admin/extras');
    extras = await res.json();
}

async function managePokemons(typeId, typeName) {
    const container = document.getElementById('admin-app');
    container.innerHTML = `<h2>Manage Pokemons — ${typeName}</h2><div id="pokemon-list"></div><button id="add-pokemon">Add Pokemon</button><button id="back">Back</button>`;
    document.getElementById('back').addEventListener('click', () => renderTypes());
    document.getElementById('add-pokemon').addEventListener('click', () => showAddPokemonForm(typeId));
    await loadPokemons(typeId);
}

async function loadPokemons(typeId) {
    const res = await fetch('/api/admin/pokemon?type_id=' + typeId);
    const pokes = await res.json();
    const list = document.getElementById('pokemon-list');
    list.innerHTML = '';
    pokes.forEach(p => {
        const el = document.createElement('div');
        el.className = 'admin-pokemon-row';
        el.innerHTML = `<strong>${p.pokemon_name}</strong> — ${p.phys_special} <button class="edit">Edit</button>`;

        // Only admins can delete
        if (userRole === 'admin') {
            const delBtn = document.createElement('button');
            delBtn.className = 'del';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
                if (confirm('Delete?')) {
                    await fetch('/api/admin/pokemon?id=' + p.id, { method: 'DELETE' });
                    await loadPokemons(typeId);
                }
            });
            el.appendChild(delBtn);
        }

        el.querySelector('.edit').addEventListener('click', () => showEditPokemonForm(p));
        list.appendChild(el);
    });
}

function showAddPokemonForm(typeId) {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Add Pokemon</h2>
        <form id="add-poke-form">
            <input type="hidden" name="type_id" value="${typeId}" />
            <label>Name</label><input name="pokemon_name" />
            <label>Phys/Special</label><input name="phys_special" />
            <label>Secondary Type</label><input name="secondary_type" />
            <label>Ability</label><input name="ability" />
            <label>Held Item</label>
            <select name="held_item">
                <option value="">(none)</option>
                ${extras.items.map(i => `<option value="${i}">${i}</option>`).join('')}
            </select>
            <label>Moves (comma separated)</label><input name="moves" />
            <label>Notes</label><input name="notes" />
            <button>Create</button>
            <button type="button" id="cancel">Cancel</button>
        </form>
    `;
    document.getElementById('cancel').addEventListener('click', () => managePokemons(typeId, ''));
    document.getElementById('add-poke-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const payload = {
            type_id: parseInt(f.type_id.value),
            pokemon_name: f.pokemon_name.value,
            phys_special: f.phys_special.value,
            secondary_type: f.secondary_type.value,
            held_item: f.held_item.value,
            ability: f.ability.value,
            moves: f.moves.value,
            notes: f.notes.value
        };
        await fetch('/api/admin/pokemon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        await managePokemons(payload.type_id, '');
    });
}

function showEditPokemonForm(p) {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Edit Pokemon</h2>
        <form id="edit-poke-form">
            <input type="hidden" name="id" value="${p.id}" />
            <input type="hidden" name="type_id" value="${p.type_id}" />
            <label>Name</label><input name="pokemon_name" value="${p.pokemon_name}" />
            <label>Phys/Special</label><input name="phys_special" value="${p.phys_special}" />
            <label>Secondary Type</label><input name="secondary_type" value="${p.secondary_type}" />
            <label>Ability</label><input name="ability" value="${p.ability}" />
            <label>Held Item</label>
            <select name="held_item">
                <option value="">(none)</option>
                ${extras.items.map(i => `<option value="${i}" ${p.held_item === i ? 'selected' : ''}>${i}</option>`).join('')}
            </select>
            <label>Moves (comma separated)</label><input name="moves" value="${p.moves}" />
            <label>Notes</label><input name="notes" value="${p.notes || ''}" />
            <label>Completed</label><input type="checkbox" name="completed" ${p.completed ? 'checked' : ''} />
            <button>Save</button>
            <button type="button" id="cancel">Cancel</button>
        </form>
    `;
    document.getElementById('cancel').addEventListener('click', () => managePokemons(p.type_id, ''));
    document.getElementById('edit-poke-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const payload = {
            id: parseInt(f.id.value),
            type_id: parseInt(f.type_id.value),
            pokemon_name: f.pokemon_name.value,
            phys_special: f.phys_special.value,
            secondary_type: f.secondary_type.value,
            held_item: f.held_item.value,
            ability: f.ability.value,
            moves: f.moves.value,
            notes: f.notes.value,
            completed: f.completed.checked ? 1 : 0
        };
        await fetch('/api/admin/pokemon', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        await managePokemons(payload.type_id, '');
    });
}

// ============= RAID BOSSES TAB =============

let raidBosses = [];

async function loadRaidBosses() {
    const res = await fetch('/api/admin/raid-bosses?season=' + encodeURIComponent(currentSeason));
    raidBosses = await res.json();
    renderRaidBosses();
}

function renderRaidBosses() {
    const container = document.getElementById('admin-app');
    container.innerHTML = '';
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add Raid Boss';
    addBtn.addEventListener('click', () => {
        window.location.href = '/admin/raid-boss-builder?action=create&season=' + encodeURIComponent(currentSeason);
    });
    container.appendChild(addBtn);

    const list = document.createElement('div');
    list.className = 'admin-raid-list';
    raidBosses.forEach(b => {
        const card = document.createElement('div');
        card.className = 'admin-raid-card';
        card.innerHTML = `<h3>${b.boss_name}</h3><div>⭐ ${b.stars}</div>`;
        const edit = document.createElement('button'); edit.textContent = 'Edit';
        edit.addEventListener('click', () => {
            window.location.href = '/admin/raid-boss-builder?action=edit&id=' + b.id + '&season=' + encodeURIComponent(currentSeason);
        });
        card.appendChild(edit);

        // Only admins can delete
        if (userRole === 'admin') {
            const del = document.createElement('button'); del.textContent = 'Delete';
            del.addEventListener('click', () => deleteRaidBoss(b.id));
            card.appendChild(del);
        }

        list.appendChild(card);
    });
    container.appendChild(list);
}

async function deleteRaidBoss(id) {
    if (!confirm('Delete this raid boss?')) return;
    await fetch('/api/admin/raid-bosses?season=' + encodeURIComponent(currentSeason) + '&id=' + id, { method: 'DELETE' });
    await loadRaidBosses();
}

// ============= USERS TAB =============

let users = [];

async function loadUsers() {
    // Only admins can access user management
    if (userRole !== 'admin') {
        const container = document.getElementById('admin-app');
        container.innerHTML = '<div style="padding:20px;color:var(--muted);"><h2>Access Denied</h2><p>Only administrators can manage users.</p></div>';
        return;
    }
    const res = await fetch('/api/admin/users');
    if (!res.ok) return;
    users = await res.json();
    renderUsers();
}

function renderUsers() {
    const container = document.getElementById('admin-app');
    container.innerHTML = '';
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add User';
    addBtn.addEventListener('click', showAddUserForm);
    container.appendChild(addBtn);

    const list = document.createElement('div');
    list.className = 'admin-user-list';
    users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'admin-user-row';
        row.innerHTML = `<strong>${u.username}</strong> <span class="role">${u.role}</span> <button class="edit">Edit</button> <button class="del">Delete</button>`;
        row.querySelector('.edit').addEventListener('click', () => showEditUser(u));
        row.querySelector('.del').addEventListener('click', async () => {
            if (confirm('Delete user?')) {
                await fetch('/api/admin/users?id=' + u.id, { method: 'DELETE' });
                await loadUsers();
            }
        });
        list.appendChild(row);
    });
    container.appendChild(list);
}

function showAddUserForm() {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Create User</h2>
        <form id="create-user">
            <label>Username</label><input name="username" required />
            <label>Password <span style="color:var(--muted);font-size:12px;">(leave blank for random)</span></label><input name="password" type="password" />
            <label>Role</label>
            <select name="role"><option value="author">author</option><option value="mod">mod</option><option value="admin">admin</option></select>
            <button type="submit">Create</button>
            <button type="button" id="cancel">Cancel</button>
        </form>
        <div id="generated-password" style="margin-top:10px;color:var(--accent);"></div>
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
                document.getElementById('generated-password').textContent = 'Generated password: ' + data.generated_password;
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
            <label>Role</label>
            <select name="role">
                <option value="author" ${u.role === 'author' ? 'selected' : ''}>author</option>
                <option value="mod" ${u.role === 'mod' ? 'selected' : ''}>mod</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
            </select>
            <label>New Password (leave blank to keep)</label>
            <input name="password" type="password" />
            <button type="submit">Save</button>
            <button type="button" id="reset-pass">Reset Password</button>
            <button type="button" id="cancel">Cancel</button>
        </form>
        <div id="generated-password" style="margin-top:10px;color:var(--accent);"></div>
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
    document.getElementById('reset-pass').addEventListener('click', async () => {
        const id = u.id, role = u.role;
        const res = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, role, reset: true }) });
        if (res.ok) {
            const data = await res.json();
            document.getElementById('generated-password').textContent = 'Reset password: ' + data.generated_password;
        } else {
            alert('Failed to reset password');
        }
    });
}
