function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
const evidenceNames = { global: 'Global', script: 'Script URL', banner: 'Self-hosted file' };
const statusNames = { vulnerable: 'Vulnerable', outdated: 'Outdated', current: 'Current', unknown: 'Unknown' };
function advisoryCard(advisory) {
  const section = node('section', 'advisory');
  section.append(node('h4', '', `${advisory.aliases[0] || 'Retire.js advisory'} · ${advisory.severity}`));
  section.append(node('p', '', advisory.why), node('p', 'upstream', advisory.summary));
  if (advisory.applicability === 'server') section.append(node('p', 'applicability', 'This advisory mentions server-side use. A browser version match alone does not establish exposure.'));
  section.append(node('p', '', `Affected: ${advisory.ranges.map(range => `${range.introduced ? `≥ ${range.introduced}` : 'any earlier version'}${range.fixed ? `, < ${range.fixed}` : ''}`).join(' or ')}`));
  const reference = advisory.references.find(url => /^https:\/\//.test(url)) || advisory.references.find(url => /^http:\/\//.test(url));
  if (reference) {
    const link = node('a', '', 'Read upstream advisory ↗');
    link.href = reference; link.target = '_blank'; link.rel = 'noopener noreferrer';
    section.append(link);
  }
  return section;
}
function libraryCard(row) {
  const article = node('article', `library ${row.status}`);
  const top = node('div', 'library-top');
  const identity = node('div');
  identity.append(node('h3', 'library-name', row.name), node('p', 'version', row.version || 'Version unavailable'));
  top.append(identity, node('span', `badge ${row.status}`, statusNames[row.status]));
  article.append(top, node('p', 'why', row.advisories[0]?.why || row.reason));
  const details = node('details');
  const advisoryCount = row.advisories.length;
  details.append(node('summary', '', advisoryCount ? `${advisoryCount} ${advisoryCount === 1 ? 'advisory' : 'advisories'} · detection evidence` : 'Detection evidence & details'));
  const evidence = node('ul', 'evidence');
  for (const item of row.evidence) evidence.append(node('li', '', `${evidenceNames[item.kind] || 'Script URL'}: ${item.detail}`));
  details.append(evidence);
  if (row.latest) details.append(node('p', 'why', `Stable release in snapshot: ${row.latest}`));
  for (const advisory of [...row.advisories, ...row.maintenance]) details.append(advisoryCard(advisory));
  article.append(details);
  return article;
}
export function renderReport(report) {
  document.getElementById('host').textContent = report.host;
  document.getElementById('total').textContent = report.rows.length;
  const vulnerable = report.rows.filter(row => row.status === 'vulnerable').length;
  const unknown = report.rows.filter(row => row.status === 'unknown').length;
  const count = document.getElementById('finding-count');
  count.textContent = vulnerable ? `${vulnerable} ${vulnerable === 1 ? 'version' : 'versions'} flagged` : unknown ? `${unknown} ${unknown === 1 ? 'version' : 'versions'} unresolved` : 'No known matches';
  count.classList.toggle('has-findings', vulnerable > 0);
  document.getElementById('libraries').replaceChildren(...report.rows.map(libraryCard));
  document.getElementById('empty').hidden = report.rows.length > 0;
  const values = document.getElementById('header-values');
  values.replaceChildren();
  for (const header of report.headers || []) values.append(node('dt', '', header.name), node('dd', '', header.value));
  const files = report.files;
  document.getElementById('files-note').textContent = files
    ? `Read ${files.read.toLocaleString('en')} script ${files.read === 1 ? 'file' : 'files'} from this site for library banners. Files without a banner, and files on other sites, are not covered.`
    : 'Libraries bundled into this site’s own files are invisible to the scan above. This check requests those files (same site only, from Chrome’s cache when possible) and reads their licence banners. Nothing is run or sent elsewhere.';
  const missing = report.headers === null;
  document.getElementById('reload').hidden = !missing;
  document.getElementById('header-note').textContent = missing ? 'Headers arrived before access was granted, or were not observable. Reloading this page lets rustline.dev check Server and X-Powered-By.' : report.headers.length ? 'Reported by this page’s server. These hints can be hidden or changed; they are not vulnerability findings.' : 'Neither Server nor X-Powered-By was present in the observed response.';
  const date = new Date(report.generatedAt);
  document.getElementById('snapshot').textContent = `Data · ${date.toISOString().slice(0, 10)}`;
  const stale = Date.now() - date.getTime() > 30 * 86400000;
  const warnings = [];
  if (stale) warnings.push('The bundled snapshot is over 30 days old. Recent advisories and releases may be missing.');
  if (report.truncated) warnings.push('Only the first 2,000 script tags of a frame were inspected.');
  if (report.framesSkipped) warnings.push('Only the first 50 frames were inspected.');
  if (report.unchecked) warnings.push(`${report.unchecked.toLocaleString('en')} script tags or globals across frames were not checked. Libraries may be missing.`);
  if (files?.skipped) warnings.push(`${files.skipped.toLocaleString('en')} script ${files.skipped === 1 ? 'file' : 'files'} could not be inspected for library banners (over the file or size limit, unavailable, or unsupported JavaScript syntax).`);
  const extra = (report.frames || 1) - 1;
  document.getElementById('frame-note').textContent = extra ? `Scanned the page and ${extra} ${extra === 1 ? 'frame' : 'frames'} inside it. Frames from other sites cannot be read.` : 'Scanned the page; no readable frames were found inside it.';
  const message = document.getElementById('message');
  message.hidden = !warnings.length;
  message.className = 'message warning';
  message.textContent = warnings.join(' ');
  document.getElementById('results').hidden = false;
}
