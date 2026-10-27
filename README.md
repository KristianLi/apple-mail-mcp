# apple-mail-mcp

An [MCP](https://modelcontextprotocol.io) server that lets Claude (or any MCP client) read and manage email in **macOS Mail.app**. It talks to Mail through JavaScript for Automation (JXA), so every account you have added to Mail works: iCloud, Gmail, Outlook/Exchange, QQ, 163, school accounts, and so on. You don't need passwords, API keys, or OAuth.

[中文说明](#中文说明)

## Tools

| Tool | What it does |
|---|---|
| `list_accounts` | All accounts with their addresses and mailboxes (message and unread counts) |
| `list_messages` | Messages newest first; omit the account to read the unified inbox |
| `search_messages` | Search across all accounts and mailboxes by subject, sender or body, with date / unread / flagged filters |
| `get_message` | Full message: recipients, attachments list, plain-text body, optional raw headers |
| `update_message` | Mark read/unread, flag/unflag, mark junk, move to another mailbox or account |
| `trash_message` | Move to the account's trash (recoverable) |
| `compose` | New email. Saved as a draft and opened in Mail by default; `send: true` sends immediately |
| `reply` | Reply / reply all. Also draft-by-default |

Messages are addressed by `account` + `mailbox` + `id`, all of which are returned by the list and search tools.

## Requirements

- macOS with Mail.app set up
- Node.js 18+

## Install

```bash
git clone https://github.com/KristianLi/apple-mail-mcp.git
cd apple-mail-mcp
npm ci
```

### Claude Code

```bash
claude mcp add --scope user apple-mail -- node /absolute/path/to/apple-mail-mcp/server.js
```

### Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart Claude:

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "node",
      "args": ["/absolute/path/to/apple-mail-mcp/server.js"]
    }
  }
}
```

If Claude can't find `node`, use its absolute path (`which node`), for example `/opt/homebrew/bin/node`.

### Permissions

The first time a tool runs, macOS asks whether the app may control Mail. Allow it. You can change this later in **System Settings → Privacy & Security → Automation**.

## Notes

- Mail.app is launched automatically if it isn't running.
- Gmail labels show up as mailboxes in Mail, so one message can appear in several of them (INBOX, All Mail, Important…).
- Mail doesn't allow editing the body of a received message. "Editing" means flags, moves, trash, drafts and replies.
- Mail's own scripted `reply` command drops the body text, so `reply` builds the reply itself (recipients, `Re:` subject, quoted original). Clients that thread strictly by `In-Reply-To` may not group it with the original.
- Searching by `content` across every mailbox can be slow on large mailboxes; narrow it with `account`, `mailbox` or `since`.

## License

[MIT](LICENSE)

---

## 中文说明

一个 MCP 连接器，让 Claude 通过 macOS「邮件」App 读取和管理邮件。Mail 里添加的所有账户（iCloud、Gmail、Outlook、QQ、163、学校邮箱等）都能用，不需要任何密码或授权。

**功能**：列出账户和文件夹、按时间列邮件（不填账户就是统一收件箱）、跨所有邮箱搜索、读取全文和附件列表、标记已读或旗标、移动、移到废纸篓、写新邮件和回复。新邮件和回复默认只存草稿并在 Mail 中打开，设置 `send: true` 才会直接发送。

**安装**：按上面的步骤 `git clone` 后运行 `npm ci`，再用 `claude mcp add` 或修改 `claude_desktop_config.json` 注册。第一次使用时，macOS 会询问是否允许控制「邮件」，点"允许"即可。
