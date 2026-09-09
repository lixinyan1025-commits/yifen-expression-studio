import { openDB, type DBSchema } from 'idb';
import type { Note, Session, VaultSnapshot } from '../shared/types';
interface Store extends DBSchema {
  notes: { key: string; value: Note };
  sessions: { key: string; value: Session };
}
export const database = openDB<Store>('yifen-expression', 1, {
  upgrade(db) {
    db.createObjectStore('notes', { keyPath: 'id' });
    db.createObjectStore('sessions', { keyPath: 'id' });
  },
});
export const storage = {
  notes: async () => (await database).getAll('notes'),
  sessions: async () => (await database).getAll('sessions'),
  saveNotes: async (notes: Note[]) => {
    const tx = (await database).transaction('notes', 'readwrite');
    for (const n of notes) await tx.store.put(n);
    await tx.done;
  },
  saveSession: async (session: Session) => (await database).put('sessions', session),
  syncVault: async (snapshot: VaultSnapshot) => {
    const tx = (await database).transaction('notes', 'readwrite');
    const existing = await tx.store.getAll();
    const incoming = new Set(snapshot.notes.map((n) => n.id));
    for (const n of existing) {
      if (n.source?.kind === 'obsidian' && !incoming.has(n.id)) await tx.store.delete(n.id);
    }
    for (const n of snapshot.notes) {
      const previous = existing.find((p) => p.id === n.id);
      await tx.store.put({ ...n, importedAt: previous?.importedAt || n.importedAt });
    }
    await tx.done;
    return (await database).getAll('notes');
  },
  deleteNote: async (id: string) => (await database).delete('notes', id),
  deleteSession: async (id: string) => (await database).delete('sessions', id),
};
