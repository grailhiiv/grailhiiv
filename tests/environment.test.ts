import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { consolidateEnvironment } from "../scripts/setup-selfhost.mjs";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "grailhiiv-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, ".env.example"),
    "NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\nSUPABASE_SERVICE_ROLE_KEY=\nGRAILHIIV_AI_MODELS='[]'\n",
  );
  return dir;
}
test("environment consolidation preserves secrets and JSON, retires duplicates and is repeatable", (t) => {
  const dir = fixture(t);
  writeFileSync(
    join(dir, ".env"),
    "SUPABASE_SERVICE_ROLE_KEY='service-secret'\nOPENAI_API_KEY='test-key'\n",
  );
  writeFileSync(
    join(dir, ".env.selfhost"),
    'SUPABASE_SERVICE_ROLE_KEY=\'service-secret\'\nN8N_ENCRYPTION_KEY=\'existing-encryption-key\'\nN8N_POSTGRES_PASSWORD=\'existing-database-password\'\nGRAILHIIV_AI_MODELS=\'[{"key":"content","label":"Content","provider":"openai","model":"test"}]\'\nEXTRA=\'literal $VALUE # preserved\'\n',
  );
  writeFileSync(
    join(dir, ".env.n8n-admin"),
    "N8N_ADMIN_EMAIL='admin@example.test'\nN8N_ADMIN_PASSWORD='admin-secret'\n",
  );
  writeFileSync(
    join(dir, ".env.local"),
    "SUPABASE_SERVICE_ROLE_KEY=\nNEXT_PUBLIC_SUPABASE_URL=https://example.test\n",
  );
  const result = consolidateEnvironment(dir, { NODE_ENV: "test" });
  assert.equal(result.retired.length, 3);
  const first = readFileSync(join(dir, ".env"), "utf8");
  const values = parseEnv(first);
  assert.equal(values.SUPABASE_SERVICE_ROLE_KEY, "service-secret");
  assert.equal(values.OPENAI_API_KEY, "test-key");
  assert.equal(values.N8N_ENCRYPTION_KEY, "existing-encryption-key");
  assert.equal(values.N8N_POSTGRES_PASSWORD, "existing-database-password");
  assert.equal(values.N8N_ADMIN_PASSWORD, "admin-secret");
  assert.equal(values.EXTRA, "literal $VALUE # preserved");
  assert.equal(JSON.parse(values.GRAILHIIV_AI_MODELS || "")[0].key, "content");
  assert.match(values.AI_POSTGRES_PASSWORD || "", /^[a-f0-9]{64}$/);
  assert.notEqual(
    values.GRAILHIIV_N8N_WEBHOOK_SECRET,
    values.GRAILHIIV_N8N_CALLBACK_SECRET,
  );
  for (const name of result.retired)
    assert.equal(existsSync(join(dir, name)), false);
  consolidateEnvironment(dir, { NODE_ENV: "test" });
  assert.equal(readFileSync(join(dir, ".env"), "utf8"), first);
});
test("conflicting credentials abort before writing or deleting any files", (t) => {
  const dir = fixture(t);
  const first = "N8N_ENCRYPTION_KEY=first-sensitive-value\n";
  const second = "N8N_ENCRYPTION_KEY=second-sensitive-value\n";
  writeFileSync(join(dir, ".env"), first);
  writeFileSync(join(dir, ".env.selfhost"), second);
  assert.throws(
    () => consolidateEnvironment(dir),
    (error) => {
      assert.equal(
        (error as Error).message,
        "Conflicting environment keys; files were preserved: N8N_ENCRYPTION_KEY",
      );
      return true;
    },
  );
  assert.equal(readFileSync(join(dir, ".env"), "utf8"), first);
  assert.equal(readFileSync(join(dir, ".env.selfhost"), "utf8"), second);
});
test("unrepresentable values fail without leaking their contents or retiring source files", (t) => {
  const dir = fixture(t);
  const original = 'EXTRA="sensitive\'value"\n';
  writeFileSync(join(dir, ".env.selfhost"), original);
  assert.throws(
    () => consolidateEnvironment(dir),
    /files were preserved: EXTRA$/,
  );
  assert.equal(existsSync(join(dir, ".env")), false);
  assert.equal(readFileSync(join(dir, ".env.selfhost"), "utf8"), original);
});
