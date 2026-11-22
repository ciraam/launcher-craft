import { useState } from "react";
import {
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { CraftLogo } from "@/components/CraftLogo";
import { isTauriRuntime, windowControls } from "@/lib/backend";
import { getShortcutDisplay } from "@/lib/platform";
import type { ThemeMode } from "@/types/launcher";
import { cn } from "@/lib/utils";

interface TitleBarProps {
  onOpenPalette: () => void;
  isSyncing: boolean;
  updateCount: number;
  hasGithubToken: boolean;
  theme: ThemeMode;
  onCycleTheme: () => void;
}

export function TitleBar({
  onOpenPalette,
  isSyncing,
  updateCount,
  hasGithubToken,
  theme,
  onCycleTheme,
}: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const native = isTauriRuntime();
  const searchShortcut = getShortcutDisplay("K");

  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!native) return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (e.buttons === 1) {
      if (e.detail === 2) {
        void windowControls.toggleMaximize().then(setIsMaximized);
      } else {
        void windowControls.startDragging();
      }
    }
  };

  const themeTitle =
    theme === "dark"
      ? "Thème : Sombre (cliquer pour Clair)"
      : theme === "light"
        ? "Thème : Clair (cliquer pour Système)"
        : "Thème : Système (cliquer pour Sombre)";

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleDragStart}
      className="craft-glass sticky top-0 z-30 flex h-11 shrink-0 select-none items-center justify-between border-b border-border px-3"
    >
      {/* Left: Crisp Craft.ro SVG emblem & wordmark */}
      <div className="flex items-center gap-2.5 pl-1">
        <CraftLogo className="size-6 drop-shadow-[0_1px_6px_rgba(94,106,210,0.35)]" />
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13.5px] font-semibold tracking-[-0.02em] text-foreground">
            Craft<span className="text-[#5E6AD2] dark:text-[#8E98F8]">.ro</span>
          </span>
          <span className="hidden rounded-full border border-border bg-secondary/70 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-muted-foreground sm:inline-block">
            v1.0.0
          </span>
        </div>
      </div>

      {/* Center: Raycast-style command trigger with OS-aware shortcut */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="group flex h-7 w-full max-w-[380px] items-center justify-between gap-2 rounded-lg border border-border bg-background/80 px-2.5 text-xs text-muted-foreground transition-all hover:border-[var(--border-strong)] hover:bg-card hover:text-foreground"
      >
        <span className="flex items-center gap-2 truncate">
          <Search className="size-3.5 text-muted-foreground/80 transition-colors group-hover:text-[#5E6AD2] dark:group-hover:text-[#8E98F8]" />
          <span className="truncate">Rechercher ou lancer une application…</span>
        </span>
        <kbd className="hidden shrink-0 items-center rounded border border-border bg-secondary/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
          {searchShortcut}
        </kbd>
      </button>

      {/* Right: Sync / Vault status + Quick Theme Toggle + Window controls */}
      <div className="flex items-center gap-1.5">
        <div className="mr-1 hidden items-center gap-2.5 md:flex">
          {hasGithubToken && (
            <span
              title="Token GitHub sécurisé dans Windows Credential Manager"
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300"
            >
              <ShieldCheck className="size-3" />
              PAT
            </span>
          )}

          {isSyncing ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <RefreshCw className="size-3 animate-spin text-[#5E6AD2] dark:text-[#8E98F8]" />
              Synchronisation…
            </span>
          ) : updateCount > 0 ? (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#5E6AD2] dark:text-[#A8B1FF]">
              <span className="size-1.5 rounded-full bg-[#5E6AD2] shadow-[0_0_8px_#5E6AD2]" />
              {updateCount} MAJ
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              À jour
            </span>
          )}
        </div>

        <button
          type="button"
          title={themeTitle}
          aria-label={themeTitle}
          onClick={onCycleTheme}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {theme === "dark" ? (
            <Moon className="size-3.5" />
          ) : theme === "light" ? (
            <Sun className="size-3.5" />
          ) : (
            <Monitor className="size-3.5" />
          )}
        </button>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Minimiser"
            onClick={() => void windowControls.minimize()}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? "Restaurer" : "Agrandir"}
            onClick={() => void windowControls.toggleMaximize().then(setIsMaximized)}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {isMaximized ? (
              <Minimize2 className="size-3" />
            ) : (
              <Maximize2 className="size-3" />
            )}
          </button>
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => void windowControls.close()}
            className={cn(
              "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-[#E5484D] hover:text-white"
            )}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
