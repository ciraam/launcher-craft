import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Calendar,
  ExternalLink,
  FileArchive,
  FolderOpen,
  Github,
  HardDrive,
  RefreshCw,
  Shield,
  ShieldCheck,
  Star,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AppIcon } from "@/components/AppIcon";
import { AppActionControl } from "@/components/AppActionControl";
import { formatBytes, formatRelativeDate, isUpdateAvailable } from "@/lib/semver";
import type {
  AppEntry,
  DownloadProgressEvent,
  InstalledApp,
  ReleaseInfo,
} from "@/types/launcher";

interface AppDetailDialogProps {
  app: AppEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installed?: InstalledApp;
  release?: ReleaseInfo;
  progress?: DownloadProgressEvent;
  isFavorite: boolean;
  isChecking: boolean;
  onToggleFavorite: (app: AppEntry) => void;
  onRemoveCustomApp: (app: AppEntry) => void;
  onInstallOrUpdate: (app: AppEntry) => void;
  onCancelDownload: (appId: string) => void;
  onLaunch: (app: AppEntry) => void;
  onOpenFolder: (app: AppEntry) => void;
  onUninstall: (app: AppEntry) => void;
  onCheckRelease: (app: AppEntry) => void;
}

export function AppDetailDialog({
  app,
  open,
  onOpenChange,
  installed,
  release,
  progress,
  isFavorite,
  isChecking,
  onToggleFavorite,
  onRemoveCustomApp,
  onInstallOrUpdate,
  onCancelDownload,
  onLaunch,
  onOpenFolder,
  onUninstall,
  onCheckRelease,
}: AppDetailDialogProps) {
  if (!app) return null;

  const hasUpdate = isUpdateAvailable(installed?.version, release?.version);
  const knownDigest =
    installed?.sha256 ||
    app.sha256 ||
    release?.matchedAsset?.sha256 ||
    null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="craft-glass-modal max-h-[85vh] overflow-hidden border border-border p-0 text-foreground shadow-2xl sm:max-w-[680px]">
        {/* Header section */}
        <div className="border-b border-border bg-card/85 p-5">
          <DialogHeader>
            <div className="flex items-start gap-4 pr-8">
              <AppIcon app={app} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                    {app.name}
                  </DialogTitle>
                  <Badge
                    variant="secondary"
                    className="h-5 rounded-md border border-border bg-secondary px-2 text-[11px] text-muted-foreground"
                  >
                    {app.category}
                  </Badge>
                  {app.source === "scoop" && (
                    <span className="rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10.5px] text-sky-700 dark:text-sky-300">
                      Scoop · {app.scoopBucket}
                    </span>
                  )}
                  {release?.version && (
                    <span className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground">
                      v{release.version}
                    </span>
                  )}
                  {hasUpdate && installed && (
                    <span className="rounded-md border border-[#5E6AD2]/35 bg-[#5E6AD2]/15 px-1.5 py-0.5 font-mono text-[11px] text-[#5E6AD2] dark:text-[#A8B1FF]">
                      installée : v{installed.version}
                    </span>
                  )}
                  {installed?.sha256Verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10.5px] text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="size-3" />
                      SHA-256 vérifié
                    </span>
                  ) : knownDigest || release?.matchedAsset?.checksumAsset ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 font-mono text-[10.5px] text-sky-700 dark:text-sky-300">
                      <Shield className="size-3" />
                      SHA-256 prêt
                    </span>
                  ) : null}
                </div>
                <DialogDescription className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {app.description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Action bar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-1">
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

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleFavorite(app)}
                className={
                  isFavorite
                    ? "h-8 border border-amber-500/35 bg-amber-500/12 px-2.5 text-xs text-amber-600 hover:bg-amber-500/20 dark:text-amber-300"
                    : "h-8 border border-border bg-secondary/50 px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                }
              >
                <Star className={isFavorite ? "size-3.5 fill-current" : "size-3.5"} />
                {isFavorite ? "Épinglée" : "Favori"}
              </Button>

              {app.isCustom && !installed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveCustomApp(app)}
                  className="h-8 border border-destructive/25 bg-destructive/10 px-2.5 text-xs text-destructive hover:bg-destructive/20"
                >
                  <Trash2 className="size-3.5" />
                  Retirer du catalogue
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                disabled={isChecking}
                onClick={() => onCheckRelease(app)}
                className="h-8 border border-border bg-secondary/50 px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className={isChecking ? "size-3.5 animate-spin" : "size-3.5"} />
                Synchroniser
              </Button>
              <a
                href={release?.htmlUrl || `https://github.com/${app.repo}/releases`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Github className="size-3.5" />
                GitHub
                <ExternalLink className="size-3 opacity-70" />
              </a>
            </div>
          </div>
        </div>

        {/* Scrollable details + changelog */}
        <div className="max-h-[calc(85vh-205px)] space-y-5 overflow-y-auto bg-background/90 p-5">
          {/* Technical metadata strip */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <FileArchive className="size-3.5" />
                Binaire sélectionné
              </div>
              <p className="mt-1 truncate font-mono text-xs text-foreground">
                {release?.matchedAsset?.name ?? app.assetPattern}
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                Motif : {app.assetPattern}
                {release?.matchedAsset?.size
                  ? ` · ${formatBytes(release.matchedAsset.size)}`
                  : ""}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Terminal className="size-3.5" />
                Exécutable &amp; Release
              </div>
              <p className="mt-1 truncate font-mono text-xs text-foreground">
                {app.executableName}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <Calendar className="size-3" />
                Publiée : {formatRelativeDate(release?.publishedAt)}
                {release?.fromCache ? " · Cache ETag" : ""}
              </p>
            </div>
          </div>

          {/* Integrity strip */}
          {(knownDigest || release?.matchedAsset?.checksumAsset) && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                  {installed?.sha256Verified ? (
                    <ShieldCheck className="size-3.5 text-emerald-500" />
                  ) : (
                    <Shield className="size-3.5 text-sky-500" />
                  )}
                  {installed?.sha256Verified
                    ? "Empreinte SHA-256 vérifiée avant extraction"
                    : knownDigest
                      ? "Empreinte SHA-256 attendue (vérification automatique)"
                      : `Fichier de contrôle détecté : ${release?.matchedAsset?.checksumAsset?.name}`}
                </div>
                {knownDigest && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {knownDigest}
                  </p>
                )}
              </div>
            </div>
          )}

          {installed && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  <HardDrive className="size-3.5" />
                  Installée localement (v{installed.version})
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {installed.executablePath}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenFolder(app)}
                className="h-7 shrink-0 gap-1.5 text-xs text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
              >
                <FolderOpen className="size-3.5" />
                Dossier
              </Button>
            </div>
          )}

          <Separator />

          {/* Markdown Changelog */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                Notes de version — {release?.name || release?.tagName || "Dernière release"}
              </h4>
              <span className="font-mono text-[11px] text-muted-foreground">{app.repo}</span>
            </div>

            {release?.body?.trim() ? (
              <div className="craft-prose rounded-xl border border-border bg-card p-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{release.body}</ReactMarkdown>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
                Aucun changelog fourni pour cette release.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
