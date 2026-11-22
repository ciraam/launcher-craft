import { ArrowDownUp, Check, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SortOption, SourceFilter, StatusFilter } from "@/types/launcher";
import { cn } from "@/lib/utils";

interface FilterSortBarProps {
  sortBy: SortOption;
  onSortChange: (next: SortOption) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (next: StatusFilter) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (next: SourceFilter) => void;
  sha256Only: boolean;
  onSha256OnlyChange: (next: boolean) => void;
  filteredCount: number;
  totalInView: number;
  hasActiveFilters: boolean;
  onReset: () => void;
  hideStatusPills?: boolean;
}

const SORT_LABELS: Record<SortOption, string> = {
  "name-asc": "Nom (A-Z)",
  "name-desc": "Nom (Z-A)",
  "updates-first": "Mises à jour d'abord",
  "installed-first": "Installées d'abord",
  "release-date": "Date de release",
};

const STATUS_PILLS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "installed", label: "Installées" },
  { id: "updates", label: "MAJ dispo" },
  { id: "not-installed", label: "Non installées" },
];

const SOURCE_PILLS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "catalog", label: "Catalogue" },
  { id: "custom", label: "Mes dépôts" },
  { id: "scoop", label: "Scoop" },
];

export function FilterSortBar({
  sortBy,
  onSortChange,
  statusFilter,
  onStatusFilterChange,
  sourceFilter,
  onSourceFilterChange,
  sha256Only,
  onSha256OnlyChange,
  filteredCount,
  totalInView,
  hasActiveFilters,
  onReset,
  hideStatusPills = false,
}: FilterSortBarProps) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card/75 px-3.5 py-2.5 shadow-[inset_0_1px_0_var(--specular-top)]">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Status + Source + SHA-256 Quick Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {!hideStatusPills && (
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background/80 p-0.5">
              {STATUS_PILLS.map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => onStatusFilterChange(pill.id)}
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
          )}

          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background/80 p-0.5">
            {SOURCE_PILLS.map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => onSourceFilterChange(pill.id)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11.5px] font-medium transition-all",
                  sourceFilter === pill.id
                    ? "bg-foreground text-background shadow-xs"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onSha256OnlyChange(!sha256Only)}
            className={cn(
              "inline-flex h-[28px] items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium transition-all",
              sha256Only
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "border-border bg-background/80 text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground"
            )}
          >
            <ShieldCheck className="size-3.5" />
            SHA-256
          </button>
        </div>

        {/* Right: Count + Reset + Sort Dropdown */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {filteredCount === totalInView
              ? `${filteredCount} app${filteredCount > 1 ? "s" : ""}`
              : `${filteredCount} / ${totalInView} app${totalInView > 1 ? "s" : ""}`}
          </span>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
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
              {SORT_LABELS[sortBy]}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="craft-glass w-48 border border-border p-1 text-popover-foreground shadow-xl"
            >
              {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
                <DropdownMenuItem
                  key={opt}
                  onClick={() => onSortChange(opt)}
                  className="flex cursor-pointer items-center justify-between text-xs"
                >
                  <span>{SORT_LABELS[opt]}</span>
                  {sortBy === opt && (
                    <Check className="size-3.5 text-[#5E6AD2] dark:text-[#8E98F8]" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
