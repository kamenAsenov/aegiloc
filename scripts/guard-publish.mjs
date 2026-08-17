const confirmationVariable = 'HEALWRIGHT_PUBLISH';
const confirmationValue = 'I_UNDERSTAND_THIS_PUBLISHES_TO_NPM';

if (process.env[confirmationVariable] !== confirmationValue) {
  process.stderr.write(
    [
      'Healwright publication blocked.',
      'Publishing is never part of the normal release or CI workflow.',
      `A maintainer must explicitly set ${confirmationVariable}=${confirmationValue}`,
      'after reviewing package ownership, the dry-run contents, credentials, and the target version.',
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
} else {
  process.stdout.write('Explicit npm publication confirmation accepted; running release gates.\n');
}
