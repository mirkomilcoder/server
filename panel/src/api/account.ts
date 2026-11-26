import { runAction } from './run';

/*
 * Own password change. `passwd` runs in a pty as the logged-in user (PAM checks
 * the current password and the system password policy); we answer its prompts.
 * Passwords are only ever written to the pty — never to argv, logs or storage.
 */

export type PasswdError = 'wrong-current' | 'weak' | 'failed';

export class PasswordChangeError extends Error {
  constructor(readonly kind: PasswdError, readonly details: string) {
    super(kind);
  }
}

/** Strip prompts/blank lines so only passwd's own messages are shown to the user. */
function messages(out: string): string {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/password:\s*$/i.test(l) && !/^changing password/i.test(l))
    .join('\n')
    .slice(0, 400);
}

export async function changePassword(current: string, next: string): Promise<void> {
  const ctl = new AbortController();
  let seen = '';
  let rest = '';
  let sentCurrent = false;
  let newPrompts = 0;
  let retyped = false;

  try {
    await runAction('account.passwd', {}, {
      signal: ctl.signal,
      onOutput: (chunk, send) => {
        seen += chunk;
        rest += chunk;
        // answer each prompt once, in order; "Retype new password:" also contains "new password:"
        for (;;) {
          const m = /(current password:|\(current\) unix password:|retype new password:|new password:)\s*/i.exec(rest);
          if (!m) break;
          rest = rest.slice(m.index + m[0].length);
          const prompt = m[1].toLowerCase();
          if (prompt.startsWith('retype')) {
            retyped = true;
            send(next + '\n');
          } else if (prompt.startsWith('new')) {
            // asked again = the new password was rejected (policy); stop instead of looping
            if (++newPrompts > 1) return ctl.abort();
            send(next + '\n');
          } else if (!sentCurrent) {
            sentCurrent = true;
            send(current + '\n');
          } else {
            return ctl.abort();
          }
        }
      },
    });
  } catch {
    const text = messages(seen);
    if (/BAD PASSWORD|too short|too simple|dictionary|palindrome|similar|not enough/i.test(text) || newPrompts > 1) {
      throw new PasswordChangeError('weak', text);
    }
    if (!retyped || /authentication token manipulation|authentication failure/i.test(text)) {
      throw new PasswordChangeError('wrong-current', text);
    }
    throw new PasswordChangeError('failed', text);
  }
}
