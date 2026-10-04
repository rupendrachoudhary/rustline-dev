export function pickHeaders(headers = []) {
  const result = [];
  for (const name of ['server', 'x-powered-by']) {
    const values = headers.filter(header => typeof header.name === 'string' && header.name.toLowerCase() === name && typeof header.value === 'string').map(header => header.value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160));
    if (values.length) result.push({ name: name === 'server' ? 'Server' : 'X-Powered-By', value: values.slice(0, 3).join(', ') });
  }
  return result;
}

export function headersForDocument(record, urlHash, timeOrigin, responseEnd) {
  // The upper bound also rejects a newer response when an older same-URL
  // document is restored from bfcache. 50 ms accommodates clock precision.
  if (!record || record.urlHash !== urlHash || !Number.isFinite(timeOrigin) || !Number.isFinite(responseEnd) || responseEnd <= 0 || record.observedAt < timeOrigin || record.observedAt > timeOrigin + responseEnd + 50) return null;
  return record.values;
}
