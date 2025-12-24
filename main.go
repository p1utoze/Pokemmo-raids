package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/smtp"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/flosch/pongo2/v4"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
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
	Health uint8  `json:"health"`
	Effect string `json:"effect"`
}
type RaidBossMove struct {
	Name string `json:"name"`
	Type string `json:"type"`
}
type BaseStats struct {
	Speed int `json:"speed,omitempty"`
	Def   int `json:"defense,omitempty"`
	SpDef int `json:"special_defense,omitempty"`
}

type RaidBoss struct {
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	Ability      string         `json:"ability,omitempty"`
	HeldItem     string         `json:"held_item,omitempty"`
	Stars        int            `json:"stars,omitempty"`
	SpeedEVs     int            `json:"speed_evs,omitempty"`
	BaseStats    BaseStats      `json:"base_stats,omitempty"`
	Moves        []RaidBossMove `json:"moves,omitempty"`
	PhaseEffects []PhaseEffect  `json:"phase_effects,omitempty"`
	Variations   []Variation    `json:"variations"`
}

type Season struct {
	SeasonName string     `json:"season"`
	Year       int        `json:"year"`
	RaidBosses []RaidBoss `json:"raid_bosses"`
}

// MongoDB Checklist Schema - Flexible document structure
type PokemonChecklistEntry struct {
	Name      string   `json:"name" bson:"name"`
	Usage     string   `json:"usage" bson:"usage"` // "Physical", "Special", "Support"
	Types     []string `json:"types" bson:"types"` // ["Fire", "Flying"] for example
	HeldItem  string   `json:"held_item,omitempty" bson:"held_item,omitempty"`
	Ability   string   `json:"ability,omitempty" bson:"ability,omitempty"`
	Moves     string   `json:"moves,omitempty" bson:"moves,omitempty"`
	Notes     string   `json:"notes,omitempty" bson:"notes,omitempty"`
	Completed bool     `json:"completed" bson:"completed"`
}

type ChecklistDocument struct {
	ID        primitive.ObjectID      `json:"_id,omitempty" bson:"_id,omitempty"`
	Season    string                  `json:"season" bson:"season"`
	UserID    string                  `json:"user_id" bson:"user_id"`
	Pokemon   []PokemonChecklistEntry `json:"pokemon" bson:"pokemon"`
	UpdatedAt time.Time               `json:"updated_at" bson:"updated_at"`
}

// TypeSettings stores configuration for Pokemon types per season
type TypeSettings struct {
	ID          primitive.ObjectID `json:"_id,omitempty" bson:"_id,omitempty"`
	Season      string             `json:"season" bson:"season"`
	TypeName    string             `json:"type_name" bson:"type_name"`
	MinRequired int                `json:"min_required" bson:"min_required"`
	IsPinned    bool               `json:"is_pinned" bson:"is_pinned"`
	UpdatedAt   time.Time          `json:"updated_at" bson:"updated_at"`
}

// Frontend-compatible response format grouped by type
type PokemonType struct {
	TypeName    string                  `json:"type_name"`
	MinRequired int                     `json:"min_required"`
	IsPinned    bool                    `json:"is_pinned"`
	Count       int                     `json:"count"`
	Completed   int                     `json:"completed"`
	Pokemons    []PokemonChecklistEntry `json:"pokemons"`
}

type ChecklistResponse struct {
	Types  []PokemonType `json:"types"`
	Season string        `json:"season"`
}

type App struct {
	seasons       []Season
	season        Season // current season for backwards compatibility
	templates     map[string]*pongo2.Template
	mongoDB       *mongo.Database
	mongoClient   *mongo.Client
	adminDB       *sql.DB
	defaultSeason string // code form e.g. "christmas_2024"
	commitHash    string // for cache busting static assets
}

var app *App

var (
	dataPath      = getEnvOrDefault("DATA_PATH", "data/bosses.json")
	templatesPath = "templates/"
	mongoURI      = getEnvOrDefault("MONGO_URI", "mongodb://pokemmo:pokemmo_local_dev@localhost:27017/")
	mongoDB       = getEnvOrDefault("MONGO_DB", "pokemmo_raids")
	adminDBPath   = getEnvOrDefault("ADMIN_DB", "data/users.db")
)

const (
	maxPlayers = 4
	emptyCell  = "—"
)

var playerPositions = [maxPlayers]string{"P1", "P2", "P3", "P4"}

// getEnvOrDefault returns the value of an environment variable or a default value if not set
func getEnvOrDefault(envVar, defaultValue string) string {
	if value := os.Getenv(envVar); value != "" {
		return value
	}
	return defaultValue
}

// generateRandomPassword creates a random password of given length
func generateRandomPassword(length int) string {
	letters := []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=")
	b := make([]rune, length)
	for i := range b {
		b[i] = letters[int(time.Now().UnixNano())%len(letters)]
		time.Sleep(time.Nanosecond) // ensure different seed
	}
	return string(b)
}

// openMongoDB opens the MongoDB connection for checklists
func (a *App) openMongoDB() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	clientOptions := options.Client().ApplyURI(mongoURI)
	client, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return fmt.Errorf("failed to connect to MongoDB: %w", err)
	}

	// Test the connection
	if err := client.Ping(ctx, nil); err != nil {
		return fmt.Errorf("failed to ping MongoDB: %w", err)
	}

	a.mongoClient = client
	a.mongoDB = client.Database(mongoDB)

	// Create indexes for efficient querying
	checklistCollection := a.mongoDB.Collection("checklists")

	// Index on season + user_id for fast lookups
	_, err = checklistCollection.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "season", Value: 1},
			{Key: "user_id", Value: 1},
		},
		Options: options.Index().SetUnique(true),
	})
	if err != nil {
		log.Printf("warning: failed to create season+user_id index: %v", err)
	}

	// Index on pokemon.name for searching
	_, err = checklistCollection.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "pokemon.name", Value: 1}},
	})
	if err != nil {
		log.Printf("warning: failed to create pokemon.name index: %v", err)
	}

	log.Println("✓ MongoDB connected successfully")
	return nil
}

// openAdminDatabase opens or creates the admin user database and ensures an admin user exists
func (a *App) openAdminDatabase() error {
	var err error
	a.adminDB, err = sql.Open("sqlite", adminDBPath)
	if err != nil {
		return fmt.Errorf("failed to open admin database: %w", err)
	}
	if err := a.adminDB.Ping(); err != nil {
		return fmt.Errorf("failed to ping admin database: %w", err)
	}

	// create users table if not exists
	_, err = a.adminDB.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT DEFAULT 'admin',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to ensure users table: %w", err)
	}

	// create password_resets table if not exists
	_, err = a.adminDB.Exec(`
		CREATE TABLE IF NOT EXISTS password_resets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			token TEXT NOT NULL UNIQUE,	
			expires_at INTEGER NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to ensure password_resets table: %w", err)
	}

	// settings table for storing key/value configuration
	_, err = a.adminDB.Exec(`
		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to ensure settings table: %w", err)
	}

	// Check if any users exist; if none, create a default admin using ADMIN_PASSWORD
	var count int
	row := a.adminDB.QueryRow("SELECT COUNT(1) FROM users")
	if err := row.Scan(&count); err != nil {
		return fmt.Errorf("failed to query users count: %w", err)
	}
	if count == 0 {
		pass := os.Getenv("ADMIN_PASSWORD")
		if pass == "" {
			pass = "adminpass"
		}
		// hash password
		hash, err := bcryptGenerateHash(pass)
		if err != nil {
			return fmt.Errorf("failed to hash admin password: %w", err)
		}
		_, err = a.adminDB.Exec("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", "admin", hash, "admin")
		if err != nil {
			return fmt.Errorf("failed to insert default admin: %w", err)
		}
		log.Println("Default admin user created from ADMIN_PASSWORD environment variable")
	}

	// load default season from settings, if present
	var defaultCode string
	row2 := a.adminDB.QueryRow("SELECT value FROM settings WHERE key='default_season'")
	if err := row2.Scan(&defaultCode); err == nil && defaultCode != "" {
		a.defaultSeason = defaultCode
		// apply to current season if found
		for _, s := range a.seasons {
			code := strings.ToLower(strings.ReplaceAll(s.SeasonName, " ", "_"))
			if s.Year > 0 {
				code = fmt.Sprintf("%s_%d", code, s.Year)
			}
			if code == defaultCode {
				a.season = s
				a.preprocessVariations()
				break
			}
		}
	}
	return nil
}

