const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  isRealDate, todayIn, daysBetween, parseTasks, findContacts,
  parseNote, buildSchedule, NoteError,
  esc, timeRange, whenText, renderNotes, writeSite, checkConfig, checkUploads,
} = require('./build.js');

const config = {
  timeZone: 'America/New_York',
  patrols: ['Patrol A', 'Patrol B'],
  allowedContacts: ['troop45@example.org'],
};

// Builds a note from header lines so each test only spells out what it changes.
function note(headerLines, body = '') {
  return `---\n${headerLines.join('\n')}\n---\n${body}`;
}
const BASE = ['title: Troop Meeting', 'type: meeting', 'date: 2026-10-13'];
const FILE = '2026-10-13-troop-meeting.md';

function rejects(fileName, source, pattern) {
  assert.throws(() => parseNote(fileName, source, config), (e) => e instanceof NoteError && pattern.test(e.message));
}

function lines(...texts) {
  return texts.map((text, i) => ({ text, lineNo: i + 1 }));
}

// ---------- dates ----------

test('isRealDate accepts real dates and rejects impossible ones', () => {
  assert.equal(isRealDate('2026-10-18'), true);
  assert.equal(isRealDate('2028-02-29'), true);
  assert.equal(isRealDate('2026-02-29'), false);
  assert.equal(isRealDate('2026-02-30'), false);
  assert.equal(isRealDate('2026-13-01'), false);
  assert.equal(isRealDate('2026-1-5'), false);
  assert.equal(isRealDate(undefined), false);
});

test('todayIn uses the troop time zone, not UTC', () => {
  // 03:30 UTC on Oct 14 is still 23:30 on Oct 13 in New York.
  assert.equal(todayIn('America/New_York', new Date('2026-10-14T03:30:00Z')), '2026-10-13');
  assert.equal(todayIn('America/New_York', new Date('2026-10-14T04:00:00Z')), '2026-10-14');
  // In January New York is UTC-5, so the day turns at 05:00 UTC.
  assert.equal(todayIn('America/New_York', new Date('2026-01-10T04:59:00Z')), '2026-01-09');
  assert.equal(todayIn('America/New_York', new Date('2026-01-10T05:00:00Z')), '2026-01-10');
});

test('daysBetween counts calendar days across a DST change', () => {
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
  assert.equal(daysBetween('2026-10-13', '2026-10-13'), 0);
  assert.equal(daysBetween('2026-10-18', '2026-10-17'), -1);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

// ---------- tasks ----------

test('parseTasks reads patrol tags, due dates, and done boxes', () => {
  const tasks = parseTasks(lines(
    '- [ ] Return permission slip (due 2026-10-08)',
    '- [ ] [Patrol A] Plan dinner menu',
    '- [x] Reserve campsite',
    '- [X] [Patrol B] Buy food (due 2026-10-16)',
    '',
  ), config.patrols);
  assert.deepEqual(tasks, [
    { text: 'Return permission slip', patrol: null, due: '2026-10-08', done: false },
    { text: 'Plan dinner menu', patrol: 'Patrol A', due: null, done: false },
    { text: 'Reserve campsite', patrol: null, due: null, done: true },
    { text: 'Buy food', patrol: 'Patrol B', due: '2026-10-16', done: true },
  ]);
});

test('parseTasks rejects unknown patrols, bad due dates, and stray lines', () => {
  const bad = (text, pattern) => assert.throws(() => parseTasks(lines(text), config.patrols), pattern);
  bad('- [ ] [Patrol Z] Plan menu', /unknown patrol "\[Patrol Z\]"/);
  bad('- [ ] Pay fee (due 2026-02-30)', /not a real date/);
  bad('- [ ] Pay fee (due Oct 8)', /not a real date/);
  bad('- [ ] Pay fee (due 2026-10-08) at the meeting', /at the end of the line/);
  bad('Bring a flashlight', /not a task/);
  bad('- [] Missing space in box', /not a task/);
});

// ---------- one note ----------

test('parseNote reads a full note and splits notes from tasks', () => {
  const ev = parseNote('2026-10-17-fall-campout.md', note([
    'title: Fall Campout', 'type: campout', 'date: 2026-10-17', 'end_date: 2026-10-18',
    'start: "08:00"', 'end: "12:00"', 'location: State Park',
  ], 'Bring a sleeping bag.\n\n## Tasks\n- [ ] Return slip (due 2026-10-08)\n'), config);
  assert.equal(ev.slug, '2026-10-17-fall-campout');
  assert.equal(ev.date, '2026-10-17');
  assert.equal(ev.endDate, '2026-10-18');
  assert.equal(ev.start, '08:00');
  assert.equal(ev.status, 'scheduled');
  assert.equal(ev.notes, 'Bring a sleeping bag.');
  assert.equal(ev.tasks.length, 1);
});

test('the template parses once copied to a properly named file', () => {
  const source = fs.readFileSync(path.join(__dirname, '../content/templates/meeting.md'), 'utf8');
  const ev = parseNote('2026-01-06-troop-meeting.md', source, config);
  assert.equal(ev.tasks.length, 2);
});

test('every sample note is valid', () => {
  const dir = path.join(__dirname, '../content/samples');
  const notes = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    .map((fileName) => ({ fileName, source: fs.readFileSync(path.join(dir, fileName), 'utf8') }));
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '../site.config.json'), 'utf8'));
  assert.ok(notes.length >= 5);
  assert.deepEqual(buildSchedule(notes, real).errors, []);
});

