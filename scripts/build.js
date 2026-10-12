// Turns the Markdown notes in content/ into validated event data, then into
// plain HTML pages in dist/. One file on purpose: the whole site is readable
// top to bottom, from note to page.

const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');

const ROOT = path.join(__dirname, '..');

const TYPES = ['meeting', 'campout', 'camp', 'plc', 'court-of-honor', 'service', 'other'];
const STATUSES = ['scheduled', 'cancelled'];
const FIELDS = ['title', 'type', 'date', 'end_date', 'start', 'end', 'location', 'status'];

// One error type so the CLI can print a plain message instead of a stack trace.
class NoteError extends Error {}

// ---------- dates ----------
// Dates stay as 'YYYY-MM-DD' strings throughout. new Date('2026-10-18') is read
// as UTC midnight, which is the previous evening in New York, so we never do it.

function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  // Day 0 of the next month is the last day of this one. Date.UTC is pure
  // arithmetic here, so no time zone is involved.
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// Today's date as seen on a wall calendar in the troop's time zone,
// regardless of where the build machine is (GitHub runs in UTC).
function todayIn(timeZone, now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// Whole days from a to b. Both are date strings, so this is calendar math,
// not clock math, and daylight saving time can't shift it.
function daysBetween(a, b) {
  const toDays = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  return toDays(b) - toDays(a);
}

// ---------- front matter ----------

// YAML rewrites some values before we see them: 2026-02-30 silently becomes
// March 2, and an unquoted 19:00 becomes the number 1140. So dates are checked
// against the text as typed, and times must arrive as strings.
function rawValue(header, key) {
  const m = header.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return undefined;
  return m[1].replace(/\s+#.*$/, '').trim().replace(/^(["'])(.*)\1$/, '$2');
}

// ---------- tasks ----------

const TASK_LINE = /^- \[( |x|X)\] (.+)$/;
const PATROL_TAG = /^\[([^\]]+)\]\s+/;
const DUE_ANY = /\(due\b[^)]*\)/i;
const DUE_END = /\s*\(due ([^)]*)\)$/;

function parseTasks(lines, patrols) {
  const tasks = [];
  lines.forEach(({ text, lineNo }) => {
    if (text.trim() === '') return;
    const m = text.trim().match(TASK_LINE);
    if (!m) {
      throw new NoteError(`line ${lineNo} under "## Tasks" is not a task. Write it as "- [ ] Do the thing".`);
    }
    let rest = m[2].trim();
    let patrol = null;
    const tag = rest.match(PATROL_TAG);
    if (tag) {
      if (!patrols.includes(tag[1])) {
        throw new NoteError(`line ${lineNo}: unknown patrol "[${tag[1]}]". Known patrols: ${patrols.join(', ') || 'none'}.`);
      }
      patrol = tag[1];
      rest = rest.slice(tag[0].length);
    }
    let due = null;
    const dueEnd = rest.match(DUE_END);
    if (dueEnd) {
      if (!isRealDate(dueEnd[1])) {
        throw new NoteError(`line ${lineNo}: due date "${dueEnd[1]}" is not a real date. Use YYYY-MM-DD.`);
      }
      due = dueEnd[1];
      rest = rest.slice(0, dueEnd.index).trim();
    } else if (DUE_ANY.test(rest)) {
      throw new NoteError(`line ${lineNo}: write the due date at the end of the line as "(due YYYY-MM-DD)".`);
    }
    if (!rest) throw new NoteError(`line ${lineNo}: task has no text.`);
    tasks.push({ text: rest, patrol, due, done: m[1] !== ' ' });
  });
  return tasks;
}

