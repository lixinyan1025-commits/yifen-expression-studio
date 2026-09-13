import { parseNote } from '../shared/notes';
import type { Note, VaultSnapshot } from '../shared/types';

export type EncryptedKnowledge = {
  version: 1;
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  id: string;
  noteCount: number;
  updatedAt: string;
};

type PackedNote = Pick<Note, 'id' | 'filename' | 'raw'> & {
  relativePath: string;
  modifiedAt: string;
  isIndex: boolean;
};
type PackedKnowledge = { version: 1; syncedAt: string; rootId: string; notes: PackedNote[] };

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const base64Bytes = (value: string) => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('知识库密文格式无效。');
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
};

function validEnvelope(value: unknown): value is EncryptedKnowledge {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    item.version === 1 &&
    item.algorithm === 'AES-256-GCM' &&
    item.kdf === 'PBKDF2-SHA256' &&
    typeof item.iterations === 'number' &&
    item.iterations >= 100000 &&
    item.iterations <= 1000000 &&
    typeof item.salt === 'string' &&
    typeof item.iv === 'string' &&
    typeof item.ciphertext === 'string' &&
    item.ciphertext.length <= 30000000 &&
    typeof item.id === 'string' &&
    typeof item.noteCount === 'number' &&
    item.noteCount >= 1 &&
    item.noteCount <= 1000 &&
    typeof item.updatedAt === 'string'
  );
}

export async function loadEncryptedKnowledge(base = import.meta.env.BASE_URL) {
  const response = await fetch(`${base}knowledge.enc.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('暂时无法读取加密知识库，请检查网络后重试。');
  const value: unknown = await response.json();
  if (!validEnvelope(value)) throw new Error('加密知识库版本或格式无效。');
  return value;
}

export async function decryptKnowledge(
  envelope: EncryptedKnowledge,
  password: string,
): Promise<VaultSnapshot> {
  try {
    const material = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: base64Bytes(envelope.salt),
        iterations: envelope.iterations,
        hash: 'SHA-256',
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64Bytes(envelope.iv) },
      key,
      base64Bytes(envelope.ciphertext),
    );
    const packed: unknown = JSON.parse(decoder.decode(decrypted));
    if (!packed || typeof packed !== 'object') throw new Error('invalid payload');
    const payload = packed as Partial<PackedKnowledge>;
    if (
      payload.version !== 1 ||
      typeof payload.syncedAt !== 'string' ||
      typeof payload.rootId !== 'string' ||
      !Array.isArray(payload.notes) ||
      payload.notes.length !== envelope.noteCount ||
      payload.notes.length > 1000
    )
      throw new Error('invalid payload');
    let bytes = 0;
    const notes = payload.notes.map((item): Note => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.filename !== 'string' ||
        typeof item.raw !== 'string' ||
        typeof item.relativePath !== 'string' ||
        typeof item.modifiedAt !== 'string' ||
        typeof item.isIndex !== 'boolean' ||
        item.raw.length > 1000000
      )
        throw new Error('invalid note');
      bytes += encoder.encode(item.raw).length;
      if (bytes > 20000000) throw new Error('knowledge too large');
      const note = parseNote(item.raw, item.filename, item.id);
      note.source = {
        kind: 'obsidian',
        rootId: payload.rootId!,
        relativePath: item.relativePath,
        modifiedAt: item.modifiedAt,
        isIndex: item.isIndex,
      };
      return note;
    });
    return {
      configured: true,
      rootPath: '加密内置知识库/01-智慧',
      rootId: payload.rootId,
      notes,
      syncedAt: payload.syncedAt,
    };
  } catch {
    throw new Error('密码不正确或知识库文件损坏，请重新输入。');
  }
}
