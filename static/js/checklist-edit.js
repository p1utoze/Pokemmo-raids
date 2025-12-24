/**
 * Checklist in-place editor with autocomplete for pokemon, moves, and items
 * Allows admin, mod, and author roles to edit checklist data
 */

// Global state - initialize only if not already set
window.checklistEditData = window.checklistEditData || null;
window.typeEditModes = window.typeEditModes || {};
window.fuseInstances = window.fuseInstances || {};

// Initialize checklist editor on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Check if user has edit permissions (admin, mod, or author)
    const userRole = document.body.dataset.userRole;
    const canEdit = ['admin', 'mod', 'author'].includes(userRole);

    if (!canEdit) {
        return;
    }

    // Load edit data (pokemon, moves, items) for autocomplete
    const loaded = await window.loadChecklistEditData();

    // Add edit buttons to checklist
    if (loaded && window.checklistEditData) {
        window.addChecklistEditButtons();
    } else {
        console.error('[ChecklistEdit] Failed to load edit data or add buttons');
    }
});

/**
 * Load pokemon, moves, and items data for autocomplete
 */
window.loadChecklistEditData = async function () {
    try {
        // Check if Fuse.js is loaded
        if (typeof Fuse === 'undefined') {
            console.error('[ChecklistEdit] Fuse.js is not loaded');
            return false;
        }

        const response = await fetch('/api/boss-edit-data');
        if (!response.ok) {
            console.error('[ChecklistEdit] Failed to fetch edit data:', response.status);
            return false;
        }

        window.checklistEditData = await response.json();

        // Create Fuse instances for autocomplete
        const pokemonNames = window.checklistEditData.monsters.map(m => m.name);
        window.fuseInstances.pokemon = new Fuse(pokemonNames, {
            threshold: 0.3,
            includeScore: true
        });

        window.fuseInstances.items = new Fuse(window.checklistEditData.items, {
            threshold: 0.3,
            includeScore: true
        });

        // Collect all moves from all pokemon
        const allMoves = new Set();
        window.checklistEditData.monsters.forEach(m => {
            if (m.moves && Array.isArray(m.moves)) {
                m.moves.forEach(move => {
                    const moveName = typeof move === 'string' ? move : (move.name || move);
                    if (moveName) allMoves.add(moveName);
                });
            }
        });
        window.allMovesArray = Array.from(allMoves);
        window.fuseInstances.moves = new Fuse(window.allMovesArray, {
            threshold: 0.3,
            includeScore: true
        });

        return true;
    } catch (error) {
        console.error('[ChecklistEdit] Error loading edit data:', error);
        return false;
    }
};

/**
 * Add edit buttons to each type header
 */
window.addChecklistEditButtons = function () {
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

            // Check if section is collapsed and expand it if needed
            const content = section.querySelector('.type-content');
            if (content && content.style.display === 'none') {
                const typeName = typeId.replace('type-', '');
                toggleTypeContent(typeName);
            }

            if (window.typeEditModes[typeId]) {
                window.exitTypeEditMode(typeId);
            } else {
                window.enterTypeEditMode(typeId);
            }
        });

        typeInfo.appendChild(editBtn);
    });
}

/**
 * Enter edit mode for a specific type
 */
