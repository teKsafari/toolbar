import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env.ts';

export const s3 = new S3Client({
  endpoint: env.s3.endpoint,
  region: env.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
});
export const bucket = env.s3.bucket;

export const keys = {
  chunk: (rec: string, stream: string, seq: number) => `rec/${rec}/${stream}/${String(seq).padStart(6, '0')}`,
  final: (rec: string, name: string) => `rec/${rec}/${name}`,
  asset: (rec: string | null, id: string) => (rec ? `rec/${rec}/assets/${id}` : `assets/${id}`),
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
