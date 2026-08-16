/**
 * Race week, as logistics rather than training.
 *
 * The sessions come from the plan unchanged — a taper is still the plan — so
 * this is only the things that have nothing to do with fitness and everything to
 * do with arriving able to use it.
 *
 * Deliberately short. A checklist that tells someone what to eat for breakfast
 * gets ignored wholesale, and then so does the item that mattered.
 */

export type Category = "logistics" | "kit" | "plan" | "admin";

export type ChecklistItem = {
  id: string;
  label: string;
  category: Category;
  /** negative: days before the race */
  due_offset_days: number;
  /** doubles only */
  pairs_only?: boolean;
};

export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "start_time", label: "Confirm start time and wave", category: "admin", due_offset_days: -7 },
  { id: "plan_pushed", label: "Race plan finalised and pushed to watch", category: "plan", due_offset_days: -5 },
  { id: "travel", label: "Travel and accommodation confirmed", category: "logistics", due_offset_days: -3 },
  { id: "kit", label: "Kit checked", category: "kit", due_offset_days: -2 },
  { id: "splits_agreed", label: "Splits agreed with partner", category: "plan", due_offset_days: -1, pairs_only: true },
  { id: "watch_charged", label: "Watch charged, pace alert set", category: "kit", due_offset_days: -1 },
];

export const checklistFor = (doubles: boolean) =>
  DEFAULT_CHECKLIST.filter((i) => !i.pairs_only || doubles);

/** "3 days out", or "today", so a row says when rather than a date to decode. */
export function dueLabel(offset: number, daysToGo: number): string {
  const dueIn = daysToGo + offset;
  if (dueIn < 0) return "overdue";
  if (dueIn === 0) return "today";
  return `${dueIn} ${dueIn === 1 ? "day" : "days"}`;
}
