// boss-edit.js - In-place editing with fuzzy search autocomplete

let editData = null; // { monsters: [...], items: [...] }
let fuseInstances = {}; // Cache for Fuse.js instances
let editMode = {}; // Track which variations are in edit mode
let originalTableData = {}; // Store original HTML for cancel

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadEditData();
    initializeEditButtons();
});

// Load monster and item data for autocomplete
async function loadEditData() {
    try {
        // Check if Fuse.js is loaded
        if (typeof Fuse === 'undefined') {
            console.error('Fuse.js is not loaded. Please ensure the CDN script is included in the HTML.');
            return;
        }

        const response = await fetch('/api/boss-edit-data');
        editData = await response.json();

        // Create Fuse instances for pokemon names
        const pokemonNames = editData.monsters.map(m => m.name);
        fuseInstances.pokemon = new Fuse(pokemonNames, {
            threshold: 0.3,
            includeScore: true
        });

        // Create Fuse instance for items
        fuseInstances.items = new Fuse(editData.items, {
            threshold: 0.3,
            includeScore: true
        });

        // Create Fuse instance for all moves (collect from all pokemon)
        const allMoves = new Set();
        editData.monsters.forEach(m => {
            if (m.moves && Array.isArray(m.moves)) {
                m.moves.forEach(move => {
                    const moveName = typeof move === 'string' ? move : (move.name || move);
                    if (moveName) allMoves.add(moveName);
                });
            }
        });
        fuseInstances.moves = new Fuse(Array.from(allMoves), {
            threshold: 0.3,
            includeScore: true
        });
    } catch (error) {
        console.error('Failed to load edit data:', error);
    }
}

// Initialize edit/save/cancel buttons
function initializeEditButtons() {
    document.querySelectorAll('.edit-variation-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const varIndex = btn.dataset.variationIndex;
            enterEditMode(varIndex);
        });
    });

    document.querySelectorAll('.save-variation-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const varIndex = btn.dataset.variationIndex;
            saveVariation(varIndex);
        });
    });

    document.querySelectorAll('.cancel-variation-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const varIndex = btn.dataset.variationIndex;
            cancelEditMode(varIndex);
        });
    });
}

// Enter edit mode for a variation
function enterEditMode(varIndex) {
    const varTable = document.querySelector(`.variation-table[data-variation-index="${varIndex}"]`);
    const tbody = varTable.querySelector('tbody');

    // Save original HTML
    originalTableData[varIndex] = tbody.innerHTML;

    // Toggle buttons
    toggleEditButtons(varIndex, true);

    // Convert each cell to editable
    const rows = tbody.querySelectorAll('tr');
    rows.forEach((row, turnIdx) => {
        const cells = row.querySelectorAll('td');

        // Skip turn number (index 0)
        // Players: indices 1-4
        for (let i = 1; i <= 4; i++) {
            const cell = cells[i];
            convertPlayerCellToEditable(cell, turnIdx, i - 1);
        }

        // Boss health (index 5) - make editable as number input
        const healthCell = cells[5];
        convertHealthCellToEditable(healthCell);

        // Side notes (index 6) - make editable as text input
        const notesCell = cells[6];
        convertNotesCellToEditable(notesCell);
    });

    editMode[varIndex] = true;
}

