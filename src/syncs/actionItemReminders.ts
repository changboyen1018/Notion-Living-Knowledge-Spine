import type { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";
import { getDbIds, getNotionClient } from "../lib/notion-helpers.js";
import {
  CATEGORY_LABELS,
  categorizeItems,
  fetchActionItems,
  type Category,
} from "../lib/actionItems.js";

type SelectColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

type SelectOption = { name: string; color?: SelectColor };

const CATEGORY_OPTIONS: SelectOption[] = [
  { name: "overdue", color: "red" },
  { name: "due_soon", color: "yellow" },
  { name: "unassigned", color: "orange" },
  { name: "missing_due_date", color: "gray" },
  { name: "review_unchecked", color: "blue" },
];

export function registerActionItemRemindersSync(worker: Worker) {
  const remindersDb = worker.database("actionItemReminders", {
    type: "managed",
    initialTitle: "Action Item Reminders",
    primaryKeyProperty: "Action Item ID",
    schema: {
      databaseIcon: Builder.emojiIcon("⏰"),
      properties: {
        Reminder: Schema.title(),
        "Action Item ID": Schema.richText(),
        Categories: Schema.multiSelect(CATEGORY_OPTIONS),
        Reason: Schema.richText(),
        Status: Schema.richText(),
        Due: Schema.date(),
        "Days Overdue": Schema.number(),
        "Days Until Due": Schema.number(),
        Assignees: Schema.richText(),
        "Source URL": Schema.url(),
        "Synced At": Schema.date(),
      },
    },
  });

  worker.sync("syncActionItemReminders", {
    database: remindersDb,
    mode: "replace",
    schedule: "1h",
    execute: async (_state, context) => {
      const notion: any = getNotionClient(context.notion);
      const { actionItems: dbId } = getDbIds();
      if (!dbId) {
        throw new Error(
          "ACTION_ITEMS_DB_ID is not set on the worker. Run `ntn workers env push --yes` after setting it in .env.",
        );
      }

      const items = await fetchActionItems(notion, dbId);
      const { categorized } = categorizeItems(items);
      const syncedAt = new Date().toISOString().slice(0, 10);

      const changes = categorized.map((c) => {
        const titlePrefix = primaryCategoryLabel(c.categories);
        const assigneeNames =
          c.item.assignees.map((a) => a.name).join(", ") || "(unassigned)";
        return {
          type: "upsert" as const,
          key: c.item.id,
          properties: {
            Reminder: Builder.title(`${titlePrefix}: ${c.item.name}`),
            "Action Item ID": Builder.richText(c.item.id),
            Categories: Builder.multiSelect(...c.categories),
            Reason: Builder.richText(c.reasons.join(" • ")),
            Status: Builder.richText(c.item.status ?? "(no status)"),
            Due: c.item.dueDate
              ? Builder.date(c.item.dueDate)
              : Builder.richText(""),
            "Days Overdue":
              c.daysOverdue !== null
                ? Builder.number(c.daysOverdue)
                : Builder.richText(""),
            "Days Until Due":
              c.daysUntilDue !== null
                ? Builder.number(c.daysUntilDue)
                : Builder.richText(""),
            Assignees: Builder.richText(assigneeNames),
            "Source URL": Builder.url(c.item.url),
            "Synced At": Builder.date(syncedAt),
          } as any,
          upstreamUpdatedAt: new Date().toISOString(),
        };
      });

      return { changes, hasMore: false };
    },
  });
}

function primaryCategoryLabel(categories: Category[]): string {
  const priority: Category[] = [
    "overdue",
    "due_soon",
    "unassigned",
    "missing_due_date",
    "review_unchecked",
  ];
  for (const c of priority) {
    if (categories.includes(c)) return CATEGORY_LABELS[c];
  }
  return "Reminder";
}
