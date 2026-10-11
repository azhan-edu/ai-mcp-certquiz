import { execFileSync, spawnSync } from "node:child_process";

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const forbidden = [
  /^\.env$/,
  /^CLAUDE\.local\.md$/,
  /^\.claude\/settings\.local\.json$/,
  /^raw-data\//,
  /^data\/.*\.db(-.*)?$/,
];

const blocked = staged.filter((file) => forbidden.some((re) => re.test(file)));
if (blocked.length > 0) {
  console.error("pre-commit: these files must not be committed:");
  for (const file of blocked) console.error(`  ${file}`);
  console.error("Unstage them with: git restore --staged <file>");
  process.exit(1);
}

const touched = (re) => staged.some((file) => re.test(file));
if (
  touched(/^src\/db\/schema\.sql$/) &&
  !touched(/^src\/db\/(seed|import|repository)/) &&
  !touched(/^tests\//)
) {
  console.warn("pre-commit warning: schema.sql changed without seed, repository or tests changes.");
}

const steps = [
  ["npx", ["biome", "check", "--staged", "--no-errors-on-unmatched"]],
  ["npm", ["run", "--silent", "typecheck"]],
  ["npm", ["test", "--silent"]],
];

for (const [cmd, args] of steps) {
  console.log(`pre-commit: ${cmd} ${args.join(" ")}`);
  const { status } = spawnSync(cmd, args, { stdio: "inherit" });
  if (status !== 0) process.exit(status ?? 1);
}
