import {
  ArrowUpCircle,
  Bookmark,
  CheckCircle2,
  FolderGit2,
  Layers,
  PackageSearch,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isTauriRuntime } from "@/lib/backend";
import type { NavView } from "@/types/launcher";
import { Separator } from "@/components/ui/separator";

interface SidebarProps {
  activeView: NavView;
  onSelectView: (view: NavView) => void;
  collectionCount: number;
  installedCount: number;
  updateCount: number;
  scoopIndexedCount: number;
  categories: { name: string; count: number }[];
  onOpenAddApp: () => void;
}

const CATEGORY_ICONS: Record<string, typeof Wrench> = {
  Outils: Wrench,
  Créativité: Sparkles,
  Dev: Terminal,
  Utilitaires: Layers,
};

export function Sidebar({
  activeView,
  onSelectView,
  collectionCount,
  installedCount,
  updateCount,
  scoopIndexedCount,
  categories,
  onOpenAddApp,
}: SidebarProps) {
  const native = isTauriRuntime();

  const itemClass = (active: boolean) =>
    cn(
      "group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all duration-150",
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_1px_0_var(--specular-top)]"
        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
    );

  return (
    <aside className="flex w-[236px] shrink-0 flex-col justify-between border-r border-sidebar-border bg-sidebar px-2.5 py-3 select-none">
      <div className="space-y-5 overflow-y-auto pr-0.5">
        {/* Primary navigation */}
        <div className="space-y-0.5">
          <p className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/75 uppercase">
            Bibliothèque
          </p>

          <button
            type="button"
            onClick={() => onSelectView({ kind: "collection" })}
            className={itemClass(activeView.kind === "collection")}
          >
            <span className="flex items-center gap-2.5">
              <Bookmark
                className={cn(
                  "size-4 transition-colors",
                  activeView.kind === "collection"
                    ? "text-[#5E6AD2] dark:text-[#8E98F8]"
                    : "text-muted-foreground/80 group-hover:text-foreground"
                )}
              />
              <span className="font-semibold tracking-[-0.015em] text-foreground">
                Craft<span className="text-[#5E6AD2] dark:text-[#8E98F8]">.thèque</span>
              </span>
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/80">
              {collectionCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView({ kind: "scoop" })}
            className={itemClass(activeView.kind === "scoop")}
          >
            <span className="flex items-center gap-2.5">
              <PackageSearch
                className={cn(
                  "size-4 transition-colors",
                  activeView.kind === "scoop"
                    ? "text-sky-600 dark:text-sky-400"
                    : "text-muted-foreground/80 group-hover:text-foreground"
                )}
              />
              Explorer (Scoop)
            </span>
            <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9.5px] font-medium tabular-nums text-sky-700 dark:text-sky-300">
              {scoopIndexedCount > 0 ? scoopIndexedCount.toLocaleString("fr-FR") : "5k+"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView({ kind: "installed" })}
            className={itemClass(activeView.kind === "installed")}
          >
            <span className="flex items-center gap-2.5">
              <CheckCircle2
                className={cn(
                  "size-4 transition-colors",
                  activeView.kind === "installed"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground/80 group-hover:text-foreground"
                )}
              />
              Installées
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/80">
              {installedCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView({ kind: "updates" })}
            className={itemClass(activeView.kind === "updates")}
          >
            <span className="flex items-center gap-2.5">
              <ArrowUpCircle
                className={cn(
                  "size-4 transition-colors",
                  activeView.kind === "updates"
                    ? "text-[#5E6AD2] dark:text-[#8E98F8]"
                    : updateCount > 0
                      ? "text-[#5E6AD2] dark:text-[#7D87F0]"
                      : "text-muted-foreground/80 group-hover:text-foreground"
                )}
              />
              Mises à jour
            </span>
            {updateCount > 0 ? (
              <span className="flex h-[18px] min-w-[20px] items-center justify-center rounded-full bg-[#5E6AD2] px-1.5 font-mono text-[10px] font-semibold tabular-nums text-white shadow-[0_0_12px_rgba(94,106,210,0.45)]">
                {updateCount}
              </span>
            ) : (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">0</span>
            )}
          </button>
        </div>

        {/* Categories (rendered cleanly once apps are present) */}
        {categories.length > 0 && (
          <div className="space-y-0.5">
            <p className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/75 uppercase">
              Catégories
            </p>
            {categories.map(({ name, count }) => {
              const Icon = CATEGORY_ICONS[name] ?? FolderGit2;
              const active =
                activeView.kind === "category" && activeView.category === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onSelectView({ kind: "category", category: name })}
                  className={itemClass(active)}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        active
                          ? "text-[#5E6AD2] dark:text-[#8E98F8]"
                          : "text-muted-foreground/80 group-hover:text-foreground"
                      )}
                    />
                    <span className="truncate">{name}</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground/80">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom section */}
      <div className="space-y-1.5 pt-3">
        <Separator className="mb-2" />

        <button
          type="button"
          onClick={onOpenAddApp}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <Plus className="size-4 text-muted-foreground/80" />
          Ajouter un dépôt
        </button>

        <button
          type="button"
          onClick={() => onSelectView({ kind: "settings" })}
          className={itemClass(activeView.kind === "settings")}
        >
          <span className="flex items-center gap-2.5">
            <Settings
              className={cn(
                "size-4 transition-colors",
                activeView.kind === "settings"
                  ? "text-[#5E6AD2] dark:text-[#8E98F8]"
                  : "text-muted-foreground/80 group-hover:text-foreground"
              )}
            />
            Paramètres
          </span>
        </button>

        <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-background/80 px-2.5 py-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                native
                  ? "bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                  : "bg-amber-500"
              )}
            />
            {native ? "Craft.ro Desktop" : "Mode Lecture Web"}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <ShieldCheck className="size-3 text-[#5E6AD2] dark:text-[#8E98F8]" />
            SHA-256
          </span>
        </div>
      </div>
    </aside>
  );
}
