#!/usr/bin/env python3
"""Initialize SQLite database for Christmas raid checklist"""

import json
import sqlite3
import os
from pathlib import Path

PARENT_DIR = Path(__file__).parent
DB_PATH = PARENT_DIR / "data/checklist_xmas.db"
JSON_PATH = PARENT_DIR / "data/checklist_xmas.json"

def init_db():
    """Create SQLite database with checklist schema"""
    
    # Remove existing database if it exists
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create types table
    cursor.execute("""
        CREATE TABLE types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type_name TEXT NOT NULL UNIQUE,
            min_required INTEGER DEFAULT 0
        )
    """)
    
    # Create pokemon checklist table
    cursor.execute("""
        CREATE TABLE pokemon_checklist (
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
    
    # Create index for faster queries
    cursor.execute("CREATE INDEX idx_type_pokemon ON pokemon_checklist(type_id, pokemon_name)")
    cursor.execute("CREATE INDEX idx_completed ON pokemon_checklist(completed)")
    
    conn.commit()
    
    # Load and parse the JSON data
    with open(JSON_PATH, 'r') as f:
        checklist_data = json.load(f)
    
    # Insert types and pokemon
    for type_name, pokemons in checklist_data.items():
        # Insert type
        cursor.execute("INSERT INTO types (type_name, min_required) VALUES (?, ?)", 
                      (type_name, 0))
        type_id = cursor.lastrowid
        
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
            
            cursor.execute("""
                INSERT INTO pokemon_checklist 
                (type_id, pokemon_name, phys_special, secondary_type, held_item, ability, moves, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (type_id, pokemon_name, phys_special, secondary_type, held_item, ability, moves_str, notes))
    
    conn.commit()
    conn.close()
    print(f"Database initialized at {DB_PATH}")

if __name__ == "__main__":
    init_db()
