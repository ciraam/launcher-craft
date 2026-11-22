import { useEffect, useState } from "react";
import {
  Check,
  Database,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  KeyRound,
  Lock,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Save,
  ShieldCheck,
  Sun,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { isTauriRuntime, pickInstallDirectory } from "@/lib/backend";
import type { Settings, ThemeMode } from "@/types/launcher";
import { cn } from "@/lib/utils";

interface SettingsViewProps {
  settings: Settings;
  hasGithubToken: boolean;
  dataDir: string;
  isSyncing: boolean;
  onSaveSettings: (next: Settings) => Promise<void>;
  onSelectTheme: (theme: ThemeMode) => Promise<void>;
  onSaveGithubToken: (token: string) => Promise<void>;
  onClearGithubToken: () => Promise<void>;
  onCheckAllUpdates: () => void;
  onRefreshRegistry: () => Promise<void>;
}

const THEME_OPTIONS: { id: ThemeMode; label: string; icon: typeof Moon }[] = [
  { id: "dark", label: "Sombre", icon: Moon },
  { id: "light", label: "Clair", icon: Sun },
  { id: "system", label: "Système", icon: Monitor },
];

export function SettingsView({
  settings,
  hasGithubToken,
  dataDir,
  isSyncing,
  onSaveSettings,
  onSelectTheme,
  onSaveGithubToken,
  onClearGithubToken,
  onCheckAllUpdates,
  onRefreshRegistry,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [syncingRegistry, setSyncingRegistry] = useState(false);
  const native = isTauriRuntime();

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const isDirty =
    draft.installDir !== settings.installDir ||
    draft.registryUrl !== settings.registryUrl ||
    draft.autoCheckUpdates !== settings.autoCheckUpdates ||
    draft.requireSha256 !== settings.requireSha256 ||
    draft.theme !== settings.theme;

  const handleBrowseFolder = async () => {
    const picked = await pickInstallDirectory(draft.installDir);
    if (picked) {
      setDraft((prev) => ({ ...prev, installDir: picked }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveSettings(draft);
      setSavedFeedback(true);
      window.setTimeout(() => setSavedFeedback(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleCommitToken = async () => {
    if (!tokenInput.trim()) return;
    setSavingToken(true);
    try {
      await onSaveGithubToken(tokenInput.trim());
      setTokenInput("");
      setShowToken(false);
    } finally {
      setSavingToken(false);
    }
  };

  const handleDeleteToken = async () => {
    setSavingToken(true);
    try {
      await onClearGithubToken();
      setTokenInput("");
    } finally {
      setSavingToken(false);
    }
  };

  const handleSyncRegistry = async () => {
    setSyncingRegistry(true);
    try {
      if (isDirty) {
        await onSaveSettings(draft);
      }
      await onRefreshRegistry();
    } finally {
      setSyncingRegistry(false);
    }
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-foreground">
            Paramètres
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Configurez l'apparence, l'emplacement d'installation, le coffre Windows Credential Manager et la sécurité.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={isSyncing}
            onClick={onCheckAllUpdates}
            className="h-8 border border-border bg-card px-3 text-xs text-foreground hover:bg-accent"
          >
            <RefreshCw className={isSyncing ? "size-3.5 animate-spin" : "size-3.5"} />
            Vérifier toutes les mises à jour
          </Button>
          <Button
            size="sm"
            disabled={!isDirty || saving || !native}
            onClick={() => void handleSave()}
            className="h-8 bg-[#5E6AD2] px-3.5 text-xs font-medium text-white hover:bg-[#6B77DF] disabled:opacity-45"
          >
            {savedFeedback ? (
              <>
                <Check className="size-3.5" />
                Enregistré
              </>
            ) : (
              <>
                <Save className="size-3.5" />
                Enregistrer
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Section 0: Appearance (Light / Dark / System) */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-[inset_0_1px_0_var(--specular-top)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-[#5E6AD2] dark:text-[#8E98F8]">
              <Palette className="size-4" />
            </div>
            <div>
              <p className="text-[13.5px] font-medium text-foreground">Apparence</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Choisissez le thème de Craft.ro ou suivez automatiquement les réglages système.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
            {THEME_OPTIONS.map(({ id, label, icon: Icon }) => {
              const active = draft.theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, theme: id }));
                    void onSelectTheme(id);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                    active
                      ? "bg-[#5E6AD2] text-white shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Section 1: Install directory */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-[inset_0_1px_0_var(--specular-top)]">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-[#5E6AD2] dark:text-[#8E98F8]">
            <FolderOpen className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <Label htmlFor="install-dir" className="text-[13.5px] font-medium text-foreground">
                Dossier d'installation par défaut
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Emplacement local des applications installées par Craft.ro (protégé par vérification canonique lors du lancement et des désinstallations).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Input
                id="install-dir"
                value={draft.installDir}
                disabled={!native}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, installDir: e.target.value }))
                }
                placeholder="C:\Users\...\AppData\Local\Craft.ro\Apps"
                className="h-9 border-border bg-[var(--surface-input)] font-mono text-xs text-foreground"
              />
              {native && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleBrowseFolder()}
                  className="h-9 shrink-0 border border-border bg-secondary px-3 text-xs text-foreground hover:bg-accent"
                >
                  Parcourir…
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: GitHub Personal Access Token (Windows Credential Manager) */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-[inset_0_1px_0_var(--specular-top)]">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-emerald-600 dark:text-emerald-400">
            <KeyRound className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label htmlFor="github-token" className="text-[13.5px] font-medium text-foreground">
                  GitHub Personal Access Token (PAT)
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Chiffré dans <strong>Windows Credential Manager</strong> (jamais écrit en clair sur disque ni renvoyé à l'interface). Transmis uniquement aux hôtes GitHub officiels en HTTPS.
                </p>
              </div>
              {hasGithubToken ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="size-3" />
                  Stocké dans le coffre Windows
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                  <Lock className="size-3" />
                  Aucun token (mode public)
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Input
                  id="github-token"
                  type={showToken ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!native || savingToken}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={
                    hasGithubToken
                      ? "•••••••••••••••••••••••• (saisir un nouveau PAT pour remplacer)"
                      : "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  }
                  className="h-9 border-border bg-[var(--surface-input)] pr-10 font-mono text-xs text-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? "Masquer le token" : "Afficher le token"}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>

              <Button
                type="button"
                size="sm"
                disabled={!native || !tokenInput.trim() || savingToken}
                onClick={() => void handleCommitToken()}
                className="h-9 shrink-0 bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-45"
              >
                <ShieldCheck className="size-3.5" />
                Enregistrer le PAT
              </Button>

              {hasGithubToken && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!native || savingToken}
                  onClick={() => void handleDeleteToken()}
                  className="h-9 shrink-0 border border-destructive/25 bg-destructive/10 px-2.5 text-xs text-destructive hover:bg-destructive/20"
                >
                  <Trash2 className="size-3.5" />
                  Supprimer
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Remote registry, Auto-updates & Strict SHA-256 */}
      <section className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-[inset_0_1px_0_var(--specular-top)]">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-sky-600 dark:text-sky-400">
            <Globe className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <Label htmlFor="registry-url" className="text-[13.5px] font-medium text-foreground">
                URL du catalogue distant (<code className="font-mono text-xs">registry.json</code>)
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Protocole <code className="font-mono text-foreground">https://</code> obligatoire (protection anti-SSRF &amp; anti-DNS rebinding). Laissez vide pour le catalogue embarqué.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Input
                id="registry-url"
                disabled={!native}
                value={draft.registryUrl}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, registryUrl: e.target.value }))
                }
                placeholder="https://raw.githubusercontent.com/user/craft-registry/main/registry.json"
                className="h-9 border-border bg-[var(--surface-input)] font-mono text-xs text-foreground"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={syncingRegistry}
                onClick={() => void handleSyncRegistry()}
                className="h-9 shrink-0 border border-border bg-secondary px-3 text-xs text-foreground hover:bg-accent"
              >
                <RefreshCw
                  className={syncingRegistry ? "size-3.5 animate-spin" : "size-3.5"}
                />
                Synchroniser
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13.5px] font-medium text-foreground">
              Vérification automatique au démarrage
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Synchronisation parallèle (4 requêtes simultanées max) avec cache ETag HTTP 304.
            </p>
          </div>
          <Switch
            disabled={!native}
            checked={draft.autoCheckUpdates}
            onCheckedChange={(checked) =>
              setDraft((prev) => ({ ...prev, autoCheckUpdates: Boolean(checked) }))
            }
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[13.5px] font-medium text-foreground">
                Exiger une empreinte SHA-256
              </p>
              {draft.requireSha256 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="size-3" />
                  Mode strict
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Rejette et supprime automatiquement tout binaire dont la release ou le manifeste Scoop ne fournit aucune empreinte SHA-256 vérifiable.
            </p>
          </div>
          <Switch
            disabled={!native}
            checked={draft.requireSha256}
            onCheckedChange={(checked) =>
              setDraft((prev) => ({ ...prev, requireSha256: Boolean(checked) }))
            }
          />
        </div>
      </section>

      {/* Section 4: Local Persistence & Security Summary */}
      <section className="rounded-xl border border-border bg-[var(--surface-subtle)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2.5 truncate">
            <Database className="size-4 shrink-0" />
            <span className="truncate">
              Données Craft.ro (<code className="font-mono text-foreground">state.json</code>,{" "}
              <code className="font-mono text-foreground">etag_cache.json</code> &amp;{" "}
              <code className="font-mono text-foreground">scoop_index.json</code>) :{" "}
              <span className="font-mono text-foreground">{dataDir}</span>
            </span>
          </span>
          <span className="font-mono text-[10.5px] text-emerald-600 dark:text-emerald-400">
            CSP · HTTPS · DNS · SHA-256
          </span>
        </div>
      </section>
    </div>
  );
}
