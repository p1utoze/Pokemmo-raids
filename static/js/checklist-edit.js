/**
 * Checklist in-place editor with autocomplete for pokemon, moves, and items
 * Allows admin, mod, and author roles to edit checklist data
 */

let checklistEditData = null;
let typeEditModes = {}; // Track edit mode per type
let fuseInstances = {}; // Autocomplete search instances

// Initialize checklist editor on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Check if user has edit permissions (admin, mod, or author)
    const userRole = document.body.dataset.userRole;
    const canEdit = ['admin', 'mod', 'author'].includes(userRole);
    if (!canEdit) return;

    // Load edit data (pokemon, moves, items) for autocomplete
    await loadChecklistEditData();
    
    // Add edit buttons to checklist
    if (checklistEditData) {
        addChecklistEditButtons();
    }
});

/**
 * Load pokemon, moves, and items data for autocomplete
 */
async function loadChecklistEditData() {
    try {
        // Check if Fuse.js is loaded
        if (typeof Fuse === 'undefined') {
            console.error('[ChecklistEdit] Fuse.js is not loaded');
            return;
        }

        const response = await fetch('/api/boss-edit-data');
        if (!response.ok) {
            console.error('[ChecklistEdit] Failed to fetch edit data:', response.status);
            return;
        }
        
        checklistEditData = await response.json();
        console.log('[ChecklistEdit] Loaded edit data:', {
            monsters: checklistEditData.monsters?.length,
            items: checklistEditData.items?.length
        });

        // Create Fuse instances for autocomplete
        const pokemonNames = checklistEditData.monsters.map(m => m.name);
        fuseInstances.pokemon = new Fuse(pokemonNames, {
            threshold: 0.3,
            includeScore: true
        });

        fuseInstances.items = new Fuse(checklistEditData.items, {
            threshold: 0.3,
            includeScore: true
        });

        // Collect all moves from all pokemon
        const allMoves = new Set();
        checklistEditData.monsters.forEach(m => {
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
        
        console.log('[ChecklistEdit] Autocomplete ready');
    } catch (error) {
        console.error('[ChecklistEdit] Error loading edit data:', error);
    }
}

/**
 * Add edit buttons to each type header
 */
function addChecklistEditButtons() {
    const typeSections = document.querySelectorAll('.type-section');

    typeSections.forEach(section => {
        const typeId = section.id;
        const header = section.querySelector('.type-header');
        if (!header) return;

        const typeInfo = header.querySelector('.type-info');
        if (!typeInfo) return;

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit-type';
        editBtn.id = `edit-btn-${typeId}`;
        editBtn.textContent = '✏️';
        editBtn.title = 'Edit this type';

        editBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (typeEditModes[typeId]) {
                exitTypeEditMode(typeId);
            } else {
                enterTypeEditMode(typeId);
            }
        });

        typeInfo.appendChild(editBtn);
    });
}

/**
 * Enter edit mode for a specific type
 */
function enterTypeEditMode(typeId) {
    typeEditModes[typeId] = true;

    const typeSection = document.getElementById(typeId);
    if (!typeSection) return;

    const table = typeSection.querySelector('.checklist-table');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    const rows = tbody.querySelectorAll('tr');

    rows.forEach((row, rowIdx) => {
        makeRowEditable(row, typeId, rowIdx);
    });

    // Create button container for save and cancel
    const header = typeSection.querySelector('.type-header');
    const typeInfo = header.querySelector('.type-info');
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'edit-button-container';
    buttonContainer.id = `btn-container-${typeId}`;

    // Get the old edit button and remove it
    const oldEditBtn = document.getElementById(`edit-btn-${typeId}`);
    if (oldEditBtn) {
        oldEditBtn.remove();
    }

    // Create new save button (cloned to remove all event listeners)
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-edit-type save-mode';
    saveBtn.id = `edit-btn-${typeId}`;
    saveBtn.textContent = '💾';
    saveBtn.title = 'Save changes';

    // Add ONLY the save handler
    saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // console.log('Save button clicked for type:', typeId);
        saveTypeChanges(typeId);
    });

    buttonContainer.appendChild(saveBtn);

    // Add cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-cancel-type';
    cancelBtn.id = `cancel-btn-${typeId}`;
    cancelBtn.textContent = '✖';
    cancelBtn.title = 'Cancel editing';
    cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exitTypeEditMode(typeId);
    });
    buttonContainer.appendChild(cancelBtn);

    typeInfo.appendChild(buttonContainer);
}