// Splits the body into the public note and the lines under "## Tasks".
function splitBody(content, firstBodyLine) {
  const lines = content.split(/\r?\n/);
  const notes = [];
  const taskLines = [];
  let section = 'notes';
  lines.forEach((text, i) => {
    if (/^##\s+tasks\s*$/i.test(text.trim())) { section = 'tasks'; return; }
    // Any other level-2 heading ends the task list.
    if (/^##\s/.test(text)) section = 'notes';
    if (section === 'tasks') taskLines.push({ text, lineNo: firstBodyLine + i });
    else notes.push(text);
  });
  return { notes: notes.join('\n').trim(), taskLines };
}

// ---------- privacy guard ----------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// US-style numbers: 555-123-4567, (555) 123-4567, 555.123.4567, +1 555 123 4567.
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g;

function findContacts(text, allowed) {
  const ok = new Set(allowed.map((a) => a.toLowerCase()));
  const found = [...(text.match(EMAIL) || []), ...(text.match(PHONE) || [])];
  return found.filter((f) => !ok.has(f.trim().toLowerCase()));
}

// ---------- one note ----------

function parseNote(fileName, source, config) {
  const allowed = config.allowedContacts || [];
  const contacts = findContacts(source, allowed);
  if (contacts.length) {
    throw new NoteError(`contains what looks like contact info (${contacts.join(', ')}). Remove it, or ask the Scoutmaster to approve it and add it to allowedContacts in site.config.json.`);
  }

  let file;
  try {
    // Passing options turns off gray-matter's cache, whose repeat results
    // lose the raw header text that the date checks below rely on.
    file = matter(source, { excerpt: false });
  } catch (e) {
    throw new NoteError(`the header between the --- lines can't be read: ${e.reason || e.message}`);
  }
  const data = file.data;
  const header = file.matter || '';
  if (!header.trim()) throw new NoteError('is missing its header. Start the file with --- lines like the template.');

  for (const key of Object.keys(data)) {
    if (!FIELDS.includes(key)) throw new NoteError(`unknown field "${key}". Allowed: ${FIELDS.join(', ')}.`);
  }
  for (const key of ['title', 'type', 'date']) {
    if (data[key] === undefined || data[key] === null || String(data[key]).trim() === '') {
      throw new NoteError(`is missing "${key}".`);
    }
  }

  const title = String(data.title).trim();
  const type = String(data.type).trim();
  if (!TYPES.includes(type)) throw new NoteError(`type "${type}" is not allowed. Use one of: ${TYPES.join(', ')}.`);

  const status = data.status === undefined ? 'scheduled' : String(data.status).trim();
  if (!STATUSES.includes(status)) throw new NoteError(`status "${status}" is not allowed. Use scheduled or cancelled.`);

  const date = rawValue(header, 'date');
  if (!isRealDate(date)) throw new NoteError(`date "${date}" is not a real date. Use YYYY-MM-DD.`);

  let endDate = null;
  if (data.end_date !== undefined) {
    endDate = rawValue(header, 'end_date');
    if (!isRealDate(endDate)) throw new NoteError(`end_date "${endDate}" is not a real date. Use YYYY-MM-DD.`);
    if (endDate < date) throw new NoteError(`end_date ${endDate} is before date ${date}.`);
  }

  const times = {};
  for (const key of ['start', 'end']) {
    if (data[key] === undefined) { times[key] = null; continue; }
    if (!isTime(data[key])) {
      throw new NoteError(`${key} must be a quoted 24-hour time like "19:00" (got ${rawValue(header, key)}).`);
    }
    times[key] = data[key];
  }

  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(fileName)) {
    throw new NoteError('file name must look like YYYY-MM-DD-short-name.md (lowercase, hyphens).');
  }
  if (!fileName.startsWith(date)) {
    throw new NoteError(`file name starts with ${fileName.slice(0, 10)} but the date field is ${date}. Make them match.`);
  }

  // Header lines plus the two --- lines come before the body.
  const firstBodyLine = header.replace(/^\n/, '').split('\n').length + 3;
  const { notes, taskLines } = splitBody(file.content, firstBodyLine);
  const tasks = parseTasks(taskLines, config.patrols || []);

  return {
    slug: fileName.replace(/\.md$/, ''),
    file: fileName,
    title,
    type,
    date,
    endDate,
    start: times.start,
    end: times.end,
    location: data.location === undefined ? null : String(data.location).trim(),
    status,
    notes,
    tasks,
  };
}

// ---------- the whole schedule ----------

// An event is upcoming through the end of its last day in the troop's time zone.
function classify(event, today) {
  const lastDay = event.endDate || event.date;
  const upcoming = lastDay >= today;
  return {
    ...event,
    upcoming,
    // "Held" is never typed: a past event that wasn't cancelled was held.
    outcome: upcoming ? null : (event.status === 'cancelled' ? 'cancelled' : 'held'),
    // Negative while a multi-day event is under way.
    daysUntil: daysBetween(today, event.date),
  };
}

function byDateThenStart(a, b) {
  return a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || '');
}

