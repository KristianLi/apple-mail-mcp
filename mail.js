// JXA bridge to Mail.app. Invoked as: osascript -l JavaScript mail.js '<json>'
// The JSON is {action, ...params}; the result is printed as JSON on stdout.

const Mail = Application("Mail");

function iso(d) {
  try { return d ? d.toISOString() : null; } catch (e) { return null; }
}

function getAccount(name) {
  const acc = Mail.accounts.byName(name);
  try { acc.name(); } catch (e) { throw new Error(`Account not found: ${name}`); }
  return acc;
}

function getMailbox(accountName, mailboxName) {
  const mb = getAccount(accountName).mailboxes.byName(mailboxName);
  try { mb.name(); } catch (e) { throw new Error(`Mailbox not found: ${accountName} / ${mailboxName}`); }
  return mb;
}

function getMessage(p) {
  const msg = getMailbox(p.account, p.mailbox).messages.byId(p.id);
  try { msg.id(); } catch (e) { throw new Error(`Message ${p.id} not found in ${p.account} / ${p.mailbox}`); }
  return msg;
}

function summarize(m, ref) {
  const s = {
    id: m.id(),
    subject: m.subject(),
    from: m.sender(),
    date: iso(m.dateReceived()),
    read: m.readStatus(),
    flagged: m.flaggedStatus(),
  };
  if (ref) {
    s.account = ref.account;
    s.mailbox = ref.mailbox;
  } else {
    const mb = m.mailbox();
    s.mailbox = mb.name();
    s.account = mb.account().name();
  }
  return s;
}

function recipients(list) {
  return list().map(r => {
    const name = r.name();
    const addr = r.address();
    return name && name !== addr ? `${name} <${addr}>` : addr;
  });
}

function buildFilter(p) {
  const conds = [];
  if (p.query) {
    const field = p.field || "any";
    if (field === "any") {
      conds.push({ _or: [{ subject: { _contains: p.query } }, { sender: { _contains: p.query } }] });
    } else {
      conds.push({ [field]: { _contains: p.query } });
    }
  }
  if (p.unread_only) conds.push({ readStatus: false });
  if (p.flagged_only) conds.push({ flaggedStatus: true });
  if (p.since) conds.push({ dateReceived: { _greaterThan: new Date(p.since) } });
  if (p.before) conds.push({ dateReceived: { _lessThan: new Date(p.before) } });
  if (conds.length === 0) return null;
  return conds.length === 1 ? conds[0] : { _and: conds };
}

function collect(collection, ref, filter, offset, limit) {
  const msgs = filter ? collection.whose(filter) : collection;
  const total = msgs.length;
  const out = [];
  for (let i = offset; i < Math.min(total, offset + limit); i++) {
    out.push(summarize(msgs[i], ref));
  }
  return { total, messages: out };
}