// ---------- each validation error ----------

test('missing required fields', () => {
  rejects(FILE, note(['type: meeting', 'date: 2026-10-13']), /missing "title"/);
  rejects(FILE, note(['title: X', 'date: 2026-10-13']), /missing "type"/);
  rejects(FILE, note(['title: X', 'type: meeting']), /missing "date"/);
  rejects(FILE, 'Just text, no header.', /missing its header/);
});

test('unknown type, status, or field', () => {
  rejects(FILE, note(['title: X', 'type: party', 'date: 2026-10-13']), /type "party" is not allowed/);
  rejects(FILE, note([...BASE, 'status: held']), /status "held" is not allowed/);
  rejects(FILE, note([...BASE, 'loaction: Mary St']), /unknown field "loaction"/);
});

test('impossible dates are caught even though YAML would roll them over', () => {
  rejects('2026-02-30-x.md', note(['title: X', 'type: meeting', 'date: 2026-02-30']), /date "2026-02-30" is not a real date/);
  rejects(FILE, note([...BASE, 'end_date: 2026-10-32']), /end_date "2026-10-32" is not a real date/);
});

test('end_date before date', () => {
  rejects(FILE, note([...BASE, 'end_date: 2026-10-12']), /end_date 2026-10-12 is before date 2026-10-13/);
});

test('times are read as typed, quoted or not, and must be 24-hour', () => {
  // YAML alone would turn an unquoted 19:00 into the number 1140.
  assert.equal(parseNote(FILE, note([...BASE, 'start: 19:00', "end: '20:30'"]), config).start, '19:00');
  assert.equal(parseNote(FILE, note([...BASE, 'start: 19:00', 'end: "20:30"']), config).end, '20:30');
  rejects(FILE, note([...BASE, 'end: "7:30pm"']), /end must be a 24-hour time like 19:00/);
  rejects(FILE, note([...BASE, 'start: "24:00"']), /start must be a 24-hour time/);
  rejects(FILE, note([...BASE, 'start: 7']), /start must be a 24-hour time/);
});

test('file name must match the date and the naming pattern', () => {
  rejects('2026-10-14-troop-meeting.md', note(BASE), /starts with 2026-10-14 but the date field is 2026-10-13/);
  rejects('Troop Meeting.md', note(BASE), /must look like YYYY-MM-DD-short-name\.md/);
});

test('task errors name the line in the file', () => {
  rejects(FILE, note(BASE, 'Notes.\n\n## Tasks\n- [ ] [Patrol Q] Thing\n'), /line 9: unknown patrol/);
});

test('privacy guard blocks emails and phone numbers unless allowed', () => {
  rejects(FILE, note(BASE, 'Questions? Email someone@gmail.com'), /contact info \(someone@gmail\.com\)/);
  rejects(FILE, note(BASE, 'Call 555-123-4567'), /contact info/);
  rejects(FILE, note(BASE, 'Call (555) 123-4567'), /contact info/);
  rejects(FILE, note(BASE, 'Call 555.123.4567'), /contact info/);
  assert.doesNotThrow(() => parseNote(FILE, note(BASE, 'Email troop45@example.org'), config));
  // Dates and times must not look like phone numbers.
  assert.deepEqual(findContacts('(due 2026-10-08) at 19:00, 2026-10-13', []), []);
});

