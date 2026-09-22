import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const stateSource = read("js/state.js");
const planningUiSource = read("js/ui-planning.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const edgeSource = read("supabase/functions/workshop-user-admin/index.ts");

function getBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Missing block start: ${startMarker}`);

  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `Missing block end: ${endMarker}`);

  return source.slice(start, end);
}

test("D-GUARD director keeps local users.manage forbidden while server administration remains authorized", () => {
  const directorPermissions = getBlock(
    stateSource,
    "const DIRECTOR_PERMISSIONS = [",
    "const ROLE_PERMISSIONS =",
  );

  assert.doesNotMatch(
    directorPermissions,
    /"users\.manage"/u,
    "Directeur SAV must not inherit legacy/local users.manage",
  );

  assert.match(
    edgeSource,
    /WORKSHOP_ADMIN_ROLES\s*=\s*new Set\(\["admin_technique",\s*"directeur"\]\)/u,
    "Server account authority must continue to include Directeur SAV",
  );

  const guardUserSwitch = getBlock(
    stateSource,
    "function guardUserSwitch()",
    "const NOTES_VISIBILITY",
  );

  assert.match(
    guardUserSwitch,
    /hasPermission\("users\.manage"\)/u,
    "Local session switching must remain protected by users.manage",
  );
});

test("CA-USER-001 sidebar exposes a semantic account menu instead of a single logout/change action", () => {
  assert.match(
    indexSource,
    /id="sidebar-user-menu-trigger"/u,
    "Sidebar account menu trigger is missing",
  );

  assert.match(
    indexSource,
    /id="sidebar-user-menu"[^>]*role="menu"/u,
    "Sidebar account menu container is missing",
  );

  assert.match(
    indexSource,
    /id="sidebar-user-manage-users"/u,
    "User-management menu action is missing",
  );

  assert.match(
    indexSource,
    /id="sidebar-user-logout"/u,
    "Logout menu action is missing",
  );
});

test("CA-USER-001 account menu wires management navigation and clean logout", () => {
  assert.match(
    appSource,
    /sidebar-user-menu-trigger/u,
    "Account menu trigger has no application behaviour",
  );

  assert.match(
    appSource,
    /sidebar-user-manage-users[\s\S]{0,1800}setSettingsWorkspace\("administration"\)/u,
    "Manage-users action must route to the Administration workspace",
  );

  assert.match(
    appSource,
    /sidebar-user-logout[\s\S]{0,1200}triggerUserChangeScreen\(\)/u,
    "Logout action must reuse the secured session logout flow",
  );
});

test("CA-USER-002 server account visibility is independent from legacy local users.manage", () => {
  const renderUsersStart = planningUiSource.indexOf("function renderUsersAndRoles()");
  assert.ok(renderUsersStart >= 0, "renderUsersAndRoles block missing");
  const renderUsers = planningUiSource.slice(renderUsersStart);

  assert.match(
    renderUsers,
    /const canManageLocalUsers\s*=/u,
    "Local profile authority must have an explicit capability",
  );

  assert.match(
    renderUsers,
    /const canManageServerUsers\s*=\s*serverManagementDecision\.allowed/u,
    "Server account authority must use the validated server decision",
  );

  assert.match(
    renderUsers,
    /const canViewManagedUsers\s*=\s*canManageLocalUsers\s*\|\|\s*canManageServerUsers/u,
    "User list visibility must combine local-admin and server-admin authority",
  );

  assert.match(
    renderUsers,
    /list\.hidden\s*=\s*!canViewManagedUsers/u,
    "Director server authority must be sufficient to display managed accounts",
  );
});

test("CA-USER-003 local compatibility profiles remain Admin-only and are separated from server-managed accounts", () => {
  const renderUsersStart = planningUiSource.indexOf("function renderUsersAndRoles()");
  assert.ok(renderUsersStart >= 0, "renderUsersAndRoles block missing");
  const renderUsers = planningUiSource.slice(renderUsersStart);

  assert.match(
    renderUsers,
    /form\.hidden\s*=\s*!canManageLocalUsers/u,
    "Legacy local profile form must remain protected by local users.manage",
  );

  assert.match(
    renderUsers,
    /localProfileManagement\.hidden\s*=\s*!canManageLocalUsers/u,
    "Local compatibility controls must remain Admin-only",
  );

  assert.match(
    renderUsers,
    /const visibleUsers\s*=\s*canManageLocalUsers\s*\?\s*users\s*:\s*users\.filter\([\s\S]{0,250}isServerManagedLocalProfile/u,
    "Server-only managers must not receive the legacy local-only profile inventory",
  );

  assert.match(
    renderUsers,
    /list\.innerHTML\s*=\s*visibleUsers\.map/u,
    "Rendered user cards must use the authority-filtered account collection",
  );
});