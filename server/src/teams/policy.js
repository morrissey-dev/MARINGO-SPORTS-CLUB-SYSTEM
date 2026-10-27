import { InputError, parseId } from '../members/validation.js';

export function requiredId(value,field='id') {
  const id = parseId(value);
  if (!id) throw new InputError('INVALID_ID',`Provide a valid ${field}.`,{[field]:'Use a positive integer identifier.'});
  return id;
}
export function teamName(value) {
  if (typeof value!=='string') throw new InputError('INVALID_TEAM_NAME','Team name is required.');
  const name=value.trim();
  if (name.length<2 || name.length>100 || /[\u0000-\u001f\u007f]/.test(name))
    throw new InputError('INVALID_TEAM_NAME','Team name must have 2–100 printable characters.');
  return name;
}
export function canManageSport(roles, actorId, patronUserId) {
  return roles.includes('ADM') || (roles.includes('PAT') && String(actorId)===String(patronUserId));
}
export function maySeeTeam(roles, actorId, patronUserId) {
  return roles.some(r=>['ADM','MGT'].includes(r)) || canManageSport(roles,actorId,patronUserId);
}
