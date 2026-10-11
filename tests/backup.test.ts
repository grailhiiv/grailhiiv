import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Readable } from "node:stream";
import {
  backupKey,
  encryptBackupFile,
  readBackupJson,
} from "../src/lib/backup-crypto";
import { verifyApplicationRestore } from "../src/lib/backup-verify";
test("encrypted backup round-trips and rejects wrong keys and modified ciphertext", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "grailhiiv-backup-test-"));
  t.after(() => {
    assert.equal(dirname(dir), tmpdir());
    rmSync(dir, { recursive: true, force: true });
  });
  const path = join(dir, "data.ghe"),
    key = backupKey("1".repeat(64));
  const value = {
    privateRecord: "must remain encrypted",
    settings: { key: "test-secret" },
  };
  const result = await encryptBackupFile(
    Readable.from([JSON.stringify(value)]),
    path,
    key,
  );
  assert.equal(result.bytes, Buffer.byteLength(JSON.stringify(value)));
  assert.equal(readFileSync(path).includes(Buffer.from("test-secret")), false);
  assert.deepEqual(await readBackupJson(path, key), value);
  await assert.rejects(readBackupJson(path, backupKey("2".repeat(64))));
  const bytes = readFileSync(path);
  bytes[20] ^= 1;
  writeFileSync(path, bytes);
  await assert.rejects(readBackupJson(path, key));
  assert.throws(() => backupKey("short"));
});
test("application restore verification loads rows into isolated PostgreSQL and rejects broken references", async () => {
  const names = [
    "workspaces",
    "workspace_members",
    "clients",
    "client_access",
    "records",
    "approvals",
    "activity_log",
    "workspace_invitations",
    "automation_bindings",
    "automation_runs",
    "agent_runs",
    "workspace_operations",
    "agent_usage",
    "internal_rules",
    "internal_runs",
    "auth_users",
    "auth_identities",
  ];
  const tables = Object.fromEntries(names.map((name) => [name, []])) as Record<
    string,
    Record<string, unknown>[]
  >;
  tables.workspaces = [{ id: "workspace" }];
  tables.clients = [{ workspace_id: "workspace", id: "client" }];
  tables.records = [
    {
      workspace_id: "workspace",
      client_id: "client",
      kind: "posts",
      id: "draft",
      payload: { status: "Draft" },
    },
  ];
  assert.equal(await verifyApplicationRestore({ version: 1, tables }), 3);
  tables.records[0].client_id = "missing-client";
  await assert.rejects(
    verifyApplicationRestore({ version: 1, tables }),
    /inconsistent/,
  );
  await assert.rejects(
    verifyApplicationRestore({ version: 1, tables: {} }),
    /incomplete/,
  );
});
