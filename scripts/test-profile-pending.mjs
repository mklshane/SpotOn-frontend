import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const stored = new Map();
const files = new Set();
const fs = {
  documentDirectory: 'file:///old/Documents/',
  FileSystemUploadType: { MULTIPART: 1 },
  FileSystemSessionType: { FOREGROUND: 1 },
  makeDirectoryAsync: async () => {},
  copyAsync: async ({ to }) => { files.add(to); },
  deleteAsync: async (uri) => { files.delete(uri); },
  getInfoAsync: async () => ({ exists: true, size: 50_000 }),
};
const secure = {
  getItemAsync: async (key) => stored.get(key) ?? null,
  setItemAsync: async (key, value) => { stored.set(key, value); },
  deleteItemAsync: async (key) => { stored.delete(key); },
};

const source = readFileSync(new URL('../src/lib/profile-pending.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, {
  module, exports: module.exports,
  require: (name) => name === '@/lib/fs' ? fs : name === '@/lib/secure-store' ? secure : null,
  Date, Math, JSON,
});
const pending = module.exports;

const alice = 'alice';
const bob = 'bob';
const fields = { full_name: 'Alice', date_of_birth: '2001-10-16', sex: 'female' };
const firstUri = await pending.keepAvatarForSync(alice, 'file:///picker.jpg');
await pending.writePendingProfile(alice, {
  revision: 'first', fields, avatar: { kind: 'upload', uri: firstUri },
});
assert.equal((await pending.readPendingProfile(alice)).avatar.uri, firstUri);
assert.equal(await pending.readPendingProfile(bob), null, 'pending edits must be account scoped');

// iOS can change its container path during an app update. Stored paths must rebase.
fs.documentDirectory = 'file:///new/Documents/';
files.delete(firstUri);
files.add(firstUri.replace('file:///old/Documents/', fs.documentDirectory));
const rebased = await pending.readPendingProfile(alice);
assert.equal(rebased.avatar.uri.startsWith(fs.documentDirectory), true);
assert.equal(await pending.clearPendingProfile(alice, 'outdated'), false);
assert.ok(await pending.readPendingProfile(alice), 'old sync must not erase a newer edit');

const secondUri = await pending.keepAvatarForSync(alice, 'file:///second.jpg');
await pending.writePendingProfile(alice, {
  revision: 'second', fields, avatar: { kind: 'upload', uri: secondUri },
});
assert.ok(files.has(rebased.avatar.uri), 'an in-flight upload keeps its source photo');
assert.equal(await pending.clearPendingProfile(alice, 'second'), true);
assert.equal(files.has(secondUri), false);
assert.equal(files.has(rebased.avatar.uri), false);
assert.equal(await pending.readPendingProfile(alice), null);

const profileSource = readFileSync(new URL('../src/lib/profile.ts', import.meta.url), 'utf8');
const profileCode = ts.transpileModule(profileSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const profileModule = { exports: {} };
let online = false;
let server = {
  id: alice, email: null, phone: null, full_name: 'Old', date_of_birth: null,
  sex: null, fitzpatrick_skin_type: null, avatar_url: null,
};
let calls = 0;
const api = {
  get: async () => { calls++; return server; },
  patch: async (_path, fields) => { calls++; server = { ...server, ...fields }; return server; },
  post: async () => { calls++; server = { ...server, avatar_url: '/me/avatar/alice?v=1' }; return server; },
  delete: async () => { calls++; server = { ...server, avatar_url: null }; return server; },
};
fs.uploadAsync = async () => {
  calls++;
  server = { ...server, avatar_url: '/me/avatar/alice?v=1' };
  return { status: 200, body: '{}' };
};
class FakeFormData { append() {} }
class FakeApiError extends Error {
  constructor(status, body) { super(body); this.status = status; this.body = body; }
  get detail() { return JSON.parse(this.body).detail; }
}
const modules = {
  '@/api/client': { api, ApiError: FakeApiError },
  '@/lib/fs': fs,
  '@/lib/auth-api': { cacheProfile: async () => {}, getAccessToken: () => 'token', refresh: async () => 'token' },
  '@/config': { API_BASE_URL: 'https://example.invalid' },
  '@/lib/account-scope': { getActiveAccountId: () => alice },
  '@/hooks/use-connectivity': { isOnlineNow: async () => online },
  '@/lib/profile-pending': pending,
  'expo-image-manipulator': {
    manipulateAsync: async () => ({ uri: 'file:///picker-prepared.jpg' }),
    SaveFormat: { JPEG: 'jpeg' },
  },
  'react-native': { Platform: { OS: 'ios' } },
};
vm.runInNewContext(profileCode, {
  module: profileModule, exports: profileModule.exports,
  require: (name) => modules[name],
  Date, Math, JSON, Map, FormData: FakeFormData, Blob,
});
const profile = profileModule.exports;
const offline = await profile.saveProfile({
  fullName: 'Alice Smith', dateOfBirth: '2001-10-16', sex: 'female',
  avatarUri: 'file:///picker.jpg',
}, server);
assert.equal(offline.status, 'pending');
assert.equal(offline.user.full_name, 'Alice Smith');
assert.equal(calls, 0, 'offline save must not call the API');
assert.ok((await pending.readPendingProfile(alice)).avatar.uri.startsWith(fs.documentDirectory));
online = true;
const synced = await profile.syncPendingProfile(alice);
assert.equal(synced.status, 'synced');
assert.equal(synced.user.avatar_url, '/me/avatar/alice?v=1');
assert.equal(await pending.readPendingProfile(alice), null);
assert.equal(calls, 3, 'sync sends profile, photo, then refreshes the server result');
fs.uploadAsync = async () => ({ status: 413, body: '{"detail":"Profile photo is too large."}' });
const rejected = await profile.saveProfile({
  fullName: 'Alice Smith', dateOfBirth: '2001-10-16', sex: 'female',
  avatarUri: 'file:///another-picker.jpg',
}, server);
assert.equal(rejected.status, 'rejected');
assert.equal(rejected.error, 'Profile photo is too large.');
assert.ok(await pending.readPendingProfile(alice), 'rejected photo remains available for a later retry');
console.log('profile pending: offline save, reconnect sync, account isolation, and cleanup passed');
