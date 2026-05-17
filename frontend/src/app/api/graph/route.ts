import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const PROJECT_LOG_DB = process.env.PROJECT_LOG_DB_ID!;
const RELATIONSHIPS_DB = process.env.RELATIONSHIPS_DB_ID;
const ACTION_ITEMS_DB = process.env.ACTION_ITEMS_DB_ID;
const MEETING_NOTES_DB = process.env.MEETING_NOTES_DB_ID;

function plain(rt: any[]): string {
  if (!rt?.length) return "";
  return rt.map((t: any) => t.plain_text ?? "").join("");
}

export async function GET() {
  try {
    // Build a lookup of meeting note ID → title + URL
    const meetingLookup: Record<string, { title: string; url: string }> = {};
    if (MEETING_NOTES_DB) {
      const meetResp = await notion.databases.query({
        database_id: MEETING_NOTES_DB,
        page_size: 100,
      });
      for (const page of meetResp.results as any[]) {
        const p = page.properties;
        const title = plain(p["Title"]?.title);
        const noteUrl = p["Note page"]?.url ?? "";
        meetingLookup[page.id] = {
          title: title || "Meeting",
          url: noteUrl || `https://notion.so/${(page.id as string).replace(/-/g, "")}`,
        };
      }
    }

    // 1. Project Log (knowledge nodes)
    const nodesResp = await notion.databases.query({
      database_id: PROJECT_LOG_DB,
      page_size: 100,
    });

    const nodes: any[] = nodesResp.results.map((page: any) => {
      const p = page.properties;
      const meetingRels = p["Meeting Notes"]?.relation ?? [];
      const sources = meetingRels
        .map((r: any) => meetingLookup[r.id])
        .filter(Boolean);

      return {
        id: page.id,
        name: plain(p["Project"]?.title),
        summary: plain(p["Summary"]?.rich_text),
        type: p["Type"]?.select?.name ?? "concept",
        lastUpdated: p["Last Updated"]?.date?.start ?? null,
        group: "project",
        sources,
        notionUrl: `https://notion.so/${(page.id as string).replace(/-/g, "")}`,
      };
    });

    const links: any[] = [];

    // 2. Action Items
    if (ACTION_ITEMS_DB) {
      const actionsResp = await notion.databases.query({
        database_id: ACTION_ITEMS_DB,
        page_size: 100,
      });

      for (const page of actionsResp.results as any[]) {
        const p = page.properties;
        const actionName = plain(p["Action item"]?.title);
        const context = plain(p["Context"]?.rich_text);
        const statusObj = p["Status"]?.status;
        const status = statusObj?.name ?? "Not started";
        const projectRels = p["Project"]?.relation ?? [];
        const meetingRels = p["Meeting Source"]?.relation ?? [];
        const sources = meetingRels
          .map((r: any) => meetingLookup[r.id])
          .filter(Boolean);

        if (!actionName) continue;

        nodes.push({
          id: page.id,
          name: actionName,
          summary: context || actionName,
          type: "action_item",
          status,
          lastUpdated: null,
          group: "action",
          sources,
          notionUrl: `https://notion.so/${(page.id as string).replace(/-/g, "")}`,
        });

        for (const rel of projectRels) {
          links.push({
            source: rel.id,
            target: page.id,
            type: "has_action",
            evidence: "",
            confidence: 1,
          });
        }
      }
    }

    // 3. Relationships
    if (RELATIONSHIPS_DB) {
      const relsResp = await notion.databases.query({
        database_id: RELATIONSHIPS_DB,
        page_size: 100,
      });

      for (const page of relsResp.results as any[]) {
        const p = (page as any).properties;
        const sourceId = p["Source Node"]?.relation?.[0]?.id;
        const targetId = p["Target Node"]?.relation?.[0]?.id;
        if (!sourceId || !targetId) continue;
        links.push({
          source: sourceId,
          target: targetId,
          type: p["Relationship Type"]?.select?.name ?? "related_to",
          evidence: plain(p["Evidence"]?.rich_text),
          confidence: p["Confidence"]?.number ?? 0.5,
        });
      }
    }

    return NextResponse.json(
      { nodes, links, fetchedAt: new Date().toISOString() },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "s-maxage=10, stale-while-revalidate=30",
        },
      },
    );
  } catch (err: any) {
    console.error("Graph API error:", err);
    return NextResponse.json(
      { error: err.message ?? "Failed to fetch graph" },
      { status: 500 },
    );
  }
}
