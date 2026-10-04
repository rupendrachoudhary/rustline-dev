# Third-party notices

`extension/data/vulnerabilities.json` is derived from Retire.js:

- Source: https://github.com/RetireJS/retire.js
- Data: https://raw.githubusercontent.com/RetireJS/retire.js/master/repository/jsrepository-v4.json
- Copyright 2018 Erlend Oftedal
- License: Apache License, Version 2.0
- Complete upstream license: `extension/licenses/RETIRE-LICENSE.txt`
- Upstream notice: `extension/licenses/RETIRE-NOTICE.txt`

Modifications by rustline.dev: limited to 15 libraries, normalized identifiers and version intervals, grouped duplicate advisory ranges, added generic plain-English impact explanations and release metadata. No upstream detector code is executed or bundled. The snapshot records its source hash and generation time.

`extension/vendor/acorn.mjs` is an unmodified copy of `dist/acorn.mjs` from Acorn 8.18.0 (https://github.com/acornjs/acorn), MIT licensed, copyright (C) 2012-2022 by various contributors. Complete license: `extension/licenses/ACORN-LICENSE.txt`. It parses script files for the opt-in file check; it never evaluates them.

Stable release version numbers are retrieved from the public npm registry. No other npm package implementation code is bundled in the extension. The separate demo includes licensed library builds; see `demo/THIRD_PARTY_NOTICES.md`. Original rustline.dev extension code is MIT licensed; the MIT license does not replace the upstream data license.

Development tools are installed separately via the lockfile: Acorn and fflate (MIT), Playwright and playwright-core (Apache-2.0). Their licenses remain in the installed packages. Apart from the vendored Acorn file above, they are not included in the extension or source ZIP.
