#!/usr/bin/env python3
"""
Transform checklist_xmas.json to MongoDB schema format

Reads the old format and creates a MongoDB-compatible document.
Reports ambiguous/conflicting fields that are omitted.
"""

import json
from datetime import datetime

def normalize_usage(usage_str):
    """Normalize usage string to Physical, Special, or Support"""
    if not usage_str or usage_str == "Level 80":
        return None
    
    usage_str = usage_str.upper().strip()
    
    if "PHYS" in usage_str and "SPECIAL" in usage_str:
        # Ambiguous - needs manual review
        return None
    elif "PHYS" in usage_str:
        return "Physical"
    elif "SPECIAL" in usage_str:
        return "Special"
    elif "UTILITY" in usage_str or "SUPPORT" in usage_str:
        return "Support"
    else:
        return None

def extract_types(type_field, secondary_usage):
    """Extract types from Fire field and Secondary Usage"""
    types = []
    
    # Primary type from the key (fire, Ice, Dragon, etc.)
    # This is handled externally by the parent loop
    
    # Secondary types from Secondary Usage field
    if secondary_usage and secondary_usage.strip():
        # Parse secondary usage for type names
        secondary = secondary_usage.strip()
        
        # Common type names
        type_names = ["Fighting", "Rock", "Ghost", "Bug", "Flying", "Psychic", 
                     "Steel", "Ground", "Poison", "Water", "Grass", "Electric",
                     "Ice", "Dragon", "Dark", "Fairy", "Normal"]
        
        for type_name in type_names:
            if type_name.lower() in secondary.lower():
                if type_name not in types:
                    types.append(type_name)
    
    return types

def collect_moves(entry):
    """Collect moves from Moves, __2, __3, __4 fields"""
    moves = []
    
    for key in ["Moves", "__2", "__3", "__4"]:
        if key in entry and entry[key] and entry[key].strip():
            moves.append(entry[key].strip())
    
    return ", ".join(moves) if moves else ""

def is_valid_pokemon_name(name):
    """Check if the name looks like a valid Pokemon name"""
    if not name or not name.strip():
        return False
    
    name = name.strip()
    
    # Filter out obvious non-Pokemon entries
    invalid_patterns = [
        "bug/ice", "level 80", "needed", "pick", 
        "choices", "special", "phys", "utility"
    ]
    
    for pattern in invalid_patterns:
        if pattern in name.lower():
            return False
    
    # Must start with uppercase letter
    if not name[0].isupper():
        return False
    
    return True

def transform_checklist():
    """Transform checklist_xmas.json to MongoDB format"""
    
    with open('data/checklist_xmas.json', 'r') as f:
        old_data = json.load(f)
    
    pokemon_list = []
    issues = []
    stats = {
        'total_entries': 0,
        'skipped_invalid_name': 0,
        'skipped_no_usage': 0,
        'skipped_ambiguous_usage': 0,
        'converted': 0
    }
    
    # Process each type category
    for type_key, entries in old_data.items():
        # Normalize type name
        type_name = type_key.capitalize()
        if type_name == "Utility":
            type_name = "Support"
        
        for entry in entries:
            stats['total_entries'] += 1
            
            # Extract Pokemon name from "Fire" field (regardless of type category)
            pokemon_name = entry.get("Fire", "").strip()
            
            if not is_valid_pokemon_name(pokemon_name):
                stats['skipped_invalid_name'] += 1
                issues.append(f"SKIPPED (invalid name): {pokemon_name} in {type_key}")
                continue
            
            # Get usage type
            usage_field = entry.get("Level 80", "")
            usage = normalize_usage(usage_field)
            
            if not usage:
                if usage_field and "PHYS" in usage_field.upper() and "SPECIAL" in usage_field.upper():
                    stats['skipped_ambiguous_usage'] += 1
                    issues.append(f"AMBIGUOUS USAGE ({usage_field}): {pokemon_name} - needs manual classification")
                else:
                    stats['skipped_no_usage'] += 1
                    issues.append(f"NO USAGE: {pokemon_name} in {type_key} (field: '{usage_field}')")
                continue
            
            # Extract types
            types = [type_name]  # Primary type from category
            secondary_types = extract_types(entry.get("Fire", ""), entry.get("Secondary Usage", ""))
            types.extend([t for t in secondary_types if t not in types])
            
            # Collect moves
            moves = collect_moves(entry)
            
            # Get ability
            ability = entry.get("Ability", "").strip()
            
            # Notes from Secondary Usage if it's not a type
            notes = ""
            secondary_usage = entry.get("Secondary Usage", "").strip()
            if secondary_usage and not any(t.lower() in secondary_usage.lower() for t in 
                ["Fighting", "Rock", "Ghost", "Bug", "Flying", "Psychic", "Steel", 
                 "Ground", "Poison", "Water", "Grass", "Electric", "Ice", "Dragon", 
                 "Dark", "Fairy", "Normal"]):
                notes = secondary_usage
            
            # Choices field as additional notes
            choices = entry.get("Choices", "").strip()
            if choices and choices.upper() not in ["", "NEEDED", "PICK 5"]:
                notes = f"{notes} {choices}".strip()
            
            # Build Pokemon entry
            pokemon_entry = {
                "name": pokemon_name,
                "usage": usage,
                "types": types,
                "completed": False
            }
            
            if ability:
                pokemon_entry["ability"] = ability
            if moves:
                pokemon_entry["moves"] = moves
            if notes:
                pokemon_entry["notes"] = notes
            
            pokemon_list.append(pokemon_entry)
            stats['converted'] += 1
    
    # Create final MongoDB document
    mongo_doc = {
        "season": "christmas_2024",
        "user_id": "default",
        "pokemon": pokemon_list,
        "updated_at": datetime.utcnow().isoformat() + "Z"
    }
    
    # Save to new file
    with open('data/checklist_christmas_2024.json', 'w') as f:
        json.dump(mongo_doc, f, indent=2)
    
    # Print report
    print("\n" + "="*60)
    print("TRANSFORMATION REPORT")
    print("="*60)
    print(f"\nTotal entries processed: {stats['total_entries']}")
    print(f"Successfully converted: {stats['converted']}")
    print(f"Skipped (invalid name): {stats['skipped_invalid_name']}")
    print(f"Skipped (no usage): {stats['skipped_no_usage']}")
    print(f"Skipped (ambiguous usage): {stats['skipped_ambiguous_usage']}")
    
    print("\n" + "="*60)
    print("ISSUES FOUND (Review These Manually)")
    print("="*60)
    
    for issue in issues:
        print(f"  • {issue}")
    
    print("\n" + "="*60)
    print("OUTPUT")
    print("="*60)
    print(f"Created: data/checklist_christmas_2024.json")
    print(f"Total Pokemon: {len(pokemon_list)}")
    print("\nSample entries:")
    for i, p in enumerate(pokemon_list[:3]):
        print(f"\n{i+1}. {p['name']} ({p['usage']})")
        print(f"   Types: {', '.join(p['types'])}")
        if 'moves' in p:
            print(f"   Moves: {p['moves']}")
        if 'notes' in p:
            print(f"   Notes: {p['notes']}")
    
    print("\n" + "="*60)
    print("NEXT STEPS")
    print("="*60)
    print("1. Review the issues above and manually add/fix ambiguous entries")
    print("2. Import to MongoDB:")
    print("   python mongo_helper.py import data/checklist_christmas_2024.json")
    print("="*60)

if __name__ == "__main__":
    transform_checklist()
