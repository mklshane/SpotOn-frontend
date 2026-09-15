/** Regression checks for authenticated-account ownership of local profile and screening data. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import {
  accountStorageKey,
  getActiveAccountId,
  setActiveAccountId,
} from '../src/lib/account-scope.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
let passed = 0;
const check = (description, condition) => {
  assert.ok(condition, description);
  passed++;
};

const aKey = accountStorageKey('account-a', 'results');
const bKey = accountStorageKey('account-b', 'results');
check('account metadata keys are isolated', aKey !== bKey);
check('account metadata keys retain the stable account id', aKey.includes('account-a'));
setActiveAccountId('account-a');
check('active account scope follows login', getActiveAccountId() === 'account-a');
setActiveAccountId(null);
check('active account scope clears on logout', getActiveAccountId() === null);

const profile = read('src/lib/profile.ts');
const completion = read('src/app/(auth)/complete-profile.tsx');
const login = read('src/app/(auth)/login.tsx');
check('profile completion requires DOB and sex', /date_of_birth != null && user\.sex != null/.test(profile));
check('profile completion installs the server-authoritative user', /setUser\(saved\)/.test(completion));
check('login installs the server-authoritative retrieved profile', /routeAfterAuth\(setUser\)/.test(login));

const auth = read('src/lib/auth-api.ts');
check('profile cache key is based on user id', /spoton\.profile\.\$\{userId\}/.test(auth));
check('legacy global profile cache is removed after migration', /deleteItemAsync\(LEGACY_PROFILE_KEY\)/.test(auth));

const screeningRepo = read('src/data/screening-repo.ts');
const lesionRepo = read('src/data/lesion-repo.ts');
check('screening lists filter by user id', /FROM screenings WHERE user_id = \? ORDER BY/.test(screeningRepo));
check('screening writes reject missing ownership', /screening must belong to an authenticated account/i.test(screeningRepo));
check('lesion lists filter by user id', /FROM lesions WHERE user_id = \?/.test(lesionRepo));
check('lesion mutations filter by user id', /DELETE FROM lesions WHERE id = \? AND user_id = \?/.test(lesionRepo));

const history = read('src/lib/scan-history.tsx');
check('history provider assigns the active user id', /userId: accountId/.test(history));
check('in-memory screening history is filtered on account switch', /entry\.userId === accountId/.test(history));
check('history reloads when the active account changes', /\}, \[accountId\]\);/.test(history));
check('screening images use an account-specific directory', /screenings\/\$\{encodeURIComponent\(userId\)\}\//.test(history));

const db = read('src/data/db.ts');
check('legacy unowned history is claimed once', /account_history_legacy_owner/.test(db));
check('legacy screenings receive the claiming account id', /UPDATE screenings SET user_id = \? WHERE user_id IS NULL/.test(db));

// Exercise the real list predicate and legacy-claim statement against two accounts. This mirrors
// the UAT switch sequence without requiring live credentials or mutating the deployed backend.
const listSql = /"(SELECT \* FROM screenings WHERE user_id = \? ORDER BY created_at DESC)"/.exec(screeningRepo)?.[1];
const claimSql = /"(UPDATE screenings SET user_id = \? WHERE user_id IS NULL)"/.exec(db)?.[1];
check('real screening list SQL is discoverable', Boolean(listSql));
check('real legacy claim SQL is discoverable', Boolean(claimSql));
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE screenings (id TEXT PRIMARY KEY, created_at TEXT, user_id TEXT)');
sqlite.prepare('INSERT INTO screenings VALUES (?, ?, ?)').run('legacy-a', '2026-01-01', null);
sqlite.prepare('INSERT INTO screenings VALUES (?, ?, ?)').run('a-1', '2026-02-01', 'account-a');
sqlite.prepare('INSERT INTO screenings VALUES (?, ?, ?)').run('b-1', '2026-03-01', 'account-b');
sqlite.prepare(claimSql).run('account-a');
const idsFor = (userId) => sqlite.prepare(listSql).all(userId).map((row) => row.id).sort();
check('Account A sees its own and migrated legacy results', idsFor('account-a').join(',') === 'a-1,legacy-a');
check('Account B does not inherit Account A results', idsFor('account-b').join(',') === 'b-1');
sqlite.prepare('INSERT INTO screenings VALUES (?, ?, ?)').run('b-2', '2026-04-01', 'account-b');
check('Account B retains only its own new and old results', idsFor('account-b').join(',') === 'b-1,b-2');
check('switching back leaves Account A results unchanged', idsFor('account-a').join(',') === 'a-1,legacy-a');

// Deleting an account must take its local history with it - and only its own. The server row is
// gone by then, so anything left here is unreachable lesion photo data belonging to a dead account.
const wipeScreeningsSql = /"(DELETE FROM screenings WHERE user_id = \?)"/.exec(screeningRepo)?.[1];
const wipeLesionsSql = /"(DELETE FROM lesions WHERE user_id = \?)"/.exec(screeningRepo)?.[1];
check('real account-wipe screening SQL is discoverable', Boolean(wipeScreeningsSql));
check('real account-wipe lesion SQL is discoverable', Boolean(wipeLesionsSql));
check(
  'account deletion collects photo rows before wiping them',
  /SELECT image_uri, images_json FROM screenings WHERE user_id = \?/.test(screeningRepo),
);
check('account deletion clears local history', /deleteAllForUser\(accountId\)/.test(auth));

sqlite.exec('CREATE TABLE lesions (id TEXT PRIMARY KEY, user_id TEXT)');
sqlite.prepare('INSERT INTO lesions VALUES (?, ?)').run('lesion-a', 'account-a');
sqlite.prepare('INSERT INTO lesions VALUES (?, ?)').run('lesion-b', 'account-b');
sqlite.prepare(wipeScreeningsSql).run('account-a');
sqlite.prepare(wipeLesionsSql).run('account-a');
check('deleted account keeps no screenings', idsFor('account-a').length === 0);
check(
  'deleted account keeps no lesions',
  sqlite.prepare('SELECT id FROM lesions WHERE user_id = ?').all('account-a').length === 0,
);
check('the surviving account keeps its screenings', idsFor('account-b').join(',') === 'b-1,b-2');
check(
  'the surviving account keeps its lesions',
  sqlite.prepare('SELECT id FROM lesions WHERE user_id = ?').all('account-b').length === 1,
);
sqlite.close();

const reminders = read('src/lib/notifications.ts');
check('reminder metadata uses account-scoped keys', /accountStorageKey\(accountId, key\)/.test(reminders));

console.log(`account isolation: ${passed} passed, 0 failed`);
