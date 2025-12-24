let movesData = [];
let phasesData = [];
let variationsData = [];
let currentVariationIndex = 0;

function updateMovesJSON() {
    document.getElementById('movesJSON').value = JSON.stringify(movesData);
}

function updatePhasesJSON() {
    document.getElementById('phaseEffectsJSON').value = JSON.stringify(phasesData);
}

function renderMovesList() {
    const tbody = document.getElementById('movesList');
    tbody.innerHTML = '';
    movesData.forEach((move, idx) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="text" class="move-name" value="${move.name}" data-idx="${idx}" /></td>
            <td><input type="text" class="move-type" value="${move.type}" data-idx="${idx}" /></td>
            <td><button type="button" class="delete-move btn-small" data-idx="${idx}">Delete</button></td>
        `;
        tbody.appendChild(row);
    });

    // Attach input listeners
    document.querySelectorAll('.move-name, .move-type').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            if (e.target.classList.contains('move-name')) {
                movesData[idx].name = e.target.value;
            } else {
                movesData[idx].type = e.target.value;
            }
            updateMovesJSON();
        });
    });

    // Attach autocomplete to move name inputs
    if (window.MovesAutocomplete) {
        document.querySelectorAll('.move-name').forEach(input => {
            window.MovesAutocomplete.attachToInput(input);
        });
    }

    // Attach delete listeners
    document.querySelectorAll('.delete-move').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            movesData.splice(idx, 1);
            renderMovesList();
            updateMovesJSON();
        });
    });
}

function renderPhasesList() {
    const tbody = document.getElementById('phaseList');
    tbody.innerHTML = '';
    phasesData.forEach((phase, idx) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="number" min="0" max="100" class="phase-health" value="${phase.health}" data-idx="${idx}" /></td>
            <td><input type="text" class="phase-effect" value="${phase.effect}" data-idx="${idx}" /></td>
            <td><button type="button" class="delete-phase btn-small" data-idx="${idx}">Delete</button></td>
        `;
        tbody.appendChild(row);
    });

    // Attach input listeners
    document.querySelectorAll('.phase-health, .phase-effect').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            if (e.target.classList.contains('phase-health')) {
                phasesData[idx].health = parseInt(e.target.value);
            } else {
                phasesData[idx].effect = e.target.value;
            }
            updatePhasesJSON();
        });
    });

    // Attach delete listeners
    document.querySelectorAll('.delete-phase').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            phasesData.splice(idx, 1);
            renderPhasesList();
            updatePhasesJSON();
        });
    });
}