// bcrypt helper wrappers
func bcryptGenerateHash(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func bcryptCompareHash(hash, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

// SMTP configuration from environment
var (
	smtpHost     = os.Getenv("SMTP_HOST")     // e.g., "smtp.gmail.com"
	smtpPort     = os.Getenv("SMTP_PORT")     // e.g., "587"
	smtpUser     = os.Getenv("SMTP_USER")     // e.g., "your-email@gmail.com"
	smtpPassword = os.Getenv("SMTP_PASSWORD") // e.g., app password
	smtpFrom     = os.Getenv("SMTP_FROM")     // e.g., "noreply@pokemmoraids.com" or same as SMTP_USER
)

// sendResetEmail sends password reset email via SMTP
func sendResetEmail(toEmail, username, resetURL string) error {
	if smtpHost == "" || smtpPort == "" || smtpUser == "" || smtpPassword == "" {
		return fmt.Errorf("SMTP not configured")
	}
	from := smtpFrom
	if from == "" {
		from = smtpUser
	}

	// Compose email
	subject := "Password Reset Request - PokeMMO Raid Book"
	body := fmt.Sprintf(`Hello %s,

You requested a password reset for your account.

Click the link below to reset your password:
%s

This link will expire in 1 hour.

If you did not request this reset, please ignore this email.

Best regards,
PokeMMO Raid Book Team`, username, resetURL)

	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s", from, toEmail, subject, body)

	// SMTP authentication
	auth := smtp.PlainAuth("", smtpUser, smtpPassword, smtpHost)

	// Send email
	addr := smtpHost + ":" + smtpPort
	err := smtp.SendMail(addr, auth, from, []string{toEmail}, []byte(message))
	if err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}
	return nil
}

// Admin auth configuration
var (
	adminPassword = func() string {
		p := os.Getenv("ADMIN_PASSWORD")
		if p == "" {
			return "adminpass"
		}
		return p
	}()
	adminSecret = func() []byte {
		s := os.Getenv("ADMIN_SECRET")
		if s == "" {
			s = "devsecret"
		}
		return []byte(s)
	}()
)

// generateJWT creates a signed token with role claim
func generateJWT(subject, role string) (string, error) {
	claims := jwt.MapClaims{
		"sub":  subject,
		"role": role,
		"exp":  time.Now().Add(24 * time.Hour).Unix(),
		"iat":  time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(adminSecret)
}

// parseJWTClaims parses token and returns claims
func parseJWTClaims(tokenStr string) (jwt.MapClaims, error) {
	t, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return adminSecret, nil
	})
	if err != nil {
		return nil, err
	}
	if !t.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	if claims, ok := t.Claims.(jwt.MapClaims); ok {
		return claims, nil
	}
	return nil, fmt.Errorf("invalid claims")
}

// isAdminRequest checks cookie for a valid admin token and role
func isAdminRequest(r *http.Request) bool {
	c, err := r.Cookie("auth_token")
	if err != nil {
		return false
	}
	claims, err := parseJWTClaims(c.Value)
	if err != nil {
		return false
	}
	if role, ok := claims["role"].(string); ok && role == "admin" {
		return true
	}
	return false
}

// isAuthRequest checks token for author/mod/admin roles
func isAuthRequest(r *http.Request) bool {
	c, err := r.Cookie("auth_token")
	if err != nil {
		return false
	}
	claims, err := parseJWTClaims(c.Value)
	if err != nil {
		return false
	}
	if role, ok := claims["role"].(string); ok {
		if role == "admin" || role == "author" || role == "mod" {
			return true
		}
	}
	return false
}

// getRoleFromRequest returns the role string from the auth_token cookie, or empty if unauthenticated
func getRoleFromRequest(r *http.Request) string {
	c, err := r.Cookie("auth_token")
	if err != nil {
		return ""
	}
	claims, err := parseJWTClaims(c.Value)
	if err != nil {
		return ""
	}
	if role, ok := claims["role"].(string); ok {
		return role
	}
	return ""
}

// getUsernameFromRequest returns the username (sub) from the auth_token cookie, or empty if unauthenticated
func getUsernameFromRequest(r *http.Request) string {
	c, err := r.Cookie("auth_token")
	if err != nil {
		return ""
	}
	claims, err := parseJWTClaims(c.Value)
	if err != nil {
		return ""
	}
	if sub, ok := claims["sub"].(string); ok {
		return sub
	}
	return ""
}

// loadData reads and processes the raid season data from JSON
func (a *App) loadData() error {
	file, err := os.Open(dataPath)
	if err != nil {
		return fmt.Errorf("failed to open data file: %w", err)
	}
	defer file.Close()

	// bosses.json is now a list of seasons
	if err := json.NewDecoder(file).Decode(&a.seasons); err != nil {
		return fmt.Errorf("failed to decode seasons data: %w", err)
	}

	// Set the current season to the first one if available
	if len(a.seasons) > 0 {
		a.season = a.seasons[0]
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
		templates:  make(map[string]*pongo2.Template),
		commitHash: getEnvOrDefault("GIT_COMMIT_HASH", "dev"),
	}

	if err := app.loadData(); err != nil {
		log.Fatalf("Failed to load data: %v", err)
	}

	if err := app.openMongoDB(); err != nil {
		log.Fatalf("Failed to open MongoDB: %v", err)
	}
	defer func() {
		if app.mongoClient != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := app.mongoClient.Disconnect(ctx); err != nil {
				log.Printf("Error disconnecting MongoDB: %v", err)
			}
		}
	}()

	if err := app.openAdminDatabase(); err != nil {
		log.Fatalf("Failed to open admin database: %v", err)
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
	http.Handle("/data/", http.StripPrefix("/data/", http.FileServer(http.Dir("data"))))
	http.HandleFunc("/", app.indexHandler)
	http.HandleFunc("/boss", app.bossHandler)
	http.HandleFunc("/build-team", app.buildTeamHandler)
	http.HandleFunc("/api/pokemon-data", app.pokemonDataHandler)
	http.HandleFunc("/api/pokemon-info", app.pokemonInfoHandler)
	http.HandleFunc("/api/boss-edit-data", app.bossEditDataHandler)
	http.HandleFunc("/api/checklist", app.checklistHandler)
	http.HandleFunc("/api/checklist/toggle", app.toggleChecklistHandler)
	http.HandleFunc("/api/checklist/save", app.saveChecklistHandler)
	http.HandleFunc("/api/user/role", app.userRoleHandler)
	// Admin UI and API
	http.HandleFunc("/admin/login", app.adminLoginHandler)
	http.HandleFunc("/admin/logout", app.adminLogoutHandler)
	http.HandleFunc("/admin", app.adminPageHandler)
	http.HandleFunc("/admin/raid-boss-builder", app.adminRaidBossBuildHandler)
	http.HandleFunc("/api/admin/users", app.adminUsersHandler) // Admin users API
	// auth routes for non-admin authors/mods
	http.HandleFunc("/auth/login", app.authLoginHandler)
	http.HandleFunc("/auth/logout", app.authLogoutHandler)
	http.HandleFunc("/auth/change", app.authChangePasswordHandler)
	// password reset endpoints
	http.HandleFunc("/auth/reset/request", app.authResetRequestHandler)
	http.HandleFunc("/auth/reset", app.authResetHandler)
	http.HandleFunc("/api/boss/save-variation", app.saveVariationHandler)
	http.HandleFunc("/api/admin/types", app.adminTypesHandler)
	http.HandleFunc("/api/admin/pokemon", app.adminPokemonHandler)
	http.HandleFunc("/api/admin/extras", app.adminExtrasHandler)
	http.HandleFunc("/api/admin/raid-bosses", app.adminRaidBossesHandler)
	http.HandleFunc("/api/admin/seasons", app.adminSeasonsHandler)
	http.HandleFunc("/api/admin/season/default", app.adminDefaultSeasonHandler)
	http.HandleFunc("/api/admin/type-settings", app.adminTypeSettingsHandler)
}

// loadTemplates loads all template files
func (a *App) loadTemplates() error {
	templateNames := []string{"index.html", "boss.html", "build_team.html", "base.html", "admin.html", "admin_login.html", "auth_login.html", "auth_reset.html", "auth_reset_sent.html", "auth_change_password.html", "admin_build_team.html"}
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
	role := getRoleFromRequest(r)
	renderTemplate(w, a.templates["index.html"], pongo2.Context{"season": a.season, "user_role": role, "commit_hash": a.commitHash})
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

	role := getRoleFromRequest(r)
	ctx := pongo2.Context{
		"boss":      boss,
		"bossJSON":  string(bossJSON),
		"user_role": role,
	}
	renderTemplate(w, a.templates["boss.html"], ctx)
}

