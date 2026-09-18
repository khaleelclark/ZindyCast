/** Attempt every close, even after a failure. Never expose error details/secrets. */
export function closeRepositories(repositories: readonly { close(): void }[]): number {
  let failures = 0;
  for (const repository of repositories) {
    try { repository.close(); } catch { failures++; }
  }
  return failures;
}
