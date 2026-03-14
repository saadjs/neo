import { webSearchTool } from "./web-search.js";
import { googleWorkspaceTool } from "./google-workspace.js";
import { memoryTool } from "./memory-tool.js";
import { systemTool } from "./system.js";
import { reminderTool } from "./reminder.js";
import { conversationTool } from "./conversation.js";
import { jobTool } from "./job.js";

export const allTools = [
  webSearchTool,
  googleWorkspaceTool,
  memoryTool,
  systemTool,
  reminderTool,
  jobTool,
  conversationTool,
];
