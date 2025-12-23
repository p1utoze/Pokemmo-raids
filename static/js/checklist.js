/**
 * Checklist functionality for Pokemon raid team building
 * Checkbox states stored in localStorage only (client-side) for ALL users
 * This is for personal tracking and does not persist to server
 */

let checklistData = {};
const STORAGE_KEY = 'pokemmoraids_checklist_state';

// Initialize checklist on page load
document.addEventListener('DOMContentLoaded', function () {
    loadChecklist();
});

/**
 * Fetch checklist data from the API and render it
 * Checkbox states stored in localStorage for ALL users (client-side only)
 */
async function loadChecklist() {
    try {
        const response = await fetch('/api/checklist');
        if (!response.ok) {
            throw new Error('Failed to load checklist');
        }
        checklistData = await response.json();
        renderChecklist();

        // Restore checkbox states from localStorage for all users
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
        const checkedPokemon = JSON.parse(state);
        checkedPokemon.forEach(key => {
            const checkbox = document.querySelector(`input[data-pokemon-key="${key}"]`);
            if (checkbox) {
                checkbox.checked = true;
                const row = checkbox.closest('tr');
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
    const checkedKeys = Array.from(document.querySelectorAll('.pokemon-checkbox:checked'))
        .map(cb => cb.dataset.pokemonKey);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checkedKeys));
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
    section.id = `type-${typeData.type_name}`;

    // Calculate completion percentage
    const completionPercent = typeData.count > 0
        ? Math.round((typeData.completed / typeData.count) * 100)
        : 0;

    const isMinMet = typeData.completed >= typeData.min_required;

    // Calculate threshold percentage and segment widths
    const minThresholdPercent = typeData.count > 0 && typeData.min_required > 0
        ? Math.round((typeData.min_required / typeData.count) * 100)
        : 0;

    // Green segment: fills from 0 to min threshold (capped at current completion)
    const greenWidth = Math.min(completionPercent, minThresholdPercent);
    // Post segment: shows progress beyond threshold (if any)
    const postWidth = completionPercent > minThresholdPercent ? (completionPercent - minThresholdPercent) : 0;

    // Header with collapse toggle
    const header = document.createElement('div');
    header.className = `type-header ${isMinMet ? 'min-met' : 'min-pending'}`;
    header.innerHTML = `
        <button class="collapse-btn" data-type-name="${typeData.type_name}">
            <span class="chevron">▼</span>
        </button>
        <div class="type-info">
            <h3 class="type-title">${typeData.type_name}</h3>
            <div class="type-meta">
                <span class="single-badge">${typeData.completed}/${typeData.count}</span>
                <small class="min-sub" title="${typeData.min_required > 0 ? `Min required: ${typeData.min_required}` : ''}">${typeData.min_required > 0 ? `(min ${typeData.min_required})` : ''}</small>
                <div class="progress-bar">
                    <div class="progress-stack">
                        <div class="progress-min" style="width: ${greenWidth}%"></div>
                        <div class="progress-post" style="width: ${postWidth}%"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    section.appendChild(header);

    // Content (collapsible)
    const content = document.createElement('div');
    content.className = 'type-content';
    content.id = `content-${typeData.type_name}`;
    content.style.display = 'none';

    // Create table
    const table = document.createElement('table');
    table.className = 'checklist-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th class="check-col">✓</th>
                <th class="name-col">Pokemon</th>
                <th class="usage-col">Usage</th>
                <th class="types-col">Types</th>
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
        const row = createPokemonRow(pokemon, typeData.type_name);
        tbody.appendChild(row);
    });

    content.appendChild(table);
    section.appendChild(content);

    // Add collapse event listener
    const collapseBtn = header.querySelector('.collapse-btn');
    collapseBtn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleTypeContent(typeData.type_name);
    });

    return section;
}

/**
 * Create a table row for a pokemon
 */
function createPokemonRow(pokemon, currentType) {
    const row = document.createElement('tr');
    const pokemonKey = `${pokemon.name}-${pokemon.usage}`;
    row.className = `pokemon-row ${pokemon.completed ? 'completed' : ''}`;
    row.id = `pokemon-${pokemonKey.replace(/\s+/g, '-')}`;

    // Checkbox
    const checkCell = document.createElement('td');
    checkCell.className = 'check-cell';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'pokemon-checkbox';
    checkbox.checked = pokemon.completed === true;
    checkbox.dataset.pokemonKey = pokemonKey;
    checkbox.dataset.pokemonName = pokemon.name;
    checkbox.dataset.pokemonUsage = pokemon.usage;
    checkbox.addEventListener('change', function () {
        handlePokemonToggle(pokemon.name, pokemon.usage, this.checked);
    });
    checkCell.appendChild(checkbox);
    row.appendChild(checkCell);

    // Pokemon Name
    const nameCell = document.createElement('td');
    nameCell.className = 'name-cell';
    nameCell.textContent = pokemon.name || '—';
    row.appendChild(nameCell);

    // Usage (Physical/Special/Support)
    const usageCell = document.createElement('td');
    usageCell.className = 'usage-cell';
    usageCell.textContent = pokemon.usage || '—';
    row.appendChild(usageCell);

    // Types (all types this Pokemon can fill)
    const typesCell = document.createElement('td');
    typesCell.className = 'types-cell';
    if (pokemon.types && pokemon.types.length > 0) {
        typesCell.textContent = pokemon.types.join(', ');
    } else {
        typesCell.textContent = '—';
    }
    row.appendChild(typesCell);

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
        const movesList = pokemon.moves.split(',').map(m => m.trim()).filter(m => m);
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
 * Toggle visibility of type content section
 */
function toggleTypeContent(typeName) {
    const content = document.getElementById(`content-${typeName}`);
    const button = document.querySelector(`button[data-type-name="${typeName}"]`);
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
 * Handle pokemon checkbox toggle
 * Client-side only (localStorage) for ALL users
 */
function handlePokemonToggle(pokemonName, pokemonUsage, isChecked) {
    const pokemonKey = `${pokemonName}-${pokemonUsage}`;

    // Update UI immediately for ALL occurrences of this Pokemon
    const checkboxes = document.querySelectorAll(`input[data-pokemon-name="${pokemonName}"][data-pokemon-usage="${pokemonUsage}"]`);
    checkboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
        const row = checkbox.closest('tr');
        if (row) {
            if (isChecked) {
                row.classList.add('completed');
            } else {
                row.classList.remove('completed');
            }
        }
    });

    // Update completion counts for all affected type sections
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
        const checkboxes = document.querySelectorAll(`#type-${typeData.type_name} .pokemon-checkbox`);
        const completedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

        const typeSection = document.getElementById(`type-${typeData.type_name}`);
        if (!typeSection) return;

        const header = typeSection.querySelector('.type-header');
        const singleBadge = header.querySelector('.single-badge');
        const progressMin = header.querySelector('.progress-min');
        const progressPost = header.querySelector('.progress-post');

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

        // Update stacked progress bar segments
        const completionPercent = typeData.count > 0
            ? Math.round((completedCount / typeData.count) * 100)
            : 0;

        const minThresholdPercent = typeData.count > 0 && typeData.min_required > 0
            ? Math.round((typeData.min_required / typeData.count) * 100)
            : 0;

        // Green segment: fills from 0 to min threshold (capped at current completion)
        const greenWidth = Math.min(completionPercent, minThresholdPercent);
        // Post segment: shows progress beyond threshold (if any)
        const postWidth = completionPercent > minThresholdPercent ? (completionPercent - minThresholdPercent) : 0;

        if (progressMin) {
            progressMin.style.width = greenWidth + '%';
        }
        if (progressPost) {
            progressPost.style.width = postWidth + '%';
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