// Convert player cell to editable with autocomplete
function convertPlayerCellToEditable(cell, turnIdx, playerIdx) {
    const label = cell.querySelector('.player-action');
    if (!label) {
        // Empty cell with just "—"
        cell.innerHTML = `
            <div class="editable-player-cell" data-turn="${turnIdx}" data-player="${playerIdx}">
                <input type="text" class="pokemon-input" placeholder="Pokemon" data-field="pokemon">
                <input type="text" class="move-input" placeholder="Move" data-field="move">
                <input type="text" class="item-input" placeholder="Item (optional)" data-field="item">
            </div>
        `;
    } else {
        // Extract existing data
        const nameDiv = label.querySelector('.player-name');
        const moveDiv = label.querySelector('.player-move');
        const itemDiv = label.querySelector('.player-item');

        const pokemon = nameDiv ? nameDiv.textContent : '';
        const move = moveDiv ? moveDiv.textContent : '';
        const item = itemDiv ? itemDiv.textContent : '';

        cell.innerHTML = `
            <div class="editable-player-cell" data-turn="${turnIdx}" data-player="${playerIdx}">
                <input type="text" class="pokemon-input" placeholder="Pokemon" value="${escapeHtml(pokemon)}" data-field="pokemon">
                <input type="text" class="move-input" placeholder="Move" value="${escapeHtml(move)}" data-field="move">
                <input type="text" class="item-input" placeholder="Item (optional)" value="${escapeHtml(item)}" data-field="item">
            </div>
        `;
    }

    // Attach autocomplete to inputs
    const editableCell = cell.querySelector('.editable-player-cell');
    const pokemonInput = editableCell.querySelector('.pokemon-input');
    const moveInput = editableCell.querySelector('.move-input');
    const itemInput = editableCell.querySelector('.item-input');

    // Disable move input until pokemon is selected
    if (!pokemonInput.value.trim()) {
        moveInput.disabled = true;
        moveInput.placeholder = 'Select Pokemon first';
    }

    attachPokemonAutocomplete(pokemonInput, moveInput);
    attachMoveAutocomplete(moveInput, pokemonInput);
    attachItemAutocomplete(itemInput);
}

// Convert health cell to editable number input
function convertHealthCellToEditable(cell) {
    // Check if already has an input
    const existingInput = cell.querySelector('.health-input, input[type="number"]');
    if (existingInput) {
        // Already editable, just ensure it has the right class
        existingInput.classList.add('health-input');
        return;
    }

    const currentValue = cell.textContent.trim();
    cell.innerHTML = `<input type="number" step="0.1" class="health-input" value="${currentValue}">`;
}

// Convert notes cell to editable text input
function convertNotesCellToEditable(cell) {
    const input = cell.querySelector('.note-input');
    if (input) {
        // Already has input, just enable it
        input.removeAttribute('readonly');
        input.classList.add('editing');
    } else {
        // No input, create one
        cell.innerHTML = `<input type="text" class="note-input editing" placeholder="notes">`;
    }
}

// Attach pokemon autocomplete with Fuse.js
function attachPokemonAutocomplete(input, moveInput) {
    let autocompleteDiv = null;

    input.addEventListener('input', () => {
        const query = input.value.trim();
        if (query.length < 2) {
            removeAutocomplete();
            return;
        }

        const results = fuseInstances.pokemon.search(query).slice(0, 8);
        if (results.length === 0) {
            removeAutocomplete();
            return;
        }

        showAutocomplete(input, results.map(r => r.item), (selected) => {
            input.value = selected;
            removeAutocomplete();
            // Enable move input and populate move options when pokemon is selected
            moveInput.disabled = false;
            moveInput.placeholder = 'Move';
            populateMoveOptions(selected, moveInput);
        });
    });

    input.addEventListener('blur', () => {
        setTimeout(removeAutocomplete, 200);
    });

    function removeAutocomplete() {
        if (autocompleteDiv) {
            autocompleteDiv.remove();
            autocompleteDiv = null;
        }
    }

    function showAutocomplete(targetInput, items, onSelect) {
        removeAutocomplete();

        autocompleteDiv = document.createElement('div');
        autocompleteDiv.className = 'autocomplete-dropdown';
        autocompleteDiv.style.position = 'absolute';
        autocompleteDiv.style.zIndex = '9999';
        autocompleteDiv.style.background = 'white';
        autocompleteDiv.style.border = '1px solid #ccc';
        autocompleteDiv.style.borderRadius = '4px';
        autocompleteDiv.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
        autocompleteDiv.style.maxHeight = '200px';
        autocompleteDiv.style.overflowY = 'auto';
        autocompleteDiv.style.minWidth = targetInput.offsetWidth + 'px';

        items.forEach(item => {
            const div = document.createElement('div');
            div.textContent = item;
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.color = '#1a202c';
            div.style.fontSize = '14px';
            div.addEventListener('mouseenter', () => {
                div.style.background = '#e2e8f0';
            });
            div.addEventListener('mouseleave', () => {
                div.style.background = 'white';
            });
            div.addEventListener('mousedown', () => {
                onSelect(item);
            });
            autocompleteDiv.appendChild(div);
        });

        const rect = targetInput.getBoundingClientRect();
        autocompleteDiv.style.top = (rect.bottom + window.scrollY) + 'px';
        autocompleteDiv.style.left = (rect.left + window.scrollX) + 'px';
        document.body.appendChild(autocompleteDiv);
    }
}

