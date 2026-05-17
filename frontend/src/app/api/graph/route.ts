import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const PROJECT_LOG_DB = process.env.PROJECT_LOG_DB_ID!;
const RELATIONSHIPS_DB = process.env.RELATIONSHIPS_DB_ID;
const ACTION_ITEMS_DB = process.env.ACTION_ITEMS_DB_ID;

function plain(rt: any[]): string {
  if (!rt?.length) return "";
  return rt.map((t: any) => t.plain_text ?? "").join("");
}

export async function GET() {
  try {
    // 1. Fetch Project Log (knowledge nodes / projects)
    const nodesResp = await notion.databases.query({
      database_id: PROJECT_LOG_DB,
      page_size: 100,
    });

    const nodes: any[] = nodesResp.results.map((page: any) => {
      const p = page.properties;
      return {
        id: page.id,
        name: plain(p["Project"]?.title),
        summary: plain(p["Summary"]?.rich_text),
        type: p["Type"]?.select?.name ?? "concept",
        lastUpdated: p["Last Updated"]?.date?.start ?? null,
        group: "project",
      };
    });

    const links: any[] = [];

    // 2. Fetch Action Items and link to their projects
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

        if (!actionName) continue;

        nodes.push({
          id: page.id,
          name: actionName.length > 50 ? actionName.slice(0, 47) + "..." : actionName,
          summary: context || actionName,
          type: "action_item",
          status,
          lastUpdated: null,
          group: "action",
        });

        for (const rel of projectRels) {
          links.push({
            source: rel.id,
            target: page.id,
            type: "has_action",
            evidence: `Action item for project`,
            confidence: 1,
          });
        }
      }
    }

    // 3. Fetch Relationships (concept-to-concept edges)
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
