import { addChild, addPartner, addPerson } from './operations';
import { emptyTree, type FamilyTree, type Gender, type Id, type PersonInput } from './types';

const p = (lastName: string, firstName: string, gender: Gender, birthYear?: number, deathYear?: number): PersonInput => ({
  lastName,
  firstName,
  gender,
  birthYear,
  deathYear,
});

/** A small hand-written family used on first start. */
export function sampleTree(): FamilyTree {
  let t = emptyTree();
  let id: Id;
  let janos: Id, maria: Id, istvan: Id, eva: Id, katalin: Id, peter: Id, gabor: Id, anna: Id;
  [t, janos] = addPerson(t, p('Kovács', 'János', 'male', 1932, 2008));
  [t, maria] = addPartner(t, janos, p('Szabó', 'Mária', 'female', 1935, 2015));
  [t, istvan] = addChild(t, janos, p('Kovács', 'István', 'male', 1958), maria);
  [t, katalin] = addChild(t, janos, p('Kovács', 'Katalin', 'female', 1961), maria);
  [t, id] = addChild(t, janos, p('Kovács', 'Ferenc', 'male', 1965, 1990), maria);
  [t, eva] = addPartner(t, istvan, p('Tóth', 'Éva', 'female', 1960));
  [t, peter] = addPartner(t, katalin, p('Nagy', 'Péter', 'male', 1957));
  [t, gabor] = addChild(t, istvan, p('Kovács', 'Gábor', 'male', 1985), eva);
  [t, id] = addChild(t, istvan, p('Kovács', 'Zsófia', 'female', 1988), eva);
  [t, id] = addChild(t, katalin, p('Nagy', 'Bence', 'male', 1983), peter);
  [t, anna] = addChild(t, katalin, p('Nagy', 'Anna', 'female', 1990), peter);
  [t, id] = addPartner(t, gabor, p('Horváth', 'Lilla', 'female', 1987));
  [t, id] = addChild(t, gabor, p('Kovács', 'Máté', 'male', 2014), id);
  [t, id] = addPartner(t, anna, p('Varga', 'Dániel', 'male', 1989));
  [t] = addChild(t, anna, p('Varga', 'Luca', 'female', 2019), id);
  return t;
}

const FIRST_M = ['János', 'István', 'László', 'Péter', 'Gábor', 'Zoltán', 'Attila', 'Tamás', 'Balázs', 'Máté', 'Bence', 'Dávid'];
const FIRST_F = ['Mária', 'Erzsébet', 'Katalin', 'Éva', 'Anna', 'Zsófia', 'Judit', 'Ágnes', 'Eszter', 'Réka', 'Lilla', 'Luca'];
const LAST = ['Kovács', 'Nagy', 'Tóth', 'Szabó', 'Horváth', 'Varga', 'Kiss', 'Molnár', 'Németh', 'Farkas', 'Balogh', 'Papp'];

/**
 * Deterministic pseudo-random tree with roughly `target` people, for performance
 * testing. Builds records directly (not via the immutable operations) so that
 * generating thousands of people stays linear.
 */
export function generateTree(target: number, seed = 1): FamilyTree {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const t = emptyTree();
  let next = 0;
  const add = (gender: Gender, lastName: string, birthYear: number): Id => {
    const id = `g${(next++).toString(36)}`;
    const deathYear = birthYear < 1940 ? birthYear + 50 + Math.floor(rand() * 40) : undefined;
    t.persons[id] = { ...p(lastName, pick(gender === 'male' ? FIRST_M : FIRST_F), gender, birthYear, deathYear), id };
    return id;
  };

  const root = add('male', pick(LAST), 1800);
  const queue: { id: Id; year: number; gender: Gender }[] = [{ id: root, year: 1800, gender: 'male' }];
  while (queue.length && next < target) {
    const cur = queue.shift()!;
    if (rand() < 0.15 && queue.length > 0) continue;
    const partnerGender: Gender = cur.gender === 'male' ? 'female' : 'male';
    const partner = add(partnerGender, pick(LAST), cur.year + Math.floor(rand() * 6) - 3);
    const father = cur.gender === 'male' ? cur.id : partner;
    const union = { id: `gu${next.toString(36)}`, partners: [cur.id, partner], children: [] as Id[] };
    t.unions[union.id] = union;
    const kids = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < kids && next < target; k++) {
      const gender: Gender = rand() < 0.5 ? 'male' : 'female';
      const year = cur.year + 22 + Math.floor(rand() * 15);
      const child = add(gender, t.persons[father].lastName, year);
      union.children.push(child);
      queue.push({ id: child, year, gender });
    }
  }
  return t;
}