// Attach item autocomplete
function attachItemAutocomplete(input) {
    let autocompleteDiv = null;

    input.addEventListener('input', () => {
        const query = input.value.trim();
        if (query.length < 2) {
            removeAutocomplete();
            return;
        }

        const results = fuseInstances.items.search(query).slice(0, 8);
        if (results.length === 0) {
            removeAutocomplete();
            return;
        }

        showAutocomplete(input, results.map(r => r.item), (selected) => {
            input.value = selected;
            removeAutocomplete();
        });
    });

    input.addEventListener('blur', () => {
        setTimeout(removeAutocomplete, 200);
    });

    function removeAutocomplete() {
        if (autocompleteDiv) {
            autocompleteDiv.remove();
            autocompleteDiv = null;
        }
    }

    function showAutocomplete(targetInput, items, onSelect) {
        removeAutocomplete();

        autocompleteDiv = document.createElement('div');
        autocompleteDiv.className = 'autocomplete-dropdown';
        autocompleteDiv.style.position = 'absolute';
        autocompleteDiv.style.zIndex = '9999';
        autocompleteDiv.style.background = 'white';
        autocompleteDiv.style.border = '1px solid #ccc';
        autocompleteDiv.style.borderRadius = '4px';
        autocompleteDiv.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
        autocompleteDiv.style.maxHeight = '200px';
        autocompleteDiv.style.overflowY = 'auto';
        autocompleteDiv.style.minWidth = targetInput.offsetWidth + 'px';

        items.forEach(item => {
            const div = document.createElement('div');
            div.textContent = item;
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.color = '#1a202c';
            div.style.fontSize = '14px';
            div.addEventListener('mouseenter', () => {
                div.style.background = '#e2e8f0';
            });
            div.addEventListener('mouseleave', () => {
                div.style.background = 'white';
            });
            div.addEventListener('mousedown', () => {
                onSelect(item);
            });
            autocompleteDiv.appendChild(div);
        });

        const rect = targetInput.getBoundingClientRect();
        autocompleteDiv.style.top = (rect.bottom + window.scrollY) + 'px';
        autocompleteDiv.style.left = (rect.left + window.scrollX) + 'px';
        document.body.appendChild(autocompleteDiv);
    }
}

