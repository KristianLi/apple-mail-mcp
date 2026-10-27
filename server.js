#!/usr/bin/env node
// MCP server that exposes every account configured in macOS Mail.app.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "mail.js");

function callMail(action, params = {}) {
  const payload = JSON.stringify({ action, ...params });
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-l", "JavaScript", BRIDGE, payload],
      { maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim()));
        try { resolve(JSON.parse(stdout)); } catch { resolve(stdout.trim()); }
      });
  });
}

function tool(name, description, schema, annotations = {}) {
  server.registerTool(name, { description, inputSchema: schema, annotations }, async (args) => {
    try {
      const result = await callMail(name, args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: String(e.message || e) }] };
    }
  });
}

const server = new McpServer({ name: "apple-mail", version: "1.0.0" });

const ref = {
  account: z.string().describe("Account name as shown by list_accounts, e.g. \"iCloud\""),
  mailbox: z.string().describe("Mailbox name within the account, e.g. \"INBOX\""),
  id: z.number().int().describe("Message id from list_messages / search_messages"),
};
const filters = {
  unread_only: z.boolean().optional().describe("Only unread messages"),
  flagged_only: z.boolean().optional().describe("Only flagged messages"),
  since: z.string().optional().describe("Only messages received after this date (ISO 8601, e.g. 2026-10-01)"),
  before: z.string().optional().describe("Only messages received before this date (ISO 8601)"),
};

tool("list_accounts",
  "List every account in Mail.app with its email addresses and mailboxes (message and unread counts).",
  {}, { readOnlyHint: true });

tool("list_messages",
  "List messages newest first. Without an account it reads the unified inbox across all accounts; with an account it reads one mailbox (default INBOX).",
  {
    account: z.string().optional().describe("Account name; omit for the unified inbox"),
    mailbox: z.string().optional().describe("Mailbox name (default INBOX)"),
    offset: z.number().int().min(0).optional().describe("Skip this many messages (paging)"),
    limit: z.number().int().min(1).max(200).optional().describe("Max messages to return (default 20)"),
    ...filters,
  }, { readOnlyHint: true });

tool("search_messages",
  "Search messages across all accounts and mailboxes (or a chosen account/mailbox) by subject, sender or body text, with optional date and status filters.",
  {
    query: z.string().optional().describe("Text to look for"),
    field: z.enum(["any", "subject", "sender", "content"]).optional()
      .describe("Where to search: any (subject or sender, default), subject, sender, or content (body, slower)"),
    account: z.string().optional().describe("Limit to one account"),
    mailbox: z.string().optional().describe("Limit to one mailbox name"),
    limit: z.number().int().min(1).max(200).optional().describe("Max messages to return (default 20)"),
    ...filters,
  }, { readOnlyHint: true });

tool("get_message",
  "Read one message in full: recipients, attachments and plain-text body.",
  {
    ...ref,
    max_chars: z.number().int().min(100).optional().describe("Truncate the body to this many characters (default 20000)"),
    include_headers: z.boolean().optional().describe("Also return the raw headers"),
  }, { readOnlyHint: true });

tool("update_message",
  "Change a message: mark read/unread, flag/unflag, mark as junk, or move it to another mailbox (optionally in another account).",
  {
    ...ref,
    read: z.boolean().optional(),
    flagged: z.boolean().optional(),
    junk: z.boolean().optional(),
    move_to_mailbox: z.string().optional().describe("Destination mailbox name"),
    move_to_account: z.string().optional().describe("Destination account (default: same account)"),
  }, { destructiveHint: false });

tool("trash_message",
  "Move a message to its account's trash (recoverable from Mail; nothing is permanently deleted).",
  ref, { destructiveHint: true });

tool("compose",
  "Write a new email. By default it is saved as a draft and opened in Mail for review; set send=true to send immediately. Always confirm with the user before sending.",
  {
    to: z.array(z.string()).describe("Recipient addresses"),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    subject: z.string(),
    body: z.string().describe("Plain-text body"),
    from: z.string().optional().describe("Sender address; must belong to one of the Mail accounts"),
    send: z.boolean().optional().describe("Send now instead of saving a draft (default false)"),
  }, { destructiveHint: false, openWorldHint: true });

tool("reply",
  "Reply to a message. By default the reply is saved as a draft and opened in Mail; set send=true to send immediately. Always confirm with the user before sending.",
  {
    ...ref,
    body: z.string().describe("Reply text, placed above the quoted original"),
    reply_all: z.boolean().optional(),
    send: z.boolean().optional().describe("Send now instead of saving a draft (default false)"),
  }, { destructiveHint: false, openWorldHint: true });

await server.connect(new StdioServerTransport());
