import "server-only";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

let r2Client: S3Client | null = null;

function getConfig(): R2Config {
  const config = {
    accountId: process.env.R2_ACCOUNT_ID?.trim() ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "",
    bucket: process.env.R2_BUCKET_NAME?.trim() ?? "",
  };
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
    throw new Error("Cloudflare R2 尚未配置，请按 10_Cloudflare_R2保姆级配置教程.md 填写环境变量");
  }
  return config;
}

function getR2Client() {
  const config = getConfig();
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return { client: r2Client, bucket: config.bucket };
}

export function isR2Configured() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
}

export async function createR2UploadUrl(input: { objectKey: string; contentType: string }) {
  const { client, bucket } = getR2Client();
  return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: input.objectKey, ContentType: input.contentType }), { expiresIn: 600 });
}

export async function createR2ReadUrl(objectKey: string) {
  const { client, bucket } = getR2Client();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: objectKey }), { expiresIn: 3600 });
}

export async function deleteR2Object(objectKey: string) {
  const { client, bucket } = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}

export function safeR2FileName(fileName: string) {
  const extension = fileName.toLowerCase().match(/\.(mp3|m4a|aac|wav|jpg|jpeg|png|webp)$/)?.[0] ?? "";
  return `${crypto.randomUUID()}${extension}`;
}
