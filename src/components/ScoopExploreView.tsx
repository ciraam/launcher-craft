import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  Check,
  Download,
  Loader2,
  Package,
  PackageSearch,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as backend from "@/lib/backend";
import { formatRelativeDate } from "@/lib/semver";
import type {
  AppEntry,
  DownloadProgressEvent,
  InstalledApp,
  ScoopIndexEntry,
  ScoopSearchResult,
} from "@/types/launcher";
import { cn } from "@/lib/utils";

interface ScoopExploreViewProps {
  existingApps: AppEntry[];
  installedApps: Record<string, InstalledApp>;
  progressMap: Record<string, DownloadProgressEvent>;
  onIndexCountChange: (count: number) => void;
  onImportScoopApp: (bucket: string, name: string, andInstall: boolean) => Promise<void>;
  onLaunchApp: (app: AppEntry) => void;
  onNotifyError: (title: string, message: string) => void;
}

type BucketFilter = "all" | "Main" | "Extras";
type ScoopSort = "relevance" | "name-asc" | "name-desc" | "installed-first";
type ScoopStatusFilter = "all" | "in-library" | "installed" | "not-installed";

const SCOOP_SORT_LABELS: Record<ScoopSort, string> = {
  relevance: "Pertinence",
  "name-asc": "Nom (A-Z)",
  "name-desc": "Nom (Z-A)",
  "installed-first": "Installées d'abord",
};

function scoopIdFor(bucket: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `scoop-${bucket.toLowerCase()}-${slug}`.slice(0, 64).replace(/-$/, "");
}