/**
 * Make a single row editable
 */
function makeRowEditable(row, typeId, rowIdx) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 8) return;

    // Skip checkbox cell (0)
    // Pokemon name (1)
    const nameCell = cells[1];
    const originalName = nameCell.textContent;
    nameCell.innerHTML = `<input type="text" class="editable-pokemon-name" value="${escapeHtml(originalName)}" placeholder="Pokemon">`;
    const nameInput = nameCell.querySelector('input');

    // Type (2) - skip, display only
    // Secondary type (3) - skip, display only
    // Ability (4) - skip, display only

    // Held Item (5)
    const itemCell = cells[5];
    const originalItem = itemCell.textContent === '—' ? '' : itemCell.textContent;
    itemCell.innerHTML = `<input type="text" class="editable-held-item" value="${escapeHtml(originalItem)}" placeholder="Item">`;
    const itemInput = itemCell.querySelector('input');
    if (typeof attachItemAutocomplete === 'function') {
        attachItemAutocomplete(itemInput);
    }

    // Moves (6) - Multi-select
    const movesCell = cells[6];
    const originalMoves = [];
    movesCell.querySelectorAll('li').forEach(li => {
        originalMoves.push(li.textContent.trim());
    });
    movesCell.innerHTML = '';
    const movesContainer = document.createElement('div');
    movesContainer.className = 'moves-container';

    // Add selected moves as tags
    originalMoves.forEach((move, idx) => {
        if (idx < 4) {
            const tag = createMoveTag(move, movesContainer, nameInput);
            movesContainer.appendChild(tag);
        }
    });

    // Add move input if less than 4 moves
    if (originalMoves.length < 4) {
        const moveInput = document.createElement('input');
        moveInput.type = 'text';
        moveInput.className = 'editable-move-input';

        // Check if pokemon name is valid
        const isPokemonValid = () => {
            const pokemonName = nameInput.value.trim();
            if (!pokemonName) return false;

            // Check if pokemon exists in monster data
            if (checklistEditData && checklistEditData.monsters) {
                return checklistEditData.monsters.some(m =>
                    m.name.toLowerCase() === pokemonName.toLowerCase()
                );
            }
            return false;
        };

        const isValid = isPokemonValid();
        moveInput.disabled = !isValid;
        moveInput.placeholder = isValid ? 'Add move' : 'Select valid Pokemon first';
        movesContainer.appendChild(moveInput);

        // Attach move autocomplete
        if (typeof attachMoveAutocomplete === 'function') {
            attachMoveAutocomplete(moveInput, nameInput);
        }

        // Handle move selection
        moveInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const moveValue = moveInput.value.trim();
                if (moveValue && originalMoves.length < 4) {
                    originalMoves.push(moveValue);
                    const newTag = createMoveTag(moveValue, movesContainer, nameInput);
                    movesContainer.insertBefore(newTag, moveInput);
                    moveInput.value = '';
                    if (originalMoves.length >= 4) {
                        moveInput.style.display = 'none';
                    }
                }
            }
        });

        // Enable/disable move input based on pokemon selection
        nameInput.addEventListener('change', () => {
            const isValid = isPokemonValid();
            moveInput.disabled = !isValid;
            moveInput.placeholder = isValid ? 'Add move' : 'Select valid Pokemon first';
        });
    }

    movesCell.appendChild(movesContainer);
    movesCell.dataset.movesData = JSON.stringify(originalMoves);

    // Notes (7)
    const notesCell = cells[7];
    const originalNotes = notesCell.textContent === '—' ? '' : notesCell.textContent;
    notesCell.innerHTML = `<input type="text" class="editable-notes" value="${escapeHtml(originalNotes)}" placeholder="Notes">`;

    // Attach Pokemon autocomplete AFTER all inputs are created
    attachChecklistPokemonAutocomplete(nameInput);
}

