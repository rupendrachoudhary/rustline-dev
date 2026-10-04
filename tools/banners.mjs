// Banner detection lives in the extension (shared/banners.js) since the popup's
// opt-in file check uses it too. The batch scanner feeds it script responses
// the page already received.
export { inspectBanners, detectBanners, addBanners } from '../extension/shared/banners.js';