function prettifyName(raw: string): string {
  return raw
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function ScoopExploreView({
  existingApps,
  installedApps,
  progressMap,
  onIndexCountChange,
  onImportScoopApp,
  onLaunchApp,
  onNotifyError,
}: ScoopExploreViewProps) {
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<BucketFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ScoopStatusFilter>("all");
  const [sortBy, setSortBy] = useState<ScoopSort>("relevance");
  const [result, setResult] = useState<ScoopSearchResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const hasActiveFilters =
    query.trim().length > 0 ||
    bucket !== "all" ||
    statusFilter !== "all" ||
    sortBy !== "relevance";

  const resetFilters = () => {
    setQuery("");
    setBucket("all");
    setStatusFilter("all");
    setSortBy("relevance");
  };

  const displayedItems = useMemo(() => {
    if (!result) return [];
    const existingIds = new Set(existingApps.map((a) => a.id));

    let list = result.items.filter((item) => {
      const id = scoopIdFor(item.bucket, item.name);
      const isInstalled = Boolean(installedApps[id]);
      const inLibrary = existingIds.has(id);
      if (statusFilter === "installed") return isInstalled;
      if (statusFilter === "in-library") return inLibrary;
      if (statusFilter === "not-installed") return !isInstalled;
      return true;
    });

    if (sortBy === "name-asc") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "name-desc") {
      list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortBy === "installed-first") {
      list = [...list].sort((a, b) => {
        const ia = installedApps[scoopIdFor(a.bucket, a.name)] ? 1 : 0;
        const ib = installedApps[scoopIdFor(b.bucket, b.name)] ? 1 : 0;
        if (ia !== ib) return ib - ia;
        return a.name.localeCompare(b.name);
      });
    }

    return list;
  }, [existingApps, installedApps, result, sortBy, statusFilter]);

  const syncIndex = async (force: boolean) => {
    setSyncing(true);
    try {
      const res = await backend.syncScoopIndex(force);
      setResult(res);
      onIndexCountChange(res.totalIndexed);
      if (query.trim() || bucket !== "all") {
        const filtered = await backend.searchScoopApps(query, bucket, 60);
        setResult(filtered);
      }
    } catch (err) {
      onNotifyError(
        "Erreur de synchronisation Scoop",
        err instanceof Error ? err.message : "Impossible de récupérer l'index Scoop."
      );
    } finally {
      setSyncing(false);
    }
  };

  // Initial load: read cached index or auto-sync on first visit
  useEffect(() => {
    let active = true;
    async function init() {
      setSyncing(true);
      try {
        const initial = await backend.syncScoopIndex(false);
        if (!active) return;
        setResult(initial);
        onIndexCountChange(initial.totalIndexed);
      } catch (err) {
        if (!active) return;
        onNotifyError(
          "Catalogue Scoop indisponible",
          err instanceof Error ? err.message : "Vérifiez votre connexion ou configurez un PAT GitHub."
        );
      } finally {
        if (active) setSyncing(false);
      }
    }
    void init();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced instant local search
  useEffect(() => {
    if (!result && syncing) return;
    let active = true;
    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const next = await backend.searchScoopApps(query, bucket, 60);
        if (active) setResult(next);
      } finally {
        if (active) setSearching(false);
      }
    }, 100);

    return () => {
      active = false;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, bucket]);

  const handleAction = async (entry: ScoopIndexEntry, andInstall: boolean) => {
    const key = `${entry.bucket}:${entry.name}:${andInstall ? "install" : "add"}`;
    setBusyKey(key);
    try {
      await onImportScoopApp(entry.bucket, entry.name, andInstall);
    } finally {
      setBusyKey(null);
    }
  };

  const totalIndexed = result?.totalIndexed ?? 0;

  return (
    <div className="mx-auto max-w-[1140px] space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-foreground">
              Explorer (Scoop)
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-sky-700 dark:text-sky-300">
              <ShieldCheck className="size-3" />
              {totalIndexed > 0
                ? `${totalIndexed.toLocaleString("fr-FR")} apps Windows`
                : "+5 000 apps Windows"}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Index officiel <code className="font-mono text-xs">ScoopInstaller/Main</code> &amp;{" "}
            <code className="font-mono text-xs">Extras</code> avec vérification SHA-256 et anti-DNS rebinding.
            {result?.updatedAt ? ` · Index : ${formatRelativeDate(result.updatedAt)}` : ""}
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          disabled={syncing}
          onClick={() => void syncIndex(true)}
          className="h-8 border border-border bg-card px-3 text-xs text-foreground hover:bg-accent"
        >
          <RefreshCw className={cn("size-3.5", syncing && "animate-spin text-[#5E6AD2]")} />
          Synchroniser l'index
        </Button>
      </div>

      {/* Search bar + Bucket Filter Pills */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher parmi 5 000+ paquets (ex: 7zip, ffmpeg, git, vlc, obsidian, python)…"
            className="h-10 border-border bg-card pl-9 pr-8 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-[#5E6AD2]/60"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card p-1">
          {(
            [
              { id: "all", label: "Tous", count: result?.totalIndexed ?? 0 },
              { id: "Main", label: "Main", count: result?.mainCount ?? 0 },
              { id: "Extras", label: "Extras", count: result?.extrasCount ?? 0 },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setBucket(tab.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                bucket === tab.id
                  ? "bg-[#5E6AD2] text-white shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  className={cn(
                    "font-mono text-[10px] tabular-nums",
                    bucket === tab.id ? "text-white/80" : "text-muted-foreground/75"
                  )}
                >
                  {tab.count.toLocaleString("fr-FR")}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Multi-criteria Filter & Sort bar */}
      {result && !syncing && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border bg-card/75 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background/80 p-0.5">
              {(
                [
                  { id: "all", label: "Toutes" },
                  { id: "in-library", label: "Dans Craft.thèque" },
                  { id: "installed", label: "Installées" },
                  { id: "not-installed", label: "Non installées" },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setStatusFilter(pill.id)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11.5px] font-medium transition-all",
                    statusFilter === pill.id
                      ? "bg-[#5E6AD2] text-white shadow-xs"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            <span className="hidden items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 font-mono text-[10.5px] text-emerald-700 dark:text-emerald-300 md:inline-flex">
              <ShieldCheck className="size-3" />
              SHA-256 actif
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {searching ? (
                "Recherche…"
              ) : (
                <>
                  <strong className="text-foreground">
                    {statusFilter === "all"
                      ? result.totalMatches.toLocaleString("fr-FR")
                      : displayedItems.length.toLocaleString("fr-FR")}
                  </strong>{" "}
                  paquet{(statusFilter === "all" ? result.totalMatches : displayedItems.length) > 1 ? "s" : ""}
                </>
              )}
            </span>

            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-7 gap-1 px-2 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-3" />
                Réinitialiser
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 gap-1.5 border border-border bg-background/85 px-2.5 text-[11.5px] font-medium text-foreground hover:bg-accent"
                  />
                }
              >
                <ArrowDownUp className="size-3 text-muted-foreground" />
                {SCOOP_SORT_LABELS[sortBy]}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="craft-glass w-44 border border-border p-1 text-popover-foreground shadow-xl"
              >
                {(Object.keys(SCOOP_SORT_LABELS) as ScoopSort[]).map((opt) => (
                  <DropdownMenuItem
                    key={opt}
                    onClick={() => setSortBy(opt)}
                    className="flex cursor-pointer items-center justify-between text-xs"
                  >
                    <span>{SCOOP_SORT_LABELS[opt]}</span>
                    {sortBy === opt && (
                      <Check className="size-3.5 text-[#5E6AD2] dark:text-[#8E98F8]" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Loading Skeletons or Results Grid */}
      {syncing && !result ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="flex h-[132px] flex-col justify-between rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="h-5 w-14 animate-pulse rounded-md bg-muted" />
              </div>
              <div className="h-3 w-40 animate-pulse rounded bg-muted/70" />
              <div className="flex gap-2 pt-2">
                <div className="h-7 w-20 animate-pulse rounded-lg bg-muted" />
                <div className="h-7 w-24 animate-pulse rounded-lg bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : !result || displayedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
            <PackageSearch className="size-5" />
          </div>
          <h3 className="mt-3.5 text-sm font-medium text-foreground">
            Aucun paquet Scoop trouvé
          </h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Essayez un autre nom de paquet, réinitialisez les filtres ou synchronisez l'index ScoopInstaller.
          </p>
          {hasActiveFilters && (
            <Button
              size="sm"
              variant="secondary"
              onClick={resetFilters}
              className="mt-4 h-8 border border-border bg-card px-3 text-xs"
            >
              <RotateCcw className="size-3.5" />
              Réinitialiser les filtres
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {displayedItems.map((item) => {
            const appId = scoopIdFor(item.bucket, item.name);
            const existing = existingApps.find((a) => a.id === appId);
            const installed = installedApps[appId];
            const prog = progressMap[appId];
            const isAdding = busyKey === `${item.bucket}:${item.name}:add`;
            const isInstalling =
              busyKey === `${item.bucket}:${item.name}:install` || Boolean(prog);
            const isMain = item.bucket === "Main";

            return (
              <div
                key={`${item.bucket}/${item.name}`}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[inset_0_1px_0_var(--specular-top)] transition-all duration-150 hover:-translate-y-[1px] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
                          isMain
                            ? "border-sky-500/30 bg-sky-500/12 text-sky-600 dark:text-sky-400"
                            : "border-violet-500/30 bg-violet-500/12 text-violet-600 dark:text-violet-400"
                        )}
                      >
                        <Package className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
                          {prettifyName(item.name)}
                        </h3>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {item.name}
                        </p>
                      </div>
                    </div>

                    <Badge
                      variant="secondary"
                      className={cn(
                        "h-5 shrink-0 rounded-md border px-1.5 text-[10px] font-medium",
                        isMain
                          ? "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                          : "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                      )}
                    >
                      {item.bucket}
                    </Badge>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate font-mono">
                      ScoopInstaller/{item.bucket}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="size-2.5" />
                      SHA-256
                    </span>
                  </div>
                </div>

                {/* 1-click actions */}
                <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-border pt-3">
                  {installed && existing ? (
                    <Button
                      size="sm"
                      onClick={() => onLaunchApp(existing)}
                      className="h-7 bg-foreground px-3 text-xs font-semibold text-background hover:opacity-90"
                    >
                      <Play className="size-3 fill-current" />
                      Ouvrir
                    </Button>
                  ) : (
                    <div className="flex w-full items-center justify-between gap-2">
                      {existing ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          <Check className="size-3.5" />
                          Dans Craft.thèque
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isAdding || isInstalling}
                          onClick={() => void handleAction(item, false)}
                          className="h-7 border border-border bg-secondary/50 px-2.5 text-xs text-foreground hover:bg-accent"
                        >
                          {isAdding ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Plus className="size-3" />
                          )}
                          Ajouter
                        </Button>
                      )}

                      <Button
                        size="sm"
                        disabled={isAdding || isInstalling}
                        onClick={() => void handleAction(item, true)}
                        className="h-7 bg-[#5E6AD2] px-3 text-xs font-medium text-white hover:bg-[#6B77DF]"
                      >
                        {isInstalling ? (
                          <>
                            <Loader2 className="size-3 animate-spin" />
                            {prog ? `${Math.round(prog.percentage)}%` : "Import…"}
                          </>
                        ) : (
                          <>
                            <Download className="size-3" />
                            Installer
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
