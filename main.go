package main

import (
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"os"
	"strings"
	"github.com/flosch/pongo2/v4"
)

type Player struct {
	Pokemon string `json:"pokemon"`
	Move    string `json:"move"`
	Item    string `json:"item"`
}
type Variation struct {
	Players         map[string][]Player `json:"players"`
	HealthRemaining []float64           `json:"health_remaining"`
	Notes           []string            `json:"notes,omitempty"`
	PlayersList     [][]Player          `json:"-"`
	TableHTML       string              `json:"-"`
	Index           int                 `json:"-"`
	Index0          int                 `json:"-"`
}

type PhaseEffect struct {
	Health uint8 `json:"health"`
	Effect  string `json:"effect"`
}
type RaidBossMove struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
}
type BaseStats struct {
	Speed   int `json:"speed,omitempty"`
	Def int `json:"defense,omitempty"`
	SpDef   int `json:"special_defense,omitempty"`
}

type RaidBoss struct {
	Name         string        	`json:"name"`
	Description  string        	`json:"description"`
	Ability      string        	`json:"ability,omitempty"`
	HeldItem     string         `json:"held_item,omitempty"`
	Stars        int            `json:"stars,omitempty"`
	SpeedEVs     int           	`json:"speed_evs,omitempty"`
	BaseStats    BaseStats     	`json:"base_stats,omitempty"`
	Moves        []RaidBossMove `json:"moves,omitempty"`
	PhaseEffects []PhaseEffect  `json:"phase_effects,omitempty"`
	Variations   []Variation    `json:"variations"`
}

type Season struct {
	SeasonName string     `json:"season"`
	RaidBosses []RaidBoss `json:"raid_bosses"`
}

type App struct {
	season    Season
	templates map[string]*pongo2.Template
}

var app *App

const (
	dataPath      = "data/bosses.json"
	templatesPath = "templates/"
	maxPlayers    = 4
	emptyCell     = "—"
)

var playerPositions = [maxPlayers]string{"P1", "P2", "P3", "P4"}

// loadData reads and processes the raid season data from JSON
func (a *App) loadData() error {
	file, err := os.Open(dataPath)
	if err != nil {
		return fmt.Errorf("failed to open data file: %w", err)
	}
	defer file.Close()

	if err := json.NewDecoder(file).Decode(&a.season); err != nil {
		return fmt.Errorf("failed to decode season data: %w", err)
	}

	a.preprocessVariations()
	return nil
}

// preprocessVariations builds HTML tables for all variations
func (a *App) preprocessVariations() {
	for bi := range a.season.RaidBosses {
		for vi := range a.season.RaidBosses[bi].Variations {
			// set convenient indexes for templates (1-based and 0-based)
			a.season.RaidBosses[bi].Variations[vi].Index = vi + 1
			a.season.RaidBosses[bi].Variations[vi].Index0 = vi
			a.season.RaidBosses[bi].Variations[vi].TableHTML = a.buildVariationTable(&a.season.RaidBosses[bi].Variations[vi])
		}
	}
}

// buildVariationTable generates HTML table rows for a variation
func (a *App) buildVariationTable(v *Variation) string {
	playerArrays := [maxPlayers][]Player{}
	for i, pos := range playerPositions {
		playerArrays[i] = v.Players[pos]
	}

	var sb strings.Builder
	for ti, health := range v.HealthRemaining {
		sb.WriteString("<tr>")
		sb.WriteString(fmt.Sprintf("<td>%d</td>", ti+1))

		for playerIdx := 0; playerIdx < maxPlayers; playerIdx++ {
			a.writePlayerCell(&sb, playerArrays[playerIdx], playerIdx, ti)
		}

		sb.WriteString(fmt.Sprintf("<td class=\"boss-health\">%v</td>", health))
		a.writeNoteCell(&sb, v.Notes, ti)
		sb.WriteString("</tr>")
	}
	return sb.String()
}

