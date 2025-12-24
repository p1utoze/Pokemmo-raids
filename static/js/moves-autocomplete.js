/**
 * Global Moves Autocomplete Module
 * Provides autocomplete for moves with visual indicators for non-native moves
 */

window.MovesAutocomplete = (function () {
    let allMoves = null;
    let allMovesMap = null;
    let fuseMoves = null;
    let currentPokemonData = null;
    let isReady = false;

    /**
     * Initialize the module by loading all moves from moves.json
     */
    async function init() {
        try {
            const response = await fetch('/data/moves.json');
            allMoves = await response.json();

            // Create a map for fast lookup by ID or name
            allMovesMap = new Map();
            allMoves.forEach(move => {
                allMovesMap.set(move.id, move);
                allMovesMap.set(move.name.toLowerCase(), move);
            });

            // Create Fuse instance for fuzzy search
            const moveNames = allMoves.map(m => m.name);
            fuseMoves = new Fuse(moveNames, {
                threshold: 0.3,
                includeScore: true
            });

            isReady = true;
            return true;
        } catch (error) {
            console.error('[MovesAutocomplete] Failed to load moves.json:', error);
            isReady = false;
            return false;
        }
    }

    /**
     * Check if a move is in the current Pokemon's natural moveset
     */
    function isPokemonNativeMove(moveName, pokemonMoves) {
        if (!pokemonMoves || !Array.isArray(pokemonMoves)) return false;

        return pokemonMoves.some(move => {
            const name = typeof move === 'string' ? move : (move.name || '');
            return name.toLowerCase() === moveName.toLowerCase();
        });
    }

    /**
     * Search for moves and return results with metadata
     */
    function searchMoves(query, pokemonMoves = null) {
        if (!fuseMoves || !allMovesMap) {
            console.error('[MovesAutocomplete] Not initialized');
            return [];
        }

        if (query.length < 1) return [];

        const results = fuseMoves.search(query).slice(0, 10);

        return results.map(result => {
            const moveName = result.item;
            const move = allMovesMap.get(moveName.toLowerCase());
            const isNative = pokemonMoves ? isPokemonNativeMove(moveName, pokemonMoves) : true;

            return {
                name: moveName,
                id: move ? move.id : null,
                type: move ? move.type : null,
                isNative: isNative,
                score: result.score
            };
        });
    }

    /**
     * Create autocomplete dropdown with visual indicators
     */
    function showAutocomplete(inputElement, results, onSelect) {
        removeAutocomplete();

        if (results.length === 0) return;

        const dropdown = document.createElement('div');
        dropdown.className = 'autocomplete-dropdown';
        dropdown.id = 'moves-autocomplete-dropdown';

        results.forEach(result => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';

            // Add visual indicator for non-native moves
            if (!result.isNative) {
                item.classList.add('non-native-move');
                item.title = 'This move is not normally learned by this Pokémon';
            }

            const nameSpan = document.createElement('span');
            nameSpan.textContent = result.name;
            item.appendChild(nameSpan);

            // Add type badge if available
            if (result.type) {
                const typeBadge = document.createElement('span');
                typeBadge.className = 'move-type-badge';
                typeBadge.textContent = result.type;
                item.appendChild(typeBadge);
            }

            // Add non-native indicator
            if (!result.isNative) {
                const indicator = document.createElement('span');
                indicator.className = 'non-native-indicator';
                indicator.textContent = '⚠';
                indicator.title = 'Not in natural moveset';
                item.appendChild(indicator);
            }

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                onSelect(result.name);
            });

            dropdown.appendChild(item);
        });

        const rect = inputElement.getBoundingClientRect();
        dropdown.style.position = 'absolute';
        dropdown.style.top = (rect.bottom + window.scrollY) + 'px';
        dropdown.style.left = (rect.left + window.scrollX) + 'px';
        dropdown.style.minWidth = rect.width + 'px';

        document.body.appendChild(dropdown);
    }

    /**
     * Remove autocomplete dropdown
     */
    function removeAutocomplete() {
        const existing = document.getElementById('moves-autocomplete-dropdown');
        if (existing) existing.remove();
    }

    /**
     * Attach autocomplete to an input element
     */
    function attachToInput(moveInput, pokemonInput = null) {
        moveInput.addEventListener('input', () => {
            const query = moveInput.value.trim();

            if (query.length < 1) {
                removeAutocomplete();
                return;
            }

            // Get current pokemon's moves if pokemonInput is provided
            let pokemonMoves = null;
            if (pokemonInput && window.editData) {
                const pokemonName = pokemonInput.value.trim();
                const pokemon = window.editData.monsters?.find(m =>
                    m.name.toLowerCase() === pokemonName.toLowerCase()
                );
                pokemonMoves = pokemon ? pokemon.moves : null;
            }

            const results = searchMoves(query, pokemonMoves);
            showAutocomplete(moveInput, results, (selectedMove) => {
                moveInput.value = selectedMove;
                removeAutocomplete();
            });
        });

        moveInput.addEventListener('blur', () => {
            setTimeout(removeAutocomplete, 200);
        });
    }

    return {
        init,
        searchMoves,
        showAutocomplete,
        removeAutocomplete,
        attachToInput,
        get isReady() { return isReady; }
    };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.MovesAutocomplete.init();
    });
} else {
    window.MovesAutocomplete.init();
}
