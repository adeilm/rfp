/**
 * references.js - The references slide when the tender's own evidence names no project.
 *
 * Only OliveSoft's real delivered projects (knowledge-base/projects/olivesoft_*), never a demo record and never
 * a project written by the LLM. Order: projects using the tender's technologies, then projects of the department
 * (knowledge-base/tech_stacks: BI & Dashboarding, Data Integration...) whose stack the tender asks for.
 * Nothing when the RAG fit is under 80 %: OliveSoft would not take that tender, the slide stays [TO FILL].
 */

const MIN_FIT = 0.8;
const CLOUD = new Set(['azure', 'aws', 'gcp', 'google cloud']);

function techList(v) {
  if (Array.isArray(v)) return v.map(x => String(x).toLowerCase().trim()).filter(Boolean);
  // tech_stacks records store the list as a string: "['power bi', 'tableau']"
  if (typeof v === 'string') return (v.match(/'([^']+)'|"([^"]+)"/g) || []).map(x => x.slice(1, -1).toLowerCase().trim());
  return [];
}

function mentions(text, tech) {
  const esc = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(text);
}

/** Real, completed OliveSoft projects of the catalog (demo records and ongoing work are never references). */
function realProjects(catalog) {
  return ((catalog && catalog.projects) || []).filter(p => p && p.type === 'past_project'
    && p.origin !== 'demo' && !/^demo[_-]/i.test(p.id || '') && (p.delivery_status || 'completed') === 'completed');
}

function asReference(p, basis, department) {
  const client = p.client && !/not named/i.test(p.client) ? p.client : null;
  return { name: p.title, client, year: p.year || null, result: p.outcomes || p.company_role || p.description || null,
    stack: techList(p.technologies), basis, department: department || null };
}

/**
 * Up to `limit` references for a tender: same technologies first, then the department's projects.
 * `tenderText` = the tender's requirements and excerpt; `fit` = the RAG fit (0..1, null when unknown).
 */
function catalogReferences(catalog, tenderText, fit, limit = 3) {
  if (typeof fit !== 'number' || fit < MIN_FIT) return [];
  const text = String(tenderText || '').toLowerCase();
  const projects = realProjects(catalog);
  const vocabulary = new Set(projects.flatMap(p => techList(p.technologies)));
  ((catalog && catalog.stacks) || []).forEach(s => techList(s.technologies).forEach(t => vocabulary.add(t)));
  const asked = [...vocabulary].filter(t => mentions(text, t));
  if (!asked.length) return [];

  // a cloud provider alone says little about the work ("Azure" is in a Kubeflow and a Power BI project alike): half weight
  const weight = t => (CLOUD.has(t) ? 0.5 : 1);
  const overlap = list => techList(list).filter(t => asked.includes(t)).reduce((s, t) => s + weight(t), 0);
  const bySameTech = projects.map(p => ({ p, n: overlap(p.technologies) })).filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || (b.p.year || 0) - (a.p.year || 0));
  const out = bySameTech.slice(0, limit).map(x => asReference(x.p, 'technology'));
  if (out.length >= limit) return out;

  // the department: the stack(s) sharing the most technologies with the tender
  const stacks = ((catalog && catalog.stacks) || []).filter(s => s.origin !== 'demo' && !/^demo[_-]/i.test(s.id || ''))
    .map(s => ({ s, n: overlap(s.technologies) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  if (!stacks.length) return out;
  const dept = stacks[0].s;
  const deptTech = techList(dept.technologies);
  const label = String(dept.title || '').replace(/^OliveSoft\s+/i, '').replace(/\s+stack$/i, '');
  const taken = new Set(out.map(r => r.name));
  projects.filter(p => !taken.has(p.title) && techList(p.technologies).some(t => deptTech.includes(t)))
    .sort((a, b) => (b.year || 0) - (a.year || 0))
    .slice(0, limit - out.length).forEach(p => out.push(asReference(p, 'department', label)));
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { catalogReferences, realProjects, techList, MIN_FIT };
}