// writeNoteCell writes a note input field with prefilled content from Notes
func (a *App) writeNoteCell(sb *strings.Builder, notes []string, turnIdx int) {
	noteValue := ""
	if len(notes) > turnIdx {
		noteValue = notes[turnIdx]
	}
	sb.WriteString("<td class=\"side-notes\">")
	sb.WriteString(fmt.Sprintf("<input class=\"note-input\" type=\"text\" placeholder=\"notes\" value=\"%s\">", html.EscapeString(noteValue)))
	sb.WriteString("</td>")
}

// writePlayerCell writes a single player cell to the HTML builder
func (a *App) writePlayerCell(sb *strings.Builder, players []Player, playerIdx, turnIdx int) {
	if len(players) <= turnIdx {
		sb.WriteString(fmt.Sprintf("<td>%s</td>", emptyCell))
		return
	}

	p := players[turnIdx]
	sb.WriteString("<td class=\"player-cell\">")
	sb.WriteString("<label class=\"player-action\">")
	sb.WriteString(fmt.Sprintf("<input type=\"checkbox\" class=\"player-check\" data-player-index=\"%d\" data-turn-index=\"%d\">", playerIdx, turnIdx))
	sb.WriteString("<div class=\"player-meta\">")
	sb.WriteString(fmt.Sprintf("<div class=\"player-name\">%s</div>", html.EscapeString(p.Pokemon)))
	sb.WriteString(fmt.Sprintf("<div class=\"player-move\">%s</div>", html.EscapeString(p.Move)))
	if p.Item != "" {
		sb.WriteString(fmt.Sprintf("<div class=\"player-item\">%s</div>", html.EscapeString(p.Item)))
	}
	sb.WriteString("</div></label></td>")
}

func main() {
	app = &App{
		templates: make(map[string]*pongo2.Template),
	}

	if err := app.loadData(); err != nil {
		log.Fatalf("Failed to load data: %v", err)
	}

	if err := app.loadTemplates(); err != nil {
		log.Fatalf("Failed to load templates: %v", err)
	}

	setupRoutes()
	log.Println("Server started at :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

// setupRoutes configures HTTP handlers
func setupRoutes() {
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	http.HandleFunc("/", app.indexHandler)
	http.HandleFunc("/boss", app.bossHandler)
}

// loadTemplates loads all template files
func (a *App) loadTemplates() error {
	templateNames := []string{"index.html", "boss.html", "build_team.html", "base.html"}
	for _, name := range templateNames {
		tpl, err := pongo2.FromFile(templatesPath + name)
		if err != nil {
			return fmt.Errorf("failed to load template %s: %w", name, err)
		}
		a.templates[name] = tpl
	}
	return nil
}

// indexHandler renders the main page with all bosses
func (a *App) indexHandler(w http.ResponseWriter, r *http.Request) {
	renderTemplate(w, a.templates["index.html"], pongo2.Context{"season": a.season})
}

// bossHandler renders a specific boss page
func (a *App) bossHandler(w http.ResponseWriter, r *http.Request) {
	bossName := r.URL.Query().Get("name")
	boss := a.findBoss(bossName)
	if boss == nil {
		http.NotFound(w, r)
		return
	}

	bossJSON, err := json.Marshal(boss)
	if err != nil {
		renderError(w, "Failed to marshal boss data", http.StatusInternalServerError)
		return
	}

	ctx := pongo2.Context{
		"boss":     boss,
		"bossJSON": string(bossJSON),
	}
	renderTemplate(w, a.templates["boss.html"], ctx)
}

// findBoss searches for a boss by name
func (a *App) findBoss(name string) *RaidBoss {
	for i := range a.season.RaidBosses {
		if a.season.RaidBosses[i].Name == name {
			return &a.season.RaidBosses[i]
		}
	}
	return nil
}

// renderTemplate renders a template with given context
func renderTemplate(w http.ResponseWriter, tpl *pongo2.Template, ctx pongo2.Context) {
	if tpl == nil {
		renderError(w, "Template not found", http.StatusInternalServerError)
		return
	}

	html, err := tpl.Execute(ctx)
	if err != nil {
		renderError(w, "Template rendering failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(html))
}

// renderError sends an error response
func renderError(w http.ResponseWriter, message string, statusCode int) {
	log.Printf("Error: %s", message)
	http.Error(w, message, statusCode)
}
