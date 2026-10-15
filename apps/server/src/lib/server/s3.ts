import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { ListObjectsV2Command, DeleteObjectsCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env.ts';

export const s3 = new S3Client({
  endpoint: env.s3.endpoint,
  region: env.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
});
export const bucket = env.s3.bucket;

/** Every object key goes through here so S3_KEY_PREFIX applies (area worktrees share one bucket). */
const k = (key: string) => env.s3.keyPrefix + key;

export const keys = {
  chunk: (rec: string, stream: string, seq: number) => k(`rec/${rec}/${stream}/${String(seq).padStart(6, '0')}`),
  final: (rec: string, name: string) => k(`rec/${rec}/${name}`),
  asset: (rec: string | null, id: string) => k(rec ? `rec/${rec}/assets/${id}` : `assets/${id}`),
  /** prefix of everything a capture owns, for purge */
  recording: (rec: string) => k(`rec/${rec}/`),
  /** instance logo and its renditions by content hash (D-112) */
  brand: (hash: string, name: string) => k(`brand/${hash}/${name}`),
};

export async function s3Ping(): Promise<void> {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
}

export async function putObject(key: string, body: Uint8Array | string, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string, range?: string) {
  return s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// ---------- server-core additions ----------

export async function putObjectWith(
  key: string,
  body: Uint8Array | string,
  opts: { contentType: string; contentEncoding?: string; metadata?: Record<string, string> },
) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: opts.contentType,
      ContentEncoding: opts.contentEncoding,
      Metadata: opts.metadata,
    }),
  );
}

/** Upload a local file without reading it into memory. */
export async function putFile(key: string, path: string, contentType: string) {
  const { size } = await stat(path);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(path), ContentLength: size, ContentType: contentType }));
  return size;
}

export async function getBytes(key: string): Promise<Uint8Array> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return r.Body!.transformToByteArray();
}

export async function headObject(key: string) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

/** Every key under a prefix (already prefixed with S3_KEY_PREFIX by keys.*). */
export async function listKeys(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function deleteKeys(list: string[]) {
  for (let i = 0; i < list.length; i += 1000) {
    const batch = list.slice(i, i + 1000);
    if (!batch.length) continue;
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
  }
}

export async function deletePrefix(prefix: string): Promise<number> {
  const list = await listKeys(prefix);
  await deleteKeys(list);
  return list.length;
}

// Presigned GETs against S3_PUBLIC_URL (large installs: the browser fetches media from S3 directly).

let publicClient: S3Client | null = null;
export async function presignGet(key: string, opts: { contentType?: string; disposition?: string; expiresIn?: number } = {}) {
  if (!env.s3.publicUrl) return null;
  publicClient ??= new S3Client({
    endpoint: env.s3.publicUrl,
    region: env.s3.region,
    forcePathStyle: true,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
  });
  return getSignedUrl(
    publicClient,
    new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: opts.contentType, ResponseContentDisposition: opts.disposition }),
    { expiresIn: opts.expiresIn ?? 3600 },
  );
}