window.enterTypeEditMode = function (typeId) {
    window.typeEditModes[typeId] = true;

    const typeSection = document.getElementById(typeId);
    if (!typeSection) return;

    const table = typeSection.querySelector('.checklist-table');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    const rows = tbody.querySelectorAll('tr');

    rows.forEach((row, rowIdx) => {
        makeRowEditable(row, typeId, rowIdx);
    });

    // Get current min_required value
    const typeName = typeId.replace('type-', '');
    const typeData = checklistData.types.find(t => t.type_name === typeName);
    const currentMinRequired = typeData ? typeData.min_required : 0;

    // Create button container for save and cancel
    const header = typeSection.querySelector('.type-header');
    const typeInfo = header.querySelector('.type-info');
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'edit-button-container';
    buttonContainer.id = `btn-container-${typeId}`;

    // Add min_required input field
    const minReqLabel = document.createElement('label');
    minReqLabel.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: #8eb3d1;';
    minReqLabel.innerHTML = `
        <span>Min Required:</span>
        <input 
            type="number" 
            id="min-required-${typeId}" 
            class="min-required-input" 
            value="${currentMinRequired}" 
            min="0" 
            style="width: 4rem; padding: 0.25rem 0.5rem; background: #12263a; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: #fff; font-size: 0.875rem;"
        />
    `;
    buttonContainer.appendChild(minReqLabel);

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
 * Table structure: [0: checkbox, 1: name, 2: usage, 3: types, 4: ability, 5: held_item, 6: moves, 7: notes]
 */
window.makeRowEditable = function (row, typeId, rowIdx) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 8) return;

    // Skip checkbox cell (0)

    // Pokemon name (1) - editable
    const nameCell = cells[1];
    const originalName = nameCell.textContent.trim();
    nameCell.innerHTML = `<input type="text" class="editable-pokemon-name" value="${escapeHtml(originalName)}" placeholder="Pokemon">`;
    const nameInput = nameCell.querySelector('input');

    // Usage (2) - editable dropdown
    const usageCell = cells[2];
    const originalUsage = usageCell.textContent.trim();
    usageCell.innerHTML = `
        <select class="editable-usage">
            <option value="Physical" ${originalUsage === 'Physical' ? 'selected' : ''}>Physical</option>
            <option value="Special" ${originalUsage === 'Special' ? 'selected' : ''}>Special</option>
            <option value="Support" ${originalUsage === 'Support' ? 'selected' : ''}>Support</option>
            <option value="Mixed" ${originalUsage === 'Mixed' ? 'selected' : ''}>Mixed</option>
        </select>
    `;

    // Types (3) - display only, skip
    // Ability (4) - display only, skip

    // Held Item (5) - editable
    const itemCell = cells[5];
    const originalItem = itemCell.textContent === '—' ? '' : itemCell.textContent.trim();
    itemCell.innerHTML = `<input type="text" class="editable-held-item" value="${escapeHtml(originalItem)}" placeholder="Item">`;
    const itemInput = itemCell.querySelector('input');
    if (typeof attachItemAutocomplete === 'function') {
        attachItemAutocomplete(itemInput);
    }

    // Moves (6) - editable multi-select
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
        moveInput.placeholder = 'Add move...';

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

    // Notes (7) - editable input
    const notesCell = cells[7];
    const noteTextarea = notesCell.querySelector('.notes-textarea');
    const originalNotes = noteTextarea ? noteTextarea.value : '';
    notesCell.innerHTML = `<input type="text" class="editable-notes" value="${escapeHtml(originalNotes)}" placeholder="Add notes...">`;

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
window.exitTypeEditMode = function (typeId) {
    window.typeEditModes[typeId] = false;

    const typeSection = document.getElementById(typeId);
    if (!typeSection) return;

    // Find the type data by matching type_name with typeId (format: "type-{TypeName}")
    const typeName = typeId.replace('type-', '');
    const typeData = checklistData.types.find(t => t.type_name === typeName);
    if (!typeData) {
        console.error('Type data not found for:', typeName);
        return;
    }

    // Rebuild the table
    const content = typeSection.querySelector('.type-content');
    const table = content.querySelector('.checklist-table');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';

    typeData.pokemons.forEach((pokemon) => {
        const row = createPokemonRow(pokemon, typeName);
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

    // Collapse the type section
    content.style.display = 'none';
    header.classList.remove('expanded');
    const chevron = header.querySelector('.chevron');
    if (chevron) {
        chevron.textContent = '▼';
    }
}

/**
 * Save changes for a specific type to server
 */
async function saveTypeChanges(typeId) {
    if (!typeEditModes[typeId]) return;

    const typeSection = document.getElementById(typeId);
    if (!typeSection) return;

    // Extract type name from typeId (format: "type-{TypeName}")
    const typeName = typeId.replace('type-', '');
    if (!typeName) {
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
    // Table structure: [0: checkbox, 1: name, 2: usage, 3: types, 4: ability, 5: held_item, 6: moves, 7: notes]
    rows.forEach((row, index) => {
        const cells = row.querySelectorAll('td');

        // Extract pokemon key from checkbox dataset
        const checkbox = cells[0]?.querySelector('.pokemon-checkbox');
        if (!checkbox || !checkbox.dataset.pokemonName || !checkbox.dataset.pokemonUsage) {
            return;
        }

        const pokemonNameInput = cells[1]?.querySelector('.editable-pokemon-name');
        const usageSelect = cells[2]?.querySelector('.editable-usage');
        const heldItemInput = cells[5]?.querySelector('.editable-held-item');
        const movesContainer = cells[6]?.querySelector('.moves-container');
        const notesInput = cells[7]?.querySelector('.editable-notes');

        // Validate required inputs exist
        if (!pokemonNameInput || !usageSelect || !heldItemInput || !notesInput) {
            console.warn(`Row ${index}: Missing required input fields, skipping`);
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
            old_name: checkbox.dataset.pokemonName,      // OLD name for matching
            old_usage: checkbox.dataset.pokemonUsage,    // OLD usage for matching
            name: pokemonNameInput.value.trim(),         // NEW name
            usage: usageSelect.value,                    // NEW usage
            held_item: heldItemInput.value.trim(),
            moves: moves.join(', '),
            notes: notesInput.value.trim()
        };

        updateData.push(rowData);
    });

    if (updateData.length === 0) {
        console.warn('No pokemon data extracted for saving!');
        alert('No changes to save. Make sure the rows are in edit mode.');
        return;
    }

    try {
        const payload = { pokemon: updateData };

        // Save pokemon data
        const response = await fetch('/api/checklist/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server error:', errorText);
            throw new Error(`Server error: ${response.status}`);
        }

        const result = await response.json();

        // Save min_required setting if changed
        const minRequiredInput = document.getElementById(`min-required-${typeId}`);
        if (minRequiredInput) {
            const minRequired = parseInt(minRequiredInput.value) || 0;

            await fetch('/api/admin/type-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    type_name: typeName,
                    min_required: minRequired
                })
            });
        }

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
        tempMsg.className = 'toast-success';
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