// Open tasks from upcoming events that are still on. Undated tasks go last.
function buildTodo(upcoming) {
  const todo = [];
  for (const ev of upcoming) {
    if (ev.status === 'cancelled') continue;
    for (const t of ev.tasks) {
      if (!t.done) todo.push({ ...t, eventSlug: ev.slug, eventTitle: ev.title, eventDate: ev.date });
    }
  }
  return todo.sort((a, b) => {
    if (a.due && b.due) return a.due.localeCompare(b.due) || a.eventDate.localeCompare(b.eventDate);
    if (a.due) return -1;
    if (b.due) return 1;
    return a.eventDate.localeCompare(b.eventDate);
  });
}

function buildSchedule(notes, config, now = new Date()) {
  const today = todayIn(config.timeZone, now);
  const errors = [];
  const events = [];
  for (const { fileName, source } of notes) {
    try {
      events.push(classify(parseNote(fileName, source, config), today));
    } catch (e) {
      if (!(e instanceof NoteError)) throw e;
      errors.push(`${fileName}: ${e.message}`);
    }
  }
  const upcoming = events.filter((e) => e.upcoming).sort(byDateThenStart);
  const past = events.filter((e) => !e.upcoming).sort((a, b) => byDateThenStart(b, a));
  return { today, errors, upcoming, past, todo: buildTodo(upcoming) };
}

// ---------- HTML helpers ----------

// Every bit of note text passes through here before it touches HTML, so a
// stray "<" in a note can't break a page or inject markup.
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TYPE_LABELS = {
  meeting: 'Meeting', campout: 'Campout', camp: 'Camp', plc: 'PLC',
  'court-of-honor': 'Court of Honor', service: 'Service', other: 'Event',
};

function typePill(type) {
  // PLC means nothing to the public, so the abbreviation carries its meaning.
  const label = type === 'plc'
    ? '<abbr title="Patrol Leaders\' Council">PLC</abbr>'
    : esc(TYPE_LABELS[type]);
  return `<span class="pill">${label}</span>`;
}

// Formats a date string by pinning it to UTC on both sides, so the calendar
// day printed is always the one written in the note.
function fmtDate(s, opts) {
  const [y, m, d] = s.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d)));
}
const longDate = (s) => fmtDate(s, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (s) => fmtDate(s, { weekday: 'short', month: 'short', day: 'numeric' });
const monthHeading = (s) => fmtDate(s, { month: 'long', year: 'numeric' });

function time12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function timeRange(start, end) {
  if (!start) return '';
  if (!end) return time12(start);
  const [a, b] = [time12(start), time12(end)];
  // "7:00 to 8:30 PM" reads better than repeating PM.
  if (a.slice(-2) === b.slice(-2)) return `${a.slice(0, -3)} to ${b}`;
  return `${a} to ${b}`;
}

function whenText(ev, fmt = longDate) {
  if (!ev.endDate || ev.endDate === ev.date) {
    const times = timeRange(ev.start, ev.end);
    return times ? `${fmt(ev.date)}, ${times}` : fmt(ev.date);
  }
  const from = ev.start ? `${fmt(ev.date)}, ${time12(ev.start)}` : fmt(ev.date);
  const to = ev.end ? `${fmt(ev.endDate)}, ${time12(ev.end)}` : fmt(ev.endDate);
  return `${from} to ${to}`;
}

function relativeDay(ev) {
  if (ev.daysUntil < 0) return 'Happening now';
  if (ev.daysUntil === 0) return ev.endDate ? 'Starts today' : 'Today';
  if (ev.daysUntil === 1) return 'Tomorrow';
  return `In ${ev.daysUntil} days`;
}

// Notes are plain text. Blank lines make paragraphs, "- " lines make a list,
// and a "## " line makes a heading. Everything else is shown as typed.
function renderNotes(text) {
  if (!text) return '';
  return text.split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => l.startsWith('- '))) {
      return `<ul>${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
    }
    if (lines.length === 1 && /^#{1,6}\s/.test(lines[0])) {
      return `<h2>${esc(lines[0].replace(/^#+\s*/, ''))}</h2>`;
    }
    return `<p>${lines.map(esc).join('<br>\n')}</p>`;
  }).join('\n');
}