// buildTeamHandler renders the team builder page
func (a *App) buildTeamHandler(w http.ResponseWriter, r *http.Request) {
	// Require authentication (author/mod/admin)
	if !isAuthRequest(r) {
		http.Redirect(w, r, "/auth/login", http.StatusSeeOther)
		return
	}
	bossName := r.URL.Query().Get("boss")

	// If no boss is selected, render selection form
	if bossName == "" {
		// Build list of bosses for current season
		bossNames := make([]string, 0, len(a.season.RaidBosses))
		for _, b := range a.season.RaidBosses {
			bossNames = append(bossNames, b.Name)
		}
		ctx := pongo2.Context{
			"season_name": a.season.SeasonName,
			"bosses":      bossNames,
			"user_role":   getRoleFromRequest(r),
		}
		renderTemplate(w, a.templates["build_team.html"], ctx)
		return
	}

	boss := a.findBoss(bossName)
	if boss == nil {
		http.NotFound(w, r)
		return
	}

	// Always present empty variation for creating new
	emptyVar := Variation{Players: map[string][]Player{"P1": {}, "P2": {}, "P3": {}, "P4": {}}, HealthRemaining: []float64{}, Notes: []string{}}
	teamData, err := json.Marshal(emptyVar)
	if err != nil {
		renderError(w, "Failed to marshal team data", http.StatusInternalServerError)
		return
	}

	// Load monster.json for all pokemon names
	monsFile, err := os.Open("data/monster.json")
	if err != nil {
		renderError(w, "Failed to open monster data", http.StatusInternalServerError)
		return
	}
	defer monsFile.Close()
	var mons []map[string]interface{}
	if err := json.NewDecoder(monsFile).Decode(&mons); err != nil {
		renderError(w, "Failed to decode monster data", http.StatusInternalServerError)
		return
	}
	pokemonList := make([]string, 0, len(mons))
	for _, m := range mons {
		if n, ok := m["name"].(string); ok && n != "" {
			pokemonList = append(pokemonList, n)
		}
	}

	// Load items from held_items.json
	itemsFile, err := os.Open("data/held_items.json")
	if err != nil {
		renderError(w, "Failed to open items data", http.StatusInternalServerError)
		return
	}
	defer itemsFile.Close()
	var itemsRoot map[string][]string
	if err := json.NewDecoder(itemsFile).Decode(&itemsRoot); err != nil {
		renderError(w, "Failed to decode items data", http.StatusInternalServerError)
		return
	}

	pokemonData := map[string]interface{}{"pokemon": pokemonList, "moves": []string{}, "items": itemsRoot["items"]}
	pokemonDataJSON, _ := json.Marshal(pokemonData)

	// Marshal boss to JSON for client-side save logic
	bossJSON, _ := json.Marshal(boss)
	ctx := pongo2.Context{
		"boss_name":    bossName,
		"pokemon_data": string(pokemonDataJSON),
		"team_data":    string(teamData),
		"bossJSON":     string(bossJSON),
		"range":        []int{1, 2, 3, 4},
		"user_role":    getRoleFromRequest(r),
	}
	renderTemplate(w, a.templates["build_team.html"], ctx)
}

// pokemonDataHandler returns available Pokemon, moves, and items as JSON
func (a *App) pokemonDataHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Extract all unique Pokemon, moves, and items from all variations
	pokemonSet := make(map[string]bool)
	moveSet := make(map[string]bool)
	itemSet := make(map[string]bool)

	for _, boss := range a.season.RaidBosses {
		for _, variation := range boss.Variations {
			for _, players := range variation.Players {
				for _, p := range players {
					if p.Pokemon != "" {
						pokemonSet[p.Pokemon] = true
					}
					if p.Move != "" {
						moveSet[p.Move] = true
					}
					if p.Item != "" {
						itemSet[p.Item] = true
					}
				}
			}
		}
	}

	pokemonList := make([]string, 0, len(pokemonSet))
	for p := range pokemonSet {
		pokemonList = append(pokemonList, p)
	}
	moveList := make([]string, 0, len(moveSet))
	for m := range moveSet {
		moveList = append(moveList, m)
	}
	itemList := make([]string, 0, len(itemSet))
	for i := range itemSet {
		itemList = append(itemList, i)
	}

	data := map[string][]string{
		"pokemon": pokemonList,
		"moves":   moveList,
		"items":   itemList,
	}
	json.NewEncoder(w).Encode(data)
}

// pokemonInfoHandler returns abilities and moves for a given pokemon name by reading data/monster.json
func (a *App) pokemonInfoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	name := r.URL.Query().Get("name")
	if name == "" {
		json.NewEncoder(w).Encode(map[string][]string{"abilities": {}, "moves": {}})
		return
	}

	f, err := os.Open("data/monster.json")
	if err != nil {
		json.NewEncoder(w).Encode(map[string][]string{"abilities": {}, "moves": {}})
		return
	}
	defer f.Close()

	var monsters []map[string]interface{}
	if err := json.NewDecoder(f).Decode(&monsters); err != nil {
		json.NewEncoder(w).Encode(map[string][]string{"abilities": {}, "moves": {}})
		return
	}

	// find by name (case-insensitive)
	for _, m := range monsters {
		n, _ := m["name"].(string)
		if n != "" && strings.EqualFold(n, name) {
			abilities := []string{}
			if arr, ok := m["abilities"].([]interface{}); ok {
				for _, it := range arr {
					switch v := it.(type) {
					case string:
						abilities = append(abilities, v)
					case map[string]interface{}:
						if s, ok := v["name"].(string); ok {
							abilities = append(abilities, s)
						} else if s2, ok := v["ability"].(map[string]interface{}); ok {
							if s3, ok := s2["name"].(string); ok {
								abilities = append(abilities, s3)
							}
						}
					}
				}
			}

			moves := []string{}
			if arr, ok := m["moves"].([]interface{}); ok {
				for _, it := range arr {
					switch v := it.(type) {
					case string:
						moves = append(moves, v)
					case map[string]interface{}:
						if s, ok := v["name"].(string); ok {
							moves = append(moves, s)
						} else if s2, ok := v["move"].(map[string]interface{}); ok {
							if s3, ok := s2["name"].(string); ok {
								moves = append(moves, s3)
							}
						}
					}
				}
			}

			json.NewEncoder(w).Encode(map[string][]string{"abilities": abilities, "moves": moves})
			return
		}
	}

	// not found
	json.NewEncoder(w).Encode(map[string][]string{"abilities": {}, "moves": {}})
}

// getSeasonName returns the season name for MongoDB queries
func (a *App) getSeasonName() string {
	seasonName := strings.ToLower(strings.ReplaceAll(a.season.SeasonName, " ", "_"))
	if a.season.Year > 0 {
		return fmt.Sprintf("%s_%d", seasonName, a.season.Year)
	}
	return seasonName
}

// seasonCode returns the canonical code for a given season
func seasonCode(s Season) string {
	name := strings.ToLower(strings.ReplaceAll(s.SeasonName, " ", "_"))
	if s.Year > 0 {
		return fmt.Sprintf("%s_%d", name, s.Year)
	}
	return name
}

func seasonLabel(s Season) string {
	if s.Year > 0 {
		return fmt.Sprintf("%s %d", s.SeasonName, s.Year)
	}
	return s.SeasonName
}

var slugNonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func slugifyName(name string) string {
	name = strings.TrimSpace(strings.ToLower(name))
	name = slugNonAlnum.ReplaceAllString(name, "_")
	name = strings.Trim(name, "_")
	name = strings.ReplaceAll(name, "__", "_")
	return name
}

// findSeasonIndexByCode finds season by code and returns index and true if found
func (a *App) findSeasonIndexByCode(code string) (int, bool) {
	for i, s := range a.seasons {
		if seasonCode(s) == code {
			return i, true
		}
	}
	return -1, false
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

// bossEditDataHandler returns monster.json and held_items.json for in-place editing
func (a *App) bossEditDataHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	monsFile, err := os.Open("data/monster.json")
	if err != nil {
		renderError(w, "Failed to open monster.json", http.StatusInternalServerError)
		return
	}
	defer monsFile.Close()
	var mons []map[string]interface{}
	if err := json.NewDecoder(monsFile).Decode(&mons); err != nil {
		renderError(w, "Failed to decode monster.json", http.StatusInternalServerError)
		return
	}

	itemsFile, err := os.Open("data/held_items.json")
	if err != nil {
		renderError(w, "Failed to open held_items.json", http.StatusInternalServerError)
		return
	}
	defer itemsFile.Close()
	var itemsRoot map[string][]string
	if err := json.NewDecoder(itemsFile).Decode(&itemsRoot); err != nil {
		renderError(w, "Failed to decode held_items.json", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"monsters": mons, "items": itemsRoot["items"]})
}

// checklistHandler returns the complete checklist data from the database
func (a *App) checklistHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Get checklist for current season and default user
	season := a.getSeasonName()
	collection := a.mongoDB.Collection("checklists")

	var doc ChecklistDocument
	err := collection.FindOne(ctx, bson.M{
		"season":  season,
		"user_id": "default",
	}).Decode(&doc)

	if err == mongo.ErrNoDocuments {
		// Return empty checklist if not found
		log.Printf("No checklist found for season: %s", season)
		json.NewEncoder(w).Encode(ChecklistResponse{Types: []PokemonType{}})
		return
	} else if err != nil {
		log.Printf("Error querying checklist: %v", err)
		http.Error(w, "Failed to fetch checklist", http.StatusInternalServerError)
		return
	}

	// Group Pokemon by type for frontend compatibility
	typeMap := make(map[string]*PokemonType)

	for _, pokemon := range doc.Pokemon {
		for _, typeName := range pokemon.Types {
			if _, exists := typeMap[typeName]; !exists {
				typeMap[typeName] = &PokemonType{
					TypeName:    typeName,
					MinRequired: 0, // Will be loaded from type_settings
					Pokemons:    []PokemonChecklistEntry{},
				}
			}

			typeMap[typeName].Pokemons = append(typeMap[typeName].Pokemons, pokemon)
			typeMap[typeName].Count++
			if pokemon.Completed {
				typeMap[typeName].Completed++
			}
		}
	}

	// Load min_required and is_pinned values from type_settings collection
	typeSettingsCollection := a.mongoDB.Collection("type_settings")
	cursor, err := typeSettingsCollection.Find(ctx, bson.M{"season": season})
	if err == nil {
		defer cursor.Close(ctx)
		var settings []TypeSettings
		if err := cursor.All(ctx, &settings); err == nil {
			for _, s := range settings {
				if pt, exists := typeMap[s.TypeName]; exists {
					pt.MinRequired = s.MinRequired
					pt.IsPinned = s.IsPinned
				}
			}
		}
	}

	// Convert map to sorted array (pinned types first, then alphabetically)
	var types []PokemonType
	for _, pt := range typeMap {
		types = append(types, *pt)
	}

	// Sort types: pinned first, then alphabetically by name
	sort.Slice(types, func(i, j int) bool {
		// If one is pinned and the other isn't, pinned comes first
		if types[i].IsPinned != types[j].IsPinned {
			return types[i].IsPinned
		}
		// Otherwise, sort alphabetically
		return types[i].TypeName < types[j].TypeName
	})

	response := ChecklistResponse{Types: types, Season: season}
	json.NewEncoder(w).Encode(response)
}

