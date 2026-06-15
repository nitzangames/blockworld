// Tracks connected visitors and their build rights. The owner is always allowed and is not
// stored in the table.
export function createPermissions(ownerId) {
  const players = new Map(); // userId -> { name, canEdit }
  return {
    add(userId, name) { if (!players.has(userId)) players.set(userId, { name: name || 'Player', canEdit: false }); },
    remove(userId) { players.delete(userId); },
    set(userId, canEdit) { const p = players.get(userId); if (p) p.canEdit = !!canEdit; },
    canEdit(userId) {
      if (userId === ownerId) return true;
      const p = players.get(userId);
      return !!(p && p.canEdit);
    },
    list() { return [...players.entries()].map(([userId, p]) => ({ userId, name: p.name, canEdit: p.canEdit })); },
  };
}
