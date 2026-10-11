import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  openSync,
  readSync,
  closeSync,
  statSync,
} from "node:fs";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
export function backupKey(value = process.env.GRAILHIIV_BACKUP_KEY) {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value))
    throw new Error("Configure a 64-character hexadecimal backup key.");
  return Buffer.from(value, "hex");
}
export async function encryptBackupFile(
  source: Readable,
  path: string,
  key: Buffer,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv),
    hash = createHash("sha256");
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      hash.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
  output.write(Buffer.concat([Buffer.from("GHB1"), iv]));
  await pipeline(source, counter, cipher, output, { end: false });
  await new Promise<void>((resolve, reject) => {
    output.on("error", reject);
    output.end(cipher.getAuthTag(), () => resolve());
  });
  return { bytes, sha256: hash.digest("hex") };
}
export function decryptBackupFile(path: string, key: Buffer): Readable {
  const size = statSync(path).size;
  if (size < 32) throw new Error("Invalid encrypted backup.");
  const fd = openSync(path, "r"),
    header = Buffer.alloc(16),
    tag = Buffer.alloc(16);
  try {
    readSync(fd, header, 0, 16, 0);
    readSync(fd, tag, 0, 16, size - 16);
  } finally {
    closeSync(fd);
  }
  if (header.subarray(0, 4).toString() !== "GHB1")
    throw new Error("Invalid encrypted backup format.");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(4));
  decipher.setAuthTag(tag);
  const input =
    size === 32
      ? Readable.from([])
      : createReadStream(path, { start: 16, end: size - 17 });
  input.on("error", (e: Error) => decipher.destroy(e));
  input.pipe(decipher);
  return decipher;
}
export async function readBackupJson(path: string, key: Buffer) {
  const chunks: Buffer[] = [];
  let size = 0;
  await pipeline(
    decryptBackupFile(path, key),
    new Writable({
      write(chunk, _encoding, done) {
        size += chunk.length;
        if (size > 128 * 1024 * 1024)
          done(new Error("Backup JSON exceeds the verification limit."));
        else {
          chunks.push(chunk);
          done();
        }
      },
    }),
  );
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
