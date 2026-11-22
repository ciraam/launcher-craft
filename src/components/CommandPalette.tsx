import {
  ArrowUpCircle,
  Bookmark,
  Download,
  PackageSearch,
  Play,
  Plus,
  RefreshCw,
  Settings,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { AppIcon } from "@/components/AppIcon";
import { isUpdateAvailable } from "@/lib/semver";
import { getShortcutDisplay } from "@/lib/platform";
import type { AppEntry, InstalledApp, ReleaseInfo } from "@/types/launcher";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apps: AppEntry[];
  installedApps: Record<string, InstalledApp>;
  releases: Record<string, ReleaseInfo>;
  onLaunch: (app: AppEntry) => void;
  onInstallOrUpdate: (app: AppEntry) => void;
  onOpenDetail: (app: AppEntry) => void;
  onCheckAllUpdates: () => void;
  onOpenCollection: () => void;
  onOpenScoop: () => void;
  onOpenSettings: () => void;
  onOpenAddApp: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  apps,
  installedApps,
  releases,
  onLaunch,
  onInstallOrUpdate,
  onOpenDetail,
  onCheckAllUpdates,
  onOpenCollection,
  onOpenScoop,
  onOpenSettings,
  onOpenAddApp,
}: CommandPaletteProps) {
  const installedList = apps.filter((a) => Boolean(installedApps[a.id]));
  const availableList = apps.filter((a) => !installedApps[a.id]);
  const refreshShortcut = getShortcutDisplay("R");

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Recherche rapide Craft.ro"
      description="Filtrez et lancez vos applications au clavier"
      className="craft-glass-modal border border-border shadow-2xl sm:max-w-[560px]"
    >
      <Command className="bg-transparent text-foreground">
        <CommandInput
          placeholder="Rechercher une app, catégorie ou dépôt GitHub…"
          className="h-10 text-[13px] placeholder:text-muted-foreground"
        />
        <CommandList className="max-h-[380px] p-1">
          <CommandEmpty className="py-8 text-center text-xs text-muted-foreground">
            Aucune application ne correspond à votre recherche.
          </CommandEmpty>

          {installedList.length > 0 && (
            <CommandGroup heading="Applications installées (Entrée pour lancer)">
              {installedList.map((app) => {
                const inst = installedApps[app.id];
                const rel = releases[app.id];
                const hasUpdate = isUpdateAvailable(inst?.version, rel?.version);
                return (
                  <CommandItem
                    key={app.id}
                    value={`${app.name} ${app.tagline} ${app.category} ${app.repo}`}
                    onSelect={() => {
                      onOpenChange(false);
                      onLaunch(app);
                    }}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <AppIcon app={app} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">
                            {app.name}
                          </span>
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            v{inst.version}
                          </span>
                          {hasUpdate && rel && (
                            <span className="rounded bg-[#5E6AD2]/15 px-1.5 py-0.5 font-mono text-[10px] text-[#5E6AD2] dark:text-[#A8B1FF]">
                              → v{rel.version}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-[11.5px] text-muted-foreground">
                          {app.tagline}
                        </p>
                      </div>
                    </div>
                    <CommandShortcut className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                      <Play className="size-3 fill-current" />
                      Ouvrir
                    </CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {availableList.length > 0 && (
            <>
              <CommandSeparator className="my-1" />
              <CommandGroup heading="Catalogue disponible (Entrée pour installer)">
                {availableList.map((app) => {
                  const rel = releases[app.id];
                  return (
                    <CommandItem
                      key={app.id}
                      value={`${app.name} ${app.tagline} ${app.category} ${app.repo}`}
                      onSelect={() => {
                        onOpenChange(false);
                        onInstallOrUpdate(app);
                      }}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <AppIcon app={app} size="sm" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-foreground">
                              {app.name}
                            </span>
                            {rel && (
                              <span className="font-mono text-[10.5px] text-muted-foreground">
                                v{rel.version}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-[11.5px] text-muted-foreground">
                            {app.tagline}
                          </p>
                        </div>
                      </div>
                      <CommandShortcut className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Download className="size-3" />
                        Installer
                      </CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}

          <CommandSeparator className="my-1" />
          <CommandGroup heading="Actions rapides">
            <CommandItem
              value="craft theque craft.theque ma collection favoris depots personnels epingles"
              onSelect={() => {
                onOpenChange(false);
                onOpenCollection();
              }}
              className="cursor-pointer rounded-lg px-2.5 py-2 text-[13px]"
            >
              <Bookmark className="size-4 text-[#5E6AD2] dark:text-[#8E98F8]" />
              <span>
                Ouvrir Craft<span className="text-[#5E6AD2] dark:text-[#8E98F8]">.thèque</span>
              </span>
            </CommandItem>

            <CommandItem
              value="explorer catalogue scoop 5000 apps windows main extras"
              onSelect={() => {
                onOpenChange(false);
                onOpenScoop();
              }}
              className="cursor-pointer rounded-lg px-2.5 py-2 text-[13px]"
            >
              <PackageSearch className="size-4 text-sky-500" />
              Explorer le catalogue Scoop (+5 000 apps)
            </CommandItem>

            <CommandItem
              value="verifier mises a jour synchroniser github releases"
              onSelect={() => {
                onOpenChange(false);
                onCheckAllUpdates();
              }}
              className="cursor-pointer rounded-lg px-2.5 py-2 text-[13px]"
            >
              <RefreshCw className="size-4 text-[#5E6AD2] dark:text-[#8E98F8]" />
              Vérifier toutes les mises à jour
              <CommandShortcut>{refreshShortcut}</CommandShortcut>
            </CommandItem>

            <CommandItem
              value="ajouter depot github application prive public"
              onSelect={() => {
                onOpenChange(false);
                onOpenAddApp();
              }}
              className="cursor-pointer rounded-lg px-2.5 py-2 text-[13px]"
            >
              <Plus className="size-4 text-muted-foreground" />
              Ajouter un dépôt GitHub personnalisé
            </CommandItem>

            <CommandItem
              value="parametres dossier installation token github pat theme clair sombre"
              onSelect={() => {
                onOpenChange(false);
                onOpenSettings();
              }}
              className="cursor-pointer rounded-lg px-2.5 py-2 text-[13px]"
            >
              <Settings className="size-4 text-muted-foreground" />
              Ouvrir les Paramètres
            </CommandItem>

            {installedList
              .filter((a) =>
                isUpdateAvailable(installedApps[a.id]?.version, releases[a.id]?.version)
              )
              .map((a) => (
                <CommandItem
                  key={`detail-${a.id}`}
                  value={`changelog notes version ${a.name}`}
                  onSelect={() => {
                    onOpenChange(false);
                    onOpenDetail(a);
                  }}
                  className="cursor-pointer rounded-lg px-2.5 py-2 text-[13px]"
                >
                  <ArrowUpCircle className="size-4 text-[#5E6AD2] dark:text-[#8E98F8]" />
                  Voir le changelog de {a.name} (v{releases[a.id]?.version})
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
