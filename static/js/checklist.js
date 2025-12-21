/**
 * Checklist functionality for Pokemon raid team building
 * Client-side only: all checkbox states stored in localStorage, not persisted to server
 */

let checklistData = {};
const STORAGE_KEY = 'pokemmoraids_checklist_state';

// Initialize checklist on page load
document.addEventListener('DOMContentLoaded', function () {
    loadChecklist();
});

/**
 * Fetch checklist data from the API and render it
 * Client-side storage of checkbox states via localStorage
 */
async function loadChecklist() {
    try {
        const response = await fetch('/api/checklist');
        if (!response.ok) {
            throw new Error('Failed to load checklist');
        }
        checklistData = await response.json();
        renderChecklist();
        // Restore checkbox states from localStorage
        restoreChecklistState();
    } catch (error) {
        console.error('Error loading checklist:', error);
        const container = document.getElementById('checklist-container');
        if (container) {
            container.innerHTML = '<p class="error">Failed to load checklist</p>';
        }
    }
}

/**
 * Restore checkbox states from localStorage
 */
function restoreChecklistState() {
    const state = localStorage.getItem(STORAGE_KEY);
    if (!state) return;

    try {
        const checkedIds = JSON.parse(state);
        checkedIds.forEach(pokemonId => {
            const checkbox = document.querySelector(`input[data-pokemon-id="${pokemonId}"]`);
            if (checkbox) {
                checkbox.checked = true;
                const row = document.getElementById(`pokemon-${pokemonId}`);
                if (row) row.classList.add('completed');
            }
        });
        updateCompletionCounts();
    } catch (err) {
        console.error('Error restoring checklist state:', err);
    }
}

/**
 * Save checkbox states to localStorage
 */
function saveChecklistState() {
    const checkedIds = Array.from(document.querySelectorAll('.pokemon-checkbox:checked'))
        .map(cb => parseInt(cb.dataset.pokemonId));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checkedIds));
}

/**
 * Render the checklist UI from loaded data
 */
function renderChecklist() {
    const container = document.getElementById('checklist-container');
    if (!container || !checklistData.types) {
        return;
    }

    container.innerHTML = '';

    checklistData.types.forEach((typeData, typeIndex) => {
        const typeSection = createTypeSection(typeData, typeIndex);
        container.appendChild(typeSection);
    });
}

/**
 * Create a collapsible section for a type
 */
