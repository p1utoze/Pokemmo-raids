document.addEventListener('DOMContentLoaded', function () {
    initAdmin();
});

let currentTab = 'checklist';
let currentSeason = '';
let userRole = '';

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
    addBtn.textContent = '+ Add Type';
    addBtn.addEventListener('click', showAddTypeForm);
    container.appendChild(addBtn);

    const list = document.createElement('div');
    list.className = 'admin-type-list';
    types.forEach(t => {
        const card = document.createElement('div');
        card.className = 'admin-type-card';

        const title = document.createElement('h3');
        title.textContent = t.type_name;
        card.appendChild(title);

        const meta = document.createElement('div');
        meta.textContent = `Min required: ${t.min_required || 0}`;
        card.appendChild(meta);

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'admin-button-group';

        const edit = document.createElement('button');
        edit.textContent = 'Edit';
        edit.className = 'edit';
        edit.addEventListener('click', () => showEditTypeForm(t));
        buttonGroup.appendChild(edit);

        // Only admins can delete
        if (userRole === 'admin') {
            const del = document.createElement('button');
            del.textContent = 'Delete';
            del.className = 'del';
            del.addEventListener('click', () => deleteType(t.id));
            buttonGroup.appendChild(del);
        }

        card.appendChild(buttonGroup);

        const manage = document.createElement('button');
        manage.textContent = 'Manage Pokemons';
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
            <label>Name
                <input name="type_name" />
            </label>
            <label>Min Required
                <input name="min_required" type="number" min="0" />
            </label>
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
            <label>Name
                <input name="type_name" value="${t.type_name}" />
            </label>
            <label>Min Required
                <input name="min_required" type="number" min="0" value="${t.min_required || 0}" />
            </label>
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
    const type = types.find(t => t.id === id);
    if (!confirmDelete('type', type?.type_name)) return;
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
    const heading = document.createElement('h2');
    heading.textContent = `Manage Pokemons — ${typeName}`;

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'admin-button-group';
    buttonGroup.style.marginBottom = '20px';

    const addBtn = document.createElement('button');
    addBtn.id = 'add-pokemon';
    addBtn.textContent = '+ Add Pokemon';
    addBtn.addEventListener('click', () => showAddPokemonForm(typeId));

    const backBtn = document.createElement('button');
    backBtn.id = 'back';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', () => renderTypes());

    buttonGroup.appendChild(addBtn);
    buttonGroup.appendChild(backBtn);

    const pokemonList = document.createElement('div');
    pokemonList.id = 'pokemon-list';

    container.innerHTML = '';
    container.appendChild(heading);
    container.appendChild(buttonGroup);
    container.appendChild(pokemonList);

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

        const nameEl = document.createElement('strong');
        nameEl.textContent = p.pokemon_name;
        el.appendChild(nameEl);

        const typeEl = document.createElement('span');
        typeEl.textContent = ` — ${p.phys_special}`;
        el.appendChild(typeEl);

        const editBtn = document.createElement('button');
        editBtn.className = 'edit';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => showEditPokemonForm(p));
        el.appendChild(editBtn);

        // Only admins can delete
        if (userRole === 'admin') {
            const delBtn = document.createElement('button');
            delBtn.className = 'del';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
                if (confirmDelete('pokemon', p.pokemon_name)) {
                    await fetch('/api/admin/pokemon?id=' + p.id, { method: 'DELETE' });
                    await loadPokemons(typeId);
                }
            });
            el.appendChild(delBtn);
        }

        list.appendChild(el);
    });
}

