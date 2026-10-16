/**
 * What a NEW password must satisfy (CAMP-228). Sign-in does not call this:
 * someone who already has a password must be able to type it, whatever it is.
 *
 * 🔴 ONE REQUIREMENT, AND IT IS LENGTH. The mockup (`07-account.html`) says it
 * in so many words: no "an upper-case letter and a digit", which marries
 * people to `Password1!` and makes passwords worse. What it does ask for, on
 * top of length, is that the commonest passwords are turned away by a list.
 *
 * 🔴 THE LIST BELOW IS A FLOOR, NOT A CORPUS. It was written by hand from
 * memory of the passwords every published breach list leads with, keeping
 * only those that clear `MIN_LENGTH` (shorter ones are already refused by the
 * length rule). Nobody measured it against a real list, and it is a few dozen
 * entries where the published ones run to thousands or more. It stops the laziest
 * ten-character choices and nothing cleverer. Replacing it with a published
 * list (a file we would have to download and licence-check) is the open
 * follow-up, and it is named in the PR rather than hidden here.
 */
export const MIN_LENGTH = 10;

/**
 * Past this a password is refused before any hashing. scrypt's cost does not
 * grow with length, but NFKC normalisation and the JSON body do, and a limit
 * somebody can type into a password manager is a limit nobody meets by
 * accident.
 */
export const MAX_LENGTH = 128;

export type PasswordProblem = 'too-short' | 'too-long' | 'common' | 'is-email';

/**
 * Що сторінка каже людині за кожну причину відмови.
 *
 * 🔴 ЖИВЕ ПОРУЧ ІЗ `PasswordProblem`, А НЕ В КОНТРОЛЕРІ, бо контролерів, що
 * приймають новий пароль, тепер двоє: `auth` (скидання за посиланням) і
 * `account` (зміна в налаштуваннях, CAMP-229). Дві копії цієї мапи розійшлись
 * би першою ж правкою формулювання, і та сама відмова звучала б на двох
 * екранах по-різному. `Record<PasswordProblem, string>` до того ж не дасть
 * додати причину й забути слова до неї.
 */
export const PASSWORD_MESSAGE: Record<PasswordProblem, string> = {
  'too-short': 'Use at least 10 characters.',
  'too-long': 'Use at most 128 characters.',
  common: 'That password is on the list of the most common ones. Pick another.',
  'is-email': 'The password must not be your email address.',
};

/** Lower-case, every entry at least `MIN_LENGTH` long. */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '1234567890',
  '0123456789',
  '9876543210',
  '0987654321',
  '1234567891',
  '12345678910',
  '123456789012',
  '1234512345',
  '123456789a',
  'qwertyuiop',
  'qwertyuiop1',
  'qwerty1234',
  'qwerty12345',
  'qwertyuiop123',
  'qwertyuiopasdfghjkl',
  'asdfghjkl1',
  'asdfghjklqwerty',
  '1q2w3e4r5t',
  '1q2w3e4r5t6y',
  'q1w2e3r4t5',
  'q1w2e3r4t5y6',
  '1qaz2wsx3edc',
  'qazwsxedcrfv',
  'zaq12wsxcde3',
  'abcdefghij',
  'abcd123456',
  'abc1234567',
  'password123',
  'password1234',
  'password12345',
  'passw0rd123',
  'iloveyou12',
  'iloveyou123',
  'iloveyou1234',
  'letmein123',
  'welcome123',
  'changeme123',
  'administrator',
  'monkey12345',
  'football123',
  'baseball123',
  'superman123',
  'trustno1234',
  'camptribe123',
]);

/**
 * `null` when the password may be used, otherwise the first rule it breaks.
 *
 * Length is counted the way the hash sees the password: NFKC-normalised
 * (`hashPassword` and `verifyPassword` both normalise), in code points rather
 * than UTF-16 units. A ten-character password of emoji must not be refused
 * for being twenty "characters" long, nor a nine-character one passed for the
 * same reason.
 */
export function checkNewPassword(
  password: unknown,
  email: string,
): PasswordProblem | null {
  if (typeof password !== 'string') return 'too-short';
  const normal = password.normalize('NFKC');
  const length = [...normal].length;
  if (length < MIN_LENGTH) return 'too-short';
  if (length > MAX_LENGTH) return 'too-long';
  const folded = normal.toLowerCase();
  if (folded === email || folded === email.split('@')[0]) return 'is-email';
  // One character repeated is not on a list because the list would be
  // infinite; it is a pattern.
  if (/^(.)\1+$/su.test(folded)) return 'common';
  if (COMMON_PASSWORDS.has(folded)) return 'common';
  return null;
}
