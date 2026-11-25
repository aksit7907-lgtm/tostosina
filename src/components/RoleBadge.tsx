import { BadgeCheck } from "lucide-react";
import { useBadge } from "@/lib/badges";

const LABELS: Record<string, string> = { creator: "Создатель" };

/** Плашка роли аккаунта. compact: только значок (для шапки чата). */
export function RoleBadge({ userId, compact = false }: { userId?: string | null; compact?: boolean }) {
  const badge = useBadge(userId);
  if (!badge || !LABELS[badge]) return null;
  const label = LABELS[badge];
  if (compact) {
    return <BadgeCheck aria-label={label} className="h-4 w-4 shrink-0 text-pulse" />;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-pulse/15 px-2.5 py-0.5 text-xs font-semibold text-pulse">
      <BadgeCheck className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
