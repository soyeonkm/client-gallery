import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function test() {
  try {
    console.log("Attempting upload to bucket:", process.env.R2_BUCKET_NAME);
    const res = await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: 'test.txt',
      Body: 'hello world'
    }));
    console.log("Success:", res);
  } catch (err) {
    console.log("Error:", err.Code, err.$metadata?.httpStatusCode, err.message);
  }
}
test();