test('buildSchedule reports every broken note with its file name', () => {
  const result = buildSchedule([
    { fileName: FILE, source: note(BASE) },
    { fileName: '2026-10-14-bad.md', source: note(['title: X', 'type: meeting', 'date: 2026-10-14', 'start: 7pm']) },
  ], config, new Date('2026-10-01T12:00:00Z'));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^2026-10-14-bad\.md: start must be a 24-hour time/);
});

// ---------- upcoming versus past ----------

function scheduleAt(isoInstant, notes) {
  return buildSchedule(notes.map(([fileName, header, body]) => ({ fileName, source: note(header, body) })), config, new Date(isoInstant));
}

test('a one-day event stays upcoming until midnight New York time', () => {
  const notes = [[FILE, BASE]];
  // 23:59 on Oct 13 in New York (03:59 UTC on the 14th): still upcoming.
  assert.equal(scheduleAt('2026-10-14T03:59:00Z', notes).upcoming.length, 1);
  // 00:00 on Oct 14 in New York: now past and held.
  const after = scheduleAt('2026-10-14T04:00:00Z', notes);
  assert.equal(after.upcoming.length, 0);
  assert.equal(after.past[0].outcome, 'held');
});

test('a multi-day event stays upcoming through its last day', () => {
  const notes = [['2026-10-17-campout.md', ['title: Campout', 'type: campout', 'date: 2026-10-17', 'end_date: 2026-10-18']]];
  const during = scheduleAt('2026-10-18T20:00:00Z', notes);
  assert.equal(during.upcoming.length, 1);
  assert.equal(during.upcoming[0].daysUntil, -1);
  assert.equal(scheduleAt('2026-10-19T04:00:00Z', notes).past.length, 1);
});

test('past cancelled events are marked cancelled, not held', () => {
  const s = scheduleAt('2026-11-01T12:00:00Z', [[FILE, [...BASE, 'status: cancelled']]]);
  assert.equal(s.past[0].outcome, 'cancelled');
});

test('daysUntil counts from today in New York', () => {
  // 22:00 Oct 12 in New York is already Oct 13 in UTC; the event is still 1 day away.
  const s = scheduleAt('2026-10-13T02:00:00Z', [[FILE, BASE]]);
  assert.equal(s.today, '2026-10-12');
  assert.equal(s.upcoming[0].daysUntil, 1);
});

test('upcoming is soonest first, past is newest first', () => {
  const s = scheduleAt('2026-10-15T12:00:00Z', [
    ['2026-10-20-b.md', ['title: B', 'type: meeting', 'date: 2026-10-20']],
    ['2026-10-16-a.md', ['title: A', 'type: meeting', 'date: 2026-10-16']],
    ['2026-10-01-old.md', ['title: Old', 'type: meeting', 'date: 2026-10-01']],
    ['2026-10-08-newer.md', ['title: Newer', 'type: meeting', 'date: 2026-10-08']],
  ]);
  assert.deepEqual(s.upcoming.map((e) => e.title), ['A', 'B']);
  assert.deepEqual(s.past.map((e) => e.title), ['Newer', 'Old']);
});

// ---------- to do list ----------

test('to do list: open tasks from upcoming, live events, by due date, undated last', () => {
  const s = scheduleAt('2026-10-10T12:00:00Z', [
    ['2026-10-20-b.md', ['title: B', 'type: meeting', 'date: 2026-10-20'],
      '## Tasks\n- [ ] Undated B\n- [ ] Due late (due 2026-10-19)\n- [x] Done already (due 2026-10-11)\n'],
    ['2026-10-15-a.md', ['title: A', 'type: meeting', 'date: 2026-10-15'],
      '## Tasks\n- [ ] Undated A\n- [ ] Due early (due 2026-10-12)\n'],
    ['2026-10-16-off.md', ['title: Off', 'type: meeting', 'date: 2026-10-16', 'status: cancelled'],
      '## Tasks\n- [ ] Moot task (due 2026-10-11)\n'],
    ['2026-10-01-old.md', ['title: Old', 'type: meeting', 'date: 2026-10-01'],
      '## Tasks\n- [ ] Never done (due 2026-09-30)\n'],
  ]);
  assert.deepEqual(s.todo.map((t) => t.text), ['Due early', 'Due late', 'Undated A', 'Undated B']);
  assert.equal(s.todo[0].eventSlug, '2026-10-15-a');
});

// ---------- notes saved by the editing form ----------