// Attach move autocomplete (works with or without pokemon selected)
function attachMoveAutocomplete(moveInput, pokemonInput) {
    let autocompleteDiv = null;

    moveInput.addEventListener('input', () => {
        const query = moveInput.value.trim();
        if (query.length < 1) {
            removeAutocomplete();
            return;
        }

        // Check if a pokemon is selected to filter moves
        const selectedPokemon = pokemonInput.value.trim();
        let movesToSearch = [];

        if (selectedPokemon) {
            // Find the pokemon and use its specific moves
            const pokemon = editData.monsters.find(m => m.name.toLowerCase() === selectedPokemon.toLowerCase());
            if (pokemon && pokemon.moves) {
                // Extract move names from objects
                movesToSearch = pokemon.moves.map(m => typeof m === 'string' ? m : (m.name || m)).filter(Boolean);
            } else {
                // Fallback to all moves if pokemon not found
                movesToSearch = Array.from(fuseInstances.moves._docs);
            }
        } else {
            // No pokemon selected, search all moves
            movesToSearch = Array.from(fuseInstances.moves._docs);
        }

        // Create temporary Fuse instance for the current move set
        const tempFuse = new Fuse(movesToSearch, {
            threshold: 0.3,
            includeScore: true
        });

        const results = tempFuse.search(query).slice(0, 8);
        if (results.length === 0) {
            removeAutocomplete();
            return;
        }

        showAutocomplete(moveInput, results.map(r => r.item), (selected) => {
            moveInput.value = selected;
            removeAutocomplete();
        });
    });

    moveInput.addEventListener('blur', () => {
        setTimeout(removeAutocomplete, 200);
    });

    function removeAutocomplete() {
        if (autocompleteDiv) {
            autocompleteDiv.remove();
            autocompleteDiv = null;
        }
    }

    function showAutocomplete(targetInput, items, onSelect) {
        removeAutocomplete();

        autocompleteDiv = document.createElement('div');
        autocompleteDiv.className = 'autocomplete-dropdown';
        autocompleteDiv.style.position = 'absolute';
        autocompleteDiv.style.zIndex = '9999';
        autocompleteDiv.style.background = 'white';
        autocompleteDiv.style.border = '1px solid #ccc';
        autocompleteDiv.style.borderRadius = '4px';
        autocompleteDiv.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.3)';
        autocompleteDiv.style.maxHeight = '200px';
        autocompleteDiv.style.overflowY = 'auto';
        autocompleteDiv.style.minWidth = targetInput.offsetWidth + 'px';

        items.forEach(item => {
            const div = document.createElement('div');
            div.textContent = item;
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.color = '#1a202c';
            div.style.fontSize = '14px';
            div.addEventListener('mouseenter', () => {
                div.style.background = '#e2e8f0';
            });
            div.addEventListener('mouseleave', () => {
                div.style.background = 'white';
            });
            div.addEventListener('mousedown', () => {
                onSelect(item);
            });
            autocompleteDiv.appendChild(div);
        });

        const rect = targetInput.getBoundingClientRect();
        autocompleteDiv.style.top = (rect.bottom + window.scrollY) + 'px';
        autocompleteDiv.style.left = (rect.left + window.scrollX) + 'px';
        document.body.appendChild(autocompleteDiv);
    }
}

// Populate move options based on selected pokemon
function populateMoveOptions(pokemonName, moveInput) {
    const pokemon = editData.monsters.find(m => m.name.toLowerCase() === pokemonName.toLowerCase());
    if (!pokemon) {
        return;
    }

    // Extract ability names from objects (they might be {id, name} objects)
    let abilityNames = [];
    if (pokemon.abilities) {
        if (Array.isArray(pokemon.abilities)) {
            abilityNames = pokemon.abilities.map(a => {
                return typeof a === 'string' ? a : (a.name || a);
            });
        }
    }

    // Add abilities display right after the move input
    const editableCell = moveInput.parentElement;
    let abilitiesDiv = editableCell.querySelector('.abilities-display');
    if (!abilitiesDiv) {
        abilitiesDiv = document.createElement('div');
        abilitiesDiv.className = 'abilities-display';
        abilitiesDiv.style.fontSize = '12px';
        abilitiesDiv.style.color = 'rgba(255, 255, 255, 0.6)';
        abilitiesDiv.style.marginTop = '4px';
        abilitiesDiv.style.padding = '4px';
        abilitiesDiv.style.background = 'rgba(110, 231, 183, 0.1)';
        abilitiesDiv.style.borderRadius = '3px';
        editableCell.appendChild(abilitiesDiv);
    }
    abilitiesDiv.textContent = `Abilities: ${abilityNames.length > 0 ? abilityNames.join(', ') : 'N/A'}`;

    // The move autocomplete is already attached and will automatically use the pokemon's moves
    // since attachMoveAutocomplete checks the pokemon input value
}

