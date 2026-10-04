import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectBanners, inspectBanners, addBanners } from '../tools/banners.mjs';
import { validateDatabase } from '../extension/shared/database.js';

const found = source => detectBanners(source, 'https://site.example/assets/vendor.min.js?v=9#x').map(b => `${b.id}@${b.version}`);

// Banner text copied from the real published builds.
test('real library banners are recognised', () => {
  const cases = {
    'jquery@1.12.4': '/*! jQuery v1.12.4 | (c) jQuery Foundation | jquery.org/license */\n!function(a,b){}',
    'jquery@3.4.1': '/*!\n * jQuery JavaScript Library v3.4.1\n * https://jquery.com/\n */',
    'angularjs@1.8.2': '/*\n AngularJS v1.8.2\n (c) 2010-2020 Google LLC. http://angularjs.org\n License: MIT\n*/',
    'react@16.14.0': '/** @license React v16.14.0\n * react.production.min.js\n *\n * Copyright (c) Facebook, Inc. */',
    'react-dom@16.14.0': '/** @license React v16.14.0\n * react-dom.production.min.js\n */',
    'vue@2.6.14': '/*!\n * Vue.js v2.6.14\n * (c) 2014-2021 Evan You\n */',
    'underscore@1.8.3': '//     Underscore.js 1.8.3\n//     http://underscorejs.org\n(function(){})',
    'moment@2.29.4': '//! moment.js\n//! version : 2.29.4\n//! authors : Tim Wood\n',
    'bootstrap@3.3.7': '/*!\n * Bootstrap v3.3.7 (http://getbootstrap.com)\n */',
    'backbone@1.4.0': '//     Backbone.js 1.4.0\n\n//     (c) 2010-2019 Jeremy Ashkenas\n',
    'handlebars@4.7.7': '/**!\n\n @license\n handlebars v4.7.7\n\nCopyright (C) 2011-2019 by Yehuda Katz\n*/',
    'axios@0.21.1': '/* axios v0.21.1 | (c) 2020 by Matt Zabriskie */',
    'd3@7.8.5': '// https://d3js.org v7.8.5 Copyright 2010-2023 Mike Bostock\n!function(){}',
    'chartjs@2.9.4': '/*!\n * Chart.js v2.9.4\n * https://www.chartjs.org\n */',
    'dompurify@3.0.6': '/*! @license DOMPurify 3.0.6 | (c) Cure53 and other contributors */'
  };
  for (const [expected, source] of Object.entries(cases)) assert.deepEqual(found(source), [expected], expected);
});

test('plugins, look-alikes and developer notes are not library banners', () => {
  for (const source of [
    '/*! jQuery UI - v1.12.1 - 2016-09-14 */',
    '/*! jQuery Migrate v3.4.1 | (c) OpenJS Foundation */',
    '/*! Requires jQuery v1.7 or later */',
    '/**\n * @license\n * Lodash <https://lodash.com/>\n * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>\n */',
    '/**\n * @license React\n * react.production.min.js\n */',
    '/** @license React v0.19.1\n * scheduler.production.min.js\n */',
    '/*!\n  * Bootstrap tooltip.js v4.3.1 (https://getbootstrap.com/)\n */',
    '// https://d3js.org/d3-array/ v3.2.0 Copyright 2010-2022 Mike Bostock',
    'var x = "// Backbone.js 1.1.0"; // TODO upgrade jQuery v1.9.1',
    '/*! jQuery v3 | short version */'
  ]) assert.deepEqual(found(source), [], source);
});

test('a bundle yields every banner, and a stray /* cannot hide the next one', () => {
  const bundle = [
    'var re="/*";function a(){}',
    '/*! jQuery v1.12.4 | (c) jQuery Foundation */!function(){}',
    ';/*! @license DOMPurify 2.2.0 | (c) Cure53 */',
    '//     Backbone.js 1.4.0'
  ].join('\n');
  assert.deepEqual(found(bundle).sort(), ['backbone@1.4.0', 'dompurify@2.2.0', 'jquery@1.12.4']);
  assert.equal(detectBanners(bundle, 'https://site.example/assets/vendor.min.js?v=9#x')[0].evidence, 'file banner · site.example/assets/vendor.min.js');
});

test('quoted documentation, templates and regex literals never become library banners', () => {
  for (const source of [
    'const example = "/*! jQuery v1.12.4 | jquery.org/license */";',
    "const example = '/*! DOMPurify 2.2.0 */';",
    'const example = `/*! DOMPurify 2.2.0 */`;',
    'const example = `sample ${"/*! jQuery v1.12.4 */"} end`;',
    'const example = `\n// Backbone.js 1.1.0\n`;',
    'const pattern = /[/*! jQuery v1.12.4 */]/;',
    'if (true) /[/*! jQuery v1.12.4 */]/.test("x");',
    'const example = "escaped \\\" /*! jQuery v1.12.4 */";'
  ]) {
    const inspected = inspectBanners(source, 'https://site.example/example.js');
    assert.equal(inspected.error, null, source);
    assert.deepEqual(inspected.banners, [], source);
  }
});

test('valid classic and module programs retain genuine comments around literals', () => {
  const source = 'const example="/*";\n/*! jQuery v1.12.4 */\nexport const value = import.meta.url;';
  assert.deepEqual(found(source), ['jquery@1.12.4']);
  assert.deepEqual(found('var legacy=010; /*! jQuery v1.12.4 */'), ['jquery@1.12.4']);
});

test('unparseable code is incomplete, never a partial confident banner result', () => {
  const result = inspectBanners('/*! jQuery v1.12.4 */ const invalid = ;', 'https://site.example/broken.js');
  assert.deepEqual(result.banners, []);
  assert.match(result.error, /syntax/);
});

test('banners add evidence to matching rows and new rows are assessed', async () => {
  const database = validateDatabase(JSON.parse(await readFile(new URL('../extension/data/vulnerabilities.json', import.meta.url))));
  const rows = [{ id: 'jquery', name: 'jQuery', version: '1.12.4', evidence: [{ kind: 'global', detail: 'window.jQuery.fn.jquery' }], status: 'vulnerable' }];
  const merged = addBanners(rows, [
    { id: 'jquery', version: '1.12.4', evidence: 'file banner · site.example/js/app.js' },
    { id: 'bootstrap', version: '3.3.7', evidence: 'file banner · site.example/js/app.js' }
  ], database);
  assert.equal(merged.length, 2);
  const jquery = merged.find(r => r.id === 'jquery');
  assert.deepEqual(jquery.evidence.map(e => e.kind), ['global', 'banner']);
  const bootstrap = merged.find(r => r.id === 'bootstrap');
  assert.equal(bootstrap.status, 'vulnerable');
  assert.ok(bootstrap.advisories.length > 0);
});