function showAddPokemonForm(typeId) {
    const container = document.getElementById('admin-app');
    container.innerHTML = `
        <h2>Add Pokemon</h2>
        <form id="add-poke-form">
            <input type="hidden" name="type_id" value="${typeId}" />
            <label>Name
                <input name="pokemon_name" />
            </label>
            <label>Phys/Special
                <input name="phys_special" />
            </label>
            <label>Secondary Type
                <input name="secondary_type" />
            </label>
            <label>Ability
                <input name="ability" />
            </label>
            <label>Held Item
                <select name="held_item">
                    <option value="">(none)</option>
                    ${extras.items.map(i => `<option value="${i}">${i}</option>`).join('')}
                </select>
            </label>
            <label>Moves (comma separated)
                <input name="moves" />
            </label>
            <label>Notes
                <input name="notes" />
            </label>
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
            <label>Pokemon Name
                <input name="pokemon_name" value="${p.pokemon_name || ''}" required />
            </label>
            <label>Physical/Special
                <select name="phys_special">
                    <option value="Physical" ${p.phys_special === 'Physical' ? 'selected' : ''}>Physical</option>
                    <option value="Special" ${p.phys_special === 'Special' ? 'selected' : ''}>Special</option>
                    <option value="Mixed" ${p.phys_special === 'Mixed' ? 'selected' : ''}>Mixed</option>
                </select>
            </label>
            <label>Secondary Type
                <select name="secondary_type">
                    <option value="">(none)</option>
                    ${types.map(t => `<option value="${t.type_name}" ${p.secondary_type === t.type_name ? 'selected' : ''}>${t.type_name}</option>`).join('')}
                </select>
            </label>
            <label>Ability
                <input name="ability" value="${p.ability || ''}" />
            </label>
            <label>Held Item
                <select name="held_item">
                    <option value="">(none)</option>
                    ${extras.items.map(i => `<option value="${i}" ${p.held_item === i ? 'selected' : ''}>${i}</option>`).join('')}
                </select>
            </label>
            <label>Moves (comma separated)
                <input name="moves" value="${p.moves || ''}" />
            </label>
            <label>Notes
                <input name="notes" value="${p.notes || ''}" />
            </label>
            <div class="admin-button-group">
                <button type="submit">Save</button>
                <button type="button" id="cancel">Cancel</button>
            </div>
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
            notes: f.notes.value
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
    addBtn.textContent = '+ Add Raid Boss';
    addBtn.addEventListener('click', () => {
        window.location.href = '/admin/raid-boss-builder?action=create&season=' + encodeURIComponent(currentSeason);
    });
    container.appendChild(addBtn);

    const list = document.createElement('div');
    list.className = 'admin-raid-list';
    raidBosses.forEach(b => {
        const card = document.createElement('div');
        card.className = 'admin-raid-card';

        const title = document.createElement('h3');
        title.textContent = b.boss_name;
        card.appendChild(title);

        const stars = document.createElement('div');
        stars.textContent = `⭐ ${b.stars}`;
        card.appendChild(stars);

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'admin-button-group';

        const edit = document.createElement('button');
        edit.textContent = 'Edit';
        edit.className = 'edit';
        edit.addEventListener('click', () => {
            window.location.href = '/admin/raid-boss-builder?action=edit&id=' + b.id + '&season=' + encodeURIComponent(currentSeason);
        });
        buttonGroup.appendChild(edit);

        // Only admins can delete
        if (userRole === 'admin') {
            const del = document.createElement('button');
            del.textContent = 'Delete';
            del.className = 'del';
            del.addEventListener('click', () => deleteRaidBoss(b.id));
            buttonGroup.appendChild(del);
        }

        card.appendChild(buttonGroup);
        list.appendChild(card);
    });
    container.appendChild(list);
}

async function deleteRaidBoss(id) {
    const boss = raidBosses.find(b => b.id === id);
    if (!confirmDelete('raid boss', boss?.name)) return;
    await fetch('/api/admin/raid-bosses?season=' + encodeURIComponent(currentSeason) + '&id=' + id, { method: 'DELETE' });
    await loadRaidBosses();
}

// ============= USERS TAB =============

let users = [];

async function loadUsers() {
    // Only admins can access user management
    if (userRole !== 'admin') {
        const container = document.getElementById('admin-app');
        const deniedDiv = document.createElement('div');
        deniedDiv.className = 'access-denied';
        deniedDiv.innerHTML = '<h2>Access Denied</h2><p>Only administrators can manage users.</p>';
        container.innerHTML = '';
        container.appendChild(deniedDiv);
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
    addBtn.textContent = '+ Add User';
    addBtn.addEventListener('click', showAddUserForm);
    container.appendChild(addBtn);

    const list = document.createElement('div');
    list.className = 'admin-user-list';
    users.forEach(u => {
        const row = document.createElement('div');
        row.className = 'admin-user-row';

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
        <div id="generated-password" class="generated-password-display" style="display:none;"></div>
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
                <button type="button" id="reset-pass">Reset Password</button>
                <button type="button" id="cancel">Cancel</button>
            </div>
        </form>
        <div id="generated-password" class="generated-password-display" style="display:none;"></div>
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
            const pwdDiv = document.getElementById('generated-password');
            pwdDiv.textContent = 'Reset password: ' + data.generated_password;
            pwdDiv.style.display = 'block';
        } else {
            alert('Failed to reset password');
        }
    });
}
