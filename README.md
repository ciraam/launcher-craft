# Craft.ro

Launcher desktop Windows natif (Tauri v2, Rust, React, TypeScript) permettant de centraliser, télécharger, vérifier, mettre à jour et lancer des applications distribuées via **GitHub Releases** (dépôts publics et privés).

---

## Fonctionnalités

- **Synchronisation GitHub Releases** : récupération de la dernière release (`/releases/latest`), comparaison SemVer automatique, affichage des notes de version en Markdown et cache HTTP `ETag` (`304 Not Modified`) pour préserver le quota API.
- **Installation et mise à jour en un clic** : téléchargement en streaming avec progression en temps réel (débit, pourcentage, ETA, annulation), extraction `.zip`, exécution d'installeurs `.msi` / `.exe` et gestion d'exécutables portables.
- **Catalogue modulaire (`registry.json`)** : catalogue embarqué extensible via un fichier distant HTTPS et ajout de dépôts GitHub personnalisés directement depuis l'interface.
- **Navigation rapide** : filtrage par état (*Découvrir*, *Installées*, *Mises à jour*), par catégorie et palette de commandes instantanée (`Ctrl+K`).

---

## Sécurité et fiabilité

Craft.ro implémente une défense en profondeur au niveau du backend Rust :

- **Gestion des secrets** : le Personal Access Token (PAT) GitHub est stocké exclusivement dans le **Gestionnaire d'identifiants Windows** (`keyring`). Il n'est jamais écrit dans `state.json` ni exposé au frontend.
- **Intégrité des binaires (SHA-256)** : calcul SHA-256 à la volée pendant le téléchargement et vérification automatique contre l'empreinte du catalogue, le champ `digest` de l'API GitHub ou un fichier `.sha256` / `SHA256SUMS` compagnon. Un mode strict optionnel (*Exiger une empreinte SHA-256*) rejette tout binaire sans empreinte vérifiable.
- **Protection réseau (anti-SSRF & DNS Rebinding)** : HTTPS obligatoire, résolution DNS préalable rejetant les adresses privées/loopback/link-local/CGNAT, validation à chaque saut de redirection (max 5) et restriction de l'en-tête `Authorization` aux seuls hôtes GitHub de confiance.
- **Confinement système** : validation stricte des identifiants et noms de dépôts, protection Zip-Slip (`enclosed_name`) et Zip-Bomb (1,5 Go / 10 000 fichiers max), vérification canonique des chemins (`canonicalize`) avant lancement, ouverture de dossier ou désinstallation, et détection des binaires verrouillés par un processus actif.
- **WebView durcie** : Content Security Policy (CSP) stricte activée dans `tauri.conf.json`.

---

## Installation et utilisation

### Prérequis

- **Windows 10 / 11 (x64)**
- **Microsoft Edge WebView2 Runtime** (préinstallé sur Windows 11 et la majorité des systèmes Windows 10)

### Formats distribués

| Artefact | Usage recommandé |
| :--- | :--- |
| `Craft.ro_<version>_x64-setup.exe` | **Usage standard** : installeur NSIS léger avec raccourcis et désinstalleur Windows. |
| `Craft.ro_<version>_x64_en-US.msi` | **Déploiement IT / entreprise** : package Windows Installer compatible GPO / Intune. |
| `craft-ro-launcher.exe` + `WebView2Loader.dll` | **Usage portable** : les deux fichiers doivent impérativement rester dans le même dossier. |

> **Note Windows SmartScreen** : si le binaire n'est pas signé avec un certificat Authenticode, Windows peut afficher un avertissement au premier lancement (*Informations complémentaires* -> *Exécuter quand même*).

### Configuration initiale

1. **Dossier d'installation** : par défaut `%LOCALAPPDATA%\Craft.ro\Apps` (modifiable dans *Paramètres*).
2. **Dépôts privés (optionnel)** : dans *Paramètres -> GitHub Personal Access Token*, renseignez un PAT (scope `repo` pour les dépôts privés). Il augmente également la limite d'appels API GitHub de 60 à 5 000 req/h.
3. **Catalogue distant (optionnel)** : indiquez une URL `https://` pointant vers un `registry.json` personnalisé, puis cliquez sur *Synchroniser*.
4. **Ajouter une application** : utilisez le bouton *Ajouter un dépôt* dans la barre latérale (`owner/repo`, motif d'asset tel que `*windows*.zip`, et nom de l'exécutable `.exe`).

### Données locales

Les préférences non sensibles et l'état des applications installées sont enregistrés dans :
- `%APPDATA%\Craft.ro\state.json`
- `%APPDATA%\Craft.ro\etag_cache.json`

---

## Structure du projet

```text
app/
├── public/
│   └── registry.json          # Catalogue d'applications embarqué
├── src/                       # Frontend React + TypeScript + Tailwind CSS v4
│   ├── components/            # Interface (AppCard, TitleBar, Sidebar, SettingsView, etc.)
│   ├── lib/                   # Bridge Tauri (backend.ts), SemVer et utilitaires
│   └── types/                 # Types TypeScript partagés
└── src-tauri/
    ├── capabilities/          # Permissions Tauri v2
    ├── icons/                 # Icônes Windows (.ico, .png)
    ├── src/
    │   ├── commands.rs        # Commandes IPC Tauri exposées au frontend
    │   ├── github.rs          # Client API GitHub, ETag, sélection d'assets
    │   ├── installer.rs       # Téléchargement streaming, SHA-256, ZIP/MSI/EXE, lancement
    │   ├── models.rs          # Structures de données sérialisées
    │   ├── security.rs        # Keyring, anti-SSRF/DNS, validation chemins/IDs
    │   └── storage.rs         # Persistance JSON locale
    ├── Cargo.toml
    └── tauri.conf.json
```

---

## Développement et compilation

### Prérequis build

- Node.js >= 20 et npm
- Rust (`stable`) avec cible Windows (`x86_64-pc-windows-msvc` avec Build Tools Visual Studio, ou `x86_64-pc-windows-gnullvm` + `llvm-mingw`)

### Commandes

```bash
cd app

# Installation des dépendances frontend
npm ci

# Lancement en mode développement (Tauri + Vite)
npm run tauri dev

# Vérification TypeScript et build frontend
npm run build

# Tests unitaires du backend Rust
cargo test --manifest-path src-tauri/Cargo.toml

# Build release complet (exécutable + installeurs NSIS/MSI)
npm run tauri build
```