// toggleChecklistHandler toggles the completion status of a pokemon
func (a *App) toggleChecklistHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Only authenticated users (mod/author/admin) can persist to server
	role := getRoleFromRequest(r)
	if role == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Name  string `json:"name"`
		Usage string `json:"usage"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	season := a.getSeasonName()
	collection := a.mongoDB.Collection("checklists")

	// Find the pokemon and toggle completion
	var doc ChecklistDocument
	err := collection.FindOne(ctx, bson.M{
		"season":  season,
		"user_id": "default",
	}).Decode(&doc)

	if err != nil {
		log.Printf("Error finding checklist: %v", err)
		http.Error(w, "Checklist not found", http.StatusNotFound)
		return
	}

	// Find and toggle the pokemon
	found := false
	for i := range doc.Pokemon {
		if doc.Pokemon[i].Name == req.Name && doc.Pokemon[i].Usage == req.Usage {
			doc.Pokemon[i].Completed = !doc.Pokemon[i].Completed
			found = true
			break
		}
	}

	if !found {
		http.Error(w, "Pokemon not found", http.StatusNotFound)
		return
	}

	// Update the document
	doc.UpdatedAt = time.Now()
	_, err = collection.ReplaceOne(ctx,
		bson.M{
			"season":  season,
			"user_id": "default",
		},
		doc,
	)

	if err != nil {
		log.Printf("Error updating checklist: %v", err)
		http.Error(w, "Failed to update checklist", http.StatusInternalServerError)
		return
	}

	// Return the new completion status
	for i := range doc.Pokemon {
		if doc.Pokemon[i].Name == req.Name && doc.Pokemon[i].Usage == req.Usage {
			json.NewEncoder(w).Encode(map[string]bool{"completed": doc.Pokemon[i].Completed})
			return
		}
	}
}

// saveChecklistHandler saves checklist pokemon edits (admin, mod, or author)
func (a *App) saveChecklistHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if user has edit permissions
	role := getRoleFromRequest(r)
	if role != "admin" && role != "mod" && role != "author" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		Pokemon []struct {
			OldName  string `json:"old_name"`  // For matching existing pokemon
			OldUsage string `json:"old_usage"` // For matching existing pokemon
			Name     string `json:"name"`      // New name
			Usage    string `json:"usage"`     // New usage
			HeldItem string `json:"held_item"`
			Moves    string `json:"moves"`
			Notes    string `json:"notes"`
		} `json:"pokemon"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Error decoding request body: %v", err)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if len(req.Pokemon) == 0 {
		log.Printf("⚠️  WARNING: No pokemon data received in request!")
		http.Error(w, "No pokemon data provided", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	season := a.getSeasonName()
	collection := a.mongoDB.Collection("checklists")

	// Find the checklist document
	var doc ChecklistDocument
	err := collection.FindOne(ctx, bson.M{
		"season":  season,
		"user_id": "default",
	}).Decode(&doc)

	if err != nil {
		log.Printf("Error finding checklist: %v", err)
		http.Error(w, "Checklist not found", http.StatusNotFound)
		return
	}

	// Update each pokemon in the request
	for _, reqPokemon := range req.Pokemon {
		for i := range doc.Pokemon {
			// Match using OLD name and OLD usage
			if doc.Pokemon[i].Name == reqPokemon.OldName && doc.Pokemon[i].Usage == reqPokemon.OldUsage {
				// Update to NEW values
				doc.Pokemon[i].Name = reqPokemon.Name
				doc.Pokemon[i].Usage = reqPokemon.Usage
				doc.Pokemon[i].HeldItem = reqPokemon.HeldItem
				doc.Pokemon[i].Moves = reqPokemon.Moves
				doc.Pokemon[i].Notes = reqPokemon.Notes
				break
			}
		}
	}

	// Update the document
	doc.UpdatedAt = time.Now()
	_, err = collection.ReplaceOne(ctx,
		bson.M{
			"season":  season,
			"user_id": "default",
		},
		doc,
	)

	if err != nil {
		log.Printf("Error updating checklist: %v", err)
		http.Error(w, "Failed to update checklist", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// userRoleHandler returns the current user's role
func (a *App) userRoleHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	role := getRoleFromRequest(r)
	json.NewEncoder(w).Encode(map[string]string{"role": role})
}

// adminLoginHandler serves login form and handles login POST
func (a *App) adminLoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		// render simple login form
		tpl, err := pongo2.FromFile(templatesPath + "admin_login.html")
		if err != nil {
			http.Error(w, "login page not available", http.StatusInternalServerError)
			return
		}
		renderTemplate(w, tpl, pongo2.Context{})
		return
	}

	// POST: expect username+password (form or JSON)
	var username, provided string
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		username = body.Username
		provided = body.Password
	} else {
		username = r.FormValue("username")
		provided = r.FormValue("password")
	}

	if username == "" || provided == "" {
		http.Error(w, "username and password required", http.StatusBadRequest)
		return
	}

	// lookup user in adminDB (get hash and role)
	var hash, role string
	row := a.adminDB.QueryRow("SELECT password_hash, role FROM users WHERE username = ?", username)
	if err := row.Scan(&hash, &role); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := bcryptCompareHash(hash, provided); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// ensure role is admin for this path
	if role != "admin" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// successful auth, generate token with role
	token, err := generateJWT(username, role)
	if err != nil {
		http.Error(w, "failed to create token", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "auth_token",
		Value:    token,
		HttpOnly: true,
		Path:     "/",
		Expires:  time.Now().Add(24 * time.Hour),
	})
	http.Redirect(w, r, "/admin", http.StatusSeeOther)
}

