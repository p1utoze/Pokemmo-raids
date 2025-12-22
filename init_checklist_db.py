#!/usr/bin/env python3
"""Initialize SQLite database for raid checklists with support for multiple seasons"""

import json
import sqlite3
import os
from pathlib import Path

PARENT_DIR = Path(__file__).parent
DB_PATH = PARENT_DIR / "data/checklist.db"  
BOSSES_JSON_PATH = PARENT_DIR / "data/bosses.json"
CHECKLIST_JSON_PATH = PARENT_DIR / "data/checklist_xmas.json"

def init_db():
    """Create SQLite database with multi-season checklist schema"""
    
    db_exists = os.path.exists(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    if not db_exists:
        # Create common types table (shared across all seasons)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                min_required INTEGER DEFAULT 0
            )
        """)
        print(f"Created types table in {DB_PATH}")
    
    # Load bosses.json to get seasons
    try:
        with open(BOSSES_JSON_PATH, 'r') as f:
            bosses_list = json.load(f)
        
        # bosses.json is now a list of season objects
        if isinstance(bosses_list, list):
            for season_data in bosses_list:
                season_name = season_data.get('season', '').lower().replace(' ', '_')
                year_info = season_data.get('year', '')
                table_name = f"{season_name}_{year_info}" if year_info else season_name
                if season_name:
                    init_season(cursor, table_name, season_data)
                    load_data(cursor, CHECKLIST_JSON_PATH, table_name=table_name)
                else:
                    print("Warning: Season object missing 'season' field")
        else:
            print("Warning: bosses.json should be a list of season objects")
    except FileNotFoundError:
        print(f"Warning: bosses.json not found at {BOSSES_JSON_PATH}")
    except json.JSONDecodeError as e:
        print(f"Warning: Failed to parse bosses.json: {e}")
    
    conn.commit()
    conn.close()
    print(f"Database initialized/updated at {DB_PATH}")


def init_season(cursor, table_name, season_data):
    """Initialize or update a specific season's data"""
    
    # Check if season table already exists
    cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
    table_exists = cursor.fetchone() is not None
    
    if not table_exists:
        # Create season-specific table
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {table_name} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type_id INTEGER NOT NULL,
                pokemon_name TEXT NOT NULL,
                phys_special TEXT,
                secondary_type TEXT,
                held_item TEXT,
                ability TEXT,
                moves TEXT,
                notes TEXT,
                completed INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (type_id) REFERENCES types(id)
            )
        """)
        
        # Create indices for the season table
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_type_pokemon ON {table_name}(type_id, pokemon_name)")
        cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_completed ON {table_name}(completed)")
        
        print(f"Created {table_name} season table in checklist.db")
    else:
        print(f"Season '{table_name}' already exists in checklist.db, skipping initialization")

def load_data(cursor, json_path, table_name):
    with open(json_path, 'r') as f:
        checklist_data = json.load(f)
     
        
    # Insert types and pokemon
    for type_name, pokemons in checklist_data.items():
        # Insert type (use INSERT OR IGNORE since types are shared across all seasons)
        cursor.execute("INSERT OR IGNORE INTO types (type_name, min_required) VALUES (?, ?)", 
                      (type_name, 0))
        # Get the type_id (whether it was inserted or already existed)
        cursor.execute("SELECT id FROM types WHERE type_name = ? COLLATE NOCASE", (type_name,))
        result = cursor.fetchone()
        if not result:
            continue
        type_id = result[0]
        
        # Insert pokemon for this type
        for pokemon_entry in pokemons:
            pokemon_name = pokemon_entry.get('Fire', '')  # Key seems to be 'Fire' for pokemon name
            if not pokemon_name or pokemon_name == 'Level 80':  # Skip header rows
                continue
            
            # Combine move fields into comma-separated string
            moves = []
            for key in ['Moves', '__2', '__3', '__4']:
                move = pokemon_entry.get(key, '').strip()
                if move:
                    moves.append(move)
            moves_str = ', '.join(moves)
            
            # Extract data
            phys_special = pokemon_entry.get('Level 80', '')
            secondary_type = pokemon_entry.get('Secondary Usage', '')
            ability = pokemon_entry.get('Ability', '')
            held_item = pokemon_entry.get('held_item', '')  # May not exist in JSON
            notes = pokemon_entry.get('Choices', '')  # Using Choices as notes
            
            cursor.execute(f"""
                INSERT INTO {table_name}
                (type_id, pokemon_name, phys_special, secondary_type, held_item, ability, moves, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (type_id, pokemon_name, phys_special, secondary_type, held_item, ability, moves_str, notes))
            
if __name__ == "__main__":
    init_db()
