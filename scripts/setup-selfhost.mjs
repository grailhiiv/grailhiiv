import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const generatedSecrets = [
  "N8N_POSTGRES_PASSWORD",
  "N8N_ENCRYPTION_KEY",
  "GRAILHIIV_N8N_WEBHOOK_SECRET",
  "GRAILHIIV_N8N_CALLBACK_SECRET",
  "AI_POSTGRES_PASSWORD",
  "GRAILHIIV_BACKUP_KEY",
  "GRAILHIIV_SOCIAL_ENCRYPTION_KEY",
];
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

// Diagnostics contain key names only, including conflicts and malformed values.
export function consolidateEnvironment(
  directory = process.cwd(),
  environment = process.env,
) {
  const root = realpathSync(directory);
  const names = [".env", ".env.local", ".env.selfhost", ".env.n8n-admin"];
  const inputs = names
    .filter((name) => existsSync(join(root, name)))
    .map((name) => {
      const path = join(root, name);
      if (dirname(realpathSync(path)) !== root)
        throw new Error("Environment files must be inside the project folder.");
      return { name, values: parseEnv(readFileSync(path, "utf8")) };
    });
  const values = Object.create(null);
  const conflicts = new Set();
  for (const input of inputs)
    for (const [key, value] of Object.entries(input.values)) {
      if (values[key] && value && values[key] !== value) conflicts.add(key);
      if (value || values[key] === undefined) values[key] = value;
    }
  if (conflicts.size)
    throw new Error(
      "Conflicting environment keys; files were preserved: " +
        [...conflicts].join(", "),
    );
  const template = readFileSync(join(root, ".env.example"), "utf8");
  const defaults = parseEnv(template);
  for (const [key, value] of Object.entries(defaults))
    if (values[key] === undefined) values[key] = environment[key] || value;
  for (const key of generatedSecrets)
    if (!values[key]) values[key] = randomBytes(32).toString("hex");
  const encode = (key, value) => {
    if (/[\r\n\0']/.test(value))
      throw new Error(
        "Cannot safely consolidate this environment key; files were preserved: " +
          key,
      );
    return `${key}='${value}'`;
  };
  const rendered = new Set();
  let output =
    template
      .replace(/^([A-Za-z_][A-Za-z0-9_]*)=.*$/gm, (_, key) => {
        rendered.add(key);
        return encode(key, values[key]);
      })
      .trimEnd() + "\n";
  const extras = Object.keys(values)
    .filter((key) => !rendered.has(key))
    .sort();
  if (extras.length)
    output +=
      "\n# Additional existing settings retained during consolidation.\n" +
      extras.map((key) => encode(key, values[key])).join("\n") +
      "\n";
  const parsed = parseEnv(output);
  if (Object.keys(values).some((key) => parsed[key] !== values[key]))
    throw new Error("Environment verification failed; files were preserved.");
  const target = join(root, ".env");
  if (!existsSync(target) || readFileSync(target, "utf8") !== output) {
    const temporary = join(
      root,
      `.env.merge-${randomBytes(8).toString("hex")}`,
    );
    try {
      writeFileSync(temporary, output, { flag: "wx", mode: 0o600 });
      renameSync(temporary, target);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  const verified = parseEnv(readFileSync(target, "utf8"));
  for (const input of inputs)
    if (
      Object.entries(input.values).some(
        ([key, value]) => value && verified[key] !== value,
      )
    )
      throw new Error(
        "Merged file verification failed; old files were preserved.",
      );
  const retired = inputs
    .filter((input) => input.name !== ".env")
    .map((input) => input.name);
  for (const name of retired) unlinkSync(join(root, name));
  return { retired, missing: required.filter((key) => !values[key]) };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = consolidateEnvironment();
    console.log(
      "Unified .env ready. Existing credentials preserved; only missing passwords were generated.",
    );
    if (result.retired.length)
      console.log("Removed superseded files: " + result.retired.join(", "));
    if (result.missing.length)
      console.log(
        "Fill these settings before starting: " + result.missing.join(", "),
      );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Environment setup failed.",
    );
    process.exitCode = 1;
  }
}
