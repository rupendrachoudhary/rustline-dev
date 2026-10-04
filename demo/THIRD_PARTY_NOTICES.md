# Demo library notices

These unmodified browser builds are used only by the local test page. They are outside `extension/` and are not shipped as extension code. Each is MIT licensed; full upstream notices are in `licenses/`.

| File | Source | License file |
| --- | --- | --- |
| jquery-3.4.0.min.js | https://code.jquery.com/jquery-3.4.0.min.js | licenses/jquery.txt |
| moment-2.29.4.min.js | https://cdn.jsdelivr.net/npm/moment@2.29.4/min/moment.min.js | licenses/moment.txt |
| vue-3.5.43.min.js | https://cdn.jsdelivr.net/npm/vue@3.5.43/dist/vue.global.prod.js | licenses/vue.txt |
| axios-0.18.0.min.js | https://cdn.jsdelivr.net/npm/axios@0.18.0/dist/axios.min.js | licenses/axios.txt |

The old versions are intentional test inputs. The demo contains no exploit payloads and performs no outbound requests. It binds only to 127.0.0.1. Expected status badges refer to the bundled 2026-09-22 database snapshot; later database refreshes may change them.

## SHA-256 of bundled assets

```
9a99eb2790e9119664c24135660904410256ff8e8248487f493ad928e07faa83  axios-0.18.0.min.js
0497a8d2a9bde7db8c0466fae73e347a3258192811ed1108e3e096d5f34ac0e8  jquery-3.4.0.min.js
f343aa319a17a3fc372ee6ad5af482b9bf6a298cb22652b4aa7502604821071f  moment-2.29.4.min.js
b72394052eef1eeda1752db3758ce1be6f88016903f22e5241cc732ea307478e  vue-3.5.43.min.js
```
