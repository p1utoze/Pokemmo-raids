document.addEventListener('DOMContentLoaded', function () {
    // Card click enhancement (navigate on click)
    document.querySelectorAll('.boss-card').forEach(c => {
        c.addEventListener('click', function (e) {
            const link = c.querySelector('.boss-link');
            if (link) window.location.href = link.getAttribute('href');
        });
    });

    // Boss page: checkbox state persistence in sessionStorage (client-side only for ALL users)
    // This is for personal tracking and does not persist to server
    const checkboxes = Array.from(document.querySelectorAll('.plan-table input.player-check'));
    checkboxes.forEach(chk => {
        const cell = chk.closest('.player-cell');
        chk.addEventListener('change', function () {
            const key = `check_${location.pathname}_${chk.dataset.playerIndex}_${chk.dataset.turnIndex}`;
            try { sessionStorage.setItem(key, chk.checked ? '1' : '0') } catch (e) { }
            if (cell) cell.classList.toggle('completed', chk.checked);
        });
        // restore
        const key = `check_${location.pathname}_${chk.dataset.playerIndex}_${chk.dataset.turnIndex}`;
        const val = sessionStorage.getItem(key);
        if (val === '1') {
            chk.checked = true;
            if (cell) cell.classList.add('completed');
        }
    });

    // View more / sidebar toggle
    const viewBtn = document.getElementById('viewMoreBtn');
    const sidebar = document.getElementById('rightSidebar');
    const closeBtn = document.getElementById('closeSidebar');
    if (viewBtn && sidebar) {
        viewBtn.addEventListener('click', function () { sidebar.classList.add('open'); sidebar.setAttribute('aria-hidden', 'false'); });
    }
    if (closeBtn && sidebar) {
        closeBtn.addEventListener('click', function () { sidebar.classList.remove('open'); sidebar.setAttribute('aria-hidden', 'true'); });
    }

    // Team builder page initialization
    const pokemonDataEl = document.getElementById('pokemon-data');
    const teamDataEl = document.getElementById('team-data');

    if (pokemonDataEl && teamDataEl) {
        const pokemonData = JSON.parse(pokemonDataEl.textContent);
        const teamData = JSON.parse(teamDataEl.textContent);
        initTeamBuilder(pokemonData, teamData);
    }

    // Cancel button on team builder
    const cancelBtn = document.getElementById('cancelTeamBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            window.history.back();
        });
    }
});

