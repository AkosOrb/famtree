import type { FamilyTree, Gender, Id, Person, Union } from './types';
import { emptyTree } from './types';

/**
 * Minimal GEDCOM 5.5.1 support: individuals (name, sex, birth/death year, note)
 * and families (partners + children). Enough to move trees between this app
 * and common genealogy software; other records are ignored on import.
 */

const SEX_OUT: Record<Gender, string> = { male: 'M', female: 'F', other: 'X', unknown: 'U' };
const SEX_IN: Record<string, Gender> = { M: 'male', F: 'female', X: 'other', U: 'unknown' };

export function exportGedcom(tree: FamilyTree): string {
  const lines = ['0 HEAD', '1 SOUR famtree', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];
  const indi = new Map<Id, string>();
  const fam = new Map<Id, string>();
  Object.keys(tree.persons).forEach((id, i) => indi.set(id, `@I${i + 1}@`));
  Object.keys(tree.unions).forEach((id, i) => fam.set(id, `@F${i + 1}@`));

  const famsOf = new Map<Id, Id[]>();
  const famcOf = new Map<Id, Id>();
  for (const u of Object.values(tree.unions)) {
    u.partners.forEach((p) => famsOf.set(p, [...(famsOf.get(p) ?? []), u.id]));
    u.children.forEach((c) => famcOf.set(c, u.id));
  }

  for (const p of Object.values(tree.persons)) {
    lines.push(`0 ${indi.get(p.id)} INDI`);
    lines.push(`1 NAME ${[clean(p.firstName), `/${clean(p.lastName)}/`].filter(Boolean).join(' ')}`);
    if (p.firstName) lines.push(`2 GIVN ${clean(p.firstName)}`);
    if (p.lastName) lines.push(`2 SURN ${clean(p.lastName)}`);
    lines.push(`1 SEX ${SEX_OUT[p.gender]}`);
    if (p.birthYear != null) lines.push('1 BIRT', `2 DATE ${p.birthYear}`);
    if (p.deathYear != null) lines.push('1 DEAT', `2 DATE ${p.deathYear}`);
    if (p.notes) {
      const [first, ...rest] = p.notes.split(/\r?\n/);
      lines.push(`1 NOTE ${first}`, ...rest.map((l) => `2 CONT ${l}`));
    }
    const famc = famcOf.get(p.id);
    if (famc) lines.push(`1 FAMC ${fam.get(famc)}`);
    for (const f of famsOf.get(p.id) ?? []) lines.push(`1 FAMS ${fam.get(f)}`);
  }

  for (const u of Object.values(tree.unions)) {
    lines.push(`0 ${fam.get(u.id)} FAM`);
    // GEDCOM 5.5.1 only knows HUSB/WIFE; pick by gender where possible.
    const female = (p: Id) => tree.persons[p]?.gender === 'female';
    const wife = u.partners.length === 2 ? (female(u.partners[0]) ? u.partners[0] : u.partners[1]) : u.partners.find(female);
    for (const p of u.partners) lines.push(`1 ${p === wife ? 'WIFE' : 'HUSB'} ${indi.get(p)}`);
    for (const c of u.children) lines.push(`1 CHIL ${indi.get(c)}`);
  }

  lines.push('0 TRLR');
  return lines.join('\n') + '\n';
}

const clean = (s: string) => s.replace(/[/\r\n]/g, ' ').trim();

interface Node {
  level: number;
  xref?: string;
  tag: string;
  value: string;
  children: Node[];
}

function parse(text: string): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const m = raw.trim().match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/);
    if (!m) continue;
    const node: Node = { level: Number(m[1]), xref: m[2], tag: m[3].toUpperCase(), value: m[4] ?? '', children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

const child = (n: Node, tag: string) => n.children.find((c) => c.tag === tag);

const year = (n: Node | undefined): number | undefined => {
  const date = n && child(n, 'DATE')?.value;
  const m = date?.match(/(\d{3,4})(?!.*\d{3,4})/);
  return m ? Number(m[1]) : undefined;
};

const noteText = (n: Node): string =>
  n.children.reduce((s, c) => (c.tag === 'CONT' ? `${s}\n${c.value}` : c.tag === 'CONC' ? s + c.value : s), n.value);

export function importGedcom(text: string): FamilyTree {
  const records = parse(text);
  if (!records.some((r) => r.tag === 'HEAD')) throw new Error('Ez nem GEDCOM fájl (hiányzik a HEAD rekord).');
  const tree = emptyTree();
  const ids = new Map<string, Id>();

  records
    .filter((r) => r.tag === 'INDI' && r.xref)
    .forEach((r, i) => {
      const id = `ged_i${i + 1}`;
      ids.set(r.xref!, id);
      const name = child(r, 'NAME');
      const nameMatch = name?.value.match(/^([^/]*)\/([^/]*)\/?(.*)$/);
      const given = name && child(name, 'GIVN')?.value;
      const surname = name && child(name, 'SURN')?.value;
      const notes = r.children.filter((c) => c.tag === 'NOTE' && !c.value.startsWith('@')).map(noteText).join('\n');
      const person: Person = {
        id,
        firstName: (given ?? (nameMatch ? `${nameMatch[1]} ${nameMatch[3]}` : name?.value ?? '')).trim(),
        lastName: (surname ?? nameMatch?.[2] ?? '').trim(),
        gender: SEX_IN[child(r, 'SEX')?.value.trim().toUpperCase() ?? ''] ?? 'unknown',
        birthYear: year(child(r, 'BIRT')),
        deathYear: year(child(r, 'DEAT')),
      };
      if (notes) person.notes = notes;
      tree.persons[id] = person;
    });

  const hasParents = new Set<Id>();
  records
    .filter((r) => r.tag === 'FAM')
    .forEach((r, i) => {
      const ref = (c: Node) => ids.get(c.value.trim());
      const partners = r.children
        .filter((c) => c.tag === 'HUSB' || c.tag === 'WIFE')
        .map(ref)
        .filter((id): id is Id => !!id);
      const children = r.children
        .filter((c) => c.tag === 'CHIL')
        .map(ref)
        .filter((id): id is Id => !!id && !hasParents.has(id) && !partners.includes(id));
      // The model needs at least one partner, and a lone partner only with children.
      if (!partners.length || (partners.length === 1 && !children.length)) return;
      children.forEach((c) => hasParents.add(c));
      const union: Union = { id: `ged_f${i + 1}`, partners: [...new Set(partners)].slice(0, 2), children };
      tree.unions[union.id] = union;
    });

  return tree;
}
