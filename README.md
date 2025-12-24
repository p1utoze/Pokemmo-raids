# PokeMMO Raids 🎮

A comprehensive web application for tracking raid boss strategies and building custom teams for PokeMMO raid battles. This tool helps players prepare for seasonal raid events by providing detailed turn-by-turn strategies and an interactive team builder.

🌐 **Live Site**: [pokemmoraids.xyz](https://pokemmoraids.xyz)

## 🎯 Why This Was Built

PokeMMO raid battles require careful planning and coordination between 4 players to defeat powerful bosses. Information was scattered across Discord channels, guides, and community posts until DragonTamer's Raid Den was launched. This platform centralizes that knowledge into an easy-to-use interface where players can:

- **Raid Prep** in the form of To-Do checklists. THIS IS SUPER HELPFUL!
- **View proven strategies** for each raid boss with turn-by-turn instructions
- **Track their progress** through each battle phase
- **Build custom teams** when existing variations don't fit their available Pokémon
- **Monitor their collection** with an interactive Pokémon checklist
- **Stay updated** with current seasonal raid events

## ✨ Features

### 📊 Raid Boss Database
- **Comprehensive boss information**: Stats, abilities, moves, and phase effects
- **Multiple variations**: Each boss has several proven strategy variations
- **Turn-by-turn plans**: Detailed instructions for each player across all turns
- **Visual tracking**: Check off completed turns as you progress through battles
- **Mobile-responsive**: Full functionality on desktop and mobile devices

### 🛠️ Interactive Team Builder
- **Custom variation creator**: Build your own strategies when you don't have the exact Pokémon
- **Smart autocomplete**: Search Pokémon, moves, and held items with real-time suggestions
- **Persistent editing**: Save and modify your custom variations
- **Share strategies**: Created variations are visible to all users

### ✅ Pokémon Collection Tracker
- **Season-specific checklists**: Track which Pokémon you've prepared for raids
- **Usage categories**: Organized by Physical attackers, Special attackers, and Support
- **Progress visualization**: See at a glance which Pokémon you're missing
- **Persistent storage**: Your checklist progress is saved across sessions

### 🔐 Admin Panel (Staff Only)
- **Boss management**: Create and edit raid boss data
- **Strategy curation**: Review and approve community-submitted variations
- **Real-time updates**: Changes reflect immediately for all users
- **User authentication**: Secure login system with role-based access

### 🎨 User Experience
- **Dark mode UI**: Easy on the eyes during long raid sessions
- **Responsive design**: Seamless experience from mobile to desktop
- **Fast navigation**: Quick access to all bosses and strategies
- **Session persistence**: Your checkboxes and progress persist during your session

## 🏗️ Technical Stack

- **Backend**: Go (Golang) with high-performance HTTP server
- **Database**: MongoDB for flexible document storage
- **Frontend**: Vanilla JavaScript with modern CSS
- **Templating**: Pongo2 (Django-style templates for Go)
- **Deployment**: Docker containers with Nginx reverse proxy
- **SSL/TLS**: HTTPS with HTTP/2 support
- **CI/CD**: GitHub Actions for automated deployment

## 🚀 Getting Started

### Prerequisites
- Docker & Docker Compose
- Git

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/PokeMMORaids.git
   cd PokeMMORaids
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your MongoDB credentials
   ```

3. **Start the application**
   ```bash
   docker compose up -d --build
   ```

4. **Access the application**
   - Main site: http://localhost:8080
   - MongoDB: localhost:27017

### Production Deployment

The application uses GitHub Actions for automated deployment:
- Builds Docker images on push to main branch
- Publishes to GitHub Container Registry
- Supports HTTPS with custom SSL certificates via Nginx

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for detailed deployment instructions.

## 📁 Project Structure

```
.
├── main.go                 # Go backend server
├── templates/              # HTML templates
│   ├── boss.html          # Boss detail page
│   ├── build_team.html    # Team builder interface
│   └── index.html         # Home page with checklist
├── static/                 # Frontend assets
│   ├── css/               # Stylesheets
│   └── js/                # JavaScript modules
├── data/                   # JSON data files
│   ├── bosses.json        # Raid boss definitions
│   ├── monster.json       # Pokémon data
│   ├── moves.json         # Move database
│   ├── held_items.json    # Item database
│   └── checklists/        # Season-specific checklists
├── nginx/                  # Nginx configuration
└── docker-compose.yml      # Container orchestration
```

## 🤝 Contributing

Contributions are welcome! Whether it's:
- 🐛 Bug reports
- 💡 Feature suggestions
- 📝 Strategy improvements
- 🔧 Code contributions

Please open an issue or submit a pull request.

## 📄 Data Attribution

This site is inspired by and built with data from the **[PokeMMO Raid Den Community](https://discord.gg/gjSNmBmu4j)**.

Special thanks to:
- **PokeMMOHub** for Pokémon data (https://github.com/PokeMMOHub)
- All the dedicated guide makers and theorycrafters
- Community contributors who make raid strategies freely available

The Pokémon data is used under the terms of the original license. All game assets and Pokémon names are property of their respective owners.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🌟 Acknowledgments

Built with ❤️ for the PokeMMO community. Special thanks to everyone who shares strategies, tests teams, and helps fellow players succeed in raids.

---

**Disclaimer**: This is a fan-made tool and is not affiliated with or endorsed by PokeMMO or Nintendo.
