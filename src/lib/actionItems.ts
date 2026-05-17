// Shared Action Items query + categorization for `remindActionItems` and
// `syncActionItemReminders` so both surfaces stay in lockstep.
//
// Expects Action Items DB properties: Action item (title), Status (status),
// Assignee (people, optional), Due (date, optional), Review Status (checkbox, optional).

export type Assignee = { id: string; name: string };

export type ActionItem = {
  id: string;
  name: string;
  status: string | null;
  assignees: Assignee[];
  dueDate: string | null;
  reviewStatus: boolean;
  url: string;
};

export type Category =
  | "overdue"
  | "due_soon"
  | "unassigned"
  | "missing_due_date"
  | "review_unchecked";

export const CATEGORY_LABELS: Record<Category, string> = {
  overdue: "Overdue",
  due_soon: "Due Soon",
  unassigned: "Unassigned",
  missing_due_date: "Missing Due Date",
  review_unchecked: "Review Unchecked",
};

export type CategorizedItem = {
  item: ActionItem;
  categories: Category[];
  reasons: string[];
  daysOverdue: number | null;
  daysUntilDue: number | null;
};

export const DEFAULT_DAYS_AHEAD = 7;

export async function fetchActionItems(
  notion: any,
  databaseId: string,
): Promise<ActionItem[]> {
  const filter = {
    or: [
      { property: "Status", status: { is_empty: true } },
      { property: "Status", status: { does_not_equal: "Done" } },
      { property: "Review Status", checkbox: { equals: false } },
    ],
  };

  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const resp: any = await notion.databases.query({
      database_id: databaseId,
      filter,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  return pages.map(pageToActionItem);
}

function pageToActionItem(page: any): ActionItem {
  const p = page.properties ?? {};
  const titleArr = p["Action item"]?.title ?? [];
  return {
    id: page.id,
    name:
      titleArr.map((t: any) => t.plain_text ?? "").join("") || "(untitled)",
    status: p["Status"]?.status?.name ?? null,
    assignees: (p["Assignee"]?.people ?? []).map((person: any) => ({
      id: person.id,
      name: person.name ?? person.id,
    })),
    dueDate: p["Due"]?.date?.start ?? null,
    reviewStatus: p["Review Status"]?.checkbox ?? false,
    url:
      page.url ??
      `https://www.notion.so/${String(page.id).replace(/-/g, "")}`,
  };
}

export type CategorizeResult = {
  categorized: CategorizedItem[];
  totalOpen: number;
  todayStr: string;
  horizon: number;
};

export function categorizeItems(
  items: ActionItem[],
  daysAhead: number = DEFAULT_DAYS_AHEAD,
): CategorizeResult {
  const horizon = daysAhead > 0 ? Math.floor(daysAhead) : DEFAULT_DAYS_AHEAD;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const horizonDate = new Date(today);
  horizonDate.setUTCDate(horizonDate.getUTCDate() + horizon);
  const horizonStr = horizonDate.toISOString().slice(0, 10);

  const out: CategorizedItem[] = [];

  for (const item of items) {
    const isOpen = item.status !== "Done";
    const categories: Category[] = [];
    const reasons: string[] = [];
    let daysOverdue: number | null = null;
    let daysUntilDue: number | null = null;

    if (!item.reviewStatus) {
      categories.push("review_unchecked");
      reasons.push(
        isOpen
          ? "Review Status unchecked"
          : "Marked Done but Review Status unchecked",
      );
    }

    if (isOpen) {
      if (item.dueDate) {
        if (item.dueDate < todayStr) {
          daysOverdue = dateDiffDays(todayStr, item.dueDate);
          categories.push("overdue");
          reasons.push(
            `Overdue by ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`,
          );
        } else if (item.dueDate <= horizonStr) {
          daysUntilDue = dateDiffDays(item.dueDate, todayStr);
          categories.push("due_soon");
          reasons.push(
            daysUntilDue === 0
              ? "Due today"
              : `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`,
          );
        }
      } else {
        categories.push("missing_due_date");
        reasons.push("No due date set");
      }

      if (item.assignees.length === 0) {
        categories.push("unassigned");
        reasons.push("No assignee");
      }
    }

    if (categories.length > 0) {
      out.push({ item, categories, reasons, daysOverdue, daysUntilDue });
    }
  }

  const totalOpen = items.filter((i) => i.status !== "Done").length;
  return { categorized: out, totalOpen, todayStr, horizon };
}

export function dateDiffDays(a: string, b: string): number {
  const ad = Date.parse(`${a}T00:00:00Z`);
  const bd = Date.parse(`${b}T00:00:00Z`);
  return Math.round((ad - bd) / 86_400_000);
}
