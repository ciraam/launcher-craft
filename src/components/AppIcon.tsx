import {
  Activity,
  Camera,
  FileCode2,
  Film,
  Gauge,
  Layers,
  Package,
  Search,
  Send,
  Sparkles,
  SpellCheck,
  Terminal,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppEntry } from "@/types/launcher";

interface AppIconProps {
  app: AppEntry;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const ICON_MAP: Record<string, typeof Package> = {
  "win-boost": Gauge,
  "net-boost": Activity,
  orthocorrect: SpellCheck,
  localsend: Send,
  "flow-launcher": Zap,
  screentogif: Film,
  sharex: Camera,
  alacritty: Terminal,
  ripgrep: Search,
  bat: FileCode2,
};

const CATEGORY_ICON_MAP: Record<string, typeof Package> = {
  Dev: Terminal,
  Créativité: Sparkles,
  Outils: Zap,
  Utilitaires: Layers,
};

export function AppIcon({ app, size = "md", className }: AppIconProps) {
  const accent = app.accentColor || "#5E6AD2";
  const isUrl = /^https?:\/\//i.test(app.icon) || app.icon.startsWith("/") || app.icon.startsWith("./");

  const dimensions = {
    sm: "size-8 rounded-lg",
    md: "size-11 rounded-xl",
    lg: "size-14 rounded-2xl",
  }[size];

  const iconSize = {
    sm: "size-4",
    md: "size-5",
    lg: "size-6",
  }[size];

  const IconComponent =
    ICON_MAP[app.icon.toLowerCase()] ??
    CATEGORY_ICON_MAP[app.category] ??
    Package;

  if (isUrl) {
    return (
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-[#1B1E25]",
          dimensions,
          className
        )}
      >
        <img
          src={app.icon}
          alt={app.name}
          className="size-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center border shadow-inner transition-transform duration-200",
        dimensions,
        className
      )}
      style={{
        background: `linear-gradient(145deg, ${accent}24 0%, ${accent}0D 100%)`,
        borderColor: `${accent}38`,
        boxShadow: `inset 0 1px 0 0 ${accent}25`,
      }}
    >
      <IconComponent className={iconSize} style={{ color: accent }} strokeWidth={1.9} />
    </div>
  );
}
