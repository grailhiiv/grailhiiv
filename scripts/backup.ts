import { createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  backupKey,
  encryptBackupFile,
  decryptBackupFile,
  readBackupJson,
} from "../src/lib/backup-crypto";
import { verifyApplicationRestore } from "../src/lib/backup-verify";
type BackupFile = {
  name: string;
  kind: string;
  sha256: string;
  bytes: number;
  storagePath?: string;
};
type Manifest = { version: 1; created_at: string; files: BackupFile[] };
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function docker(args: string[]) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });
  } catch {
    throw new Error("Local Docker backup operation failed.");
  }
}
function processStream(args: string[]) {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", () =>
      reject(new Error("Cannot start local backup operation.")),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Local database backup or restore failed.")),
    );
  });
  // Attach rejection handling immediately, before a pipeline has finished.
  void done.catch(() => {});
  return { child, done };
}
export async function verifyBackup(directory: string, key = backupKey()) {
  const folder = realpathSync(directory),
    manifest = (await readBackupJson(
      join(folder, "manifest.ghe"),
      key,
    )) as Manifest;
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new Error("Invalid backup manifest.");
  const required = [
    "application.json.ghe",
    "environment.json.ghe",
    "agent.dump.ghe",
    "n8n.dump.ghe",
    "n8n-files.tar.ghe",
  ];
  if (required.some((name) => !manifest.files.some((f) => f.name === name)))
    throw new Error("Incomplete backup.");
  const container = "grailhiiv-restore-check-" + randomBytes(6).toString("hex");
  docker([
    "run",
    "--rm",
    "-d",
    "--network",
    "none",
    "--name",
    container,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17.11-alpine",
  ]);
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        docker(["exec", container, "pg_isready", "-U", "postgres"]);
        ready = true;
        break;
      } catch {
        await delay(1000);
      }
    }
    if (!ready) throw new Error("Restore verification database did not start.");
    for (const file of manifest.files) {
      if (
        !/^[a-zA-Z0-9_.-]+\.ghe$/.test(file.name) ||
        dirname(resolve(folder, file.name)) !== folder
      )
        throw new Error("Invalid backup path.");
      const hash = createHash("sha256");
      let bytes = 0;
      const counter = new Transform({
        transform(chunk, _encoding, done) {
          hash.update(chunk);
          bytes += chunk.length;
          done(null, chunk);
        },
      });
      if (file.kind === "postgres") {
        const database =
          file.name === "agent.dump.ghe"
            ? "agent_verify"
            : file.name === "n8n.dump.ghe"
              ? "n8n_verify"
              : null;
        if (!database) throw new Error("Unknown database archive.");
        docker(["exec", container, "createdb", "-U", "postgres", database]);
        const proc = processStream([
          "exec",
          "-i",
          container,
          "pg_restore",
          "-U",
          "postgres",
          "--no-owner",
          "--no-privileges",
          "--exit-on-error",
          "-d",
          database,
        ]);
        proc.child.stdout.resume();
        try {
          await pipeline(
            decryptBackupFile(join(folder, file.name), key),
            counter,
            proc.child.stdin,
          );
          await proc.done;
        } finally {
          if (proc.child.exitCode === null) proc.child.kill();
        }
        docker([
          "exec",
          container,
          "psql",
          "-U",
          "postgres",
          "-d",
          database,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');",
        ]);
      } else if (file.kind === "tar") {
        const proc = processStream([
          "exec",
          "-i",
          container,
          "tar",
          "-tf",
          "-",
        ]);
        proc.child.stdout.resume();
        try {
          await pipeline(
            decryptBackupFile(join(folder, file.name), key),
            counter,
            proc.child.stdin,
          );
          await proc.done;
        } finally {
          if (proc.child.exitCode === null) proc.child.kill();
        }
      } else
        await pipeline(
          decryptBackupFile(join(folder, file.name), key),
          counter,
          new Writable({
            write(_chunk, _encoding, done) {
              done();
            },
          }),
        );
      if (bytes !== file.bytes || hash.digest("hex") !== file.sha256)
        throw new Error("Backup integrity verification failed.");
    }
    const snapshot = await readBackupJson(
      join(folder, "application.json.ghe"),
      key,
    );
    const rows = await verifyApplicationRestore(snapshot);
    const paths = new Set(
      manifest.files
        .filter((f) => f.kind === "asset")
        .map((f) => f.storagePath),
    );
    for (const row of snapshot.tables.records)
      if (row.kind === "assets" && row.payload.uploaded)
        for (const path of [
          row.payload.storagePath,
          row.payload.thumbnailPath,
        ].filter(Boolean))
          if (!paths.has(path)) throw new Error("Backup asset is missing.");
    return { files: manifest.files.length, rows };
  } finally {
    docker(["rm", "-f", container]);
  }
}
export async function createBackup() {
  const key = backupKey();
  const keep = Number(process.env.GRAILHIIV_BACKUP_KEEP || 7);
  if (!Number.isInteger(keep) || keep < 1 || keep > 365)
    throw new Error("Invalid backup retention.");
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const base = resolve(
    root,
    process.env.GRAILHIIV_BACKUP_DIRECTORY || "backups",
  );
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const folder = join(
    base,
    "backup-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomBytes(3).toString("hex"),
  );
  mkdirSync(folder, { mode: 0o700 });
  const manifest: Manifest = {
    version: 1,
    created_at: new Date().toISOString(),
    files: [],
  };
  async function add(
    name: string,
    kind: string,
    source: Readable,
    storagePath?: string,
  ) {
    const result = await encryptBackupFile(source, join(folder, name), key);
    manifest.files.push({
      name,
      kind,
      ...result,
      ...(storagePath ? { storagePath } : {}),
    });
  }
  try {
    const snapshot = await db.rpc("backup_snapshot");
    if (snapshot.error)
      throw new Error("Application backup snapshot unavailable.");
    await add(
      "application.json.ghe",
      "json",
      Readable.from([JSON.stringify(snapshot.data)]),
    );
    const env = parseEnv(readFileSync(join(root, ".env"), "utf8"));
    delete env.GRAILHIIV_BACKUP_KEY;
    await add(
      "environment.json.ghe",
      "json",
      Readable.from([JSON.stringify(env)]),
    );
    for (const name of readdirSync(join(root, "supabase", "migrations")).filter(
      (n) => /^\d+_[a-zA-Z0-9_]+\.sql$/.test(n),
    ))
      await add(
        "migration-" + name + ".ghe",
        "sql",
        createReadStream(join(root, "supabase", "migrations", name)),
      );
    for (const [name, container, user, database] of [
      ["agent", "grailhiiv-agent-db-1", "agent", "agent"],
      ["n8n", "grailhiiv-n8n-db-1", "n8n", "n8n"],
    ]) {
      const proc = processStream([
        "exec",
        container,
        "pg_dump",
        "-U",
        user,
        "-d",
        database,
        "-Fc",
      ]);
      proc.child.stdin.end();
      try {
        await add(name + ".dump.ghe", "postgres", proc.child.stdout);
        await proc.done;
      } finally {
        if (proc.child.exitCode === null) proc.child.kill();
      }
    }
    const tar = processStream([
      "exec",
      "grailhiiv-n8n-1",
      "tar",
      "-cf",
      "-",
      "-C",
      "/home/node",
      ".n8n",
    ]);
    tar.child.stdin.end();
    try {
      await add("n8n-files.tar.ghe", "tar", tar.child.stdout);
      await tar.done;
    } finally {
      if (tar.child.exitCode === null) tar.child.kill();
    }
    const paths = new Set<string>();
    for (const row of snapshot.data.tables.records)
      if (row.kind === "assets" && row.payload.uploaded)
        for (const path of [
          row.payload.storagePath,
          row.payload.thumbnailPath,
        ].filter(Boolean))
          paths.add(path);
    for (const path of paths) {
      const asset = await db.storage.from("grailhiiv-assets").download(path);
      if (asset.error) throw new Error("Private asset backup failed.");
      await add(
        "asset-" + createHash("sha256").update(path).digest("hex") + ".ghe",
        "asset",
        Readable.from([Buffer.from(await asset.data.arrayBuffer())]),
        path,
      );
    }
    await encryptBackupFile(
      Readable.from([JSON.stringify(manifest)]),
      join(folder, "manifest.ghe"),
      key,
    );
    const verification = await verifyBackup(folder, key);
    writeFileSync(
      join(folder, "VERIFIED"),
      "Encrypted files and isolated restores verified.\n",
      { mode: 0o600, flag: "wx" },
    );
    await db.from("backup_runs").insert({
      status: "Success",
      detail: "Encrypted snapshot and isolated database restore verified.",
    });
    const folders = readdirSync(base)
      .filter(
        (n) =>
          /^backup-[0-9TZ-]+-[a-f0-9]{6}$/.test(n) &&
          existsSync(join(base, n, "VERIFIED")),
      )
      .sort()
      .reverse();
    for (const name of folders.slice(keep)) {
      const target = realpathSync(join(base, name));
      if (dirname(target) !== realpathSync(base))
        throw new Error("Backup retention path escaped its directory.");
      rmSync(target, { recursive: true, force: true });
    }
    return { folder, ...verification };
  } catch {
    await db.from("backup_runs").insert({
      status: "Failed",
      detail:
        "Backup or restore verification failed. Check local Docker and storage access.",
    });
    throw new Error(
      "Local backup failed; existing verified archives were preserved.",
    );
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const action =
    process.argv[2] === "--verify"
      ? verifyBackup(resolve(process.argv[3] || ""))
      : createBackup();
  action
    .then((result) =>
      console.log(
        "Encrypted backup verified: " +
          result.files +
          " files, " +
          result.rows +
          " application rows.",
      ),
    )
    .catch(() => {
      console.error(
        "Backup failed. Check encryption key, Docker, migrations and storage access.",
      );
      process.exitCode = 1;
    });
}