test('form-made notes: tasks in the header, empty optional fields', () => {
  const ev = parseNote('2026-10-17-fall-campout.md', note([
    'title: Fall Campout', 'type: campout', 'date: 2026-10-17', 'end_date: ""',
    'start: 08:00', 'end: ""', 'location: ""', 'status: ""',
    'tasks:',
    '  - text: Return permission slip',
    '    patrol: ""',
    '    due: 2026-10-08',
    '    done: false',
    '  - text: Plan dinner',
    '    patrol: Patrol A',
    '    due: ""',
    '    done: true',
  ], 'Bring a sleeping bag.\n'), config);
  assert.equal(ev.endDate, null);
  assert.equal(ev.end, null);
  assert.equal(ev.location, null);
  assert.equal(ev.status, 'scheduled');
  assert.deepEqual(ev.tasks, [
    { text: 'Return permission slip', patrol: null, due: '2026-10-08', done: false },
    { text: 'Plan dinner', patrol: 'Patrol A', due: null, done: true },
  ]);
});

test('header tasks and body tasks are combined', () => {
  const ev = parseNote(FILE, note([...BASE, 'tasks:', '  - text: From the form'], '## Tasks\n- [ ] Typed by hand\n'), config);
  assert.deepEqual(ev.tasks.map((t) => t.text), ['From the form', 'Typed by hand']);
});

test('header task errors', () => {
  rejects(FILE, note([...BASE, 'tasks:', '  - text: ""']), /task 1 in the header has no text/);
  rejects(FILE, note([...BASE, 'tasks:', '  - text: Menu', '    patrol: Patrol Z']), /task 1 \("Menu"\): unknown patrol "Patrol Z"/);
  rejects(FILE, note([...BASE, 'tasks:', '  - text: Menu', '    due: "2026-02-30"']), /due date "2026-02-30" is not a real date/);
  rejects(FILE, note([...BASE, 'tasks: buy food']), /"tasks" in the header must be a list/);
});

test('form-style file names with double hyphens are accepted', () => {
  assert.doesNotThrow(() => parseNote('2026-10-13-scouts--day.md', note(BASE), config));
  rejects('2026-10-13-.md', note(BASE), /must look like/);
  rejects('2026-10-13-trailing-.md', note(BASE), /must look like/);
});

// ---------- pages ----------

test('esc neutralizes HTML in note text', () => {
  assert.equal(esc('<script>"x" & \'y\'</script>'), '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
  assert.equal(renderNotes('Bring <b>snacks</b>'), '<p>Bring &lt;b&gt;snacks&lt;/b&gt;</p>');
});

test('renderNotes makes paragraphs, lists, and headings', () => {
  assert.equal(renderNotes('One\ntwo\n\n- a\n- b\n\n## Packing'),
    '<p>One<br>\ntwo</p>\n<ul><li>a</li><li>b</li></ul>\n<h2>Packing</h2>');
});

test('times read naturally', () => {
  assert.equal(timeRange('19:00', '20:30'), '7:00 to 8:30 PM');
  assert.equal(timeRange('09:00', '12:00'), '9:00 AM to 12:00 PM');
  assert.equal(timeRange('00:30', null), '12:30 AM');
  assert.equal(whenText({ date: '2026-10-17', endDate: '2026-10-18', start: '08:00', end: '12:00' }),
    'Saturday, October 17, 2026, 8:00 AM to Sunday, October 18, 2026, 12:00 PM');
  assert.equal(whenText({ date: '2026-10-13', endDate: null, start: null, end: null }), 'Tuesday, October 13, 2026');
});

test('an accessibility email must be approved in allowedContacts', () => {
  assert.equal(checkConfig({ accessibilityEmail: 'a@example.org', allowedContacts: [] }).length, 1);
  assert.equal(checkConfig({ accessibilityEmail: 'a@example.org', allowedContacts: ['a@example.org'] }).length, 0);
  assert.equal(checkConfig({ accessibilityEmail: '', allowedContacts: [] }).length, 0);
});

// Builds the sample site into a temporary folder, the same way npm run build:samples does.
function buildSampleSite() {
  const root = path.join(__dirname, '..');
  const dir = path.join(root, 'content/samples');
  const notes = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    .map((fileName) => ({ fileName, source: fs.readFileSync(path.join(dir, fileName), 'utf8') }));
  const real = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf8'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'troop45-'));
  const schedule = buildSchedule(notes, real, new Date('2026-10-11T12:00:00Z'));
  writeSite(schedule, real, out, path.join(root, 'src/static'));
  return { out, schedule };
}

function allHtml(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    // admin/ is the editors' tool, not a public page, and is tested separately.
    if (d.isDirectory()) return d.name === 'admin' ? [] : allHtml(p, base);
    return d.name.endsWith('.html') ? [path.relative(base, p)] : [];
  });
}