function initTeamBuilder(pokemonData, teamData) {
    // Populate dropdown options
    const pokemonSelects = document.querySelectorAll('.pokemon-select');
    const moveSelects = document.querySelectorAll('.move-select');
    const itemSelects = document.querySelectorAll('.item-select');

    // Clear and populate dropdowns
    pokemonSelects.forEach(select => {
        select.innerHTML = '<option value="">Select Pokémon</option>';
        pokemonData.pokemon.forEach(p => {
            const option = document.createElement('option');
            option.value = p;
            option.textContent = p;
            select.appendChild(option);
        });
    });

    moveSelects.forEach(select => {
        select.innerHTML = '<option value="">Select Move</option>';
        pokemonData.moves.forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = m;
            select.appendChild(option);
        });
    });

    itemSelects.forEach(select => {
        select.innerHTML = '<option value="">Select Item</option>';
        pokemonData.items.forEach(i => {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            select.appendChild(option);
        });
    });

    // Prefill team data
    const playerPositions = ['P1', 'P2', 'P3', 'P4'];
    playerPositions.forEach((pos, idx) => {
        const playerNum = idx + 1;
        const players = teamData.players[pos];

        if (players && players.length > 0) {
            const firstPlayer = players[0];

            // Set values from first player in variation
            document.getElementById(`pokemon_p${playerNum}`).value = firstPlayer.pokemon || '';
            document.getElementById(`move_p${playerNum}`).value = firstPlayer.move || '';
            document.getElementById(`item_p${playerNum}`).value = firstPlayer.item || '';
            // fetch ability and moves for this pokemon
            if (firstPlayer.pokemon) {
                fetchPokemonInfo(firstPlayer.pokemon).then(info => {
                    const abilityEl = document.getElementById(`ability_p${playerNum}`);
                    if (abilityEl) abilityEl.textContent = info.abilities && info.abilities.length ? info.abilities[0] : '—';
                    // if API returned moves, replace player's move options
                    if (info.moves && info.moves.length) {
                        const moveSel = document.getElementById(`move_p${playerNum}`);
                        if (moveSel) {
                            moveSel.innerHTML = '<option value="">Select Move</option>';
                            info.moves.forEach(m => {
                                const opt = document.createElement('option');
                                opt.value = m;
                                opt.textContent = m;
                                moveSel.appendChild(opt);
                            });
                            // restore the selected move if present
                            if (firstPlayer.move) moveSel.value = firstPlayer.move;
                        }
                    }
                }).catch(() => { });
            }
        }
    });

    // build plan table from existing variation data if any
    window._pokemonData = pokemonData;
    buildPlanFromVariation(teamData);

    // when pokemon is changed, fetch its abilities/moves and populate ability display and moves
    document.querySelectorAll('.pokemon-select').forEach(select => {
        select.addEventListener('change', function () {
            const player = this.dataset.player;
            const name = this.value;
            const abilityEl = document.getElementById(`ability_p${player}`);
            const moveSel = document.getElementById(`move_p${player}`);
            if (!name) {
                if (abilityEl) abilityEl.textContent = '—';
                return;
            }
            fetchPokemonInfo(name).then(info => {
                if (abilityEl) abilityEl.textContent = info.abilities && info.abilities.length ? info.abilities[0] : '—';
                if (info.moves && info.moves.length && moveSel) {
                    moveSel.innerHTML = '<option value="">Select Move</option>';
                    info.moves.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m;
                        opt.textContent = m;
                        moveSel.appendChild(opt);
                    });
                }
                // after selecting pokemon+moves, check if all players have a pokemon and move selected => auto-add a turn
                setTimeout(() => {
                    const snap = getCurrentSnapshot();
                    if (snap && allPlayersSelected(snap)) {
                        // append if different than last
                        appendPlanIfNew(snap);
                    }
                }, 50);
            }).catch(() => { });
        });
    });

    // Form submission
    const form = document.getElementById('teamBuilderForm');
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            // Collect form data + planned turns
            const teamFormData = { players: {}, turns: [] };
            for (let i = 1; i <= 4; i++) {
                const ability = document.getElementById(`ability_p${i}`) ? document.getElementById(`ability_p${i}`).textContent : '';
                teamFormData.players[`P${i}`] = {
                    pokemon: document.getElementById(`pokemon_p${i}`).value,
                    ability: ability,
                    move: document.getElementById(`move_p${i}`).value,
                    item: document.getElementById(`item_p${i}`).value,
                };
            }

            // collect planned turns from table
            const tbody = document.getElementById('planTbody');
            if (tbody) {
                Array.from(tbody.querySelectorAll('tr')).forEach(tr => {
                    const cols = tr.querySelectorAll('td');
                    if (cols.length >= 5) {
                        const turn = {
                            P1: cols[1].textContent || '',
                            P2: cols[2].textContent || '',
                            P3: cols[3].textContent || '',
                            P4: cols[4].textContent || '',
                            notes: cols[5] ? cols[5].textContent : ''
                        };
                        teamFormData.turns.push(turn);
                    }
                });
            }

            // For now, save to sessionStorage (you can expand to API call later)
            try {
                sessionStorage.setItem('teamBuilderData', JSON.stringify(teamFormData));
                alert('Team saved! (Currently saved locally)');
            } catch (e) {
                alert('Failed to save team data');
            }
        });
    }

    // Add Turn and Clear Plan buttons
    const addTurnBtn = document.getElementById('addTurnBtn');
    if (addTurnBtn) addTurnBtn.addEventListener('click', function () {
        const snap = getCurrentSnapshot();
        if (snap) appendPlanIfNew(snap);
    });
    const clearPlanBtn = document.getElementById('clearPlanBtn');
    if (clearPlanBtn) clearPlanBtn.addEventListener('click', function () {
        const tbody = document.getElementById('planTbody');
        if (tbody) tbody.innerHTML = '';
    });
}

