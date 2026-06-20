import { existsSync } from 'fs';

import mongoose from 'mongoose';

async function main() {
  const environment = process.env.NODE_ENV ?? 'development';
  for (const path of [`.env.${environment}`, '.env.local', '.env']) {
    if (existsSync(path)) process.loadEnvFile(path);
  }
  const uri = process.env.MONGODB_URI;
  const legacyEmail = process.env.LEGACY_ADMIN_EMAIL?.trim().toLowerCase();
  const apply = process.argv.includes('--apply');
  if (!uri || !legacyEmail) {
    throw new Error('MONGODB_URI and LEGACY_ADMIN_EMAIL are required');
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection unavailable');
  const users = db.collection('users');
  const sessions = db.collection('refresh_tokens');
  const matches = await users
    .find({ email: legacyEmail, role: 'ADMIN' })
    .toArray();
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one legacy administrator; found ${matches.length}`,
    );
  }

  const user = matches[0];
  const sessionCount = await sessions.countDocuments({ userId: user._id });
  console.info(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      userId: user._id,
      email: user.email,
      sessions: sessionCount,
    }),
  );
  if (apply) {
    await sessions.deleteMany({ userId: user._id });
    await users.deleteOne({ _id: user._id });
    console.info('Legacy administrator credentials and sessions removed');
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
