import { Worker } from "@notionhq/workers";

import { registerAddKnowledgeNode } from "./tools/addKnowledgeNode.js";
import { registerUpdateKnowledgeNode } from "./tools/updateKnowledgeNode.js";
import { registerAddRelationship } from "./tools/addRelationship.js";
import { registerListKnowledgeNodes } from "./tools/listKnowledgeNodes.js";
import { registerMarkMeetingProcessed } from "./tools/markMeetingProcessed.js";
import { registerGenerateKnowledgeMap } from "./tools/generateKnowledgeMap.js";

const worker = new Worker();
export default worker;

registerAddKnowledgeNode(worker);
registerUpdateKnowledgeNode(worker);
registerAddRelationship(worker);
registerListKnowledgeNodes(worker);
registerMarkMeetingProcessed(worker);
registerGenerateKnowledgeMap(worker);