function buildPlanFromVariation(teamData) {
    try {
        const tbody = document.getElementById('planTbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!teamData || !teamData.players) return;

        // determine max turns by looking at players arrays
        let maxTurns = 0;
        ['P1', 'P2', 'P3', 'P4'].forEach(p => {
            if (Array.isArray(teamData.players[p])) {
                maxTurns = Math.max(maxTurns, teamData.players[p].length);
            }
        });

        // Build a row for each turn
        for (let ti = 0; ti < maxTurns; ti++) {
            const snap = {};
            ['P1', 'P2', 'P3', 'P4'].forEach((p, idx) => {
                const arr = teamData.players[p] || [];
                const entry = arr[ti] || {};
                // Map the data correctly - Player struct has Pokemon, Move, Item fields
                snap[`P${idx + 1}`] = {
                    pokemon: entry.pokemon || '',
                    move: entry.move || '',
                    item: entry.item || '',
                    ability: '' // ability will be fetched when pokemon is set
                };
            });
            appendPlanRowFromSnap(snap, teamData.notes ? teamData.notes[ti] : '');
        }
    } catch (e) {
        console.error('Error building plan from variation:', e);
    }
}
function appendPlanRowFromSnap(snap, note) {
    const tbody = document.getElementById('planTbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    const turnTd = document.createElement('td');
    turnTd.textContent = tbody.children.length + 1;
    tr.appendChild(turnTd);
    for (let i = 1; i <= 4; i++) {
        const cell = createPlayerCellFromData(tbody.children.length, i - 1, snap[`P${i}`] || {});
        tr.appendChild(cell);
    }
    const notesTd = document.createElement('td');
    notesTd.textContent = note || '';
    tr.appendChild(notesTd);
    tbody.appendChild(tr);
}

function createPlayerCellFromData(turnIdx, playerIdx, data) {
    const td = document.createElement('td');
    td.className = 'player-cell';

    const label = document.createElement('label');
    label.className = 'player-action';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'player-check';
    chk.dataset.playerIndex = playerIdx;
    chk.dataset.turnIndex = turnIdx;
    chk.addEventListener('change', () => td.classList.toggle('completed', chk.checked));

    const meta = document.createElement('div');
    meta.className = 'player-meta';

    // Ability display
    const abilityDiv = document.createElement('div');
    abilityDiv.className = 'player-ability';
    abilityDiv.style.fontSize = '12px';
    abilityDiv.style.color = 'var(--muted)';
    abilityDiv.textContent = (data && data.ability) ? data.ability : '—';

    // pokemon select
    const pSelect = document.createElement('select');
    pSelect.className = 'form-control plan-pokemon-select';
    pSelect.innerHTML = '<option value="">Select Pokémon</option>';
    (window._pokemonData && window._pokemonData.pokemon || []).forEach(p => {
        const opt = document.createElement('option'); opt.value = p; opt.textContent = p; pSelect.appendChild(opt);
    });
    if (data && data.pokemon) pSelect.value = data.pokemon;

    // move select
    const mSelect = document.createElement('select');
    mSelect.className = 'form-control plan-move-select';
    mSelect.innerHTML = '<option value="">Select Move</option>';
    if (data && data.move) {
        const opt = document.createElement('option'); opt.value = data.move; opt.textContent = data.move; mSelect.appendChild(opt);
        mSelect.value = data.move;
    }

    // item select
    const iSelect = document.createElement('select');
    iSelect.className = 'form-control plan-item-select';
    iSelect.innerHTML = '<option value="">Select Item</option>';
    (window._pokemonData && window._pokemonData.items || []).forEach(it => {
        const opt = document.createElement('option'); opt.value = it; opt.textContent = it; iSelect.appendChild(opt);
    });
    if (data && data.item) iSelect.value = data.item;

    // when pokemon in table cell changes, fetch info and populate moves & ability
    pSelect.addEventListener('change', function () {
        const name = this.value;
        if (!name) { abilityDiv.textContent = '—'; mSelect.innerHTML = '<option value="">Select Move</option>'; return; }
        fetchPokemonInfo(name).then(info => {
            abilityDiv.textContent = info.abilities && info.abilities.length ? info.abilities[0] : '—';
            if (info.moves && info.moves.length) {
                mSelect.innerHTML = '<option value="">Select Move</option>';
                info.moves.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; mSelect.appendChild(o); });
            }
        }).catch(() => { });
    });

    // If pokemon is already set, fetch its ability and moves
    if (data && data.pokemon) {
        fetchPokemonInfo(data.pokemon).then(info => {
            abilityDiv.textContent = info.abilities && info.abilities.length ? info.abilities[0] : '—';
            if (info.moves && info.moves.length) {
                mSelect.innerHTML = '<option value="">Select Move</option>';
                info.moves.forEach(m => {
                    const o = document.createElement('option');
                    o.value = m;
                    o.textContent = m;
                    mSelect.appendChild(o);
                });
                // Restore the selected move
                if (data.move) mSelect.value = data.move;
            }
        }).catch(() => { });
    }

    meta.appendChild(pSelect);
    meta.appendChild(mSelect);
    meta.appendChild(iSelect);
    meta.appendChild(abilityDiv);

    label.appendChild(chk);
    label.appendChild(meta);
    td.appendChild(label);
    return td;
}

