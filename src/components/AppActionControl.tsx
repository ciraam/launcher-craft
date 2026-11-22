import {
  ArrowUpCircle,
  Download,
  FolderOpen,
  MoreHorizontal,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes, formatSpeed, isUpdateAvailable } from "@/lib/semver";
import type {
  AppEntry,
  DownloadProgressEvent,
  InstalledApp,
  ReleaseInfo,
} from "@/types/launcher";
import { cn } from "@/lib/utils";

interface AppActionControlProps {
  app: AppEntry;
  installed?: InstalledApp;
  release?: ReleaseInfo;
  progress?: DownloadProgressEvent;
  onInstallOrUpdate: (app: AppEntry) => void;
  onCancelDownload: (appId: string) => void;
  onLaunch: (app: AppEntry) => void;
  onOpenFolder: (app: AppEntry) => void;
  onUninstall: (app: AppEntry) => void;
  onCheckRelease: (app: AppEntry) => void;
  compact?: boolean;
}

export function AppActionControl({
  app,
  installed,
  release,
  progress,
  onInstallOrUpdate,
  onCancelDownload,
  onLaunch,
  onOpenFolder,
  onUninstall,
  onCheckRelease,
  compact = false,
}: AppActionControlProps) {
  const isBusy =
    progress &&
    (progress.status === "downloading" ||
      progress.status === "verifying" ||
      progress.status === "extracting" ||
      progress.status === "installing");

  if (isBusy) {
    const pct = Math.max(2, Math.min(100, Math.round(progress.percentage)));
    const phaseLabel =
      progress.status === "verifying"
        ? "SHA-256…"
        : progress.status === "extracting"
          ? "Extraction…"
          : progress.status === "installing"
            ? "Installation…"
            : `${pct}%`;

    return (
      <div
        className={cn("flex items-center gap-2", compact ? "w-full max-w-[250px]" : "w-full")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1 truncate font-medium tabular-nums text-foreground">
              {progress.status === "verifying" && (
                <ShieldCheck className="size-3 shrink-0 text-emerald-500" />
              )}
              {phaseLabel}
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
              {progress.status === "downloading" ? (
                <>
                  {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}
                  {progress.speedBytesPerSec > 0 && ` · ${formatSpeed(progress.speedBytesPerSec)}`}
                </>
              ) : (
                progress.message || "Traitement…"
              )}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-150",
                progress.status === "downloading"
                  ? "bg-gradient-to-r from-[#5E6AD2] to-[#8E98F8]"
                  : progress.status === "verifying"
                    ? "animate-pulse bg-sky-500"
                    : "animate-pulse bg-emerald-500"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Annuler le téléchargement"
          onClick={() => onCancelDownload(app.id)}
          className="shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  const hasUpdate = isUpdateAvailable(installed?.version, release?.version);

  // State 1: Installed + Update Available
  if (installed && hasUpdate && release) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          onClick={() => onInstallOrUpdate(app)}
          className="h-8 bg-[#5E6AD2] px-3 text-xs font-medium text-white shadow-[0_1px_14px_rgba(94,106,210,0.35)] hover:bg-[#6B77DF]"
        >
          <ArrowUpCircle className="size-3.5" />
          Mettre à jour (v{release.version})
        </Button>

        <SecondaryAppMenu
          app={app}
          showLaunch
          onLaunch={onLaunch}
          onOpenFolder={onOpenFolder}
          onUninstall={onUninstall}
          onCheckRelease={onCheckRelease}
        />
      </div>
    );
  }

  // State 2: Installed & Up-to-date
  if (installed) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          onClick={() => onLaunch(app)}
          className="h-8 bg-foreground px-3.5 text-xs font-semibold text-background hover:opacity-90"
        >
          <Play className="size-3 fill-current" />
          Ouvrir
        </Button>

        <SecondaryAppMenu
          app={app}
          showLaunch={false}
          onLaunch={onLaunch}
          onOpenFolder={onOpenFolder}
          onUninstall={onUninstall}
          onCheckRelease={onCheckRelease}
        />
      </div>
    );
  }

  // State 3: Not installed
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onInstallOrUpdate(app)}
        className="h-8 border border-border bg-secondary px-3.5 text-xs font-medium text-foreground transition-all hover:border-[#5E6AD2]/65 hover:bg-[#5E6AD2] hover:text-white hover:shadow-[0_0_16px_rgba(94,106,210,0.3)]"
      >
        <Download className="size-3.5" />
        Installer
      </Button>
    </div>
  );
}

function SecondaryAppMenu({
  app,
  showLaunch,
  onLaunch,
  onOpenFolder,
  onUninstall,
  onCheckRelease,
}: {
  app: AppEntry;
  showLaunch: boolean;
  onLaunch: (app: AppEntry) => void;
  onOpenFolder: (app: AppEntry) => void;
  onUninstall: (app: AppEntry) => void;
  onCheckRelease: (app: AppEntry) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Plus d'actions"
            className="h-8 w-8 border border-border bg-secondary/50 text-muted-foreground hover:bg-accent hover:text-foreground"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="craft-glass w-48 border border-border p-1 text-popover-foreground shadow-xl"
      >
        {showLaunch && (
          <DropdownMenuItem
            onClick={() => onLaunch(app)}
            className="cursor-pointer text-xs"
          >
            <Play className="size-3.5 text-muted-foreground" />
            Lancer la version actuelle
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => onOpenFolder(app)}
          className="cursor-pointer text-xs"
        >
          <FolderOpen className="size-3.5 text-muted-foreground" />
          Ouvrir le dossier
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onCheckRelease(app)}
          className="cursor-pointer text-xs"
        >
          <RefreshCw className="size-3.5 text-muted-foreground" />
          Vérifier la release
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onUninstall(app)}
          className="cursor-pointer text-xs text-destructive focus:bg-destructive/15 focus:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Désinstaller
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