test('the build writes every page, and every relative link resolves', () => {
  const { out, schedule } = buildSampleSite();
  for (const f of ['index.html', 'past.html', 'about.html', '404.html', 'sitemap.xml', 'style.css']) {
    assert.ok(fs.existsSync(path.join(out, f)), `missing ${f}`);
  }
  const pages = allHtml(out);
  assert.equal(pages.filter((p) => p.startsWith('events')).length, schedule.upcoming.length + schedule.past.length);

  for (const page of pages) {
    if (page === '404.html') continue; // uses absolute paths on purpose
    const html = fs.readFileSync(path.join(out, page), 'utf8');
    const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
      .filter((l) => !/^(https?:|mailto:|#)/.test(l));
    for (const link of links) {
      let target = path.join(out, path.dirname(page), link.split('#')[0]);
      if (link.endsWith('/') || link === './' || link === '../') target = path.join(target, 'index.html');
      assert.ok(fs.existsSync(target), `${page} links to ${link}, which does not exist`);
    }
  }
});

test('every page has a unique title and description, a canonical link, and a skip link', () => {
  const { out } = buildSampleSite();
  const titles = new Set();
  const descriptions = new Set();
  for (const page of allHtml(out)) {
    const html = fs.readFileSync(path.join(out, page), 'utf8');
    const title = html.match(/<title>(.*)<\/title>/)[1];
    const desc = html.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(!titles.has(title), `duplicate title: ${title}`);
    assert.ok(!descriptions.has(desc), `duplicate description on ${page}`);
    titles.add(title);
    descriptions.add(desc);
    assert.match(html, /href="#main"/);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /\u2014/, `${page} contains an em dash`);
    if (page !== '404.html') assert.match(html, /<link rel="canonical" href="https:\/\/troop45-thegoats\.github\.io\/troop-45\//);
  }
});

test('the home page shows the next event and an empty past page says so', () => {
  const root = path.join(__dirname, '..');
  const real = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf8'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'troop45-'));
  writeSite(buildSchedule([], real, new Date('2026-10-11T12:00:00Z')), real, out, path.join(root, 'src/static'));
  assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /Nothing scheduled yet\./);
  assert.match(fs.readFileSync(path.join(out, 'past.html'), 'utf8'), /No past events yet\./);

  const { out: full } = buildSampleSite();
  const home = fs.readFileSync(path.join(full, 'index.html'), 'utf8');
  assert.match(home, /class="next-title"><a href="events\/2026-10-13-plc-meeting\.html">PLC Meeting/);
});

test('the editing form is generated from site.config.json', () => {
  const { out } = buildSampleSite();
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '../site.config.json'), 'utf8'));
  const html = fs.readFileSync(path.join(out, 'admin/index.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex">/);
  // Pinned to an exact version, never "latest".
  assert.match(html, /unpkg\.com\/@sveltia\/cms@\d+\.\d+\.\d+\/dist\/sveltia-cms\.js/);

  const cms = JSON.parse(fs.readFileSync(path.join(out, 'admin/config.yml'), 'utf8'));
  assert.equal(cms.backend.repo, real.repo);
  const events = cms.collections[0];
  assert.equal(events.folder, 'content/meetings');
  assert.equal(events.slug, '{{date}}-{{title}}');
  const tasks = events.fields.find((f) => f.name === 'tasks');
  assert.deepEqual(tasks.fields.find((f) => f.name === 'patrol').options, real.patrols);
  const types = events.fields.find((f) => f.name === 'type').options.map((o) => o.value);
  assert.deepEqual(types, ['meeting', 'campout', 'camp', 'plc', 'court-of-honor', 'service', 'other']);
  // The admin page is never listed for search engines.
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8'), /admin/);
});

test('any uploaded file stops the build', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
  assert.deepEqual(checkUploads(dir), []);
  assert.deepEqual(checkUploads(path.join(dir, 'missing')), []);
  fs.writeFileSync(path.join(dir, 'photo.jpg'), '');
  assert.match(checkUploads(dir)[0], /never publishes uploaded files \(photo\.jpg\)/);
});
