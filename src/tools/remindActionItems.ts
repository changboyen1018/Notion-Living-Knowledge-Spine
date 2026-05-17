import type { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";
import { getDbIds, getNotionClient } from "../lib/notion-helpers.js";
import {
  categorizeItems,
  fetchActionItems,
  DEFAULT_DAYS_AHEAD,
  type Category,
  type CategorizedItem,
} from "../lib/actionItems.js";

type ReminderItem = {
  id: string;
  name: string;
  status: string | null;
  assignees: { id: string; name: string }[];
  dueDate: string | null;
  reviewStatus: boolean;
  url: string;
  daysOverdue: number | null;
  daysUntilDue: number | null;
  reason: string;
};

export function registerRemindActionItems(worker: Worker) {
  worker.tool("remindActionItems", {
    title: "Remind: Action Items",
    description:
      "Read the Action Items database and return items needing attention — overdue, due soon, unassigned, missing a due date, or with Review Status unchecked. Use this when the user asks 'what do I need to do', 'what's overdue', 'remind me about action items', for a daily standup, or any time they want the status of pending work.",
    schema: j.object({
      daysAhead: j
        .number()
        .nullable()
        .describe(
          `Number of days ahead to flag as 'due soon'. Default ${DEFAULT_DAYS_AHEAD}. Pass null to use the default.`,
        ),
    }),
    hints: { readOnlyHint: true },
    execute: async ({ daysAhead }, context: any) => {
      const notion: any = getNotionClient(context.notion);
      const { actionItems: dbId } = getDbIds();
      if (!dbId) {
        throw new Error(
          "ACTION_ITEMS_DB_ID is not set. Add it via `ntn workers env set ACTION_ITEMS_DB_ID=<id>` or to .env.",
        );
      }

      const items = await fetchActionItems(notion, dbId);
      const { categorized, totalOpen, horizon } = categorizeItems(
        items,
        typeof daysAhead === "number" ? daysAhead : DEFAULT_DAYS_AHEAD,
      );

      const buckets: Record<Category, ReminderItem[]> = {
        overdue: [],
        due_soon: [],
        unassigned: [],
        missing_due_date: [],
        review_unchecked: [],
      };

      for (const c of categorized) {
        for (let i = 0; i < c.categories.length; i++) {
          buckets[c.categories[i]].push(toReminderItem(c, c.reasons[i]));
        }
      }

      buckets.overdue.sort(
        (a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0),
      );
      buckets.due_soon.sort(
        (a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0),
      );

      const counts = {
        overdue: buckets.overdue.length,
        dueSoon: buckets.due_soon.length,
        unassigned: buckets.unassigned.length,
        missingDueDate: buckets.missing_due_date.length,
        reviewUnchecked: buckets.review_unchecked.length,
      };

      return {
        generatedAt: new Date().toISOString(),
        horizonDays: horizon,
        totalOpenItems: totalOpen,
        counts,
        summary: buildSummary(counts, totalOpen, horizon),
        byCategory: {
          overdue: buckets.overdue,
          dueSoon: buckets.due_soon,
          unassigned: buckets.unassigned,
          missingDueDate: buckets.missing_due_date,
          reviewUnchecked: buckets.review_unchecked,
        },
      };
    },
  });
}

function toReminderItem(c: CategorizedItem, reason: string): ReminderItem {
  return {
    id: c.item.id,
    name: c.item.name,
    status: c.item.status,
    assignees: c.item.assignees,
    dueDate: c.item.dueDate,
    reviewStatus: c.item.reviewStatus,
    url: c.item.url,
    daysOverdue: c.daysOverdue,
    daysUntilDue: c.daysUntilDue,
    reason,
  };
}

function buildSummary(
  counts: {
    overdue: number;
    dueSoon: number;
    unassigned: number;
    missingDueDate: number;
    reviewUnchecked: number;
  },
  totalOpen: number,
  horizon: number,
): string {
  if (totalOpen === 0 && counts.reviewUnchecked === 0) {
    return "All clear — no action items need attention.";
  }
  const parts: string[] = [];
  if (counts.overdue) parts.push(`${counts.overdue} overdue`);
  if (counts.dueSoon)
    parts.push(
      `${counts.dueSoon} due in the next ${horizon} day${horizon === 1 ? "" : "s"}`,
    );
  if (counts.unassigned) parts.push(`${counts.unassigned} unassigned`);
  if (counts.missingDueDate)
    parts.push(`${counts.missingDueDate} missing a due date`);
  if (counts.reviewUnchecked)
    parts.push(`${counts.reviewUnchecked} with Review Status unchecked`);

  return parts.length > 0
    ? `${totalOpen} open item${totalOpen === 1 ? "" : "s"} — ${parts.join(", ")}.`
    : `${totalOpen} open item${totalOpen === 1 ? "" : "s"}, nothing flagged.`;
}
