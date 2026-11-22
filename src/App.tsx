import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpCircle,
  Bookmark,
  CheckCircle2,
  LayoutGrid,
  List,
  Monitor,
  PackageSearch,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TitleBar } from "@/components/TitleBar";
import { Sidebar } from "@/components/Sidebar";
import { AppCard } from "@/components/AppCard";
import { AppDetailDialog } from "@/components/AppDetailDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { SettingsView } from "@/components/SettingsView";
import { AddAppDialog } from "@/components/AddAppDialog";
import { ScoopExploreView } from "@/components/ScoopExploreView";
import { FilterSortBar } from "@/components/FilterSortBar";
import * as backend from "@/lib/backend";
import { isUpdateAvailable } from "@/lib/semver";
import { applyThemeToDocument, readCachedTheme } from "@/lib/theme";
import type {
  AppEntry,
  DownloadProgressEvent,
  InstalledApp,
  NavView,
  Registry,
  ReleaseInfo,
  Settings,
  SortOption,
  SourceFilter,
  StatusFilter,
  ThemeMode,
  ToastNotice,
} from "@/types/launcher";
import { cn } from "@/lib/utils";

const CATEGORY_ORDER = ["Outils", "Créativité", "Dev", "Utilitaires"];

export function App() {
  const [registry, setRegistry] = useState<Registry>({ version: 1, apps: [] });
  const [installedApps, setInstalledApps] = useState<Record<string, InstalledApp>>({});
  const [releases, setReleases] = useState<Record<string, ReleaseInfo>>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>({
    installDir: "",
    registryUrl: "",
    autoCheckUpdates: true,
    requireSha256: false,
    theme: readCachedTheme(),
    minimizeToTray: true,
  });
  const [isWindowHidden, setIsWindowHidden] = useState(false);
  const [hasGithubToken, setHasGithubToken] = useState(false);
  const [dataDir, setDataDir] = useState("");
  const [scoopIndexedCount, setScoopIndexedCount] = useState(0);
  const [progressMap, setProgressMap] = useState<Record<string, DownloadProgressEvent>>({});
  const [activeView, setActiveView] = useState<NavView>({ kind: "collection" });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("default");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sha256Only, setSha256Only] = useState(false);
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [selectedApp, setSelectedApp] = useState<AppEntry | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addAppOpen, setAddAppOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [checkingAppId, setCheckingAppId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const isNativeDesktop = backend.isTauriRuntime();
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const resetFilters = useCallback(() => {
    setSearchQuery("");
    setSortBy("default");
    setStatusFilter("all");
    setSourceFilter("all");
    setSha256Only(false);
  }, []);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    sortBy !== "default" ||
    statusFilter !== "all" ||
    sourceFilter !== "all" ||
    sha256Only;

  const pushToast = useCallback(
    (title: string, description?: string, variant: ToastNotice["variant"] = "default") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-2), { id, title, description, variant }]);
    },
    []
  );

  // Auto-dismiss toasts only while the window is visible (pauses timers in System Tray)
  useEffect(() => {
    if (isWindowHidden || toasts.length === 0) return;
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [isWindowHidden, toasts]);

  // Sync theme to <html> class & react to OS changes in "system" mode
  useEffect(() => {
    applyThemeToDocument(settings.theme);
    if (settings.theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyThemeToDocument("system");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [settings.theme]);

  // Parallel GitHub & Scoop releases check with explicit error reporting
  const handleCheckAllUpdates = useCallback(
    async (force = false, silent = false) => {
      setIsSyncing(true);
      try {
        const result = await backend.checkAllUpdates(force);
        setReleases((prev) => ({ ...prev, ...result.releases }));
        const okCount = Object.keys(result.releases).length;
        const errEntries = Object.entries(result.errors);

        if (!silent) {
          if (errEntries.length > 0) {
            const firstErr = errEntries[0][1];
            pushToast(
              `Synchronisation partielle (${okCount} OK, ${errEntries.length} erreur${errEntries.length > 1 ? "s" : ""})`,
              firstErr,
              "error"
            );
          } else {
            pushToast(
              "Releases synchronisées",
              `${okCount} sources vérifiées en parallèle avec cache ETag.`,
              "success"
            );
          }
        }
      } catch (err) {
        if (!silent) {
          pushToast(
            "Échec de synchronisation",
            err instanceof Error ? err.message : "Impossible de contacter GitHub.",
            "error"
          );
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [pushToast]
  );

  // Pause CSS animations & timers when window is hidden in Tray or occluded
  useEffect(() => {
    const syncVisibility = (hidden: boolean) => {
      setIsWindowHidden(hidden);
      document.documentElement.classList.toggle("craft-paused", hidden);
    };

    const onDocVisibility = () => syncVisibility(document.hidden);
    document.addEventListener("visibilitychange", onDocVisibility);

    let unlistenTray: (() => void) | null = null;
    void backend
      .subscribeTrayEvents({
        onCheckUpdates: () => {
          void handleCheckAllUpdates(true, false);
        },
        onVisibilityChange: (visible) => {
          syncVisibility(!visible);
        },
      })
      .then((fn) => {
        unlistenTray = fn;
      });

    return () => {
      document.removeEventListener("visibilitychange", onDocVisibility);
      if (unlistenTray) unlistenTray();
      document.documentElement.classList.remove("craft-paused");
    };
  }, [handleCheckAllUpdates]);

  // Initial load + download-progress subscription
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    async function boot() {
      try {
        const snapshot = await backend.getAppState();
        if (!mounted) return;
        setRegistry(snapshot.registry);
        setInstalledApps(snapshot.installedApps);
        setReleases(snapshot.releases);
        setFavorites(snapshot.favorites ?? []);
        setSettings(snapshot.settings);
        setHasGithubToken(snapshot.hasGithubToken);
        setDataDir(snapshot.dataDir);
        setIsLoading(false);

        if (snapshot.settings.autoCheckUpdates) {
          void handleCheckAllUpdates(false, true);
        }

        void backend
          .searchScoopApps("", undefined, 1)
          .then((res) => {
            if (mounted && res.totalIndexed > 0) {
              setScoopIndexedCount(res.totalIndexed);
            }
          })
          .catch(() => {});
      } catch (err) {
        if (!mounted) return;
        setIsLoading(false);
        pushToast(
          "Erreur de chargement",
          err instanceof Error ? err.message : "Impossible de charger le catalogue Craft.ro.",
          "error"
        );
      }
    }

    void boot();

    void backend
      .subscribeDownloadProgress((evt) => {
        if (!mounted) return;
        setProgressMap((prev) => {
          if (evt.status === "completed" || evt.status === "cancelled" || evt.status === "error") {
            const copy = { ...prev };
            delete copy[evt.appId];
            return copy;
          }
          return { ...prev, [evt.appId]: evt };
        });
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      mounted = false;
      if (unlisten) unlisten();
    };
  }, [handleCheckAllUpdates, pushToast]);

  // Global OS-aware keyboard shortcuts (Ctrl+K / Cmd+K, Ctrl+R / Cmd+R)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void handleCheckAllUpdates(true, false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCheckAllUpdates]);

  const handleSelectTheme = useCallback(
    async (theme: ThemeMode) => {
      const next = { ...settings, theme };
      setSettings(next);
      applyThemeToDocument(theme);
      try {
        await backend.saveSettings(next);
      } catch {
        // Keep visual theme applied locally even if outside Tauri
      }
    },
    [settings]
  );

  const handleCycleTheme = useCallback(() => {
    const order: ThemeMode[] = ["dark", "light", "system"];
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    void handleSelectTheme(next);
  }, [handleSelectTheme, settings.theme]);

  const handleToggleFavorite = useCallback(
    async (app: AppEntry) => {
      try {
        const updated = await backend.toggleFavorite(app.id);
        setFavorites(updated);
        const added = updated.includes(app.id);
        pushToast(
          added ? `${app.name} épinglée` : `${app.name} retirée des favoris`,
          added ? "Épinglée en favori dans Craft.thèque." : undefined
        );
      } catch (err) {
        pushToast(
          "Action impossible",
          err instanceof Error ? err.message : "Impossible de modifier vos favoris.",
          "error"
        );
      }
    },
    [pushToast]
  );

  const handleRemoveCustomApp = useCallback(
    async (app: AppEntry) => {
      try {
        const res = await backend.removeCustomApp(app.id);
        setRegistry(res.registry);
        setFavorites(res.favorites);
        if (selectedApp?.id === app.id) {
          setSelectedApp(null);
        }
        pushToast(`${app.name} retirée du catalogue`, "Le dépôt personnalisé a été supprimé.");
      } catch (err) {
        pushToast(
          `Impossible de retirer ${app.name}`,
          err instanceof Error ? err.message : "Suppression refusée.",
          "error"
        );
      }
    },
    [pushToast, selectedApp?.id]
  );

  const handleCheckSingleRelease = useCallback(
    async (app: AppEntry) => {
      setCheckingAppId(app.id);
      try {
        const rel = await backend.checkRelease(app.id, true);
        setReleases((prev) => ({ ...prev, [app.id]: rel }));
        pushToast(`${app.name} synchronisé`, `Dernière version : v${rel.version}`);
      } catch (err) {
        pushToast(
          `Erreur (${app.name})`,
          err instanceof Error ? err.message : "Vérification impossible.",
          "error"
        );
      } finally {
        setCheckingAppId(null);
      }
    },
    [pushToast]
  );

  const handleInstallOrUpdate = useCallback(
    async (app: AppEntry) => {
      const wasInstalled = Boolean(installedApps[app.id]);
      try {
        const installed = await backend.installOrUpdateApp(app.id);
        setInstalledApps((prev) => ({ ...prev, [app.id]: installed }));
        pushToast(
          wasInstalled ? `${app.name} mis à jour` : `${app.name} installé`,
          installed.sha256Verified
            ? `Version v${installed.version} prête (SHA-256 vérifié).`
            : `Version v${installed.version} prête à être lancée.`,
          "success"
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Installation interrompue.";
        if (!message.toLowerCase().includes("annul")) {
          pushToast(`Échec pour ${app.name}`, message, "error");
        } else {
          pushToast("Téléchargement annulé", `${app.name} n'a pas été modifié.`);
        }
      }
    },
    [installedApps, pushToast]
  );

  const handleImportScoopApp = useCallback(
    async (bucket: string, name: string, andInstall: boolean) => {
      try {
        const imported = await backend.importScoopApp(bucket, name);
        setRegistry(imported.registry);
        setReleases((prev) => ({ ...prev, [imported.app.id]: imported.release }));

        if (andInstall) {
          pushToast(
            `${imported.app.name} importé depuis Scoop`,
            `Téléchargement de v${imported.release.version} avec vérification SHA-256…`
          );
          await handleInstallOrUpdate(imported.app);
        } else {
          pushToast(
            `${imported.app.name} ajouté à Craft.thèque`,
            `Scoop ${bucket} · v${imported.release.version}${imported.app.sha256 ? " · SHA-256 prêt" : ""}`,
            "success"
          );
        }
      } catch (err) {
        pushToast(
          `Import Scoop impossible (${name})`,
          err instanceof Error ? err.message : "Erreur lors de la lecture du manifeste Scoop.",
          "error"
        );
      }
    },
    [handleInstallOrUpdate, pushToast]
  );

  const handleCancelDownload = useCallback(async (appId: string) => {
    await backend.cancelDownload(appId);
  }, []);

  const handleLaunch = useCallback(
    async (app: AppEntry) => {
      try {
        await backend.launchApp(app.id);
        pushToast(
          `Lancement de ${app.name}`,
          installedApps[app.id]?.executablePath,
          "success"
        );
      } catch (err) {
        pushToast(
          `Impossible de lancer ${app.name}`,
          err instanceof Error ? err.message : "Exécutable introuvable.",
          "error"
        );
      }
    },
    [installedApps, pushToast]
  );

  const handleOpenFolder = useCallback(
    async (app: AppEntry) => {
      try {
        await backend.openInstallFolder(app.id);
      } catch (err) {
        pushToast(
          "Ouverture impossible",
          err instanceof Error ? err.message : "Dossier introuvable.",
          "error"
        );
      }
    },
    [pushToast]
  );

  const handleUninstall = useCallback(
    async (app: AppEntry) => {
      try {
        await backend.uninstallApp(app.id);
        setInstalledApps((prev) => {
          const copy = { ...prev };
          delete copy[app.id];
          return copy;
        });
        pushToast(`${app.name} désinstallé`, "Les fichiers locaux ont été supprimés.");
      } catch (err) {
        pushToast(
          "Erreur de désinstallation",
          err instanceof Error ? err.message : "Suppression impossible.",
          "error"
        );
      }
    },
    [pushToast]
  );

  const handleSaveSettings = useCallback(
    async (next: Settings) => {
      try {
        const saved = await backend.saveSettings(next);
        setSettings(saved);
        pushToast(
          "Paramètres enregistrés",
          "Vos préférences Craft.ro sont sauvegardées localement.",
          "success"
        );
      } catch (err) {
        pushToast(
          "Paramètres invalides",
          err instanceof Error ? err.message : "Échec de l'enregistrement.",
          "error"
        );
        throw err;
      }
    },
    [pushToast]
  );

  const handleSaveGithubToken = useCallback(
    async (token: string) => {
      try {
        const stored = await backend.setGithubToken(token);
        setHasGithubToken(stored);
        pushToast(
          "Token GitHub sécurisé",
          "Enregistré dans Windows Credential Manager.",
          "success"
        );
      } catch (err) {
        pushToast(
          "Échec du coffre Windows",
          err instanceof Error ? err.message : "Impossible de stocker le token.",
          "error"
        );
        throw err;
      }
    },
    [pushToast]
  );

  const handleClearGithubToken = useCallback(async () => {
    try {
      const stored = await backend.clearGithubToken();
      setHasGithubToken(stored);
      pushToast("Token GitHub supprimé", "Retiré de Windows Credential Manager.");
    } catch (err) {
      pushToast(
        "Erreur lors de la suppression",
        err instanceof Error ? err.message : "Impossible de retirer le token.",
        "error"
      );
    }
  }, [pushToast]);

  const handleRefreshRegistry = useCallback(async () => {
    try {
      const reg = await backend.refreshRegistry();
      setRegistry(reg);
      pushToast(
        "Catalogue synchronisé",
        `${reg.apps.length} applications chargées depuis registry.json.`,
        "success"
      );
      void handleCheckAllUpdates(false, true);
    } catch (err) {
      pushToast(
        "Erreur catalogue",
        err instanceof Error ? err.message : "Impossible de charger registry.json.",
        "error"
      );
    }
  }, [handleCheckAllUpdates, pushToast]);

  const handleAddCustomApp = useCallback(
    async (entry: AppEntry) => {
      const updated = await backend.addCustomApp(entry);
      setRegistry(updated);
      pushToast(
        `${entry.name} ajouté à Craft.thèque`,
        `Récupération de la dernière release de ${entry.repo}…`,
        "success"
      );
      try {
        const rel = await backend.checkRelease(entry.id, true);
        setReleases((prev) => ({ ...prev, [entry.id]: rel }));
      } catch {
        // Keep entry even if repo requires PAT or has no release yet
      }
    },
    [pushToast]
  );

  // Derived collections
  const updatableApps = useMemo(
    () =>
      registry.apps.filter((app) =>
        isUpdateAvailable(installedApps[app.id]?.version, releases[app.id]?.version)
      ),
    [installedApps, registry.apps, releases]
  );

  const collectionApps = useMemo(() => registry.apps, [registry.apps]);

  const installedCount = useMemo(
    () => registry.apps.filter((app) => Boolean(installedApps[app.id])).length,
    [installedApps, registry.apps]
  );

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of CATEGORY_ORDER) counts.set(c, 0);
    for (const app of registry.apps) {
      counts.set(app.category, (counts.get(app.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 0)
      .map(([name, count]) => ({ name, count }));
  }, [registry.apps]);

  // Base list for current view before multi-criteria filters
  const baseViewApps = useMemo(() => {
    if (activeView.kind === "collection") return collectionApps;
    if (activeView.kind === "installed") {
      return registry.apps.filter((a) => Boolean(installedApps[a.id]));
    }
    if (activeView.kind === "updates") return updatableApps;
    if (activeView.kind === "category") {
      return registry.apps.filter((a) => a.category === activeView.category);
    }
    return registry.apps;
  }, [activeView, collectionApps, installedApps, registry.apps, updatableApps]);

  // Apply search, status/source/SHA-256 filters, and sorting
  const visibleApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = baseViewApps.filter((app) => {
      if (q) {
        const matchesQuery =
          app.name.toLowerCase().includes(q) ||
          app.tagline.toLowerCase().includes(q) ||
          app.category.toLowerCase().includes(q) ||
          app.repo.toLowerCase().includes(q) ||
          (app.scoopName?.toLowerCase().includes(q) ?? false);
        if (!matchesQuery) return false;
      }

      const inst = installedApps[app.id];
      const rel = releases[app.id];
      const hasUpd = isUpdateAvailable(inst?.version, rel?.version);

      if (statusFilter === "installed" && !inst) return false;
      if (statusFilter === "updates" && !hasUpd) return false;
      if (statusFilter === "not-installed" && inst) return false;

      const isScoop = app.source === "scoop";
      const isCustomNonScoop = Boolean(app.isCustom) && !isScoop;
      const isBuiltinCatalog = !app.isCustom && !isScoop;

      if (sourceFilter === "catalog" && !isBuiltinCatalog) return false;
      if (sourceFilter === "custom" && !isCustomNonScoop) return false;
      if (sourceFilter === "scoop" && !isScoop) return false;

      if (sha256Only) {
        const hasSha = Boolean(
          inst?.sha256Verified ||
            app.sha256 ||
            rel?.matchedAsset?.sha256 ||
            rel?.matchedAsset?.checksumAsset
        );
        if (!hasSha) return false;
      }

      return true;
    });

    if (sortBy === "default") {
      return filtered;
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "name-asc") {
        return a.name.localeCompare(b.name, "fr");
      }
      if (sortBy === "name-desc") {
        return b.name.localeCompare(a.name, "fr");
      }
      if (sortBy === "updates-first") {
        const ua = isUpdateAvailable(installedApps[a.id]?.version, releases[a.id]?.version) ? 1 : 0;
        const ub = isUpdateAvailable(installedApps[b.id]?.version, releases[b.id]?.version) ? 1 : 0;
        if (ua !== ub) return ub - ua;
        return a.name.localeCompare(b.name, "fr");
      }
      if (sortBy === "installed-first") {
        const ia = installedApps[a.id] ? 1 : 0;
        const ib = installedApps[b.id] ? 1 : 0;
        if (ia !== ib) return ib - ia;
        return a.name.localeCompare(b.name, "fr");
      }
      if (sortBy === "release-date") {
        const da = releases[a.id]?.publishedAt ? Date.parse(releases[a.id].publishedAt!) : 0;
        const db = releases[b.id]?.publishedAt ? Date.parse(releases[b.id].publishedAt!) : 0;
        if (da !== db) return db - da;
        return a.name.localeCompare(b.name, "fr");
      }
      return 0;
    });

    return sorted;
  }, [baseViewApps, installedApps, releases, searchQuery, sha256Only, sortBy, sourceFilter, statusFilter]);

  const viewHeader = useMemo(() => {
    switch (activeView.kind) {
      case "collection":
        return {
          title: "Craft.thèque",
          subtitle:
            "Votre bibliothèque personnelle d'applications GitHub Releases et Scoop, vérifiées en SHA-256.",
        };
      case "installed":
        return {
          title: "Applications installées",
          subtitle: `${installedCount} application${installedCount > 1 ? "s" : ""} prête${installedCount > 1 ? "s" : ""} à être lancée${installedCount > 1 ? "s" : ""} en un clic.`,
        };
      case "updates":
        return {
          title: "Mises à jour",
          subtitle:
            updatableApps.length > 0
              ? `${updatableApps.length} nouvelle${updatableApps.length > 1 ? "s" : ""} version${updatableApps.length > 1 ? "s" : ""} disponible${updatableApps.length > 1 ? "s" : ""} via SemVer.`
              : "Toutes vos applications installées sont parfaitement à jour.",
        };
      case "category":
        return {
          title: activeView.category,
          subtitle: `Applications de la catégorie ${activeView.category}.`,
        };
      case "scoop":
        return { title: "Explorer (Scoop)", subtitle: "" };
      case "settings":
        return { title: "Paramètres", subtitle: "" };
    }
  }, [activeView, installedCount, updatableApps.length]);

  const handleUpdateAll = async () => {
    for (const app of updatableApps) {
      await handleInstallOrUpdate(app);
    }
  };

  return (
    <TooltipProvider>
      <div className="craft-shell-enter flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        {/* Custom Frameless Tauri Frosted Titlebar */}
        <TitleBar
          onOpenPalette={() => setPaletteOpen(true)}
          isSyncing={isSyncing}
          updateCount={updatableApps.length}
          hasGithubToken={hasGithubToken}
          theme={settings.theme}
          onCycleTheme={handleCycleTheme}
        />

        {/* Workspace body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            activeView={activeView}
            onSelectView={(v) => {
              setActiveView(v);
              setSearchQuery("");
              setStatusFilter("all");
              setSourceFilter("all");
              setSha256Only(false);
            }}
            collectionCount={collectionApps.length}
            installedCount={installedCount}
            updateCount={updatableApps.length}
            scoopIndexedCount={scoopIndexedCount}
            categories={categories}
            onOpenAddApp={() => setAddAppOpen(true)}
          />

          {/* Main scrolling canvas */}
          <main className="craft-canvas-bg relative flex-1 overflow-y-auto bg-background px-7 py-6">
            {activeView.kind === "settings" ? (
              <SettingsView
                settings={settings}
                hasGithubToken={hasGithubToken}
                dataDir={dataDir}
                isSyncing={isSyncing}
                onSaveSettings={handleSaveSettings}
                onSelectTheme={handleSelectTheme}
                onSaveGithubToken={handleSaveGithubToken}
                onClearGithubToken={handleClearGithubToken}
                onCheckAllUpdates={() => void handleCheckAllUpdates(true, false)}
                onRefreshRegistry={handleRefreshRegistry}
              />
            ) : activeView.kind === "scoop" ? (
              <ScoopExploreView
                existingApps={registry.apps}
                installedApps={installedApps}
                progressMap={progressMap}
                onIndexCountChange={setScoopIndexedCount}
                onImportScoopApp={handleImportScoopApp}
                onLaunchApp={(a) => void handleLaunch(a)}
                onNotifyError={(title, msg) => pushToast(title, msg, "error")}
              />
            ) : (
              <div className="mx-auto max-w-[1140px] space-y-5 pb-12">
                {/* Explicit non-simulated banner when opened in a browser instead of native Tauri Desktop */}
                {!isNativeDesktop && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
                    <div className="flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-200">
                      <Monitor className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>
                        <strong>Mode consultation web</strong> — La simulation factice est désactivée. Lancez l'exécutable natif <strong>Craft.ro Desktop</strong> pour télécharger, vérifier (SHA-256), installer et exécuter vos applications.
                      </span>
                    </div>
                  </div>
                )}

                {/* Page Header + Controls */}
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                  <div>
                    <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-foreground">
                      {activeView.kind === "collection" ? (
                        <>
                          Craft
                          <span className="text-[#5E6AD2] dark:text-[#8E98F8]">.thèque</span>
                        </>
                      ) : (
                        viewHeader.title
                      )}
                    </h1>
                    <p className="mt-1 text-[13px] text-muted-foreground">{viewHeader.subtitle}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Inline filter */}
                    <div className="relative w-52">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filtrer…"
                        className="h-8 border-border bg-card pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus-visible:border-[#5E6AD2]/60"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery("")}
                          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </div>

                    {/* Grid / List toggle */}
                    <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                      <button
                        type="button"
                        aria-label="Vue grille"
                        onClick={() => setLayout("grid")}
                        className={cn(
                          "rounded-md p-1.5 transition-colors",
                          layout === "grid"
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <LayoutGrid className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Vue liste"
                        onClick={() => setLayout("list")}
                        className={cn(
                          "rounded-md p-1.5 transition-colors",
                          layout === "list"
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <List className="size-3.5" />
                      </button>
                    </div>

                    {activeView.kind === "collection" && (
                      <Button
                        size="sm"
                        onClick={() => setAddAppOpen(true)}
                        className="h-8 bg-[#5E6AD2] px-3 text-xs font-medium text-white hover:bg-[#6B77DF]"
                      >
                        <Plus className="size-3.5" />
                        Ajouter un dépôt
                      </Button>
                    )}

                    {activeView.kind === "updates" && updatableApps.length > 1 && (
                      <Button
                        size="sm"
                        onClick={() => void handleUpdateAll()}
                        className="h-8 bg-[#5E6AD2] px-3 text-xs font-medium text-white hover:bg-[#6B77DF]"
                      >
                        <ArrowUpCircle className="size-3.5" />
                        Tout mettre à jour ({updatableApps.length})
                      </Button>
                    )}

                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isSyncing}
                      onClick={() => void handleCheckAllUpdates(true, false)}
                      className="h-8 border border-border bg-card px-3 text-xs text-foreground hover:bg-accent"
                    >
                      <RefreshCw
                        className={cn(
                          "size-3.5",
                          isSyncing && "animate-spin text-[#5E6AD2] dark:text-[#8E98F8]"
                        )}
                      />
                      Actualiser
                    </Button>
                  </div>
                </div>

                {/* Multi-criteria Filter & Sort bar (shown whenever the view has apps or active filters) */}
                {!isLoading && (baseViewApps.length > 0 || hasActiveFilters) && (
                  <FilterSortBar
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    sourceFilter={sourceFilter}
                    onSourceFilterChange={setSourceFilter}
                    sha256Only={sha256Only}
                    onSha256OnlyChange={setSha256Only}
                    filteredCount={visibleApps.length}
                    totalInView={baseViewApps.length}
                    hasActiveFilters={hasActiveFilters}
                    onReset={resetFilters}
                    hideStatusPills={activeView.kind === "installed" || activeView.kind === "updates"}
                  />
                )}

                {/* Highlight Banner when updates are available on Craft.thèque */}
                {activeView.kind === "collection" &&
                  updatableApps.length > 0 &&
                  !hasActiveFilters && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#5E6AD2]/35 bg-gradient-to-r from-[#5E6AD2]/[0.12] via-card to-card px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-[#5E6AD2]/15 text-[#5E6AD2] dark:text-[#A8B1FF]">
                          <Sparkles className="size-4" />
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-foreground">
                            {updatableApps.length} mise{updatableApps.length > 1 ? "s" : ""} à jour
                            disponible{updatableApps.length > 1 ? "s" : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {updatableApps
                              .map((a) => `${a.name} (v${releases[a.id]?.version})`)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => setActiveView({ kind: "updates" })}
                        className="h-7 bg-[#5E6AD2] px-3 text-xs font-medium text-white hover:bg-[#6B77DF]"
                      >
                        Voir les mises à jour
                      </Button>
                    </div>
                  )}

                {/* App Grid / List or Structured Loading Skeletons / Empty State */}
                {isLoading ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex h-[218px] flex-col justify-between rounded-xl border border-border bg-card p-4"
                      >
                        <div>
                          <div className="flex items-start justify-between">
                            <div className="size-11 animate-pulse rounded-xl bg-muted" />
                            <div className="h-5 w-16 animate-pulse rounded-md bg-muted" />
                          </div>
                          <div className="mt-4 h-4 w-32 animate-pulse rounded bg-muted" />
                          <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted/80" />
                          <div className="mt-1.5 h-3 w-3/4 animate-pulse rounded bg-muted/60" />
                        </div>
                        <div className="flex items-center justify-between border-t border-border pt-3.5">
                          <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : visibleApps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
                    <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-xs">
                      {activeView.kind === "updates" ? (
                        <CheckCircle2 className="size-5 text-emerald-500" />
                      ) : activeView.kind === "collection" && !hasActiveFilters ? (
                        <Bookmark className="size-5 text-[#5E6AD2] dark:text-[#8E98F8]" />
                      ) : (
                        <Search className="size-5" />
                      )}
                    </div>
                    <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.015em] text-foreground">
                      {hasActiveFilters ? (
                        "Aucune application ne correspond aux filtres"
                      ) : activeView.kind === "updates" ? (
                        "Tout est à jour"
                      ) : activeView.kind === "collection" ? (
                        <>
                          Votre Craft
                          <span className="text-[#5E6AD2] dark:text-[#8E98F8]">.thèque</span> est
                          vide
                        </>
                      ) : activeView.kind === "installed" ? (
                        "Aucune application installée"
                      ) : (
                        "Aucun résultat"
                      )}
                    </h3>
                    <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                      {hasActiveFilters
                        ? "Essayez d'élargir vos critères de statut, de source ou de recherche."
                        : activeView.kind === "updates"
                          ? "Toutes vos applications correspondent à la dernière release disponible."
                          : activeView.kind === "collection"
                            ? "Ajoutez vos propres dépôts GitHub (publics ou privés) ou parcourez plus de 5 000 logiciels Windows vérifiés en SHA-256 dans Scoop."
                            : activeView.kind === "installed"
                              ? "Ajoutez un dépôt GitHub ou explorez le catalogue Scoop (+5 000 apps) pour installer vos outils en un clic."
                              : "Essayez un autre mot-clé ou ajoutez un dépôt GitHub personnalisé."}
                    </p>
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                      {hasActiveFilters && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={resetFilters}
                          className="h-8 border border-border bg-card px-3 text-xs"
                        >
                          <RotateCcw className="size-3.5" />
                          Réinitialiser les filtres
                        </Button>
                      )}
                      {activeView.kind === "collection" && !hasActiveFilters && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => setAddAppOpen(true)}
                            className="h-9 bg-[#5E6AD2] px-4 text-xs font-medium text-white shadow-[0_2px_14px_rgba(94,106,210,0.35)] hover:bg-[#6B77DF]"
                          >
                            <Plus className="size-3.5" />
                            Ajouter un dépôt
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setActiveView({ kind: "scoop" })}
                            className="h-9 border border-border bg-card px-4 text-xs font-medium text-foreground hover:bg-accent"
                          >
                            <PackageSearch className="size-3.5 text-sky-500" />
                            Explorer (Scoop)
                          </Button>
                        </>
                      )}
                      {activeView.kind === "installed" && !hasActiveFilters && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => setAddAppOpen(true)}
                            className="h-8 bg-[#5E6AD2] px-3.5 text-xs text-white hover:bg-[#6B77DF]"
                          >
                            <Plus className="size-3.5" />
                            Ajouter un dépôt
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setActiveView({ kind: "scoop" })}
                            className="h-8 border border-border bg-card px-3.5 text-xs text-foreground hover:bg-accent"
                          >
                            <PackageSearch className="size-3.5 text-sky-500" />
                            Explorer (Scoop)
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    className={
                      layout === "grid"
                        ? "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
                        : "space-y-2.5"
                    }
                  >
                    {visibleApps.map((app, index) => (
                      <div
                        key={app.id}
                        className="craft-card-enter"
                        style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
                      >
                        <AppCard
                          app={app}
                          installed={installedApps[app.id]}
                          release={releases[app.id]}
                          progress={progressMap[app.id]}
                          isFavorite={favoriteSet.has(app.id)}
                          layout={layout}
                          onOpenDetail={setSelectedApp}
                          onToggleFavorite={(a) => void handleToggleFavorite(a)}
                          onRemoveCustomApp={(a) => void handleRemoveCustomApp(a)}
                          onInstallOrUpdate={(a) => void handleInstallOrUpdate(a)}
                          onCancelDownload={(id) => void handleCancelDownload(id)}
                          onLaunch={(a) => void handleLaunch(a)}
                          onOpenFolder={(a) => void handleOpenFolder(a)}
                          onUninstall={(a) => void handleUninstall(a)}
                          onCheckRelease={(a) => void handleCheckSingleRelease(a)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

        {/* App Details & Markdown Changelog Modal */}
        <AppDetailDialog
          app={selectedApp}
          open={Boolean(selectedApp)}
          onOpenChange={(open) => {
            if (!open) setSelectedApp(null);
          }}
          installed={selectedApp ? installedApps[selectedApp.id] : undefined}
          release={selectedApp ? releases[selectedApp.id] : undefined}
          progress={selectedApp ? progressMap[selectedApp.id] : undefined}
          isFavorite={selectedApp ? favoriteSet.has(selectedApp.id) : false}
          isChecking={selectedApp ? checkingAppId === selectedApp.id : false}
          onToggleFavorite={(a) => void handleToggleFavorite(a)}
          onRemoveCustomApp={(a) => void handleRemoveCustomApp(a)}
          onInstallOrUpdate={(a) => void handleInstallOrUpdate(a)}
          onCancelDownload={(id) => void handleCancelDownload(id)}
          onLaunch={(a) => void handleLaunch(a)}
          onOpenFolder={(a) => void handleOpenFolder(a)}
          onUninstall={(a) => void handleUninstall(a)}
          onCheckRelease={(a) => void handleCheckSingleRelease(a)}
        />

        {/* Instant Keyboard Palette (Ctrl+K / Cmd+K) positioned Spotlight-high */}
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          apps={registry.apps}
          installedApps={installedApps}
          releases={releases}
          onLaunch={(a) => void handleLaunch(a)}
          onInstallOrUpdate={(a) => void handleInstallOrUpdate(a)}
          onOpenDetail={setSelectedApp}
          onCheckAllUpdates={() => void handleCheckAllUpdates(true, false)}
          onOpenCollection={() => setActiveView({ kind: "collection" })}
          onOpenScoop={() => setActiveView({ kind: "scoop" })}
          onOpenSettings={() => setActiveView({ kind: "settings" })}
          onOpenAddApp={() => setAddAppOpen(true)}
        />

        {/* Add Custom GitHub Repository Modal */}
        <AddAppDialog
          open={addAppOpen}
          onOpenChange={setAddAppOpen}
          onAddApp={handleAddCustomApp}
        />

        {/* Frosted Floating Toast Notifications */}
        {toasts.length > 0 && (
          <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex flex-col gap-2">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "craft-glass-modal pointer-events-auto flex w-80 items-start justify-between gap-3 rounded-xl border px-3.5 py-2.5 shadow-2xl",
                  t.variant === "success" && "border-emerald-500/35",
                  t.variant === "error" && "border-destructive/40",
                  (!t.variant || t.variant === "default") && "border-border"
                )}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{t.title}</p>
                  {t.description && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                      {t.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;