const actions = {
  list_accounts() {
    return Mail.accounts().map(a => ({
      name: a.name(),
      emails: a.emailAddresses(),
      enabled: a.enabled(),
      mailboxes: a.mailboxes().map(b => ({ name: b.name(), count: b.messages.length, unread: b.unreadCount() })),
    }));
  },

  list_messages(p) {
    const offset = p.offset || 0;
    const limit = p.limit || 20;
    const filter = buildFilter(p);
    if (!p.account) {
      return collect(Mail.inbox.messages, null, filter, offset, limit);
    }
    const mbName = p.mailbox || "INBOX";
    return collect(getMailbox(p.account, mbName).messages, { account: p.account, mailbox: mbName }, filter, offset, limit);
  },

  search_messages(p) {
    const limit = p.limit || 20;
    const filter = buildFilter(p);
    const accounts = p.account ? [getAccount(p.account)] : Mail.accounts().filter(a => a.enabled());
    // Fetch only dates in bulk first, then summarize the newest `limit` matches overall.
    const candidates = [];
    const skipped = [];
    let total = 0;
    for (const acc of accounts) {
      const accName = acc.name();
      const boxes = p.mailbox ? [getMailbox(accName, p.mailbox)] : acc.mailboxes();
      for (const mb of boxes) {
        let boxName = "?";
        try {
          boxName = mb.name();
          const msgs = filter ? mb.messages.whose(filter) : mb.messages;
          const dates = msgs.dateReceived();
          total += dates.length;
          dates.forEach((d, i) => candidates.push({ t: d ? d.getTime() : 0, msgs, i, ref: { account: accName, mailbox: boxName } }));
        } catch (e) {
          skipped.push(`${accName} / ${boxName}`);
        }
      }
    }
    candidates.sort((a, b) => b.t - a.t);
    const results = candidates.slice(0, limit).map(c => summarize(c.msgs[c.i], c.ref));
    const out = { total_matches: total, returned: results.length, messages: results };
    if (skipped.length) out.skipped_mailboxes = skipped;
    return out;
  },

  get_message(p) {
    const m = getMessage(p);
    const maxChars = p.max_chars || 20000;
    let content = m.content() || "";
    const truncated = content.length > maxChars;
    if (truncated) content = content.slice(0, maxChars);
    const result = {
      ...summarize(m, { account: p.account, mailbox: p.mailbox }),
      to: recipients(m.toRecipients),
      cc: recipients(m.ccRecipients),
      reply_to: m.replyTo(),
      message_id: m.messageId(),
      attachments: m.mailAttachments().map(a => ({ name: a.name(), size: a.fileSize(), downloaded: a.downloaded() })),
      content,
      truncated,
    };
    if (p.include_headers) result.headers = m.allHeaders();
    return result;
  },

  update_message(p) {
    const m = getMessage(p);
    if (p.read !== undefined) m.readStatus = p.read;
    if (p.flagged !== undefined) m.flaggedStatus = p.flagged;
    if (p.junk !== undefined) m.junkMailStatus = p.junk;
    if (p.move_to_mailbox) {
      const dest = getMailbox(p.move_to_account || p.account, p.move_to_mailbox);
      Mail.move(m, { to: dest });
      return { ok: true, moved_to: { account: p.move_to_account || p.account, mailbox: p.move_to_mailbox } };
    }
    return { ok: true, message: summarize(m, { account: p.account, mailbox: p.mailbox }) };
  },

  trash_message(p) {
    const m = getMessage(p);
    const subject = m.subject();
    Mail.delete(m); // Mail moves the message to the account's trash mailbox
    return { ok: true, trashed: subject };
  },

  compose(p) {
    const msg = Mail.OutgoingMessage({ subject: p.subject || "", content: p.body || "", visible: !p.send });
    Mail.outgoingMessages.push(msg);
    if (p.from) msg.sender = p.from;
    for (const addr of p.to || []) msg.toRecipients.push(Mail.Recipient({ address: addr }));
    for (const addr of p.cc || []) msg.ccRecipients.push(Mail.Recipient({ address: addr }));
    for (const addr of p.bcc || []) msg.bccRecipients.push(Mail.Recipient({ address: addr }));
    if (p.send) {
      msg.send();
      return { ok: true, sent: true };
    }
    msg.save();
    return { ok: true, sent: false, note: "Saved as a draft and opened in Mail for review." };
  },

  reply(p) {
    // Mail's own `reply` command ignores scripted body text, so build the reply by hand.
    const original = getMessage(p);
    const own = getAccount(p.account).emailAddresses().map(a => a.toLowerCase());
    const addrOf = s => ((s.match(/<([^>]+)>/) || [])[1] || s).trim();
    const isOwn = s => own.includes(addrOf(s).toLowerCase());
    const origTo = original.toRecipients().map(r => r.address());
    const origCc = original.ccRecipients().map(r => r.address());

    let to = [addrOf(original.replyTo() || original.sender())];
    let cc = [];
    if (p.reply_all) {
      to = to.concat(origTo);
      cc = origCc;
    }
    to = [...new Set(to)].filter(a => !isOwn(a));
    cc = [...new Set(cc)].filter(a => !isOwn(a) && !to.includes(a));
    if (to.length === 0) to = [addrOf(original.replyTo() || original.sender())];

    const subject = original.subject() || "";
    const quoted = (original.content() || "").split("\n").map(l => "> " + l).join("\n");
    const header = `On ${original.dateReceived().toString()}, ${original.sender()} wrote:`;
    const msg = Mail.OutgoingMessage({
      subject: /^re:/i.test(subject) ? subject : "Re: " + subject,
      content: `${p.body}\n\n${header}\n${quoted}`,
      visible: !p.send,
    });
    Mail.outgoingMessages.push(msg);
    msg.sender = origTo.concat(origCc).find(isOwn) || own[0];
    for (const a of to) msg.toRecipients.push(Mail.Recipient({ address: a }));
    for (const a of cc) msg.ccRecipients.push(Mail.Recipient({ address: a }));
    if (p.send) {
      msg.send();
      return { ok: true, sent: true };
    }
    msg.save();
    return { ok: true, sent: false, note: "Reply saved as a draft and opened in Mail for review." };
  },
};

function run(argv) {
  const p = JSON.parse(argv[0] || "{}");
  const fn = actions[p.action];
  if (!fn) throw new Error(`Unknown action: ${p.action}`);
  return JSON.stringify(fn(p));
}
