// Serialized by chrome.scripting.executeScript into MAIN world. Keep this
// function self-contained. Return plain values; never call page functions.
export function inspectGlobals(definitions) {
  const results = [];
  const read = path => {
    let value = window;
    try {
      for (const key of path) {
        if (value == null) return undefined;
        // Skip getters: inspection must not deliberately execute page code.
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) return undefined;
        value = descriptor.value;
      }
      return value;
    } catch { return undefined; }
  };
  const add = (id, path, version) => results.push({ id, version: typeof version === 'string' ? version.slice(0, 100) : null, evidence: path.join('.') });
  for (const library of definitions) {
    let found = false;
    for (const path of library.globals) {
      const value = read(path);
      if (typeof value === 'string') { add(library.id, path, value); found = true; }
    }
    if (found) continue;
    // Presence with a missing version is useful, but cannot imply safety.
    const signatures = {
      react: ['React','createElement'], 'react-dom': ['ReactDOM','createPortal'],
      vue: ['Vue','createApp'], axios: ['axios','get'], d3: ['d3','select'],
      chartjs: ['Chart','register'], dompurify: ['DOMPurify','sanitize'],
      moment: ['moment','isMoment'], backbone: ['Backbone','Model'],
      handlebars: ['Handlebars','compile'], angularjs: ['angular','module']
    };
    const signature = signatures[library.id];
    if (signature && typeof read(signature) === 'function') add(library.id, signature, null);
  }
  // Both libraries use `_`; VERSION alone cannot distinguish them.
  const underscoreVersion = read(['_','VERSION']);
  if (typeof underscoreVersion === 'string') {
    const lodash = typeof read(['_','runInContext']) === 'function';
    const underscore = !lodash && typeof read(['_','template']) === 'function' && typeof read(['_','uniqueId']) === 'function';
    if (lodash || underscore) add(lodash ? 'lodash' : 'underscore', ['_','VERSION'], underscoreVersion);
  }
  return results.slice(0, 100); // Mirrored in shared/detection.js MAX_GLOBALS; honest pages report under 40.
}
