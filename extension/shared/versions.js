// Numeric versions, SemVer prereleases/build metadata, and Retire's legacy
// 1.9.0b1 / 1.0.0.beta.3 bounds. Unrecognized syntax stays unknown.
export function parseVersion(value, { partial = true } = {}) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = value.trim().match(/^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(.*)$/);
  if (!match || (!partial && (match[2] === undefined || match[3] === undefined))) return null;
  const numbers = match.slice(1, 4).map(x => Number(x || 0));
  if (numbers.some(x => !Number.isSafeInteger(x))) return null;
  let tail = match[4];
  if (tail && match[3] === undefined) return null;
  const legacy = /^(?:\.(?:alpha|beta|rc)\.|(?:alpha|beta|rc|a|b)\d)/i.test(tail);
  if (tail && !/^[+-]/.test(tail) && !legacy) return null;
  let [pre, build, extra] = tail.split('+');
  if (extra !== undefined || (build !== undefined && !/^[\da-z-]+(?:\.[\da-z-]+)*$/i.test(build))) return null;
  pre = pre.replace(/^[.-]/, '');
  if (legacy) pre = pre.replace(/^(a|b|alpha|beta|rc)(\d+)$/i, (_, tag, n) => `${tag === 'a' ? 'alpha' : tag === 'b' ? 'beta' : tag}.${n}`);
  if (pre && !/^[\da-z-]+(?:\.[\da-z-]+)*$/i.test(pre)) return null;
  if (tail && !pre && build === undefined) return null;
  const prerelease = pre ? pre.split('.') : [];
  if (prerelease.some(x => /^\d+$/.test(x) && (x.length > 1 && x[0] === '0' || !Number.isSafeInteger(Number(x))))) return null;
  return { numbers, prerelease };
}

export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] < b.numbers[i] ? -1 : 1;
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn !== yn) return xn ? -1 : 1;
    return (xn ? Number(x) < Number(y) : x < y) ? -1 : 1;
  }
  return 0;
}

export function inRange(version, range) {
  if (!parseVersion(version) || !range || (!range.introduced && !range.fixed)) return null;
  const lower = range.introduced === null ? 1 : compareVersions(version, range.introduced);
  const upper = range.fixed === null ? -1 : compareVersions(version, range.fixed);
  return lower === null || upper === null ? null : lower >= 0 && upper < 0;
}

// jQuery custom/slim builds report e.g. "3.5.1 -ajax,-effects". The probe may
// truncate that list, so only the leading version and a +/- module list shape
// are required. Anything else stays unknown.
export function customBuildVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^\s*(v?\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?)\s+[-+][\w/.,+\s-]*$/i);
  return match ? exactVersion(match[1]) : null;
}

export function exactVersion(value) {
  return typeof value === 'string' && parseVersion(value, { partial: false }) ? value.trim().replace(/^v/, '') : null;
}
