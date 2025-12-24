#!/usr/bin/env python3
"""
MongoDB helper utilities for checklist operations

New flexible schema structure:
{
  "season": "christmas_2024",
  "user_id": "default",
  "pokemon": [
    {
      "name": "Charizard",
      "usage": "Physical",
      "types": ["Fire", "Flying"],
      "held_item": "Choice Band",
      "ability": "Blaze",
      "moves": "Flare Blitz, Dragon Claw",
      "notes": "High damage dealer",
      "completed": false
    }
  ],
  "updated_at": ISODate("2024-12-23T10:00:00Z")
}

Example usage:
  python mongo_helper.py show                          # Show all checklists
  python mongo_helper.py pokemon christmas_2024        # Show all Pokemon in a season
  python mongo_helper.py types christmas_2024          # Show types summary
  python mongo_helper.py complete "Charizard" "Physical" christmas_2024
  python mongo_helper.py add christmas_2024            # Add a new Pokemon interactively
  python mongo_helper.py import data/checklist_christmas_2024.json  # Import from JSON
  python mongo_helper.py export christmas_2024 output.json  # Export one season to JSON
  python mongo_helper.py export-all [base_dir]             # Export all to checklists/*.json
"""

import sys
from pymongo import MongoClient
from bson import json_util
import json
from datetime import datetime

MONGO_URI = "mongodb://pokemmo:pokemmo_local_dev@localhost:27017/"
MONGO_DB = "pokemmo_raids"

def get_db():
    """Get MongoDB database connection"""
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return client[MONGO_DB]

def show_all():
    """Show all checklists"""
    db = get_db()
    checklists = db.checklists.find()
    
    print("📋 Checklists in MongoDB:\n")
    for doc in checklists:
        season = doc.get('season', 'unknown')
        user = doc.get('user_id', 'unknown')
        pokemon = doc.get('pokemon', [])
        completed = sum(1 for p in pokemon if p.get('completed', False))
        
        print(f"Season: {season}")
        print(f"User: {user}")
        print(f"Pokemon: {len(pokemon)}")
        print(f"Completed: {completed}/{len(pokemon)}")
        print(f"Updated: {doc.get('updated_at', 'N/A')}")
        print("-" * 40)

def show_pokemon(season):
    """Show all Pokemon in a season"""
    db = get_db()
    doc = db.checklists.find_one({"season": season, "user_id": "default"})
    
    if not doc:
        print(f"❌ Season '{season}' not found")
        return
    
    print(f"\n🎮 Pokemon in {season}:")
    print("-" * 80)
    for p in doc.get('pokemon', []):
        status = "✓" if p.get('completed', False) else "☐"
        types_str = ", ".join(p.get('types', []))
        usage = p.get('usage', 'Unknown')
        held_item = p.get('held_item', '')
        
        print(f"{status} {p['name']:20} ({usage:10}) | Types: {types_str:25} | Item: {held_item}")

def show_types(season):
    """Show all types in a season with counts"""
    db = get_db()
    doc = db.checklists.find_one({"season": season, "user_id": "default"})
    
    if not doc:
        print(f"❌ Season '{season}' not found")
        return
    
    # Collect all unique types and count
    type_stats = {}
    for p in doc.get('pokemon', []):
        for t in p.get('types', []):
            if t not in type_stats:
                type_stats[t] = {'total': 0, 'completed': 0}
            type_stats[t]['total'] += 1
            if p.get('completed', False):
                type_stats[t]['completed'] += 1
    
    print(f"\n🏷️  Types in {season}:")
    print("-" * 40)
    for t in sorted(type_stats.keys()):
        stats = type_stats[t]
        pct = (stats['completed'] / stats['total'] * 100) if stats['total'] > 0 else 0
        print(f"  {t:12} {stats['completed']:3}/{stats['total']:3} ({pct:5.1f}%)")

def toggle_complete(pokemon_name, usage, season):
    """Toggle completion status for a Pokemon"""
    db = get_db()
    
    result = db.checklists.update_one(
        {
            "season": season,
            "user_id": "default",
            "pokemon": {
                "$elemMatch": {
                    "name": pokemon_name,
                    "usage": usage
                }
            }
        },
        {
            "$set": {
                "pokemon.$[elem].completed": True,
                "updated_at": datetime.utcnow()
            }
        },
        array_filters=[{"elem.name": pokemon_name, "elem.usage": usage}]
    )
    
    if result.modified_count > 0:
        # Get updated status
        doc = db.checklists.find_one({"season": season, "user_id": "default"})
        for p in doc.get('pokemon', []):
            if p['name'] == pokemon_name and p.get('usage') == usage:
                status = "completed" if p.get('completed', False) else "not completed"
                types = ", ".join(p.get('types', []))
                print(f"✓ {pokemon_name} ({usage}) is now {status}")
                print(f"  Types: {types}")
                break
    else:
        print(f"❌ Pokemon '{pokemon_name}' ({usage}) not found in {season}")

