const { spawn } = require('node:child_process');

const systemCaFlag = '--use-system-ca';
const supportsSystemCa = process.allowedNodeEnvironmentFlags.has(systemCaFlag);
const nestArgs = process.argv
  .slice(2)
  .filter((arg) => arg !== '--print-config');

const env = { ...process.env };
delete env.NODE_TLS_REJECT_UNAUTHORIZED;

if (supportsSystemCa) {
  const nodeOptions = env.NODE_OPTIONS?.trim() ?? '';
  if (!nodeOptions.split(/\s+/).includes(systemCaFlag)) {
    env.NODE_OPTIONS = `${nodeOptions} ${systemCaFlag}`.trim();
  }
}

if (process.argv.includes('--print-config')) {
  process.stdout.write(
    `${JSON.stringify({ supportsSystemCa, node: process.version, nodeOptions: env.NODE_OPTIONS ?? '' })}\n`,
  );
  process.exit(0);
}

const nodeArgs = [];
if (supportsSystemCa) {
  nodeArgs.push(systemCaFlag);
} else {
  process.stderr.write(
    'Node does not support --use-system-ca. Use Node 22.15+ or configure NODE_EXTRA_CA_CERTS with the trusted root CA.\n',
  );
}

nodeArgs.push(require.resolve('@nestjs/cli/bin/nest.js'));
nodeArgs.push(...(nestArgs.length > 0 ? nestArgs : ['start']));

const child = spawn(process.execPath, nodeArgs, {
  env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  process.stderr.write(`Failed to start NestJS: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 1));
