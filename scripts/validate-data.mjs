import { readFile } from 'node:fs/promises';
import { validateDatabase } from '../extension/shared/database.js';
const db = validateDatabase(JSON.parse(await readFile(new URL('../extension/data/vulnerabilities.json', import.meta.url), 'utf8')));
console.log(`Valid snapshot: ${Object.keys(db.libraries).length} libraries, generated ${db.generatedAt}`);