function firstSentence(text, max = 140) {
  const plain = (text || '').replace(/^#+\s*/gm, '').replace(/^- /gm, '').replace(/\s+/g, ' ').trim();
  const sentence = (plain.match(/^.*?[.!?](\s|$)/) || [plain])[0].trim();
  return sentence.length > max ? `${sentence.slice(0, max - 3).trim()}...` : sentence;
}

// ---------- page templates ----------

function layout(site, page) {
  const { config } = site;
  const root = page.root;
  const placeName = `${config.troopName} ${config.town}, NY`;
  const canonical = page.path === undefined ? null : config.baseUrl + page.path;
  const navLink = (href, label, key) =>
    `<li><a href="${href}"${page.nav === key ? ' aria-current="page"' : ''}>${label}</a></li>`;
  // Only point at icons and preview images that exist, so no tag is a broken link.
  const ogImage = site.hasStatic('og.png') ? config.baseUrl + 'og.png' : null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} | ${esc(placeName)}</title>
<meta name="description" content="${esc(page.description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '<meta name="robots" content="noindex">'}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(config.troopName)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">\n<meta property="og:image:alt" content="${esc(config.troopName)} schedule, ${esc(config.town)}, ${esc(config.state)}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
${site.hasStatic('favicon.svg') ? `<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">` : ''}
<link rel="stylesheet" href="${root}style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="wordmark" href="${root || './'}">${esc(config.troopName)}</a>
    <nav aria-label="Schedule">
      <ul>
        ${navLink(root || './', 'Upcoming', 'upcoming')}
        ${navLink(`${root}past.html`, 'Past', 'past')}
      </ul>
    </nav>
  </div>
</header>
<main id="main" class="wrap">
${page.body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p><a href="${root}about.html">About this site: privacy, accessibility, and schedule changes</a></p>
    <p>${esc(config.troopName)}, ${esc(config.town)}, ${esc(config.state)}. Last updated ${esc(longDate(site.today))}.</p>
  </div>
</footer>
</body>
</html>
`;
}

function eventRow(ev, root, extra = '') {
  const multi = ev.endDate && ev.endDate !== ev.date;
  const meta = [
    multi ? `to ${shortDate(ev.endDate)}` : '',
    multi ? '' : timeRange(ev.start, ev.end),
    ev.location ? esc(ev.location) : '',
  ].filter(Boolean).join(' · ');
  const cancelled = ev.status === 'cancelled';
  const title = cancelled ? `<s>${esc(ev.title)}</s>` : esc(ev.title);
  return `<li>
  <a class="event-row" href="${root}events/${esc(ev.slug)}.html">
    <span class="date-block" aria-hidden="true"><span class="dow">${fmtDate(ev.date, { weekday: 'short' })}</span><span class="dom">${fmtDate(ev.date, { day: 'numeric' })}</span></span>
    <span class="row-main">
      <span class="visually-hidden">${esc(shortDate(ev.date))}: </span>
      <span class="row-title">${title}</span>
      <span class="row-meta">${typePill(ev.type)}${cancelled ? ' <span class="pill pill-status">Cancelled</span>' : ''}${extra}${meta ? ` <span>${meta}</span>` : ''}</span>
    </span>
  </a>
</li>`;
}

function groupByMonth(events, root, rowExtra, level = 3) {
  const groups = [];
  for (const ev of events) {
    const label = monthHeading(ev.date);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, events: [] });
    groups[groups.length - 1].events.push(ev);
  }
  return groups.map((g) => `<h${level} class="month">${esc(g.label)}</h${level}>
<ul class="event-list">
${g.events.map((ev) => eventRow(ev, root, rowExtra ? rowExtra(ev) : '')).join('\n')}
</ul>`).join('\n');
}

function patrolChip(task) {
  return `<span class="chip">${esc(task.patrol || 'Everyone')}</span>`;
}

function dueText(task, today) {
  if (!task.due) return '';
  const word = task.due < today ? 'Was due' : 'Due';
  return `<span class="due">${word} ${esc(shortDate(task.due))}</span>`;
}

function todoList(todo, root, today) {
  if (!todo.length) return '<p class="empty">Nothing to do right now.</p>';
  return `<ul class="todo">
${todo.map((t) => `<li>
  <p class="task-text">${esc(t.text)}</p>
  <p class="task-meta">${patrolChip(t)} ${dueText(t, today)} <span class="task-for">for <a href="${root}events/${esc(t.eventSlug)}.html">${esc(t.eventTitle)}</a></span></p>
</li>`).join('\n')}
</ul>`;
}

function homePage(site) {
  const { schedule, config } = site;
  const root = '';
  const next = schedule.upcoming.find((e) => e.status !== 'cancelled');
  const rest = schedule.upcoming.filter((e) => e !== next);
  const hasDay = config.meetingDay && !config.meetingDay.startsWith('[');
  const meets = `${config.troopName} is a Scout troop in ${config.town}, ${config.state}. We meet${hasDay ? ` on ${esc(config.meetingDay)}` : ''} at ${esc(config.meetingPlace)}.`;

  const nextCard = next ? `<div class="next-card">
  <h3 class="next-title"><a href="events/${esc(next.slug)}.html">${esc(next.title)}</a></h3>
  <p class="next-type">${typePill(next.type)} <span class="next-when-rel">${relativeDay(next)}</span></p>
  <p>${esc(whenText(next))}</p>
  ${next.location ? `<p>${esc(next.location)}</p>` : ''}
</div>` : '<p class="empty">Nothing scheduled yet.</p>';

  const body = `<section class="intro">
  <h1>Troop schedule</h1>
  <p>${meets} Here is what's coming up.</p>
</section>
<div class="home-grid">
<section class="area-next" aria-labelledby="next-h">
  <h2 id="next-h">Next up</h2>
  ${nextCard}
</section>
<aside class="area-todo" aria-labelledby="todo-h">
  <h2 id="todo-h">To do</h2>
  ${todoList(schedule.todo, root, schedule.today)}
</aside>
<section class="area-coming" aria-labelledby="coming-h">
  <h2 id="coming-h">Coming up</h2>
  ${rest.length ? groupByMonth(rest, root) : `<p class="empty">${next ? 'Nothing else scheduled yet.' : 'Nothing scheduled yet.'}</p>`}
</section>
<section class="area-access" aria-labelledby="access-h">
  <h2 id="access-h">Accessibility</h2>
  <p>We want this schedule to work for everyone, including people who use a screen reader, a keyboard, or zoomed-in text. If anything here is hard to use, please tell us, and read our <a href="about.html#accessibility">full accessibility statement</a>.</p>
</section>
</div>`;

  return layout(site, {
    root, path: '', nav: 'upcoming', body,
    title: 'Schedule',
    description: `Upcoming meetings, campouts, and to do list for Scout ${config.troopName} in ${config.town}, ${config.state}. Regular meetings at ${config.meetingPlace}.`,
  });
}

function pastPage(site) {
  const { schedule } = site;
  const root = '';
  const body = `<h1>Past events</h1>
<p>A record of past meetings and trips, newest first.</p>
${schedule.past.length
    // Month headings are h2 here because there is no section heading above them.
    ? groupByMonth(schedule.past, root, (ev) => (ev.outcome === 'held' ? ' <span class="pill pill-status">Held</span>' : ''), 2)
    : '<p class="empty">No past events yet.</p>'}`;
  return layout(site, {
    root, path: 'past.html', nav: 'past', body,
    title: 'Past events',
    description: `Past meetings, campouts, and service projects of Scout ${site.config.troopName} in ${site.config.town}, ${site.config.state}.`,
  });
}

function eventPage(site, ev) {
  const root = '../';
  const today = site.schedule.today;
  const statusText = ev.status === 'cancelled' ? 'Cancelled' : (ev.upcoming ? relativeDay(ev) : 'Held');
  const tasks = ev.tasks.length ? `<section aria-labelledby="todo-h">
  <h2 id="todo-h">To do</h2>
  <ul class="todo">
  ${ev.tasks.map((t) => `<li${t.done ? ' class="done"' : ''}>
    <p class="task-text">${t.done ? '<span class="pill pill-status">Done</span> ' : ''}${esc(t.text)}</p>
    <p class="task-meta">${patrolChip(t)} ${t.done ? '' : dueText(t, today)}</p>
  </li>`).join('\n  ')}
  </ul>
</section>` : '';

  const body = `<p class="back"><a href="${root}${ev.upcoming ? '' : 'past.html'}"><span aria-hidden="true">&larr;</span> ${ev.upcoming ? 'All upcoming events' : 'All past events'}</a></p>
<h1${ev.status === 'cancelled' ? ' class="cancelled"' : ''}>${esc(ev.title)}</h1>
<p class="event-status">${typePill(ev.type)} <span class="pill pill-status">${statusText}</span></p>
<dl class="facts">
  <div><dt>When</dt><dd>${esc(whenText(ev))}</dd></div>
  ${ev.location ? `<div><dt>Where</dt><dd>${esc(ev.location)}</dd></div>` : ''}
</dl>
<div class="notes">
${renderNotes(ev.notes)}
</div>
${tasks}`;

  const what = TYPE_LABELS[ev.type].toLowerCase();
  const where = ev.location ? ` at ${ev.location}` : '';
  const lead = ev.status === 'cancelled' ? 'Cancelled: ' : '';
  return layout(site, {
    root, path: `events/${ev.slug}.html`, nav: null, body,
    title: `${ev.title}, ${shortDate(ev.date)}, ${ev.date.slice(0, 4)}`,
    description: `${lead}${site.config.troopName} ${what} on ${longDate(ev.date)}${where}. ${firstSentence(ev.notes)}`.trim(),
  });
}

function aboutPage(site) {
  const { config } = site;
  const email = config.accessibilityEmail
    ? `<a href="mailto:${esc(config.accessibilityEmail)}">${esc(config.accessibilityEmail)}</a>`
    : '[troop email address, waiting for Scoutmaster approval]';
  const reply = config.accessibilityReplyTime ? esc(config.accessibilityReplyTime) : '[reply timeframe]';
  const body = `<h1>About this site</h1>
<p>This is the public schedule for ${esc(config.troopName)} in ${esc(config.town)}, ${esc(config.state)}: meetings, campouts, and what to do before each one.</p>

<h2 id="privacy">Privacy</h2>
<p>This site sets no cookies, runs no analytics, and has no forms or accounts. Everything on it, including the fonts, is served from this site, so your visit is not shared with other companies. The site is hosted by GitHub, which keeps basic server logs as any web host does.</p>
<p>We never publish the names, photos, or contact details of any scout. Tasks are given to everyone or to a patrol, never to a person.</p>

<h2 id="accessibility">Accessibility</h2>
<p>We want everyone to be able to use this schedule, including people who use a screen reader, a keyboard instead of a mouse, or large text. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA.</p>
<ul>
  <li>Every page works without JavaScript.</li>
  <li>Every page can be used with a keyboard, and the focused item is always outlined.</li>
  <li>Text and background colors meet contrast guidelines, and meaning is never shown by color alone.</li>
  <li>Pages still work when text is enlarged to 200 percent.</li>
</ul>
<p>If something is hard to use, tell the Scoutmaster in person at any meeting, or email ${email}. We will reply ${reply}.</p>

<h2 id="schedule-changes">Schedule changes</h2>
<p>Plans can change because of weather or other reasons. When they do, the event's page is updated, and a called-off event is marked Cancelled. The site also refreshes itself every day. If you are unsure whether an event is on, ask the Scoutmaster at a meeting.</p>`;
  return layout(site, {
    root: '', path: 'about.html', nav: null, body,
    title: 'About, privacy, and accessibility',
    description: `How the ${config.troopName} ${config.town} schedule site handles privacy, accessibility, and schedule changes.`,
  });
}

function notFoundPage(site) {
  // GitHub Pages serves this file for a missing address at any depth, so its
  // links must start from the site's own path instead of being relative.
  const root = new URL(site.config.baseUrl).pathname;
  const body = `<h1>Page not found</h1>
<p>That page doesn't exist. The event may have been renamed or moved to another date.</p>
<p><a href="${root}">See the upcoming schedule</a> or <a href="${root}past.html">past events</a>.</p>`;
  return layout(site, {
    root, nav: null, body,
    title: 'Page not found',
    description: `Page not found on the ${site.config.troopName} schedule site.`,
  });
}

function sitemap(site) {
  const paths = ['', 'past.html', 'about.html',
    ...[...site.schedule.upcoming, ...site.schedule.past].map((e) => `events/${e.slug}.html`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${esc(site.config.baseUrl + p)}</loc></url>`).join('\n')}
</urlset>
`;
}

// Starts from an empty dist/ every time, so a deleted note never leaves an
// orphaned page behind.
function writeSite(schedule, config, outDir, staticDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'events'), { recursive: true });
  fs.cpSync(staticDir, outDir, { recursive: true });

  const site = {
    schedule, config, today: schedule.today,
    hasStatic: (name) => fs.existsSync(path.join(staticDir, name)),
  };
  const write = (rel, html) => fs.writeFileSync(path.join(outDir, rel), html);
  write('index.html', homePage(site));
  write('past.html', pastPage(site));
  write('about.html', aboutPage(site));
  write('404.html', notFoundPage(site));
  write('sitemap.xml', sitemap(site));
  for (const ev of [...schedule.upcoming, ...schedule.past]) write(`events/${ev.slug}.html`, eventPage(site, ev));
}

// Rule 2: no adult contact details unless the Scoutmaster approved them,
// which is recorded by listing them in allowedContacts.
function checkConfig(config) {
  const errors = [];
  const allowed = (config.allowedContacts || []).map((a) => a.toLowerCase());
  if (config.accessibilityEmail && !allowed.includes(config.accessibilityEmail.toLowerCase())) {
    errors.push('site.config.json: accessibilityEmail must also be listed in allowedContacts once the Scoutmaster approves it.');
  }
  return errors;
}

function readNotes(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((fileName) => ({ fileName, source: fs.readFileSync(path.join(dir, fileName), 'utf8') }));
}

function main() {
  const useSamples = process.argv.includes('--samples');
  const dirName = useSamples ? 'content/samples' : 'content/meetings';
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const schedule = buildSchedule(readNotes(path.join(ROOT, dirName)), config);
  const errors = [...checkConfig(config), ...schedule.errors];

  if (errors.length) {
    console.error(`Build stopped. Nothing was published. Fix ${errors.length === 1 ? 'this' : 'these'} (notes are in ${dirName}/):\n`);
    for (const e of errors) console.error(`  ${e}`);
    // On GitHub, "::error" lines show on the run's summary page, so an admin
    // on a phone sees the problem without opening the full log.
    if (process.env.GITHUB_ACTIONS) {
      for (const e of errors) console.log(`::error title=Site not updated::${e}`);
    }
    process.exit(1);
  }
  writeSite(schedule, config, path.join(ROOT, 'dist'), path.join(ROOT, 'src/static'));
  console.log(`Built dist/ from ${dirName}/ for ${schedule.today}: ${schedule.upcoming.length} upcoming, ${schedule.past.length} past, ${schedule.todo.length} open tasks.`);
}

if (require.main === module) main();

module.exports = {
  isRealDate, isTime, todayIn, daysBetween, rawValue, parseTasks, findContacts,
  parseNote, classify, buildTodo, buildSchedule, NoteError,
  esc, time12, timeRange, whenText, relativeDay, renderNotes, writeSite, checkConfig,
};