function createTypeSection(typeData, typeIndex) {
    const section = document.createElement('div');
    section.className = 'type-section';
    section.id = `type-${typeData.id}`;

    // Calculate completion percentage
    const completionPercent = typeData.count > 0
        ? Math.round((typeData.completed / typeData.count) * 100)
        : 0;

    const isMinMet = typeData.completed >= typeData.min_required;
    const minStatus = typeData.min_required > 0
        ? `(${typeData.completed}/${typeData.min_required})`
        : '';

    // Header with collapse toggle
    const header = document.createElement('div');
    header.className = `type-header ${isMinMet ? 'min-met' : 'min-pending'}`;
    header.innerHTML = `
        <button class="collapse-btn" data-type-id="${typeData.id}">
            <span class="chevron">▼</span>
        </button>
        <div class="type-info">
            <h3 class="type-title">${typeData.type_name}</h3>
            <div class="type-meta">
                <span class="single-badge">${typeData.completed}/${typeData.count}</span>
                <small class="min-sub" title="${typeData.min_required > 0 ? `Min required: ${typeData.min_required}` : ''}">${typeData.min_required > 0 ? `(min ${typeData.min_required})` : ''}</small>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${completionPercent}%"></div>
                </div>
            </div>
        </div>
    `;
    section.appendChild(header);

    // Content (collapsible)
    const content = document.createElement('div');
    content.className = 'type-content';
    content.id = `content-${typeData.id}`;
    content.style.display = 'none';

    // Create table
    const table = document.createElement('table');
    table.className = 'checklist-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th class="check-col">✓</th>
                <th class="name-col">Pokemon</th>
                <th class="type-col">Type</th>
                <th class="secondary-col">Secondary</th>
                <th class="ability-col">Ability</th>
                <th class="item-col">Held Item</th>
                <th class="moves-col">Moves</th>
                <th class="notes-col">Notes</th>
            </tr>
        </thead>
        <tbody>
        </tbody>
    `;

    const tbody = table.querySelector('tbody');
    typeData.pokemons.forEach((pokemon) => {
        const row = createPokemonRow(pokemon);
        tbody.appendChild(row);
    });

    content.appendChild(table);
    section.appendChild(content);

    // Add collapse event listener
    const collapseBtn = header.querySelector('.collapse-btn');
    collapseBtn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleTypeContent(typeData.id);
    });

    return section;
}

/**
 * Create a table row for a pokemon
 */
function createPokemonRow(pokemon) {
    const row = document.createElement('tr');
    row.className = `pokemon-row ${pokemon.completed ? 'completed' : ''}`;
    row.id = `pokemon-${pokemon.id}`;

    // Checkbox
    const checkCell = document.createElement('td');
    checkCell.className = 'check-cell';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'pokemon-checkbox';
    checkbox.checked = pokemon.completed === 1;
    checkbox.dataset.pokemonId = pokemon.id;
    checkbox.addEventListener('change', function () {
        handlePokemonToggle(pokemon.id, this.checked);
    });
    checkCell.appendChild(checkbox);
    row.appendChild(checkCell);

    // Pokemon Name
    const nameCell = document.createElement('td');
    nameCell.className = 'name-cell';
    nameCell.textContent = pokemon.pokemon_name;
    row.appendChild(nameCell);

    // Type (Physical/Special)
    const typeCell = document.createElement('td');
    typeCell.className = 'type-cell';
    typeCell.textContent = pokemon.phys_special || '—';
    row.appendChild(typeCell);

    // Secondary Type
    const secondaryCell = document.createElement('td');
    secondaryCell.className = 'secondary-cell';
    secondaryCell.textContent = pokemon.secondary_type || '—';
    row.appendChild(secondaryCell);

    // Ability
    const abilityCell = document.createElement('td');
    abilityCell.className = 'ability-cell';
    abilityCell.textContent = pokemon.ability || '—';
    row.appendChild(abilityCell);

    // Held Item
    const itemCell = document.createElement('td');
    itemCell.className = 'item-cell';
    itemCell.textContent = pokemon.held_item || '—';
    row.appendChild(itemCell);

    // Moves
    const movesCell = document.createElement('td');
    movesCell.className = 'moves-cell';
    if (pokemon.moves) {
        const movesList = pokemon.moves.split(', ').map(m => m.trim()).filter(m => m);
        if (movesList.length > 0) {
            const ul = document.createElement('ul');
            movesList.forEach(move => {
                const li = document.createElement('li');
                li.textContent = move;
                ul.appendChild(li);
            });
            movesCell.appendChild(ul);
        } else {
            movesCell.textContent = '—';
        }
    } else {
        movesCell.textContent = '—';
    }
    row.appendChild(movesCell);

    // Notes
    const notesCell = document.createElement('td');
    notesCell.className = 'notes-cell';
    notesCell.textContent = pokemon.notes || '—';
    row.appendChild(notesCell);

    return row;
}

/**
 * Toggle the visibility of a type's content
 */
function toggleTypeContent(typeId) {
    const content = document.getElementById(`content-${typeId}`);
    const button = document.querySelector(`button[data-type-id="${typeId}"]`);
    const chevron = button.querySelector('.chevron');

    if (content.style.display === 'none') {
        content.style.display = 'table';
        button.parentElement.classList.add('expanded');
        chevron.textContent = '▲';
    } else {
        content.style.display = 'none';
        button.parentElement.classList.remove('expanded');
        chevron.textContent = '▼';
    }
}

/**
 * Handle pokemon checkbox toggle (client-side only, no server call)
 */
function handlePokemonToggle(pokemonId, isChecked) {
    // Update UI
    const row = document.getElementById(`pokemon-${pokemonId}`);
    if (row) {
        if (isChecked) {
            row.classList.add('completed');
        } else {
            row.classList.remove('completed');
        }
    }

    // Update completion counts
    updateCompletionCounts();

    // Save state to localStorage
    saveChecklistState();
}

/**
 * Update completion counts and visual indicators for all type sections
 */
function updateCompletionCounts() {
    if (!checklistData.types) return;

    checklistData.types.forEach(typeData => {
        const checkboxes = document.querySelectorAll(`#type-${typeData.id} .pokemon-checkbox`);
        const completedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

        const typeSection = document.getElementById(`type-${typeData.id}`);
        if (!typeSection) return;

        const header = typeSection.querySelector('.type-header');
        const singleBadge = header.querySelector('.single-badge');
        const progressFill = header.querySelector('.progress-fill');

        // Update single badge (always show completed/total)
        if (singleBadge) {
            singleBadge.textContent = `${completedCount}/${typeData.count}`;
        }
        // Update min-sub text and tooltip when min_required is present
        const minSub = header.querySelector('.min-sub');
        if (minSub) {
            if (typeData.min_required > 0) {
                minSub.textContent = `(min ${typeData.min_required})`;
                minSub.title = `Min required: ${typeData.min_required}`;
                minSub.style.display = 'inline-block';
            } else {
                minSub.textContent = '';
                minSub.title = '';
                minSub.style.display = 'none';
            }
        }

        // Update progress bar
        const completionPercent = typeData.count > 0
            ? Math.round((completedCount / typeData.count) * 100)
            : 0;
        if (progressFill) {
            
            progressFill.style.width = completionPercent + '%';
            // add threshold coloring for progress bar
            if (typeData.count <= typeData.min_required && completedCount < typeData.min_required) {
                progressFill.classList.add('progress-minimum');
                progressFill.classList.remove('progress-normal');
            } else {
                progressFill.classList.remove('progress-minimum');
                progressFill.classList.add('progress-normal');
            }
        }

        // Update header styling based on min requirement
        const isMinMet = completedCount >= typeData.min_required;
        if (isMinMet) {
            header.classList.remove('min-pending');
            header.classList.add('min-met');
        } else {
            header.classList.remove('min-met');
            header.classList.add('min-pending');
        }
    });
}