function getCurrentSnapshot() {
    try {
        const snap = {};
        for (let i = 1; i <= 4; i++) {
            const p = document.getElementById(`pokemon_p${i}`) ? document.getElementById(`pokemon_p${i}`).value : '';
            const m = document.getElementById(`move_p${i}`) ? document.getElementById(`move_p${i}`).value : '';
            const it = document.getElementById(`item_p${i}`) ? document.getElementById(`item_p${i}`).value : '';
            snap[`P${i}`] = { pokemon: p, move: m, item: it };
        }
        return snap;
    } catch (e) { return null; }
}

function allPlayersSelected(snap) {
    if (!snap) return false;
    for (let i = 1; i <= 4; i++) {
        const s = snap[`P${i}`];
        if (!s || !s.pokemon) return false;
    }
    return true;
}

function appendPlanIfNew(snap) {
    if (!snap) return;
    const tbody = document.getElementById('planTbody');
    const last = tbody && tbody.lastElementChild;
    const cols = [snap.P1.pokemon + (snap.P1.move ? ' — ' + snap.P1.move : ''), snap.P2.pokemon + (snap.P2.move ? ' — ' + snap.P2.move : ''), snap.P3.pokemon + (snap.P3.move ? ' — ' + snap.P3.move : ''), snap.P4.pokemon + (snap.P4.move ? ' — ' + snap.P4.move : '')];
    if (last) {
        const lastCols = Array.from(last.querySelectorAll('td')).slice(1, 5).map(td => td.textContent || '');
        if (JSON.stringify(lastCols) === JSON.stringify(cols)) return; // duplicate
    }
    appendPlanRowFromSnap(snap);
}

// Fetch abilities and moves for a pokemon from the server
function fetchPokemonInfo(name) {
    return fetch(`/api/pokemon-info?name=${encodeURIComponent(name)}`)
        .then(resp => {
            if (!resp.ok) return { abilities: [], moves: [] };
            return resp.json();
        })
        .then(data => ({
            abilities: data.abilities || [],
            moves: data.moves || []
        }));
}
