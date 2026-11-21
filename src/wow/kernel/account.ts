import { sha256, uniqueId } from '../hal/platform';
import { preferences } from '../hal/storage';

const ACCOUNT_KEY = 'kernel:account:v1';

export const WIN11_SECURITY_QUESTIONS = [
  '你的童年昵称是什么？',
  '你第一只宠物的名字是什么？',
  '你出生城市的名称是什么？',
  '你最喜欢的食物是什么？',
  '你最喜欢的老师叫什么名字？',
  '你最大的兄弟姐妹的中间名是什么？',
] as const;

export interface SecurityQuestionEntry {
  question: string;
  answerHash: string;
}

interface StoredAccountRecord {
  oobeCompleted: boolean;
  username: string;
  salt: string;
  passwordHash: string | null;
  securityQuestions: SecurityQuestionEntry[];
}

export interface PublicAccountState {
  oobeCompleted: boolean;
  username: string;
  hasPassword: boolean;
  questions: string[];
}

const listeners = new Set<(state: PublicAccountState) => void>();

async function hashSecret(salt: string, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${value}`);
  return sha256(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function readRecord(): StoredAccountRecord | null {
  try {
    const raw = preferences.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAccountRecord>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.username !== 'string') return null;
    return {
      oobeCompleted: Boolean(parsed.oobeCompleted),
      username: parsed.username.trim() || 'Administrator',
      salt: typeof parsed.salt === 'string' && parsed.salt ? parsed.salt : uniqueId(),
      passwordHash: typeof parsed.passwordHash === 'string' ? parsed.passwordHash : null,
      securityQuestions: Array.isArray(parsed.securityQuestions)
        ? parsed.securityQuestions.filter(
            (q): q is SecurityQuestionEntry =>
              Boolean(q && typeof q.question === 'string' && typeof q.answerHash === 'string'),
          )
        : [],
    };
  } catch {
    return null;
  }
}

function writeRecord(record: StoredAccountRecord | null) {
  try {
    if (!record) preferences.removeItem(ACCOUNT_KEY);
    else preferences.setItem(ACCOUNT_KEY, JSON.stringify(record));
  } catch {}
  const state = getAccountState();
  listeners.forEach((fn) => fn(state));
}

export function getAccountState(): PublicAccountState {
  const rec = readRecord();
  if (!rec) {
    return {
      oobeCompleted: false,
      username: 'Administrator',
      hasPassword: false,
      questions: [],
    };
  }
  return {
    oobeCompleted: rec.oobeCompleted,
    username: rec.username,
    hasPassword: Boolean(rec.passwordHash),
    questions: rec.securityQuestions.map((q) => q.question),
  };
}

export function subscribeAccount(listener: (state: PublicAccountState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function skipOobeAsAdministrator(): PublicAccountState {
  writeRecord({
    oobeCompleted: true,
    username: 'Administrator',
    salt: uniqueId(),
    passwordHash: null,
    securityQuestions: [],
  });
  return getAccountState();
}

export async function completeOobe(input: {
  username: string;
  password?: string;
  securityQuestions?: Array<{ question: string; answer: string }>;
}): Promise<PublicAccountState> {
  const cleanName = input.username.trim();
  if (!cleanName) throw new Error('请输入用户名');
  const salt = uniqueId();
  const pwd = input.password ?? '';
  let passwordHash: string | null = null;
  const hashedQuestions: SecurityQuestionEntry[] = [];

  if (pwd.length > 0) {
    const qa = input.securityQuestions ?? [];
    if (qa.length !== 3) throw new Error('设置密码时必须填写 3 个安全问题');
    const seen = new Set<string>();
    for (const item of qa) {
      const q = item.question.trim();
      const a = item.answer.trim();
      if (!q || !a) throw new Error('请完整选择安全问题并填写答案');
      if (seen.has(q)) throw new Error('3 个安全问题不能重复');
      seen.add(q);
      hashedQuestions.push({
        question: q,
        answerHash: await hashSecret(salt, a.toLowerCase()),
      });
    }
    passwordHash = await hashSecret(salt, pwd);
  }

  writeRecord({
    oobeCompleted: true,
    username: cleanName,
    salt,
    passwordHash,
    securityQuestions: hashedQuestions,
  });
  return getAccountState();
}

export async function verifyAccountPassword(password: string): Promise<boolean> {
  const rec = readRecord();
  if (!rec || !rec.passwordHash) return true;
  const candidate = await hashSecret(rec.salt, password);
  return candidate === rec.passwordHash;
}

export async function verifySecurityAnswers(answers: readonly string[]): Promise<boolean> {
  const rec = readRecord();
  if (!rec || rec.securityQuestions.length !== 3 || answers.length !== 3) return false;
  for (let i = 0; i < 3; i += 1) {
    const candidate = await hashSecret(rec.salt, answers[i].trim().toLowerCase());
    if (candidate !== rec.securityQuestions[i].answerHash) return false;
  }
  return true;
}

export async function resetPasswordWithAnswers(
  answers: readonly string[],
  nextPassword: string,
): Promise<boolean> {
  const ok = await verifySecurityAnswers(answers);
  if (!ok) return false;
  const rec = readRecord();
  if (!rec) return false;
  const nextHash = nextPassword.length > 0 ? await hashSecret(rec.salt, nextPassword) : null;
  writeRecord({
    ...rec,
    passwordHash: nextHash,
  });
  return true;
}

export function resetAccountOobe(): void {
  writeRecord(null);
}