def add_pokemon(season):
    """Add a new Pokemon to the checklist interactively"""
    print(f"\n➕ Add Pokemon to {season}")
    print("-" * 40)
    
    name = input("Pokemon name: ").strip()
    if not name:
        print("❌ Name required")
        return
    
    usage = input("Usage (Physical/Special/Support): ").strip()
    if usage not in ["Physical", "Special", "Support"]:
        print("❌ Usage must be Physical, Special, or Support")
        return
    
    types_input = input("Types (comma-separated, e.g., Fire, Flying): ").strip()
    types = [t.strip().upper() for t in types_input.split(",") if t.strip()]
    
    held_item = input("Held item (optional): ").strip()
    ability = input("Ability (optional): ").strip()
    moves = input("Moves (optional): ").strip()
    notes = input("Notes (optional): ").strip()
    
    pokemon_entry = {
        "name": name,
        "usage": usage,
        "types": types,
        "completed": False
    }
    
    if held_item:
        pokemon_entry["held_item"] = held_item
    if ability:
        pokemon_entry["ability"] = ability
    if moves:
        pokemon_entry["moves"] = moves
    if notes:
        pokemon_entry["notes"] = notes
    
    db = get_db()
    result = db.checklists.update_one(
        {"season": season, "user_id": "default"},
        {
            "$push": {"pokemon": pokemon_entry},
            "$set": {"updated_at": datetime.utcnow()}
        },
        upsert=True
    )
    
    if result.modified_count > 0 or result.upserted_id:
        print(f"✓ Added {name} ({usage}) to {season}")
    else:
        print(f"❌ Failed to add {name}")

def import_json(json_file):
    """Import a checklist from JSON file to MongoDB"""
    db = get_db()
    
    with open(json_file, 'r') as f:
        doc = json.load(f)
    
    season = doc.get('season')
    user_id = doc.get('user_id', 'default')
    
    if not season:
        print("❌ JSON file must contain 'season' field")
        return
    
    # Normalize types to uppercase
    for pokemon in doc.get('pokemon', []):
        if 'types' in pokemon:
            pokemon['types'] = [t.upper() for t in pokemon['types']]
    
    # Check if checklist already exists
    existing = db.checklists.find_one({"season": season, "user_id": user_id})
    
    if existing:
        response = input(f"⚠️  Checklist for {season} already exists. Overwrite? (y/N): ")
        if response.lower() != 'y':
            print("Import cancelled")
            return
        
        # Replace existing
        result = db.checklists.replace_one(
            {"season": season, "user_id": user_id},
            doc
        )
        print(f"✓ Updated checklist for {season}")
        print(f"  Pokemon count: {len(doc.get('pokemon', []))}")
    else:
        # Insert new
        result = db.checklists.insert_one(doc)
        print(f"✓ Imported checklist for {season}")
        print(f"  Pokemon count: {len(doc.get('pokemon', []))}")

def export_json(season, output_file):
    """Export a season's checklist to JSON file"""
    db = get_db()
    doc = db.checklists.find_one({"season": season, "user_id": "default"})
    
    if not doc:
        print(f"❌ Season '{season}' not found")
        return
    
    # Remove MongoDB _id field
    doc.pop('_id', None)
    
    with open(output_file, 'w') as f:
        json.dump(doc, f, indent=2, default=json_util.default)
    
    print(f"✓ Exported {season} to {output_file}")

def export_all_json(base_dir="."):
    """Export entire checklists collection to checklists/*.json directory structure"""
    import os
    
    db = get_db()
    checklists = list(db.checklists.find())
    
    if not checklists:
        print("❌ No checklists found in database")
        return
    
    # Create checklists directory
    checklists_dir = os.path.join(base_dir, "checklists")
    os.makedirs(checklists_dir, exist_ok=True)
    
    print(f"✓ Exporting {len(checklists)} checklist(s) to {checklists_dir}/")
    
    for doc in checklists:
        # Remove MongoDB _id field
        doc.pop('_id', None)
        
        season = doc.get('season', 'unknown')
        output_file = os.path.join(checklists_dir, f"{season}.json")
        
        with open(output_file, 'w') as f:
            json.dump(doc, f, indent=2, default=json_util.default)
        
        pokemon_count = len(doc.get('pokemon', []))
        print(f"  - {season}.json: {pokemon_count} Pokemon")

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    
    command = sys.argv[1]
    
    try:
        if command == "show":
            show_all()
        elif command == "pokemon":
            season = sys.argv[2] if len(sys.argv) > 2 else "christmas_2024"
            show_pokemon(season)
        elif command == "types":
            season = sys.argv[2] if len(sys.argv) > 2 else "christmas_2024"
            show_types(season)
        elif command == "complete":
            if len(sys.argv) < 4:
                print("Usage: python mongo_helper.py complete <pokemon_name> <usage> [season]")
                return
            pokemon_name = sys.argv[2]
            usage = sys.argv[3]
            season = sys.argv[4] if len(sys.argv) > 4 else "christmas_2024"
            toggle_complete(pokemon_name, usage, season)
        elif command == "add":
            season = sys.argv[2] if len(sys.argv) > 2 else "christmas_2024"
            add_pokemon(season)
        elif command == "import":
            if len(sys.argv) < 3:
                print("Usage: python mongo_helper.py import <json_file>")
                return
            json_file = sys.argv[2]
            import_json(json_file)
        elif command == "export":
            if len(sys.argv) < 3:
                print("Usage: python mongo_helper.py export <season> [output_file]")
                return
            season = sys.argv[2]
            output = sys.argv[3] if len(sys.argv) > 3 else f"{season}_export.json"
            export_json(season, output)
        elif command == "export-all":
            base_dir = sys.argv[2] if len(sys.argv) > 2 else "."
            export_all_json(base_dir)
        else:
            print(f"Unknown command: {command}")
            print(__doc__)
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
