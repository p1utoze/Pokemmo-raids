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
    // Update chip label with formatted season name
    const chip = document.getElementById('selected-season-label');
    if (chip) {
        const displayName = season.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        chip.textContent = `Season: ${displayName}`;
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
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Moves (comma separated)</span>
                <input type="text" id="moves-field" 
                    style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white;" 
                    placeholder="e.g., Flamethrower, Fire Blast, Overheat" />
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
                <span style="display: block; margin-bottom: 5px; color: #a8c5e3;">Moves (comma separated)</span>
                <input type="text" id="moves-field" value="${pokemon.moves || ''}" 
                    style="width: 100%; padding: 8px; background: #0d1f2d; border: 1px solid #2d5a8a; border-radius: 4px; color: white;" />
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

function setupPokemonFormHandlers(editingPokemon) {
    const isEditing = editingPokemon !== null;
    const form = document.getElementById(isEditing ? 'edit-pokemon-form' : 'add-pokemon-form');

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
        const moves = document.getElementById('moves-field').value;
        const notes = document.getElementById('notes-field').value;

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