/**
 * Create a move tag with delete button
 */
function createMoveTag(move, container, nameInput) {
    const tag = document.createElement('div');
    tag.className = 'move-tag';

    const span = document.createElement('span');
    span.textContent = move;
    tag.appendChild(span);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Remove move';

    deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        tag.remove();

        // Get the move input if it exists
        const moveInput = container.querySelector('.editable-move-input');
        if (moveInput && moveInput.style.display === 'none') {
            moveInput.style.display = 'block';

            // Check if pokemon name is valid before enabling
            const pokemonName = nameInput.value.trim();
            const isPokemonValid = pokemonName && checklistEditData &&
                checklistEditData.monsters &&
                checklistEditData.monsters.some(m =>
                    m.name.toLowerCase() === pokemonName.toLowerCase()
                );
            moveInput.disabled = !isPokemonValid;
        }
    });

    tag.appendChild(deleteBtn);
    return tag;
}

/**
 * Exit edit mode and restore original view for a specific type
 */
function exitTypeEditMode(typeId) {
    typeEditModes[typeId] = false;

    const typeSection = document.getElementById(typeId);
    if (!typeSection) return;

    // Find the type data
    const typeData = checklistData.types.find(t => `type-${t.id}` === typeId);
    if (!typeData) return;

    // Rebuild the table
    const content = typeSection.querySelector('.type-content');
    const table = content.querySelector('.checklist-table');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';

    typeData.pokemons.forEach((pokemon) => {
        const row = createPokemonRow(pokemon);
        tbody.appendChild(row);
    });

    // Restore checkbox states
    if (typeof restoreChecklistState === 'function') {
        restoreChecklistState();
    }

    // Remove button container and restore original edit button
    const buttonContainer = document.getElementById(`btn-container-${typeId}`);
    if (buttonContainer) {
        buttonContainer.remove();
    }

    // Re-add the original edit button
    const header = typeSection.querySelector('.type-header');
    const typeInfo = header.querySelector('.type-info');
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit-type';
    editBtn.id = `edit-btn-${typeId}`;
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit this type';
    editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterTypeEditMode(typeId);
    });
    typeInfo.appendChild(editBtn);
}

/**
 * Save changes for a specific type to server
 */
