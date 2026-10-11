// Turns the Markdown notes in content/ into validated event data.
// Phase 1 stops at data; Phase 2 adds the HTML pages in dist/.

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

  if (schedule.errors.length) {
    console.error(`Build stopped. Nothing was published. Fix ${schedule.errors.length === 1 ? 'this' : 'these'} in ${dirName}/:\n`);
    for (const e of schedule.errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`Read ${dirName}/ for ${schedule.today}: ${schedule.upcoming.length} upcoming, ${schedule.past.length} past, ${schedule.todo.length} open tasks.`);
}

if (require.main === module) main();

module.exports = {
  isRealDate, isTime, todayIn, daysBetween, rawValue, parseTasks, findContacts,
  parseNote, classify, buildTodo, buildSchedule, NoteError,
};
