import { Check, Github, Package, Shield, ShieldCheck, Star, Trash2 } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import { AppActionControl } from "@/components/AppActionControl";
import { Badge } from "@/components/ui/badge";
import { formatBytes, isUpdateAvailable } from "@/lib/semver";
import type {
  AppEntry,
  DownloadProgressEvent,
  InstalledApp,
  ReleaseInfo,
} from "@/types/launcher";
import { cn } from "@/lib/utils";

interface AppCardProps {
  app: AppEntry;
  installed?: InstalledApp;
  release?: ReleaseInfo;
  progress?: DownloadProgressEvent;
  isFavorite: boolean;
  layout: "grid" | "list";
  onOpenDetail: (app: AppEntry) => void;
  onToggleFavorite: (app: AppEntry) => void;
  onRemoveCustomApp: (app: AppEntry) => void;
  onInstallOrUpdate: (app: AppEntry) => void;
  onCancelDownload: (appId: string) => void;
  onLaunch: (app: AppEntry) => void;
  onOpenFolder: (app: AppEntry) => void;
  onUninstall: (app: AppEntry) => void;
  onCheckRelease: (app: AppEntry) => void;
}

export function AppCard({
  app,
  installed,
  release,
  progress,
  isFavorite,
  layout,
  onOpenDetail,
  onToggleFavorite,
  onRemoveCustomApp,
  onInstallOrUpdate,
  onCancelDownload,
  onLaunch,
  onOpenFolder,
  onUninstall,
  onCheckRelease,
}: AppCardProps) {
  const accent = app.accentColor || "#5E6AD2";
  const hasUpdate = isUpdateAvailable(installed?.version, release?.version);
  const displayVersion = release?.version
    ? `v${release.version}`
    : installed?.version
      ? `v${installed.version}`
      : null;

  const isScoop = app.source === "scoop";
  const hasSha256Source = Boolean(
    app.sha256 ||
      release?.matchedAsset?.sha256 ||
      release?.matchedAsset?.checksumAsset
  );
  const shaVerified = Boolean(installed?.sha256Verified);

  if (layout === "list") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetail(app)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenDetail(app);
          }
        }}
        className={cn(
          "group relative flex items-center justify-between gap-4 overflow-hidden rounded-xl border border-border bg-card px-4 py-3 text-left shadow-[inset_0_1px_0_var(--specular-top)] transition-all duration-150",
          "hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5E6AD2]/60"
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(360px circle at 8% 50%, ${accent}14, transparent 70%)`,
          }}
        />

        <div className="relative flex min-w-0 flex-1 items-center gap-3.5">
          <AppIcon app={app} size="sm" className="group-hover:scale-[1.04]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
                {app.name}
              </h3>
              <Badge
                variant="secondary"
                className="h-5 rounded-md border border-border bg-secondary/70 px-1.5 text-[10px] font-medium text-muted-foreground"
              >
                {app.category}
              </Badge>
              {isScoop && (
                <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-sky-700 dark:text-sky-300">
                  Scoop
                </span>
              )}
              {installed && !hasUpdate && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                  <Check className="size-2.5" />
                  Installée
                </span>
              )}
              {hasUpdate && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#5E6AD2]/30 bg-[#5E6AD2]/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#5E6AD2] dark:text-[#A8B1FF]">
                  v{installed?.version} → v{release?.version}
                </span>
              )}
              {shaVerified ? (
                <span
                  title="Intégrité SHA-256 vérifiée lors de l'installation"
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9.5px] text-emerald-700 dark:text-emerald-300"
                >
                  <ShieldCheck className="size-2.5" />
                  SHA-256
                </span>
              ) : hasSha256Source ? (
                <span
                  title="Empreinte SHA-256 disponible pour vérification"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground"
                >
                  <Shield className="size-2.5 text-sky-500" />
                  SHA-256
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{app.tagline}</p>
          </div>
        </div>

        <div className="relative hidden shrink-0 items-center gap-4 lg:flex">
          <span className="font-mono text-[11px] text-muted-foreground/80">
            {isScoop ? `${app.scoopBucket}/${app.scoopName}` : app.repo}
          </span>
          {displayVersion && (
            <span className="w-16 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {displayVersion}
            </span>
          )}
        </div>

        <div className="relative flex shrink-0 items-center justify-end gap-1.5">
          <button
            type="button"
            title={isFavorite ? "Retirer des favoris" : "Épingler en favori"}
            aria-label={isFavorite ? "Retirer des favoris" : "Épingler en favori"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(app);
            }}
            className={cn(
              "flex size-8 items-center justify-center rounded-lg border transition-colors",
              isFavorite
                ? "border-amber-500/35 bg-amber-500/12 text-amber-500 dark:text-amber-400"
                : "border-transparent text-muted-foreground/65 hover:border-border hover:bg-accent hover:text-foreground"
            )}
          >
            <Star className={cn("size-3.5", isFavorite && "fill-current")} />
          </button>

          {app.isCustom && !installed && (
            <button
              type="button"
              title="Retirer du catalogue"
              aria-label="Retirer du catalogue"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveCustomApp(app);
              }}
              className="flex size-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground/65 transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}

          <AppActionControl
            app={app}
            installed={installed}
            release={release}
            progress={progress}
            onInstallOrUpdate={onInstallOrUpdate}
            onCancelDownload={onCancelDownload}
            onLaunch={onLaunch}
            onOpenFolder={onOpenFolder}
            onUninstall={onUninstall}
            onCheckRelease={onCheckRelease}
            compact
          />
        </div>
      </div>
    );
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail(app)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail(app);
        }
      }}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-4 text-left shadow-[inset_0_1px_0_var(--specular-top)] transition-all duration-200",
        "hover:-translate-y-[1.5px] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:shadow-[0_14px_30px_-14px_rgba(0,0,0,0.22)] dark:hover:shadow-[0_14px_34px_-14px_rgba(0,0,0,0.8)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5E6AD2]/60",
        hasUpdate && "border-[#5E6AD2]/40"
      )}
    >
      {/* Subtle accent radial glow on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-12 size-44 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `${accent}22` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}66, transparent)`,
        }}
      />

      {/* Top row: Icon + Status / Source / Category */}
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <AppIcon app={app} size="md" className="group-hover:scale-[1.04]" />

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {isScoop && (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 font-mono text-[9.5px] font-medium text-sky-700 dark:text-sky-300">
                Scoop
              </span>
            )}
            {installed && !hasUpdate && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="size-2.5" />
                Installée
              </span>
            )}
            {hasUpdate && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#5E6AD2]/40 bg-[#5E6AD2]/15 px-2 py-0.5 font-mono text-[10px] font-medium text-[#5E6AD2] dark:text-[#A8B1FF]">
                Mise à jour
              </span>
            )}
            <Badge
              variant="secondary"
              className="h-5 rounded-md border border-border bg-secondary/70 px-2 text-[10px] font-medium text-muted-foreground"
            >
              {app.category}
            </Badge>
            <button
              type="button"
              title={isFavorite ? "Retirer des favoris" : "Épingler dans Ma Collection"}
              aria-label={isFavorite ? "Retirer des favoris" : "Épingler dans Ma Collection"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(app);
              }}
              className={cn(
                "flex size-6 items-center justify-center rounded-md border transition-all",
                isFavorite
                  ? "border-amber-500/35 bg-amber-500/12 text-amber-500 dark:text-amber-400"
                  : "border-transparent text-muted-foreground/60 opacity-75 hover:border-border hover:bg-accent hover:text-foreground group-hover:opacity-100"
              )}
            >
              <Star className={cn("size-3.5", isFavorite && "fill-current")} />
            </button>
          </div>
        </div>

        {/* Title & tagline */}
        <div className="mt-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-[15px] font-semibold tracking-[-0.015em] text-foreground">
              {app.name}
            </h3>
            {displayVersion && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {displayVersion}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 min-h-[34px] text-[12.5px] leading-[1.45] text-muted-foreground">
            {app.tagline}
          </p>
        </div>

        {/* Repo/Scoop + SHA-256 + Size */}
        <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground/80">
          <span className="flex min-w-0 items-center gap-1.5 truncate font-mono">
            {isScoop ? (
              <Package className="size-3 shrink-0 text-sky-500" />
            ) : (
              <Github className="size-3 shrink-0" />
            )}
            <span className="truncate">
              {isScoop ? `${app.scoopBucket}/${app.scoopName}` : app.repo}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {shaVerified ? (
              <span
                title="Intégrité SHA-256 vérifiée"
                className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-600 dark:text-emerald-400"
              >
                <ShieldCheck className="size-3" />
                SHA-256
              </span>
            ) : hasSha256Source ? (
              <span
                title="Empreinte SHA-256 disponible pour vérification"
                className="inline-flex items-center gap-1 font-mono text-[10px] text-sky-600 dark:text-sky-400/90"
              >
                <Shield className="size-3" />
                SHA-256
              </span>
            ) : null}
            {release?.matchedAsset?.size ? (
              <span className="font-mono text-[10.5px] tabular-nums">
                {formatBytes(release.matchedAsset.size)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Footer: Smart single action control */}
      <div className="relative mt-4 flex items-center justify-between gap-2 border-t border-border pt-3.5">
        <AppActionControl
          app={app}
          installed={installed}
          release={release}
          progress={progress}
          onInstallOrUpdate={onInstallOrUpdate}
          onCancelDownload={onCancelDownload}
          onLaunch={onLaunch}
          onOpenFolder={onOpenFolder}
          onUninstall={onUninstall}
          onCheckRelease={onCheckRelease}
        />

        {app.isCustom && !installed && !progress && (
          <button
            type="button"
            title="Retirer du catalogue"
            aria-label="Retirer du catalogue"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveCustomApp(app);
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground/65 transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </article>
  );
}