async function saveTypeChanges(typeId) {
    if (!typeEditModes[typeId]) return;

    const typeSection = document.getElementById(typeId);
    if (!typeSection) return;

    // Extract numeric type ID from typeId (format: "type-{id}")
    const numericTypeId = parseInt(typeId.replace('type-', ''));
    if (isNaN(numericTypeId)) {
        console.error('Invalid typeId format:', typeId);
        alert('Error: Invalid type ID');
        return;
    }

    const table = typeSection.querySelector('.checklist-table');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    const rows = tbody.querySelectorAll('tr');
    const updateData = [];

    // Extract data from editable inputs BEFORE any DOM manipulation
    rows.forEach((row, index) => {
        const cells = row.querySelectorAll('td');
        // console.log(`Row ${index}: Found ${cells.length} cells`);

        // Extract pokemon ID from row (format: "pokemon-{id}")
        const pokemonId = parseInt(row.id.replace('pokemon-', ''));
        if (isNaN(pokemonId)) {
            // console.log(`Row ${index}: Invalid pokemon ID in row.id='${row.id}', skipping`);
            return;
        }

        const pokemonNameInput = cells[1]?.querySelector('.editable-pokemon-name');
        const heldItemInput = cells[5]?.querySelector('.editable-held-item');
        const movesContainer = cells[6]?.querySelector('.moves-container');
        const notesInput = cells[7]?.querySelector('.editable-notes');

        // console.log(`Row ${index} inputs:`, {
        //     pokemonId: pokemonId,
        //     pokemonNameInput: pokemonNameInput?.value,
        //     heldItemInput: heldItemInput?.value,
        //     movesContainer: !!movesContainer,
        //     notesInput: notesInput?.value
        // });

        if (!pokemonNameInput) {
            // console.log(`Row ${index}: No pokemon name input found, skipping`);
            return;
        }

        if (!heldItemInput) {
            // console.log(`Row ${index}: No held item input found, skipping`);
            return;
        }

        if (!notesInput) {
            // console.log(`Row ${index}: No notes input found, skipping`);
            return;
        }

        // Extract moves from tags
        const moves = [];
        if (movesContainer) {
            movesContainer.querySelectorAll('.move-tag span').forEach(span => {
                moves.push(span.textContent.trim());
            });
        }

        const rowData = {
            id: pokemonId,
            pokemon_name: pokemonNameInput.value.trim(),
            held_item: heldItemInput.value.trim(),
            moves: moves.join(', '),
            notes: notesInput.value.trim()
        };

        // console.log(`Row ${index} extracted data:`, rowData);
        updateData.push(rowData);
    });

    // Send to server
    // console.log('Saving checklist data:', updateData);

    if (updateData.length === 0) {
        console.warn('⚠️ No pokemon data extracted for saving!');
        alert('No changes to save. Make sure you have edit fields filled in.');
        return;
    }

    try {
        const payload = { pokemon: updateData };
        // console.log('Full payload to send:', JSON.stringify(payload, null, 2));

        const response = await fetch('/api/checklist/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',  // Include cookies for authentication
            body: JSON.stringify(payload)
        });

        // console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server error response:', errorText);
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        // console.log('Save successful:', result);

        // Exit edit mode FIRST (before reloading)
        typeEditModes[typeId] = false;

        // Remove button container and restore original edit button
        const buttonContainer = document.getElementById(`btn-container-${typeId}`);
        if (buttonContainer) {
            buttonContainer.remove();
        }

        // Reload checklist data to get fresh data from server
        if (typeof loadChecklist === 'function') {
            await loadChecklist();
        }

        // Re-add edit buttons since loadChecklist rebuilds the DOM
        addChecklistEditButtons();

        // After reload, expand the type section to show updated data
        const updatedTypeSection = document.getElementById(typeId);
        if (updatedTypeSection) {
            const content = updatedTypeSection.querySelector('.type-content');
            const header = updatedTypeSection.querySelector('.type-header');
            const collapseBtn = header ? header.querySelector('.collapse-btn') : null;
            const chevron = collapseBtn ? collapseBtn.querySelector('.chevron') : null;

            if (content) {
                content.style.display = 'block';
            }
            if (header) {
                header.classList.add('expanded');
            }
            if (chevron) {
                chevron.textContent = '▲';
            }
        }

        // Show success message to user
        const tempMsg = document.createElement('div');
        tempMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 12px 16px; border-radius: 4px; z-index: 10000; font-weight: bold;';
        tempMsg.textContent = '✓ Changes saved successfully';
        document.body.appendChild(tempMsg);
        setTimeout(() => tempMsg.remove(), 3000);
    } catch (error) {
        console.error('Failed to save checklist:', error);
        alert(`Failed to save changes: ${error.message}`);
    }
}

/**
 * Escape HTML for safe display
 * (Function defined in boss-edit.js which loads first - this is redundant)
 */
// Removed duplicate escapeHtml function

/**
 * Attach Pokemon autocomplete specifically for checklist
 * (Reuses Fuse instance from boss-edit.js if available)
 */
function attachChecklistPokemonAutocomplete(input) {
    let autocompleteDiv = null;

    input.addEventListener('input', () => {
        const query = input.value.trim();
        if (query.length < 2) {
            removeAutocomplete();
            return;
        }

        // Use Fuse instance from boss-edit.js
        if (!fuseInstances || !fuseInstances.pokemon) {
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
            // Trigger change event to enable move inputs
            input.dispatchEvent(new Event('change'));
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