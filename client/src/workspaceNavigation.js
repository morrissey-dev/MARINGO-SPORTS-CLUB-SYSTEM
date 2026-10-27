// Part 13 — presentation-only, role-aware navigation.
// Backend resource permissions remain authoritative; links do not grant access.
export const WORKSPACE_LINKS = Object.freeze([
  {id:'workspace-registration', label:'Member registration', roles:['REG','ADM']},
  {id:'workspace-directory', label:'Member directory', roles:['REG','ADM']},
  {id:'workspace-guardian', label:'Guardian review', roles:['ADM','MGT']},
  {id:'workspace-payments', label:'Payments', roles:['ADM','REG','FIN','MGT']},
  {id:'workspace-teams', label:'Sports and teams', roles:['ADM','MGT','PAT']},
  {id:'workspace-events', label:'Sporting events', roles:['ADM','MGT','PAT','FIN']},
  {id:'workspace-store', label:'Store and sales', roles:['ADM','STO','FIN','MGT']},
  {id:'workspace-equipment', label:'Equipment', roles:['ADM','MGT','STO','FIN','PAT']},
  {id:'workspace-reports', label:'Club reports', roles:['ADM','MGT','FIN','REG','STO']},
]);

export function visibleWorkspaces(roles) {
  if (!Array.isArray(roles)) return [];
  return WORKSPACE_LINKS.filter(item=>item.roles.some(role=>roles.includes(role)));
}