// Save variation changes
async function saveVariation(varIndex) {
    const varTable = document.querySelector(`.variation-table[data-variation-index="${varIndex}"]`);
    const tbody = varTable.querySelector('tbody');
    const rows = tbody.querySelectorAll('tr');

    // Extract data from editable cells
    const players = { P1: [], P2: [], P3: [], P4: [] };
    const healthRemaining = [];
    const notes = [];

    rows.forEach((row, turnIdx) => {
        const cells = row.querySelectorAll('td');

        // Extract player data (cells 1-4)
        for (let i = 1; i <= 4; i++) {
            const cell = cells[i];
            const editableCell = cell.querySelector('.editable-player-cell');
            if (editableCell) {
                const pokemon = editableCell.querySelector('.pokemon-input').value.trim();
                const move = editableCell.querySelector('.move-input').value.trim();
                const item = editableCell.querySelector('.item-input').value.trim();

                const playerKey = `P${i}`;
                players[playerKey].push({
                    pokemon: pokemon,
                    move: move,
                    item: item
                });
            }
        }

        // Extract health (cell 5)
        const healthInput = cells[5].querySelector('.health-input');
        const health = healthInput ? parseFloat(healthInput.value) : 0;
        healthRemaining.push(health);

        // Extract notes (cell 6)
        const noteInput = cells[6].querySelector('.note-input');
        const note = noteInput ? noteInput.value.trim() : '';
        notes.push(note);
    });

    // Get boss name from page data
    const bossData = JSON.parse(document.getElementById('boss-data').textContent);

    // Boss name property is lowercase in JSON (from Go serialization)
    const bossName = bossData.name || bossData.Name;
    if (!bossName) {
        console.error('❌ Boss name not found in boss data:', bossData);
        alert('Error: Could not determine boss name. Please refresh and try again.');
        return;
    }

    // Remove the star symbol from boss name if present (e.g., "Raichu 3★" -> "Raichu 3")
    const cleanBossName = bossName.replace(/\s*★\s*$/, '').trim();

    // Send to server
    try {
        const payload = {
            boss_name: cleanBossName,
            players: players,
            health_remaining: healthRemaining,
            notes: notes
        };

        const response = await fetch('/api/boss/save-variation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();

        if (!response.ok) {
            throw new Error(`Server error: ${response.status} - ${responseText}`);
        }

        // Reload page to show updated data
        window.location.reload();
    } catch (error) {
        console.error('❌ Save failed:', error);
        alert(`Failed to save changes: ${error.message}`);
    }
}

// Cancel edit mode and restore original HTML
function cancelEditMode(varIndex) {
    const varTable = document.querySelector(`.variation-table[data-variation-index="${varIndex}"]`);
    const tbody = varTable.querySelector('tbody');

    // Restore original HTML
    tbody.innerHTML = originalTableData[varIndex];

    // Toggle buttons
    toggleEditButtons(varIndex, false);

    editMode[varIndex] = false;
}

// Toggle edit/save/cancel buttons
function toggleEditButtons(varIndex, isEditing) {
    // Find the specific variation table and its associated header
    const varTable = document.querySelector(`.variation-table[data-variation-index="${varIndex}"]`);
    if (!varTable) return;

    // Find the header that's a sibling or parent of this variation table
    const header = varTable.previousElementSibling;
    if (!header || !header.classList.contains('variation-header')) return;

    const editBtn = header.querySelector(`.edit-variation-btn[data-variation-index="${varIndex}"]`);
    const saveBtn = header.querySelector(`.save-variation-btn[data-variation-index="${varIndex}"]`);
    const cancelBtn = header.querySelector(`.cancel-variation-btn[data-variation-index="${varIndex}"]`);

    if (!editBtn || !saveBtn || !cancelBtn) return;

    if (isEditing) {
        editBtn.style.display = 'none';
        saveBtn.style.display = 'inline-block';
        cancelBtn.style.display = 'inline-block';
    } else {
        editBtn.style.display = 'inline-block';
        saveBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
