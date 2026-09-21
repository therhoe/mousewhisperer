import { spawnSync } from "node:child_process";

const maxAttempts = Number(process.env.PRISMA_MIGRATE_ATTEMPTS || 4);
const baseDelay = Number(process.env.PRISMA_MIGRATE_RETRY_SECONDS || 3);

const sleep = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
  });

  if (result.status === 0) {
    process.exit(0);
  }

  if (attempt === maxAttempts) {
    process.exit(1);
  }

  const delay = baseDelay * attempt;
  console.log(
    `Prisma migrate deploy failed. Retrying in ${delay}s (${attempt + 1}/${maxAttempts})...`,
  );
  await sleep(delay);
}
