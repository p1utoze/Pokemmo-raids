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
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px;flex-wrap:wrap;">
            <div>
                <h2 style="margin:0;color:#fff;">Manage Seasons</h2>
                <p style="margin:4px 0 0;color:#8eb3d1;font-size:13px;">Codes auto-format to lowercase <strong>name_year</strong>. These seasons drive raid bosses and checklists.</p>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <button id="refresh-seasons" class="button btn-secondary">Refresh</button>
                <button id="back-from-manage" class="button btn-secondary">Back</button>
            </div>
        </div>

        <div class="season-form" style="background:#1e3a5f;padding:16px;border-radius:8px;margin-bottom:16px;">
            <h3 style="margin-top:0;color:#fff;">${editing ? 'Edit Season' : 'Add Season'}</h3>
            <form id="season-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;align-items:end;">
                <label style="display:flex;flex-direction:column;gap:6px;color:#a8c5e3;">
                    <span>Season Name</span>
                    <input id="season-name" type="text" value="${editing ? editing.name : ''}" placeholder="e.g., Christmas" style="padding:8px;background:#0d1f2d;border:1px solid #2d5a8a;border-radius:4px;color:#fff;" required />
                </label>
                <label style="display:flex;flex-direction:column;gap:6px;color:#a8c5e3;">
                    <span>Year</span>
                    <input id="season-year" type="number" value="${editing ? editing.year : ''}" placeholder="2024" min="1" style="padding:8px;background:#0d1f2d;border:1px solid #2d5a8a;border-radius:4px;color:#fff;" required />
                </label>
                <div style="display:flex;flex-direction:column;gap:6px;color:#a8c5e3;">
                    <span>Code Preview</span>
                    <div id="season-code-preview" style="padding:10px;background:#0d1f2d;border:1px dashed #2d5a8a;border-radius:4px;color:#4a90e2;">${editing ? editing.code : 'name_year'}</div>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button type="submit" class="button" style="padding:10px 18px;">${editing ? 'Save Changes' : 'Add Season'}</button>
                    ${editing ? '<button type="button" id="cancel-edit-season" class="button btn-secondary">Cancel</button>' : ''}
                </div>
            </form>
        </div>

        <div class="season-list" style="display:flex;flex-direction:column;gap:10px;">
            ${seasonsList.map(s => `
                <div class="season-row" style="background:#12263a;padding:12px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                    <div style="color:#fff;">
                        <div style="font-weight:600;">${s.label || s.code}</div>
                        <div style="color:#8eb3d1;font-size:13px;">Code: ${s.code}</div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="button btn-secondary edit-season" data-code="${s.code}">Edit</button>
                        <button class="button delete-season" style="background:#8a2d2d;color:white;" data-code="${s.code}" data-label="${s.label || s.code}">Delete</button>
                    </div>
                </div>
            `).join('') || '<p style="color:#a8c5e3;">No seasons found.</p>'}
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
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';

    const title = document.createElement('h2');
    title.textContent = `Checklist Pokemon (${pokemons.length})`;
    title.style.cssText = 'margin: 0; color: #fff;';
    header.appendChild(title);

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Pokemon';
    addBtn.style.cssText = 'background: #4a90e2; padding: 10px 20px; border-radius: 6px; color: white; border: none; cursor: pointer;';
    addBtn.addEventListener('click', () => showAddPokemonForm());
    header.appendChild(addBtn);

    container.appendChild(header);

    const list = document.createElement('div');
    list.style.cssText = 'display: grid; gap: 15px; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));';

    if (pokemons.length === 0) {
        list.innerHTML = '<p style="color: #a8c5e3; padding: 20px;">No Pokemon in checklist.</p>';
    } else {
        pokemons.forEach(p => {
            const card = document.createElement('div');
            card.style.cssText = 'background: #1e3a5f; padding: 15px; border-radius: 8px; display: flex; flex-direction: column; gap: 10px; align-items: stretch;';

            const info = document.createElement('div');

            const nameDiv = document.createElement('div');
            nameDiv.style.cssText = 'display: flex; gap: 10px; align-items: center; margin-bottom: 8px;';
            const nameEl = document.createElement('strong');
            nameEl.textContent = p.name;
            nameEl.style.cssText = 'color: #fff; font-size: 18px;';
            nameDiv.appendChild(nameEl);

            const usageBadge = document.createElement('span');
            usageBadge.textContent = p.usage || 'N/A';
            usageBadge.style.cssText = 'background: #2d5a8a; padding: 4px 10px; border-radius: 4px; font-size: 12px; color: #a8c5e3;';
            nameDiv.appendChild(usageBadge);
            info.appendChild(nameDiv);

            const typesDiv = document.createElement('div');
            typesDiv.style.cssText = 'color: #7a9bb8; margin-bottom: 5px; font-size: 14px;';
            typesDiv.innerHTML = `<strong>Types:</strong> ${p.types ? p.types.join(', ') : 'N/A'}`;
            info.appendChild(typesDiv);

            if (p.ability) {
                const abilityDiv = document.createElement('div');
                abilityDiv.style.cssText = 'color: #8eb3d1; margin-bottom: 5px; font-size: 13px;';
                abilityDiv.innerHTML = `<strong>Ability:</strong> ${p.ability}`;
                info.appendChild(abilityDiv);
            }

            if (p.held_item) {
                const itemDiv = document.createElement('div');
                itemDiv.style.cssText = 'color: #8eb3d1; margin-bottom: 5px; font-size: 13px;';
                itemDiv.innerHTML = `<strong>Item:</strong> ${p.held_item}`;
                info.appendChild(itemDiv);
            }

            if (p.moves) {
                const movesDiv = document.createElement('div');
                movesDiv.style.cssText = 'color: #7a9bb8; margin-bottom: 5px; font-size: 13px;';
                movesDiv.innerHTML = `<strong>Moves:</strong> ${p.moves}`;
                info.appendChild(movesDiv);
            }

            if (p.notes) {
                const notesDiv = document.createElement('div');
                notesDiv.style.cssText = 'color: #6a8aa8; font-style: italic; font-size: 13px;';
                notesDiv.innerHTML = `<strong>Notes:</strong> ${p.notes}`;
                info.appendChild(notesDiv);
            }

            card.appendChild(info);

            const buttonGroup = document.createElement('div');
            buttonGroup.style.cssText = 'display: flex; flex-direction: row; gap: 8px; justify-content: flex-start;';

            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.style.cssText = 'padding: 8px 16px; border-radius: 4px; background: #2d5a8a; color: white; border: none; cursor: pointer; flex: 1;';
            editBtn.addEventListener('click', () => showEditPokemonForm(p));
            buttonGroup.appendChild(editBtn);

            if (userRole === 'admin') {
                const delBtn = document.createElement('button');
                delBtn.textContent = 'Delete';
                delBtn.style.cssText = 'padding: 8px 16px; border-radius: 4px; background: #8a2d2d; color: white; border: none; cursor: pointer; flex: 1;';
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
        <form id="add-pokemon-form" style="max-width: 600px;">
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Pokemon Name *</span>
                <input type="text" id="pokemon-name-search" autocomplete="off" 
                    style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white;" 
                    placeholder="Start typing Pokemon name..." />
                <div id="pokemon-suggestions" style="position: relative; background: #1e3a5f; border-radius: 4px; margin-top: 5px; max-height: 200px; overflow-y: auto; display: none;"></div>
            </label>
            
            <div id="selected-pokemon-info" style="display: none; background: #1e3a5f; padding: 10px; border-radius: 4px; margin-bottom: 15px;">
                <div><strong style="color: #fff;">Selected:</strong> <span id="selected-name" style="color: #4a90e2;"></span></div>
                <div><strong style="color: #a8c5e3;">Types:</strong> <span id="selected-types" style="color: #7a9bb8;"></span></div>
            </div>
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Usage *</span>
                <select id="usage-field" required style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white;">
                    <option value="">Select usage...</option>
                    <option value="Physical">Physical</option>
                    <option value="Special">Special</option>
                    <option value="Support">Support</option>
                    <option value="Mixed">Mixed</option>
                </select>
            </label>
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Ability</span>
                <input type="text" id="ability-search" autocomplete="off" 
                    style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white;" 
                    placeholder="Start typing ability..." disabled />
                <div id="ability-suggestions" style="position: relative; background: #1e3a5f; border-radius: 4px; margin-top: 5px; max-height: 150px; overflow-y: auto; display: none;"></div>
            </label>
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Held Item</span>
                <select id="held-item-field" style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white;">
                    <option value="">(none)</option>
                </select>
            </label>
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Moves</span>
                <div id="moves-container" style="display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; min-height: 42px;">
                    <input type="text" id="moves-field" autocomplete="off" disabled
                        style="flex: 1; min-width: 120px; padding: 4px; background: transparent; border: none; color: white; outline: none;" 
                        placeholder="Select valid Pokemon first" />
                </div>
                <div id="move-suggestions" style="position: relative; background: #1e3a5f; border-radius: 4px; margin-top: 5px; max-height: 200px; overflow-y: auto; display: none;"></div>
            </label>
            
            <label style="display: block; margin-bottom: 20px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Notes</span>
                <textarea id="notes-field" rows="3" 
                    style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white; resize: vertical;" 
                    placeholder="Any additional notes..."></textarea>
            </label>
            
            <div style="display: flex; gap: 10px;">
                <button type="submit" style="padding: 10px 20px; background: #4a90e2; color: white; border: none; border-radius: 4px; cursor: pointer;">Add Pokemon</button>
                <button type="button" id="cancel-btn" style="padding: 10px 20px; background: #6a6a6a; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
            </div>
        </form>
    `;

    setupPokemonFormHandlers(null);
}

// ============= RAID BOSSES TAB =============

async function loadRaidBosses() {
    const container = document.getElementById('admin-app');
    container.innerHTML = '<p style="color:#a8c5e3">Loading raid bosses…</p>';
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
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;';
    const title = document.createElement('h2');
    title.textContent = `Raid Bosses (${bosses.length})`;
    title.style.cssText = 'margin:0;color:#fff;';
    header.appendChild(title);
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;gap:15px;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));';

    if (!bosses.length) {
        grid.innerHTML = '<p style="color:#a8c5e3;padding:20px;">No raid bosses found.</p>';
    } else {
        bosses.forEach(b => {
            const card = document.createElement('div');
            card.style.cssText = 'background:#1e3a5f;padding:15px;border-radius:8px;display:flex;flex-direction:column;gap:8px;';

            const nameRow = document.createElement('div');
            nameRow.style.cssText = 'display:flex;gap:10px;align-items:center;';
            const nameEl = document.createElement('strong');
            nameEl.textContent = `${b.boss_name} ${b.stars}★`;
            nameEl.style.cssText = 'color:#fff;font-size:18px;';
            nameRow.appendChild(nameEl);
            card.appendChild(nameRow);

            const desc = document.createElement('div');
            desc.style.cssText = 'color:#7a9bb8;font-size:14px;';
            desc.textContent = b.description || '';
            card.appendChild(desc);

            const meta = document.createElement('div');
            meta.style.cssText = 'color:#8eb3d1;font-size:13px;';
            meta.innerHTML = `<strong>Ability:</strong> ${b.ability || '—'} • <strong>Item:</strong> ${b.held_item || '—'}`;
            card.appendChild(meta);

            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:8px;margin-top:6px;';
            const edit = document.createElement('a');
            edit.href = `/admin/raid-boss-builder?action=edit&season=${encodeURIComponent(currentSeason)}&id=${encodeURIComponent(b.id)}`;
            edit.textContent = 'Edit';
            edit.style.cssText = 'padding:8px 16px;border-radius:4px;background:#2d5a8a;color:white;text-decoration:none;';
            actions.appendChild(edit);
            if (userRole === 'admin') {
                const delBtn = document.createElement('button');
                delBtn.textContent = 'Delete';
                delBtn.style.cssText = 'padding:8px 16px;border-radius:4px;background:#8a2d2d;color:white;border:none;cursor:pointer;';
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
    container.innerHTML = '<p style="color:#a8c5e3">Loading users…</p>';
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
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;';
    const title = document.createElement('h2');
    title.textContent = `Users (${users.length})`;
    title.style.cssText = 'margin:0;color:#fff;';
    header.appendChild(title);

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add User';
    addBtn.className = 'button';
    addBtn.addEventListener('click', showAddUserForm);
    header.appendChild(addBtn);
    container.appendChild(header);

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
        <form id="edit-pokemon-form" style="max-width: 600px;">
            <input type="hidden" id="old-name" value="${pokemon.name}" />
            <input type="hidden" id="old-usage" value="${pokemon.usage}" />
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Pokemon Name (read-only)</span>
                <input type="text" value="${pokemon.name}" readonly 
                    style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: #7a9bb8;" />
            </label>
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Types (auto-filled)</span>
                <input type="text" value="${pokemon.types ? pokemon.types.join(', ') : ''}" readonly 
                    style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: #7a9bb8;" />
            </label>
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Usage *</span>
                <select id="usage-field" required style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white;">
                    <option value="Physical" ${pokemon.usage === 'Physical' ? 'selected' : ''}>Physical</option>
                    <option value="Special" ${pokemon.usage === 'Special' ? 'selected' : ''}>Special</option>
                    <option value="Support" ${pokemon.usage === 'Support' ? 'selected' : ''}>Support</option>
                    <option value="Mixed" ${pokemon.usage === 'Mixed' ? 'selected' : ''}>Mixed</option>
                </select>
            </label>
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Ability</span>
                <input type="text" id="ability-field" value="${pokemon.ability || ''}" 
                    style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white;" />
            </label>
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Held Item</span>
                <select id="held-item-field" style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white;">
                    <option value="">(none)</option>
                </select>
            </label>
            
            <label style="display: block; margin-bottom: 15px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Moves</span>
                <div id="moves-container" style="display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; min-height: 42px;">
                    <input type="text" id="moves-field" autocomplete="off"
                        style="flex: 1; min-width: 120px; padding: 4px; background: transparent; border: none; color: white; outline: none;" 
                        placeholder="Add move" />
                </div>
                <div id="move-suggestions" style="position: relative; background: #1e3a5f; border-radius: 4px; margin-top: 5px; max-height: 200px; overflow-y: auto; display: none;"></div>
            </label>
            
            <label style="display: block; margin-bottom: 20px;">
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Notes</span>
                <textarea id="notes-field" rows="3" 
                    style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white; resize: vertical;">${pokemon.notes || ''}</textarea>
            </label>
            
            <div style="display: flex; gap: 10px;">
                <button type="submit" style="padding: 10px 20px; background: #4a90e2; color: white; border: none; border-radius: 4px; cursor: pointer;">Save Changes</button>
                <button type="button" id="cancel-btn" style="padding: 10px 20px; background: #6a6a6a; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
            </div>
        </form>
    `;

    setupPokemonFormHandlers(pokemon);
}

// Helper function to create move tag element
function createMoveTag(moveName, container) {
    const tag = document.createElement('span');
    tag.className = 'move-tag';
    tag.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; background: #2d5a8a; color: white; padding: 4px 8px; border-radius: 4px; font-size: 13px;';

    const span = document.createElement('span');
    span.textContent = moveName;
    tag.appendChild(span);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '×';
    deleteBtn.style.cssText = 'background: none; border: none; color: white; cursor: pointer; padding: 0; font-size: 18px; line-height: 1; font-weight: bold;';
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
                `<div class="move-suggestion" data-move="${m}" style="padding: 8px; cursor: pointer; border-bottom: 1px solid #2d5a8a; color: #fff;">${m}</div>`
            ).join('');
            suggestions.style.display = 'block';

            // Add click handlers
            suggestions.querySelectorAll('.move-suggestion').forEach(div => {
                div.addEventListener('click', () => {
                    const moveName = div.dataset.move;
                    addMoveTag(moveName, moveInput, container);
                    suggestions.style.display = 'none';
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
                    `<div class="pokemon-suggestion" data-name="${m.name}" style="padding: 8px; cursor: pointer; border-bottom: 1px solid #2d5a8a; color: #fff;">${m.name}</div>`
                ).join('');
                suggestions.style.display = 'block';

                // Add click handlers
                suggestions.querySelectorAll('.pokemon-suggestion').forEach(div => {
                    div.addEventListener('click', () => {
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
            await fetch(`/api/admin/pokemon?season=${encodeURIComponent(currentSeason)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    old_name: document.getElementById('old-name').value,
                    old_usage: document.getElementById('old-usage').value,
                    pokemon: payload
                })
            });
        } else {
            await fetch(`/api/admin/pokemon?season=${encodeURIComponent(currentSeason)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
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
                `<div class="ability-suggestion" data-name="${a.name}" style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid #2d5a8a; color: #fff;">${a.name}</div>`
            ).join('');
            abilitySuggestions.style.display = 'block';

            abilitySuggestions.querySelectorAll('.ability-suggestion').forEach(div => {
                div.addEventListener('click', () => {
                    abilityInput.value = div.dataset.name;
                    abilitySuggestions.style.display = 'none';
                });
            });
        } else {
            abilitySuggestions.style.display = 'none';
        }
    });
}