function renderVariationCarousel() {
    const container = document.getElementById('variationTablesContainer');
    container.innerHTML = '';

    if (variationsData.length === 0) {
        container.innerHTML = '<p class="admin-empty">No variations yet. Click "+ Add Variation" to start.</p>';
        document.getElementById('variationHeader').textContent = 'No Variations';
        const prev = document.getElementById('prevVariationBtn'); if (prev) prev.style.visibility = 'hidden';
        const next = document.getElementById('nextVariationBtn'); if (next) next.style.visibility = 'hidden';
        const del = document.getElementById('deleteVariationBtn'); if (del) del.disabled = true;
        return;
    }

    const variation = variationsData[currentVariationIndex] || { players: { P1: [], P2: [], P3: [], P4: [] } };
    const header = document.getElementById('variationHeader'); if (header) header.textContent = `Variation ${currentVariationIndex + 1} of ${variationsData.length}`;
    const prevBtn = document.getElementById('prevVariationBtn'); if (prevBtn) prevBtn.style.visibility = currentVariationIndex > 0 ? 'visible' : 'hidden';
    const nextBtn = document.getElementById('nextVariationBtn'); if (nextBtn) nextBtn.style.visibility = currentVariationIndex < variationsData.length - 1 ? 'visible' : 'hidden';
    const deleteBtn = document.getElementById('deleteVariationBtn'); if (deleteBtn) deleteBtn.disabled = variationsData.length <= 1;

    // Create 4 player tables (P1, P2, P3, P4)
    ['P1', 'P2', 'P3', 'P4'].forEach(player => {
        const playerTable = document.createElement('div');
        playerTable.className = 'player-table-container';

        const playerTitle = document.createElement('h5');
        playerTitle.textContent = player;
        playerTitle.className = 'player-table-title';
        playerTable.appendChild(playerTitle);

        const table = document.createElement('table');
        table.className = 'builder-table';
        table.innerHTML = `
            <thead>
                <tr><th>Pokémon</th><th>Move</th><th>Item</th><th>Action</th></tr>
            </thead>
            <tbody class="player-${player}-list"></tbody>
        `;

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-small';
        addBtn.textContent = '+ Add Pokémon';
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!variation.players[player]) variation.players[player] = [];
            variation.players[player].push({ pokemon: '', move: '', item: '' });
            renderVariationCarousel();
            updateVariationsJSON();
        });

        playerTable.appendChild(table);
        playerTable.appendChild(addBtn);
        container.appendChild(playerTable);

        // Render player's pokemon list
        if (!variation.players[player]) variation.players[player] = [];
        const tbody = playerTable.querySelector(`.player-${player}-list`);
        variation.players[player].forEach((poke, idx) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><input type="text" class="poke-name" value="${poke.pokemon}" data-player="${player}" data-idx="${idx}" placeholder="e.g., Pikachu" /></td>
                <td><input type="text" class="poke-move" value="${poke.move}" data-player="${player}" data-idx="${idx}" placeholder="e.g., Thunderbolt" /></td>
                <td><input type="text" class="poke-item" value="${poke.item}" data-player="${player}" data-idx="${idx}" placeholder="e.g., Assault Vest" /></td>
                <td><button type="button" class="delete-poke btn-small" data-player="${player}" data-idx="${idx}">Delete</button></td>
            `;
            tbody.appendChild(row);
        });
    });

    // Attach event listeners
    document.querySelectorAll('.poke-name, .poke-move, .poke-item').forEach(input => {
        input.addEventListener('change', (e) => {
            const player = e.target.dataset.player;
            const idx = parseInt(e.target.dataset.idx);
            if (e.target.classList.contains('poke-name')) {
                variation.players[player][idx].pokemon = e.target.value;
            } else if (e.target.classList.contains('poke-move')) {
                variation.players[player][idx].move = e.target.value;
            } else {
                variation.players[player][idx].item = e.target.value;
            }
            updateVariationsJSON();
        });
    });

    // Attach autocomplete to move inputs
    if (window.MovesAutocomplete) {
        document.querySelectorAll('.poke-move').forEach(moveInput => {
            const pokemonInput = moveInput.closest('tr')?.querySelector('.poke-name');
            window.MovesAutocomplete.attachToInput(moveInput, pokemonInput);
        });
    }

    document.querySelectorAll('.delete-poke').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const player = e.target.dataset.player;
            const idx = parseInt(e.target.dataset.idx);
            variation.players[player].splice(idx, 1);
            renderVariationCarousel();
            updateVariationsJSON();
        });
    });
}

function updateVariationsJSON() {
    const el = document.getElementById('bossVariations');
    if (el) el.value = JSON.stringify(variationsData);
}

document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('raidBossForm');
    const saveBtn = document.getElementById('saveTeamBtn');
    const cancelBtn = document.getElementById('cancelTeamBtn');
    const season = document.getElementById('raidBossSeason').value;
    const action = document.getElementById('raidBossAction').value;
    const bossId = document.getElementById('raidBossId').value;

    // Wait for MovesAutocomplete to initialize before rendering
    const initializeAdmin = async () => {
        // Wait for MovesAutocomplete to be ready
        if (window.MovesAutocomplete && !window.MovesAutocomplete.isReady) {
            await window.MovesAutocomplete.init();
        }

        // Initialize moves and phases data
        try {
            movesData = JSON.parse(document.getElementById('movesJSON').value || '[]');
        } catch (e) {
            movesData = [];
        }
        try {
            phasesData = JSON.parse(document.getElementById('phaseEffectsJSON').value || '[]');
        } catch (e) {
            phasesData = [];
        }

        renderMovesList();
        renderPhasesList();

        // Initialize variations data robustly: prefer inlined JSON blob (#raid-boss-data), fallback to hidden input
        try {
            const bossDataElem = document.getElementById('raid-boss-data');
            if (bossDataElem && bossDataElem.textContent && bossDataElem.textContent.trim().length > 0) {
                const bossObj = JSON.parse(bossDataElem.textContent);
                variationsData = bossObj.variations || JSON.parse(document.getElementById('bossVariations').value || '[]');
            } else {
                variationsData = JSON.parse(document.getElementById('bossVariations').value || '[]');
            }
        } catch (e) {
            variationsData = [];
        }

        if (!Array.isArray(variationsData)) variationsData = [];
        if (variationsData.length === 0) variationsData = [{ players: { P1: [], P2: [], P3: [], P4: [] } }];
        currentVariationIndex = 0;
        renderVariationCarousel();

        // Carousel navigation
        document.getElementById('prevVariationBtn').addEventListener('click', (e) => {
            e.preventDefault();
            if (currentVariationIndex > 0) {
                currentVariationIndex--;
                renderVariationCarousel();
            }
        });

        document.getElementById('nextVariationBtn').addEventListener('click', (e) => {
            e.preventDefault();
            if (currentVariationIndex < variationsData.length - 1) {
                currentVariationIndex++;
                renderVariationCarousel();
            }
        });

        // Add variation button
        document.getElementById('addVariationBtn').addEventListener('click', (e) => {
            e.preventDefault();
            variationsData.push({
                players: { P1: [], P2: [], P3: [], P4: [] },
                health_remaining: [],
                notes: []
            });
            currentVariationIndex = variationsData.length - 1;
            renderVariationCarousel();
            updateVariationsJSON();
        });

        // Delete variation button
        document.getElementById('deleteVariationBtn').addEventListener('click', (e) => {
            e.preventDefault();
            if (variationsData.length <= 1) {
                alert('Cannot delete the last variation. Delete the entire boss instead.');
                return;
            }
            if (confirm('Delete this variation?')) {
                variationsData.splice(currentVariationIndex, 1);
                if (currentVariationIndex >= variationsData.length) {
                    currentVariationIndex = variationsData.length - 1;
                }
                renderVariationCarousel();
                updateVariationsJSON();
            }
        });


        // Add move button
        document.getElementById('addMoveBtn').addEventListener('click', (e) => {
            e.preventDefault();
            movesData.push({ name: '', type: '' });
            renderMovesList();
            updateMovesJSON();
        });

        // Add phase button
        document.getElementById('addPhaseBtn').addEventListener('click', (e) => {
            e.preventDefault();
            phasesData.push({ health: 100, effect: '' });
            renderPhasesList();
            updatePhasesJSON();
        });

        saveBtn.addEventListener('click', async () => {
            const formData = new FormData(form);
            const payload = {
                boss_name: formData.get('boss_name'),
                stars: parseInt(formData.get('stars')),
                description: formData.get('description'),
                ability: formData.get('ability'),
                held_item: formData.get('held_item'),
                speed_evs: parseInt(formData.get('speed_evs')),
                base_stats: {
                    speed: parseInt(formData.get('base_stats_speed')),
                    defense: parseInt(formData.get('base_stats_defense')),
                    special_defense: parseInt(formData.get('base_stats_spdef'))
                },
                moves: JSON.parse(formData.get('moves') || '[]'),
                phase_effects: JSON.parse(formData.get('phase_effects') || '[]'),
                variations: JSON.parse(formData.get('variations') || '[]')
            };

            if (action === 'edit') {
                payload.id = parseInt(bossId);
            }

            try {
                const method = action === 'create' ? 'POST' : 'PUT';
                const response = await fetch('/api/admin/raid-bosses?season=' + encodeURIComponent(season), {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (response.ok) {
                    window.location.href = '/admin?tab=raid-bosses';
                } else {
                    alert('Failed to save boss');
                }
            } catch (err) {
                console.error(err);
                alert('Error saving boss');
            }
        });

        cancelBtn.addEventListener('click', () => {
            window.history.back();
        });
    };

    // Call the initialization function
    initializeAdmin();
});