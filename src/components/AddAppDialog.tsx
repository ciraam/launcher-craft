import { useState } from "react";
import { Github, Plus, Shield } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppEntry } from "@/types/launcher";

interface AddAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddApp: (app: AppEntry) => Promise<void>;
}

const CATEGORIES = ["Outils", "Créativité", "Dev", "Utilitaires"];
const ACCENTS = ["#5E6AD2", "#2DD4BF", "#F472B6", "#38BDF8", "#FB923C", "#A78BFA"];

export function AddAppDialog({ open, onOpenChange, onAddApp }: AddAppDialogProps) {
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [tagline, setTagline] = useState("");
  const [category, setCategory] = useState("Outils");
  const [assetPattern, setAssetPattern] = useState("*windows*.zip");
  const [executableName, setExecutableName] = useState("");
  const [sha256, setSha256] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedRepo = repo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\/$/, "");

    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmedRepo) || trimmedRepo.includes("..")) {
      setError("Format de dépôt invalide : utilisez exactement owner/repo.");
      return;
    }

    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      setError("Le nom doit produire un identifiant alphanumérique valide.");
      return;
    }

    const cleanSha = sha256.trim().replace(/^sha256:/i, "");
    if (cleanSha && !/^[a-f0-9]{64}$/i.test(cleanSha)) {
      setError("L'empreinte SHA-256 doit contenir exactement 64 caractères hexadécimaux.");
      return;
    }

    const entry: AppEntry = {
      id: slug,
      name: name.trim(),
      tagline: tagline.trim() || `Application GitHub (${trimmedRepo})`,
      description:
        tagline.trim() ||
        `Application installée et mise à jour automatiquement par Craft.ro depuis ${trimmedRepo}.`,
      category,
      repo: trimmedRepo,
      icon: "custom",
      assetPattern: assetPattern.trim() || "*.zip",
      executableName: executableName.trim() || `${slug}.exe`,
      accentColor: ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
      homepage: `https://github.com/${trimmedRepo}`,
      sha256: cleanSha ? cleanSha.toLowerCase() : null,
      isCustom: true,
      source: "github",
    };

    setSubmitting(true);
    setError(null);
    try {
      await onAddApp(entry);
      setName("");
      setRepo("");
      setTagline("");
      setAssetPattern("*windows*.zip");
      setExecutableName("");
      setSha256("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'ajout.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="craft-glass-modal border border-border text-foreground shadow-2xl sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Github className="size-4 text-[#5E6AD2] dark:text-[#8E98F8]" />
            Ajouter un dépôt GitHub
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Connectez un dépôt public ou privé (via votre PAT stocké dans Windows Credential Manager).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-name" className="text-xs text-muted-foreground">
                Nom de l'application
              </Label>
              <Input
                id="add-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: Mon Outil"
                className="h-9 border-border bg-[var(--surface-input)] text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-repo" className="text-xs text-muted-foreground">
                Dépôt GitHub (owner/repo)
              </Label>
              <Input
                id="add-repo"
                required
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="ex: owner/mon-app"
                className="h-9 border-border bg-[var(--surface-input)] font-mono text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-tagline" className="text-xs text-muted-foreground">
              Description courte
            </Label>
            <Input
              id="add-tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Utilité principale en une phrase…"
              className="h-9 border-border bg-[var(--surface-input)] text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Catégorie</Label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={
                    category === cat
                      ? "rounded-lg border border-[#5E6AD2]/60 bg-[#5E6AD2]/15 px-2.5 py-1 text-xs font-medium text-[#5E6AD2] dark:text-[#B3BAFF]"
                      : "rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground"
                  }
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-pattern" className="text-xs text-muted-foreground">
                Motif d'asset (<code className="font-mono">assetPattern</code>)
              </Label>
              <Input
                id="add-pattern"
                value={assetPattern}
                onChange={(e) => setAssetPattern(e.target.value)}
                placeholder="*setup*.exe ou *win*.zip"
                className="h-9 border-border bg-[var(--surface-input)] font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-exe" className="text-xs text-muted-foreground">
                Exécutable (<code className="font-mono">.exe</code>)
              </Label>
              <Input
                id="add-exe"
                value={executableName}
                onChange={(e) => setExecutableName(e.target.value)}
                placeholder="ex: mon-app.exe"
                className="h-9 border-border bg-[var(--surface-input)] font-mono text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-sha256" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Shield className="size-3 text-sky-500" />
              SHA-256 attendu (optionnel — sinon détection automatique GitHub)
            </Label>
            <Input
              id="add-sha256"
              value={sha256}
              onChange={(e) => setSha256(e.target.value)}
              placeholder="64 caractères hexadécimaux (optionnel)"
              className="h-9 border-border bg-[var(--surface-input)] font-mono text-xs"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="mt-2 border-border bg-secondary/40">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs text-muted-foreground"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="bg-[#5E6AD2] text-xs font-medium text-white hover:bg-[#6B77DF]"
            >
              <Plus className="size-3.5" />
              Ajouter au catalogue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