// adminLogoutHandler clears auth cookie
func (a *App) adminLogoutHandler(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "auth_token",
		Value:    "",
		HttpOnly: true,
		Path:     "/",
		Expires:  time.Unix(0, 0),
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// adminPageHandler renders admin UI and requires auth
func (a *App) adminPageHandler(w http.ResponseWriter, r *http.Request) {
	if !isAuthRequest(r) {
		http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
		return
	}
	role := getRoleFromRequest(r)
	tpl, err := pongo2.FromFile(templatesPath + "admin.html")
	if err != nil {
		http.Error(w, "admin page not available", http.StatusInternalServerError)
		return
	}
	// pass all seasons with code and label for admin sidebar
	type seasonVM struct{ Code, Label string }
	var seasons []seasonVM
	for _, s := range a.seasons {
		seasons = append(seasons, seasonVM{Code: seasonCode(s), Label: seasonLabel(s)})
	}
	renderTemplate(w, tpl, pongo2.Context{"seasons": seasons, "user_role": role, "commit_hash": a.commitHash})
}

// adminRaidBossBuildHandler renders the raid boss builder page (similar to build_team.html but admin-only)
func (a *App) adminRaidBossBuildHandler(w http.ResponseWriter, r *http.Request) {
	if !isAuthRequest(r) {
		http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
		return
	}

	action := r.URL.Query().Get("action")
	season := r.URL.Query().Get("season")
	idStr := r.URL.Query().Get("id")

	if action == "" || season == "" {
		http.Error(w, "action and season required", http.StatusBadRequest)
		return
	}

	tpl, err := pongo2.FromFile(templatesPath + "admin_build_team.html")
	if err != nil {
		http.Error(w, "builder page not available", http.StatusInternalServerError)
		return
	}

	context := pongo2.Context{
		"action":             action,
		"season":             season,
		"boss_id":            "",
		"boss_name":          "",
		"stars":              3,
		"description":        "",
		"ability":            "",
		"held_item":          "",
		"speed_evs":          0,
		"base_stats_speed":   0,
		"base_stats_defense": 0,
		"base_stats_spdef":   0,
		"moves":              "[]",
		"phase_effects":      "[]",
		"variations":         "[]",
		"mode_label":         "Creating new boss",
		"raid_boss_data":     "{}",
	}

	if action == "edit" && idStr != "" {
		id, _ := strconv.Atoi(idStr)
		if id >= 0 && id < len(a.season.RaidBosses) {
			boss := a.season.RaidBosses[id]
			movesJSON, _ := json.Marshal(boss.Moves)
			phasesJSON, _ := json.Marshal(boss.PhaseEffects)
			variationsJSON, _ := json.Marshal(boss.Variations)

			// Marshal the full boss object for the raid-boss-data JSON blob
			bossDataJSON, _ := json.Marshal(map[string]interface{}{
				"id":            id,
				"name":          boss.Name,
				"stars":         boss.Stars,
				"description":   boss.Description,
				"ability":       boss.Ability,
				"held_item":     boss.HeldItem,
				"speed_evs":     boss.SpeedEVs,
				"base_stats":    boss.BaseStats,
				"moves":         boss.Moves,
				"phase_effects": boss.PhaseEffects,
				"variations":    boss.Variations,
			})

			context["boss_id"] = id
			context["boss_name"] = boss.Name
			context["stars"] = boss.Stars
			context["description"] = boss.Description
			context["ability"] = boss.Ability
			context["held_item"] = boss.HeldItem
			context["speed_evs"] = boss.SpeedEVs
			context["base_stats_speed"] = boss.BaseStats.Speed
			context["base_stats_defense"] = boss.BaseStats.Def
			context["base_stats_spdef"] = boss.BaseStats.SpDef
			context["moves"] = string(movesJSON)
			context["phase_effects"] = string(phasesJSON)
			context["variations"] = string(variationsJSON)
			context["raid_boss_data"] = string(bossDataJSON)
			context["mode_label"] = fmt.Sprintf("Editing: %s", boss.Name)
		}
	}

	renderTemplate(w, tpl, context)
}

// adminUsersHandler provides CRUD API for admin users (requires admin)
func (a *App) adminUsersHandler(w http.ResponseWriter, r *http.Request) {
	role := getRoleFromRequest(r)
	if role == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case http.MethodGet:
		if role != "admin" && role != "mod" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		rows, err := a.adminDB.Query("SELECT id, username, role, created_at FROM users ORDER BY username")
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		out := []map[string]interface{}{}
		for rows.Next() {
			var id int
			var username, role, created string
			if err := rows.Scan(&id, &username, &role, &created); err != nil {
				continue
			}
			out = append(out, map[string]interface{}{"id": id, "username": username, "role": role, "created_at": created})
		}
		json.NewEncoder(w).Encode(out)
	case http.MethodPost:
		// only admin may create admin users
		if role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var payload struct{ Username, Password, Role string }
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if payload.Username == "" || payload.Role == "" {
			http.Error(w, "missing fields", http.StatusBadRequest)
			return
		}
		// If no password provided, generate a random one
		password := payload.Password
		if password == "" {
			password = generateRandomPassword(12)
		}
		hash, _ := bcryptGenerateHash(password)
		_, err := a.adminDB.Exec("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", payload.Username, hash, payload.Role)
		if err != nil {
			http.Error(w, "db insert failed", http.StatusInternalServerError)
			return
		}
		// Return the generated password if it was generated
		resp := map[string]string{"status": "created"}
		if payload.Password == "" {
			resp["generated_password"] = password
		}
		json.NewEncoder(w).Encode(resp)

	case http.MethodPut:
		// only admin may update admin users
		if role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var payload struct {
			ID       int
			Password string
			Role     string
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if payload.Password != "" {
			hash, _ := bcryptGenerateHash(payload.Password)
			if _, err := a.adminDB.Exec("UPDATE users SET password_hash = ?, role = ? WHERE id = ?", hash, payload.Role, payload.ID); err != nil {
				http.Error(w, "db update failed", http.StatusInternalServerError)
				return
			}
		} else {
			if _, err := a.adminDB.Exec("UPDATE users SET role = ? WHERE id = ?", payload.Role, payload.ID); err != nil {
				http.Error(w, "db update failed", http.StatusInternalServerError)
				return
			}
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	case http.MethodDelete:
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			http.Error(w, "id required", http.StatusBadRequest)
			return
		}
		id, _ := strconv.Atoi(idStr)
		if _, err := a.adminDB.Exec("DELETE FROM users WHERE id = ?", id); err != nil {
			http.Error(w, "db delete failed", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// authLoginHandler handles login for authors/mods (and admins if needed)
func (a *App) authLoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		tpl, err := pongo2.FromFile(templatesPath + "auth_login.html")
		if err != nil {
			http.Error(w, "login page not available", http.StatusInternalServerError)
			return
		}
		renderTemplate(w, tpl, pongo2.Context{"commit_hash": a.commitHash})
		return
	}
	// POST
	username := r.FormValue("username")
	password := r.FormValue("password")
	if username == "" || password == "" {
		http.Error(w, "username and password required", http.StatusBadRequest)
		return
	}
	var hash, role string
	row := a.adminDB.QueryRow("SELECT password_hash, role FROM users WHERE username = ?", username)
	if err := row.Scan(&hash, &role); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := bcryptCompareHash(hash, password); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// allow roles author/mod/admin
	if role != "author" && role != "mod" && role != "admin" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	token, err := generateJWT(username, role)
	if err != nil {
		http.Error(w, "failed to create token", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "auth_token", Value: token, HttpOnly: true, Path: "/", Expires: time.Now().Add(24 * time.Hour)})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// authResetRequestHandler handles initiating a password reset by generating a token
// Forbidden for admin users (only master admin may reset admin accounts)
func (a *App) authResetRequestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	username := strings.TrimSpace(r.FormValue("username"))
	email := strings.TrimSpace(r.FormValue("email"))
	if username == "" || email == "" {
		http.Error(w, "username and email required", http.StatusBadRequest)
		return
	}
	var role string
	row := a.adminDB.QueryRow("SELECT role FROM users WHERE username = ?", username)
	if err := row.Scan(&role); err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if role == "admin" {
		http.Error(w, "reset forbidden for admin users", http.StatusForbidden)
		return
	}
	// generate token
	token := generateRandomPassword(32)
	expires := time.Now().Add(1 * time.Hour).Unix()
	if _, err := a.adminDB.Exec("INSERT INTO password_resets (username, token, expires_at) VALUES (?, ?, ?)", username, token, expires); err != nil {
		http.Error(w, "failed to create reset token", http.StatusInternalServerError)
		return
	}
	// build reset URL
	host := r.Host
	scheme := "https"
	if strings.HasPrefix(host, "localhost") || strings.HasPrefix(host, "127.0.0.1") {
		scheme = "http"
	}
	resetURL := fmt.Sprintf("%s://%s/auth/reset?token=%s", scheme, host, token)
	// log.Printf("Password reset link for %s → %s (email to: %s)", username, resetURL, email)

	// Send email
	if err := sendResetEmail(email, username, resetURL); err != nil {
		log.Printf("Failed to send reset email to %s: %v", email, err)
		// Still return success to avoid leaking whether email exists
		// but log the error for debugging
	}

	// Respond with success (do not leak the token or email status)
	if strings.Contains(r.Header.Get("Accept"), "application/json") {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "sent"})
		return
	}

	// Default: render a simple status page
	ctx := pongo2.Context{
		"message": "If the account exists and is eligible, a reset link has been sent to the email provided.",
	}
	renderTemplate(w, a.templates["auth_reset_sent.html"], ctx)
}

// authChangePasswordHandler allows a logged-in user to change password without email
func (a *App) authChangePasswordHandler(w http.ResponseWriter, r *http.Request) {
	if !isAuthRequest(r) {
		http.Redirect(w, r, "/auth/login", http.StatusSeeOther)
		return
	}
	username := getUsernameFromRequest(r)
	role := getRoleFromRequest(r)
	if username == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		renderTemplate(w, a.templates["auth_change_password.html"], pongo2.Context{"user_role": role, "commit_hash": a.commitHash})
	case http.MethodPost:
		current := strings.TrimSpace(r.FormValue("current_password"))
		newPass := strings.TrimSpace(r.FormValue("new_password"))
		confirm := strings.TrimSpace(r.FormValue("confirm_password"))

		if current == "" || newPass == "" || confirm == "" {
			renderTemplate(w, a.templates["auth_change_password.html"], pongo2.Context{
				"user_role":   role,
				"commit_hash": a.commitHash,
				"error":       "All fields are required.",
			})
			return
		}
		if newPass != confirm {
			renderTemplate(w, a.templates["auth_change_password.html"], pongo2.Context{
				"user_role":   role,
				"commit_hash": a.commitHash,
				"error":       "New passwords do not match.",
			})
			return
		}
		if len(newPass) < 8 {
			renderTemplate(w, a.templates["auth_change_password.html"], pongo2.Context{
				"user_role":   role,
				"commit_hash": a.commitHash,
				"error":       "New password must be at least 8 characters.",
			})
			return
		}

		var hash string
		row := a.adminDB.QueryRow("SELECT password_hash FROM users WHERE username = ?", username)
		if err := row.Scan(&hash); err != nil {
			http.Error(w, "user not found", http.StatusUnauthorized)
			return
		}
		if err := bcryptCompareHash(hash, current); err != nil {
			renderTemplate(w, a.templates["auth_change_password.html"], pongo2.Context{
				"user_role":   role,
				"commit_hash": a.commitHash,
				"error":       "Current password is incorrect.",
			})
			return
		}

		newHash, err := bcryptGenerateHash(newPass)
		if err != nil {
			http.Error(w, "failed to hash password", http.StatusInternalServerError)
			return
		}
		if _, err := a.adminDB.Exec("UPDATE users SET password_hash = ? WHERE username = ?", newHash, username); err != nil {
			http.Error(w, "failed to update password", http.StatusInternalServerError)
			return
		}

		token, err := generateJWT(username, role)
		if err == nil {
			http.SetCookie(w, &http.Cookie{Name: "auth_token", Value: token, HttpOnly: true, Path: "/", Expires: time.Now().Add(24 * time.Hour)})
		}

		renderTemplate(w, a.templates["auth_change_password.html"], pongo2.Context{
			"user_role":   role,
			"commit_hash": a.commitHash,
			"success":     "Password updated successfully.",
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// authResetHandler serves the reset page (GET) and completes reset (POST)
func (a *App) authResetHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "token required", http.StatusBadRequest)
			return
		}
		// Validate token exists and hasn't expired
		var username string
		var expires int64
		row := a.adminDB.QueryRow("SELECT username, expires_at FROM password_resets WHERE token = ?", token)
		if err := row.Scan(&username, &expires); err != nil {
			http.Error(w, "invalid or expired reset token", http.StatusBadRequest)
			return
		}
		if time.Now().Unix() > expires {
			http.Error(w, "reset token has expired", http.StatusBadRequest)
			return
		}
		tpl, err := pongo2.FromFile(templatesPath + "auth_reset.html")
		if err != nil {
			http.Error(w, "reset page not available", http.StatusInternalServerError)
			return
		}
		renderTemplate(w, tpl, pongo2.Context{"token": token, "commit_hash": a.commitHash})
	case http.MethodPost:
		token := strings.TrimSpace(r.FormValue("token"))
		newPassword := strings.TrimSpace(r.FormValue("new_password"))
		if token == "" || newPassword == "" {
			tpl, _ := pongo2.FromFile(templatesPath + "auth_reset.html")
			renderTemplate(w, tpl, pongo2.Context{"token": token, "commit_hash": a.commitHash, "error": "Token and password are required"})
			return
		}
		if len(newPassword) < 8 {
			tpl, _ := pongo2.FromFile(templatesPath + "auth_reset.html")
			renderTemplate(w, tpl, pongo2.Context{"token": token, "commit_hash": a.commitHash, "error": "Password must be at least 8 characters"})
			return
		}
		var username string
		var expires int64
		row := a.adminDB.QueryRow("SELECT username, expires_at FROM password_resets WHERE token = ?", token)
		if err := row.Scan(&username, &expires); err != nil {
			tpl, _ := pongo2.FromFile(templatesPath + "auth_reset.html")
			renderTemplate(w, tpl, pongo2.Context{"token": token, "commit_hash": a.commitHash, "error": "Invalid or already used reset token"})
			return
		}
		if time.Now().Unix() > expires {
			tpl, _ := pongo2.FromFile(templatesPath + "auth_reset.html")
			renderTemplate(w, tpl, pongo2.Context{"token": token, "commit_hash": a.commitHash, "error": "Reset token has expired. Please request a new one."})
			return
		}
		// Update password
		hash, err := bcryptGenerateHash(newPassword)
		if err != nil {
			tpl, _ := pongo2.FromFile(templatesPath + "auth_reset.html")
			renderTemplate(w, tpl, pongo2.Context{"token": token, "commit_hash": a.commitHash, "error": "Failed to process password"})
			return
		}
		if _, err := a.adminDB.Exec("UPDATE users SET password_hash = ? WHERE username = ?", hash, username); err != nil {
			tpl, _ := pongo2.FromFile(templatesPath + "auth_reset.html")
			renderTemplate(w, tpl, pongo2.Context{"token": token, "commit_hash": a.commitHash, "error": "Failed to update password"})
			return
		}
		// Clean up token
		_, _ = a.adminDB.Exec("DELETE FROM password_resets WHERE token = ?", token)
		// Redirect to login
		http.Redirect(w, r, "/auth/login", http.StatusSeeOther)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// authLogoutHandler clears auth cookie for authors/mods
func (a *App) authLogoutHandler(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "auth_token", Value: "", HttpOnly: true, Path: "/", Expires: time.Unix(0, 0)})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// saveVariationHandler handles saving variation data (creates new or updates existing)
func (a *App) saveVariationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Only authenticated users can save
	role := getRoleFromRequest(r)
	if role == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		BossName        string              `json:"boss_name"`
		VariationIndex  int                 `json:"variation_index"`
		Players         map[string][]Player `json:"players"`
		HealthRemaining []float64           `json:"health_remaining"`
		Notes           []string            `json:"notes"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Find the boss
	boss := a.findBoss(req.BossName)
	if boss == nil {
		http.Error(w, "boss not found", http.StatusNotFound)
		return
	}

	// Check if this is an update or a new variation
	if req.VariationIndex >= 0 && req.VariationIndex < len(boss.Variations) {
		// Update existing variation at the specified index - replace entire variation
		updatedVariation := Variation{
			Index:           boss.Variations[req.VariationIndex].Index,
			Index0:          req.VariationIndex,
			Players:         req.Players,
			HealthRemaining: req.HealthRemaining,
			Notes:           req.Notes,
		}
		updatedVariation.TableHTML = a.buildVariationTable(&updatedVariation)
		boss.Variations[req.VariationIndex] = updatedVariation
	} else {
		// Create new variation only if index is not provided or invalid
		newVariation := Variation{
			Index:           len(boss.Variations) + 1,
			Index0:          len(boss.Variations),
			Players:         req.Players,
			HealthRemaining: req.HealthRemaining,
			Notes:           req.Notes,
		}

		// Build the HTML table for this variation
		newVariation.TableHTML = a.buildVariationTable(&newVariation)

		// Append to boss variations
		boss.Variations = append(boss.Variations, newVariation)
	}

	// Save to bosses.json
	if err := a.saveBossesJSON(); err != nil {
		http.Error(w, "failed to save changes", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// adminTypesHandler returns all unique types from the checklist Pokemon for a season
func (a *App) adminTypesHandler(w http.ResponseWriter, r *http.Request) {
	role := getRoleFromRequest(r)
	if role == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	season := r.URL.Query().Get("season")
	if season == "" {
		json.NewEncoder(w).Encode([]map[string]interface{}{})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	collection := a.mongoDB.Collection("checklists")
	var doc ChecklistDocument
	err := collection.FindOne(ctx, bson.M{
		"season":  season,
		"user_id": "default",
	}).Decode(&doc)

	if err == mongo.ErrNoDocuments {
		json.NewEncoder(w).Encode([]map[string]interface{}{})
		return
	} else if err != nil {
		http.Error(w, "Failed to fetch checklist", http.StatusInternalServerError)
		return
	}

	// Extract unique types from Pokemon
	typeMap := make(map[string]*PokemonType)
	for _, pokemon := range doc.Pokemon {
		for _, typeName := range pokemon.Types {
			if _, exists := typeMap[typeName]; !exists {
				typeMap[typeName] = &PokemonType{
					TypeName:    typeName,
					MinRequired: 0, // Can be extended later
					Pokemons:    []PokemonChecklistEntry{},
				}
			}
			typeMap[typeName].Count++
		}
	}

	// Convert to array for frontend
	types := []map[string]interface{}{}
	for _, pt := range typeMap {
		types = append(types, map[string]interface{}{
			"type_name":    pt.TypeName,
			"min_required": pt.MinRequired,
			"count":        pt.Count,
		})
	}

	json.NewEncoder(w).Encode(types)
}

// adminPokemonHandler handles CRUD operations for checklist Pokemon
func (a *App) adminPokemonHandler(w http.ResponseWriter, r *http.Request) {
	role := getRoleFromRequest(r)
	if role == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	season := r.URL.Query().Get("season")
	if season == "" {
		http.Error(w, "season required", http.StatusBadRequest)
		return
	}
	// find target season by code
	var target *Season
	for i := range a.seasons {
		code := strings.ToLower(strings.ReplaceAll(a.seasons[i].SeasonName, " ", "_"))
		if a.seasons[i].Year > 0 {
			code = fmt.Sprintf("%s_%d", code, a.seasons[i].Year)
		}
		if strings.EqualFold(season, code) {
			target = &a.seasons[i]
			break
		}
	}
	if target == nil {
		http.Error(w, "season not found", http.StatusNotFound)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	collection := a.mongoDB.Collection("checklists")

	switch r.Method {
	case http.MethodGet:
		// Return all Pokemon in the checklist
		var doc ChecklistDocument
		err := collection.FindOne(ctx, bson.M{
			"season":  season,
			"user_id": "default",
		}).Decode(&doc)

		if err == mongo.ErrNoDocuments {
			json.NewEncoder(w).Encode([]PokemonChecklistEntry{})
			return
		} else if err != nil {
			http.Error(w, "Failed to fetch checklist", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(doc.Pokemon)

	case http.MethodPost:
		// Add new Pokemon
		if role != "admin" && role != "mod" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		var newPokemon PokemonChecklistEntry
		if err := json.NewDecoder(r.Body).Decode(&newPokemon); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// Add to Pokemon array
		_, err := collection.UpdateOne(
			ctx,
			bson.M{"season": season, "user_id": "default"},
			bson.M{"$push": bson.M{"pokemon": newPokemon}},
			options.Update().SetUpsert(true),
		)

		if err != nil {
			log.Printf("Error adding Pokemon: %v", err)
			http.Error(w, "Failed to add Pokemon", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]string{"status": "success"})

	case http.MethodPut:
		// Update existing Pokemon
		if role != "admin" && role != "mod" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		var updateData struct {
			OldName  string                `json:"old_name"`
			OldUsage string                `json:"old_usage"`
			Pokemon  PokemonChecklistEntry `json:"pokemon"`
		}

		if err := json.NewDecoder(r.Body).Decode(&updateData); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// Find and update Pokemon by name+usage composite key
		result, err := collection.UpdateOne(
			ctx,
			bson.M{
				"season":        season,
				"user_id":       "default",
				"pokemon.name":  updateData.OldName,
				"pokemon.usage": updateData.OldUsage,
			},
			bson.M{"$set": bson.M{"pokemon.$": updateData.Pokemon}},
		)

		if err != nil {
			log.Printf("Error updating Pokemon: %v", err)
			http.Error(w, "Failed to update Pokemon", http.StatusInternalServerError)
			return
		}

		// Check if any document was modified
		if result.ModifiedCount == 0 {
			log.Printf("Warning: No Pokemon updated. OldName=%s, OldUsage=%s, Season=%s", updateData.OldName, updateData.OldUsage, season)
			http.Error(w, "Pokemon not found to update", http.StatusNotFound)
			return
		}

		json.NewEncoder(w).Encode(map[string]string{"status": "success"})

	case http.MethodDelete:
		// Delete Pokemon
		if role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		pokemonName := r.URL.Query().Get("name")
		pokemonUsage := r.URL.Query().Get("usage")

		if pokemonName == "" || pokemonUsage == "" {
			http.Error(w, "name and usage required", http.StatusBadRequest)
			return
		}

		// Remove from Pokemon array
		_, err := collection.UpdateOne(
			ctx,
			bson.M{"season": season, "user_id": "default"},
			bson.M{"$pull": bson.M{"pokemon": bson.M{"name": pokemonName, "usage": pokemonUsage}}},
		)

		if err != nil {
			log.Printf("Error deleting Pokemon: %v", err)
			http.Error(w, "Failed to delete Pokemon", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]string{"status": "success"})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// adminExtrasHandler returns monster.json and held_items.json for dropdowns
func (a *App) adminExtrasHandler(w http.ResponseWriter, r *http.Request) {
	role := getRoleFromRequest(r)
	if role == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	monsFile, err := os.Open("data/monster.json")
	if err != nil {
		http.Error(w, "failed to open monsters", http.StatusInternalServerError)
		return
	}
	defer monsFile.Close()
	var mons []map[string]interface{}
	if err := json.NewDecoder(monsFile).Decode(&mons); err != nil {
		http.Error(w, "failed to decode monsters", http.StatusInternalServerError)
		return
	}

	itemsFile, err := os.Open("data/held_items.json")
	if err != nil {
		http.Error(w, "failed to open items", http.StatusInternalServerError)
		return
	}
	defer itemsFile.Close()
	var itemsRoot map[string][]string
	if err := json.NewDecoder(itemsFile).Decode(&itemsRoot); err != nil {
		http.Error(w, "failed to decode items", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"monsters": mons, "items": itemsRoot["items"]})
}

// adminRaidBossesHandler handles CRUD for raid bosses, loading from and persisting to bosses.json
func (a *App) adminRaidBossesHandler(w http.ResponseWriter, r *http.Request) {
	role := getRoleFromRequest(r)
	if role == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	season := r.URL.Query().Get("season")
	if season == "" {
		http.Error(w, "season required", http.StatusBadRequest)
		return
	}

	// find target season by code
	idx, ok := a.findSeasonIndexByCode(season)
	if !ok {
		http.Error(w, "season not found", http.StatusNotFound)
		return
	}
	target := &a.seasons[idx]

	switch r.Method {
	case http.MethodGet:
		// Return raid bosses from in-memory season data
		bosses := []map[string]interface{}{}
		for i, boss := range target.RaidBosses {
			movesJSON, _ := json.Marshal(boss.Moves)
			phasesJSON, _ := json.Marshal(boss.PhaseEffects)
			variationsJSON, _ := json.Marshal(boss.Variations)
			bosses = append(bosses, map[string]interface{}{
				"id":            i, // Use index as ID
				"boss_name":     boss.Name,
				"stars":         boss.Stars,
				"description":   boss.Description,
				"ability":       boss.Ability,
				"held_item":     boss.HeldItem,
				"speed_evs":     boss.SpeedEVs,
				"base_stats":    boss.BaseStats,
				"moves":         string(movesJSON),
				"phase_effects": string(phasesJSON),
				"variations":    string(variationsJSON),
			})
		}
		json.NewEncoder(w).Encode(bosses)

	case http.MethodPost:
		// allow CRU for admin/mod/author on JSONs
		if role != "admin" && role != "mod" && role != "author" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var payload struct {
			BossName     string          `json:"boss_name"`
			Stars        int             `json:"stars"`
			Description  string          `json:"description"`
			Ability      string          `json:"ability"`
			HeldItem     string          `json:"held_item"`
			SpeedEVs     int             `json:"speed_evs"`
			BaseStats    BaseStats       `json:"base_stats"`
			Moves        json.RawMessage `json:"moves"`
			PhaseEffects json.RawMessage `json:"phase_effects"`
			Variations   json.RawMessage `json:"variations"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if payload.BossName == "" {
			http.Error(w, "boss_name required", http.StatusBadRequest)
			return
		}

		// Parse moves
		var moves []RaidBossMove
		if err := json.Unmarshal(payload.Moves, &moves); err != nil {
			moves = []RaidBossMove{}
		}
		// Parse phase effects
		var phases []PhaseEffect
		if err := json.Unmarshal(payload.PhaseEffects, &phases); err != nil {
			phases = []PhaseEffect{}
		}
		// Parse variations
		var variations []Variation
		if err := json.Unmarshal(payload.Variations, &variations); err != nil {
			variations = []Variation{}
		}

		newBoss := RaidBoss{
			Name:         payload.BossName,
			Stars:        payload.Stars,
			Description:  payload.Description,
			Ability:      payload.Ability,
			HeldItem:     payload.HeldItem,
			SpeedEVs:     payload.SpeedEVs,
			BaseStats:    payload.BaseStats,
			Moves:        moves,
			PhaseEffects: phases,
			Variations:   variations,
		}
		target.RaidBosses = append(target.RaidBosses, newBoss)
		if err := a.saveBossesJSON(); err != nil {
			http.Error(w, "failed to save bosses", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "created"})

	case http.MethodPut:
		// allow CRU for admin/mod/author on JSONs
		if role != "admin" && role != "mod" && role != "author" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var payload struct {
			ID           int             `json:"id"`
			BossName     string          `json:"boss_name"`
			Stars        int             `json:"stars"`
			Description  string          `json:"description"`
			Ability      string          `json:"ability"`
			HeldItem     string          `json:"held_item"`
			SpeedEVs     int             `json:"speed_evs"`
			BaseStats    BaseStats       `json:"base_stats"`
			Moves        json.RawMessage `json:"moves"`
			PhaseEffects json.RawMessage `json:"phase_effects"`
			Variations   json.RawMessage `json:"variations"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if payload.ID < 0 || payload.ID >= len(target.RaidBosses) {
			http.Error(w, "boss not found", http.StatusNotFound)
			return
		}

		// Parse moves
		var moves []RaidBossMove
		if err := json.Unmarshal(payload.Moves, &moves); err != nil {
			moves = []RaidBossMove{}
		}
		// Parse phase effects
		var phases []PhaseEffect
		if err := json.Unmarshal(payload.PhaseEffects, &phases); err != nil {
			phases = []PhaseEffect{}
		}
		// Parse variations
		var variations []Variation
		if err := json.Unmarshal(payload.Variations, &variations); err != nil {
			variations = []Variation{}
		}

		target.RaidBosses[payload.ID] = RaidBoss{
			Name:         payload.BossName,
			Stars:        payload.Stars,
			Description:  payload.Description,
			Ability:      payload.Ability,
			HeldItem:     payload.HeldItem,
			SpeedEVs:     payload.SpeedEVs,
			BaseStats:    payload.BaseStats,
			Moves:        moves,
			PhaseEffects: phases,
			Variations:   variations,
		}
		if err := a.saveBossesJSON(); err != nil {
			http.Error(w, "failed to save bosses", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "updated"})

	case http.MethodDelete:
		// only admin may delete JSON bosses
		if role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		idStr := r.URL.Query().Get("id")
		if idStr == "" {
			http.Error(w, "id required", http.StatusBadRequest)
			return
		}
		id, _ := strconv.Atoi(idStr)
		if id < 0 || id >= len(target.RaidBosses) {
			http.Error(w, "boss not found", http.StatusNotFound)
			return
		}
		target.RaidBosses = append(target.RaidBosses[:id], target.RaidBosses[id+1:]...)
		if err := a.saveBossesJSON(); err != nil {
			http.Error(w, "failed to save bosses", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// adminSeasonsHandler manages CRUD for seasons (admin only)
func (a *App) adminSeasonsHandler(w http.ResponseWriter, r *http.Request) {
	role := getRoleFromRequest(r)
	if role == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodGet && role != "admin" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	buildList := func() []map[string]interface{} {
		out := make([]map[string]interface{}, 0, len(a.seasons))
		for _, s := range a.seasons {
			out = append(out, map[string]interface{}{
				"code":  seasonCode(s),
				"label": seasonLabel(s),
				"name":  s.SeasonName,
				"year":  s.Year,
			})
		}
		return out
	}

	switch r.Method {
	case http.MethodGet:
		json.NewEncoder(w).Encode(buildList())
		return

	case http.MethodPost:
		var payload struct {
			Name string `json:"name"`
			Year int    `json:"year"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		name := strings.TrimSpace(payload.Name)
		if name == "" || payload.Year <= 0 {
			http.Error(w, "name and positive year required", http.StatusBadRequest)
			return
		}
		code := seasonCode(Season{SeasonName: name, Year: payload.Year})
		slug := slugifyName(name)
		if slug == "" {
			http.Error(w, "invalid name", http.StatusBadRequest)
			return
		}
		code = fmt.Sprintf("%s_%d", slug, payload.Year)
		if _, exists := a.findSeasonIndexByCode(code); exists {
			http.Error(w, "season already exists", http.StatusConflict)
			return
		}
		newSeason := Season{SeasonName: name, Year: payload.Year, RaidBosses: []RaidBoss{}}
		a.seasons = append(a.seasons, newSeason)
		if len(a.seasons) == 1 {
			a.season = newSeason
			a.preprocessVariations()
		}
		if err := a.saveBossesJSON(); err != nil {
			http.Error(w, "failed to save", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "created", "code": code, "seasons": buildList()})
		return

	case http.MethodPut:
		var payload struct {
			OriginalCode string `json:"original_code"`
			Name         string `json:"name"`
			Year         int    `json:"year"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		payload.Name = strings.TrimSpace(payload.Name)
		if payload.OriginalCode == "" || payload.Name == "" || payload.Year <= 0 {
			http.Error(w, "original_code, name and positive year required", http.StatusBadRequest)
			return
		}
		idx, ok := a.findSeasonIndexByCode(payload.OriginalCode)
		if !ok {
			http.Error(w, "season not found", http.StatusNotFound)
			return
		}
		slug := slugifyName(payload.Name)
		if slug == "" {
			http.Error(w, "invalid name", http.StatusBadRequest)
			return
		}
		newCode := fmt.Sprintf("%s_%d", slug, payload.Year)
		for i, s := range a.seasons {
			if i == idx {
				continue
			}
			if seasonCode(s) == newCode {
				http.Error(w, "season already exists", http.StatusConflict)
				return
			}
		}
		// preserve raid bosses while updating metadata
		s := a.seasons[idx]
		s.SeasonName = payload.Name
		s.Year = payload.Year
		a.seasons[idx] = s

		// update in-memory current and default season pointers
		if seasonCode(a.season) == payload.OriginalCode {
			a.season = s
			a.preprocessVariations()
		}
		if a.defaultSeason == payload.OriginalCode {
			a.defaultSeason = newCode
			_, _ = a.adminDB.Exec("INSERT INTO settings(key,value) VALUES('default_season',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", newCode)
		}

		if err := a.saveBossesJSON(); err != nil {
			http.Error(w, "failed to save", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "updated", "code": newCode, "seasons": buildList()})
		return

	case http.MethodDelete:
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "code required", http.StatusBadRequest)
			return
		}
		idx, ok := a.findSeasonIndexByCode(code)
		if !ok {
			http.Error(w, "season not found", http.StatusNotFound)
			return
		}
		// remove from slice
		removed := a.seasons[idx]
		a.seasons = append(a.seasons[:idx], a.seasons[idx+1:]...)

		// adjust current season if needed
		if seasonCode(a.season) == code {
			if len(a.seasons) > 0 {
				a.season = a.seasons[0]
				a.preprocessVariations()
			} else {
				a.season = Season{}
			}
		}

		// clear default season if deleted
		if a.defaultSeason == code {
			a.defaultSeason = ""
			_, _ = a.adminDB.Exec("DELETE FROM settings WHERE key='default_season'")
		}

		if err := a.saveBossesJSON(); err != nil {
			http.Error(w, "failed to save", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"status": "deleted", "removed": seasonLabel(removed), "seasons": buildList()})
		return

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// saveBossesJSON writes the seasons data back to bosses.json
func (a *App) saveBossesJSON() error {
	file, err := os.OpenFile(dataPath, os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(a.seasons)
}

// adminDefaultSeasonHandler gets/sets the default season for public view (admin only)
func (a *App) adminDefaultSeasonHandler(w http.ResponseWriter, r *http.Request) {
	role := getRoleFromRequest(r)
	if role != "admin" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		json.NewEncoder(w).Encode(map[string]string{"season": a.defaultSeason})
		return
	case http.MethodPost:
		var payload struct {
			Season string `json:"season"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.Season == "" {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if _, ok := a.findSeasonIndexByCode(payload.Season); !ok {
			http.Error(w, "season not found", http.StatusNotFound)
			return
		}
		// upsert setting
		_, err := a.adminDB.Exec("INSERT INTO settings(key,value) VALUES('default_season',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", payload.Season)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		a.defaultSeason = payload.Season
		if idx, ok := a.findSeasonIndexByCode(payload.Season); ok {
			a.season = a.seasons[idx]
			a.preprocessVariations()
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// adminTypeSettingsHandler handles GET/POST for type settings (min_required per type)
func (a *App) adminTypeSettingsHandler(w http.ResponseWriter, r *http.Request) {
	role := getRoleFromRequest(r)
	if role != "admin" && role != "mod" && role != "author" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	season := r.URL.Query().Get("season")
	if season == "" {
		// Use current season if not specified
		season = a.getSeasonName()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	collection := a.mongoDB.Collection("type_settings")

	switch r.Method {
	case http.MethodGet:
		// Fetch all type settings for the season
		cursor, err := collection.Find(ctx, bson.M{"season": season})
		if err != nil {
			http.Error(w, "Failed to fetch type settings", http.StatusInternalServerError)
			return
		}
		defer cursor.Close(ctx)

		var settings []TypeSettings
		if err := cursor.All(ctx, &settings); err != nil {
			http.Error(w, "Failed to decode type settings", http.StatusInternalServerError)
			return
		}

		// Return as map for easy lookup by frontend
		result := make(map[string]map[string]interface{})
		for _, s := range settings {
			result[s.TypeName] = map[string]interface{}{
				"min_required": s.MinRequired,
				"is_pinned":    s.IsPinned,
			}
		}

		json.NewEncoder(w).Encode(result)

	case http.MethodPost:
		// Update or insert type setting
		var req struct {
			TypeName    string `json:"type_name"`
			MinRequired int    `json:"min_required"`
			IsPinned    bool   `json:"is_pinned"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		if req.TypeName == "" {
			http.Error(w, "type_name is required", http.StatusBadRequest)
			return
		}

		// Upsert the type setting
		filter := bson.M{
			"season":    season,
			"type_name": req.TypeName,
		}

		update := bson.M{
			"$set": bson.M{
				"season":       season,
				"type_name":    req.TypeName,
				"min_required": req.MinRequired,
				"is_pinned":    req.IsPinned,
				"updated_at":   time.Now(),
			},
		}

		opts := options.Update().SetUpsert(true)
		_, err := collection.UpdateOne(ctx, filter, update, opts)

		if err != nil {
			log.Printf("Error updating type setting: %v", err)
			http.Error(w, "Failed to update type setting", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]string{"status": "success"})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// renderTemplate renders a template with given context
func renderTemplate(w http.ResponseWriter, tpl *pongo2.Template, ctx pongo2.Context) {
	if tpl == nil {
		renderError(w, "Template not found", http.StatusInternalServerError)
		return
	}

	html, err := tpl.Execute(ctx)
	if err != nil {
		// Log detailed template error for debugging
		log.Printf("Template execution error: %v", err)
		// Also include the error message in the response to aid debugging in development
		http.Error(w, fmt.Sprintf("Template rendering failed: %v", err), http.StatusInternalServerError)
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
