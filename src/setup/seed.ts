// ---------------------------------------------------------------------------
// Seed script — populates the Raw Notes database with 5 realistic sample
// notes from the fictional "Cardio Risk Engine" domain.
//
// Usage: NOTION_API_TOKEN=ntn_xxx RAW_NOTES_DB_ID=xxx npx tsx src/setup/seed.ts
// ---------------------------------------------------------------------------

import "dotenv/config";

const NOTION_API = "https://api.notion.com/v1";
const TOKEN = process.env.NOTION_API_TOKEN;
const DB_ID = process.env.RAW_NOTES_DB_ID;

if (!TOKEN || !DB_ID) {
  console.error(
    "Set NOTION_API_TOKEN and RAW_NOTES_DB_ID environment variables.",
  );
  process.exit(1);
}

interface SeedNote {
  date: string;
  sourceType: string;
  domain: string;
  transcript: string;
}

const SAMPLE_NOTES: SeedNote[] = [
  {
    date: "2026-05-10",
    sourceType: "voice",
    domain: "Cardio Risk Engine",
    transcript: `Today I walked through the Cardio Risk Engine architecture with Sarah. The system starts with the Feature Extractor, which pulls patient data from the EHR integration layer and computes about 40 clinical features — things like resting heart rate variability, lipid panel trends, and exercise tolerance scores. The Feature Extractor feeds into the Prediction Model. I still need to understand how the feature selection step works — apparently there's a recursive feature elimination step that runs weekly to prune low-signal features.`,
  },
  {
    date: "2026-05-11",
    sourceType: "meeting",
    domain: "Cardio Risk Engine",
    transcript: `Meeting with the ML team about the Prediction Model. It's an ensemble of gradient-boosted trees and a logistic regression baseline. The ensemble uses a stacking approach where the meta-learner is a simple linear model. Key insight: the model outputs a raw risk score between 0 and 1, but the clinical team needs calibrated probabilities. There's a Platt scaling layer that recalibrates the output before it goes to the Output Aggregator. The model is retrained monthly with a sliding 2-year window of patient outcomes. Model validation uses time-series cross-validation to avoid data leakage.`,
  },
  {
    date: "2026-05-12",
    sourceType: "voice",
    domain: "Cardio Risk Engine",
    transcript: `Looked at the Output Aggregator and Report Generator today. The Output Aggregator takes the calibrated risk score from the Prediction Model and combines it with rule-based alerts — for example, if a patient's LDL is above 190, that triggers a hard flag regardless of the model score. The aggregated output feeds into the Report Generator, which produces both a patient-facing summary and a clinician-facing detailed report. The patient report uses plain language and a traffic-light risk indicator. The clinician report includes feature importance breakdowns and comparison to population baselines. I'm not sure where the PDF rendering happens — need to ask the frontend team.`,
  },
  {
    date: "2026-05-13",
    sourceType: "manual",
    domain: "Cardio Risk Engine",
    transcript: `Notes on the Validation Layer. Every prediction goes through a Validation Layer before it reaches the Report Generator. The validation checks include: (1) input completeness — are all required features present, (2) plausibility checks — is the heart rate within human range, (3) model drift detection — comparing current prediction distribution against a reference distribution using KL divergence, and (4) fairness auditing — checking that prediction distributions don't differ significantly across demographic groups. If validation fails, the system returns a "low confidence" flag and routes to manual clinician review instead of automated reporting. The Validation Layer depends on a reference statistics cache that gets updated with each monthly model retrain.`,
  },
  {
    date: "2026-05-14",
    sourceType: "slack",
    domain: "Cardio Risk Engine",
    transcript: `Quick thread with James about cross-component data flow. The EHR Integration Layer feeds raw patient data to the Feature Extractor. Feature Extractor outputs go to the Prediction Model and also to the Validation Layer (for input completeness checks). The Prediction Model output goes to both the Output Aggregator and the Validation Layer (for drift detection). The Output Aggregator feeds the Report Generator. There's also a feedback loop: clinician overrides from the Report Generator are logged and fed back into the next model retrain cycle. The whole pipeline is orchestrated by an Airflow DAG that runs nightly for batch processing, but there's also a real-time scoring API for urgent cases that bypasses the batch pipeline.`,
  },
];

async function createNote(note: SeedNote) {
  const body = {
    parent: { database_id: DB_ID },
    properties: {
      // Raw Notes uses a title property — we use "Name" as the default title
      Name: {
        title: [
          {
            type: "text",
            text: {
              content: `${note.sourceType} — ${note.date}`,
            },
          },
        ],
      },
      Date: { date: { start: note.date } },
      "Source Type": { select: { name: note.sourceType } },
      Domain: { select: { name: note.domain } },
      "Raw Transcript": {
        rich_text: [
          { type: "text", text: { content: note.transcript } },
        ],
      },
      Processed: { checkbox: false },
    },
  };

  const resp = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Failed to create note "${note.date}": ${err}`);
  }

  const page: any = await resp.json();
  console.log(`  Created: ${note.sourceType} — ${note.date}  (${page.id})`);
  return page.id;
}

async function main() {
  console.log("Seeding Raw Notes database with Cardio Risk Engine samples...\n");

  const ids: string[] = [];
  for (const note of SAMPLE_NOTES) {
    const id = await createNote(note);
    ids.push(id);
  }

  console.log(`\nDone! Created ${ids.length} sample notes.`);
  console.log("\nNote IDs (use these with updateKnowledgeSpine):");
  for (const id of ids) {
    console.log(`  ${id}`);
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
