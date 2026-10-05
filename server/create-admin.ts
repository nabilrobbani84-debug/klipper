import 'dotenv/config';
import { hashPassword } from './auth.js';
import { Repository, runMigrations } from './db.js';

/** Usage: bun run admin:create -- admin@example.com 'a-long-password' */
const [email, password] = process.argv.slice(2).filter((arg) => arg !== '--');
if (!process.env.DATABASE_URL || !email || !password || password.length < 10) {
  console.error('Usage: DATABASE_URL=... tsx server/create-admin.ts <email> <password (min 10 chars)>');
  process.exit(1);
}
const repository = new Repository({ DATABASE_URL: process.env.DATABASE_URL });
try {
  await runMigrations(repository.pool);
  const existing = await repository.findUserByEmail(email);
  if (existing) {
    await repository.setUserRole(existing.id, 'admin');
    console.log(`Promoted ${email} to admin.`);
  } else {
    await repository.registerUser({ email, passwordHash: await hashPassword(password), role: 'admin' });
    console.log(`Created admin ${email}.`);
  }
} finally {
  await repository.close();
}
